import { nanoid } from "nanoid";

const STORAGE_KEY = "gradeflow-client-id";
const LEGACY_STORAGE_KEYS = ["tonelab-client-id", "pixelboard-client-id"];

export function getClientId() {
  if (typeof window === "undefined") return "server-render";

  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  for (const key of LEGACY_STORAGE_KEYS) {
    const legacy = window.localStorage.getItem(key);
    if (legacy) {
      window.localStorage.setItem(STORAGE_KEY, legacy);
      return legacy;
    }
  }

  const id = nanoid(24);
  window.localStorage.setItem(STORAGE_KEY, id);
  return id;
}
