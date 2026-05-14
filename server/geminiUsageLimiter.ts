import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { TrpcContext } from "./_core/context";
import {
  MAX_BATCH_SIZE,
  MAX_IMAGES_PER_DAY,
  MAX_IMAGES_PER_USER_PER_DAY,
  type GeminiLimitType,
  type GeminiUsageSnapshot,
} from "@shared/geminiLimits";

interface UsageFile {
  day: string;
  globalUsed: number;
  users: Record<string, number>;
}

interface LimitResult {
  allowed: boolean;
  limitType?: GeminiLimitType;
  message?: string;
  usage: GeminiUsageSnapshot;
}

const RESET_TIMEZONE = "America/Los_Angeles" as const;
const DATA_DIR = process.env.GRADEFLOW_DATA_DIR
  ? path.resolve(process.env.GRADEFLOW_DATA_DIR)
  : process.env.TONELAB_DATA_DIR
    ? path.resolve(process.env.TONELAB_DATA_DIR)
    : process.env.PIXELBOARD_DATA_DIR
      ? path.resolve(process.env.PIXELBOARD_DATA_DIR)
      : path.resolve(process.cwd(), ".gradeflow");
const LEGACY_USAGE_FILES = [
  process.env.TONELAB_DATA_DIR
    ? path.join(path.resolve(process.env.TONELAB_DATA_DIR), "gemini-usage.json")
    : path.resolve(process.cwd(), ".tonelab", "gemini-usage.json"),
  process.env.PIXELBOARD_DATA_DIR
    ? path.join(
        path.resolve(process.env.PIXELBOARD_DATA_DIR),
        "gemini-usage.json"
      )
    : path.resolve(process.cwd(), ".pixelboard", "gemini-usage.json"),
];
const USAGE_FILE = path.join(DATA_DIR, "gemini-usage.json");

let cachedUsage: UsageFile | null = null;
let writeQueue = Promise.resolve();
let reserveQueue = Promise.resolve();

function getGeminiQuotaDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: RESET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

async function loadUsage(): Promise<UsageFile> {
  const currentDay = getGeminiQuotaDay();
  if (cachedUsage?.day === currentDay) return cachedUsage;

  try {
    const raw = await fs.readFile(USAGE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as UsageFile;
    cachedUsage =
      parsed.day === currentDay
        ? parsed
        : { day: currentDay, globalUsed: 0, users: {} };
  } catch {
    for (const legacyUsageFile of LEGACY_USAGE_FILES) {
      if (legacyUsageFile === USAGE_FILE) continue;

      try {
        const raw = await fs.readFile(legacyUsageFile, "utf-8");
        const parsed = JSON.parse(raw) as UsageFile;
        cachedUsage =
          parsed.day === currentDay
            ? parsed
            : { day: currentDay, globalUsed: 0, users: {} };
        await saveUsage(cachedUsage);
        return cachedUsage;
      } catch {
        // Try the next legacy rename target.
      }
    }

    cachedUsage = { day: currentDay, globalUsed: 0, users: {} };
  }

  return cachedUsage;
}

async function saveUsage(usage: UsageFile) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(USAGE_FILE, JSON.stringify(usage, null, 2), "utf-8");
  });

  await writeQueue;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function getUserLimitKey(ctx: TrpcContext, apiKey?: string) {
  if (ctx.user?.id) return `auth:${ctx.user.id}`;

  const clientId =
    ctx.req?.header?.("x-gradeflow-client-id") ??
    ctx.req?.header?.("x-tonelab-client-id") ??
    ctx.req?.header?.("x-pixelboard-client-id");
  if (clientId && /^[A-Za-z0-9_-]{16,80}$/.test(clientId)) {
    return `client:${hash(clientId)}`;
  }

  if (apiKey) return `key:${hash(apiKey)}`;

  const forwarded = ctx.req?.header?.("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    forwarded || ctx.req?.ip || ctx.req?.socket?.remoteAddress || "anonymous";
  return `ip:${hash(ip)}`;
}

function snapshot(usage: UsageFile, userKey: string): GeminiUsageSnapshot {
  const userUsed = usage.users[userKey] ?? 0;

  return {
    day: usage.day,
    globalUsed: usage.globalUsed,
    globalRemaining: Math.max(0, MAX_IMAGES_PER_DAY - usage.globalUsed),
    userUsed,
    userRemaining: Math.max(0, MAX_IMAGES_PER_USER_PER_DAY - userUsed),
    maxImagesPerDay: MAX_IMAGES_PER_DAY,
    maxImagesPerUserPerDay: MAX_IMAGES_PER_USER_PER_DAY,
    maxBatchSize: MAX_BATCH_SIZE,
    resetTimezone: RESET_TIMEZONE,
  };
}

export async function checkBatchSize(
  batchSize: number,
  ctx: TrpcContext,
  apiKey?: string
): Promise<LimitResult> {
  const usage = await loadUsage();
  const userKey = getUserLimitKey(ctx, apiKey);

  if (process.env.NODE_ENV === "test") {
    return { allowed: true, usage: snapshot(usage, userKey) };
  }

  if (batchSize > MAX_BATCH_SIZE) {
    return {
      allowed: false,
      limitType: "batch",
      message: `Batch size is capped at ${MAX_BATCH_SIZE} images. Remove ${batchSize - MAX_BATCH_SIZE} image${batchSize - MAX_BATCH_SIZE === 1 ? "" : "s"} before converting.`,
      usage: snapshot(usage, userKey),
    };
  }

  return { allowed: true, usage: snapshot(usage, userKey) };
}

export async function reserveGeminiImageUse(
  ctx: TrpcContext,
  apiKey?: string
): Promise<LimitResult> {
  const run: Promise<LimitResult> = reserveQueue.then(
    async (): Promise<LimitResult> => {
      const usage = await loadUsage();
      const userKey = getUserLimitKey(ctx, apiKey);
      const userUsed = usage.users[userKey] ?? 0;

      if (process.env.NODE_ENV === "test") {
        return { allowed: true, usage: snapshot(usage, userKey) };
      }

      if (usage.globalUsed >= MAX_IMAGES_PER_DAY) {
        return {
          allowed: false,
          limitType: "global_daily",
          message: `Daily project cap reached: ${usage.globalUsed}/${MAX_IMAGES_PER_DAY} Gemini image conversions used today.`,
          usage: snapshot(usage, userKey),
        };
      }

      if (userUsed >= MAX_IMAGES_PER_USER_PER_DAY) {
        return {
          allowed: false,
          limitType: "user_daily",
          message: `Daily user cap reached: ${userUsed}/${MAX_IMAGES_PER_USER_PER_DAY} Gemini image conversions used today.`,
          usage: snapshot(usage, userKey),
        };
      }

      usage.globalUsed += 1;
      usage.users[userKey] = userUsed + 1;
      await saveUsage(usage);

      return { allowed: true, usage: snapshot(usage, userKey) };
    }
  );

  reserveQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
