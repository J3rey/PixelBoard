import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";

// Each test gets a fresh IDBFactory so the cached dbPromise is reset cleanly.
// We re-import idb helpers via dynamic import after swapping the global.
async function freshIdb() {
  (globalThis as any).indexedDB = new IDBFactory();
  // Re-load the module to reset the cached dbPromise
  const { _resetDBForTesting, idbGet, idbSet, idbRemove } =
    await import("../lib/idb");
  _resetDBForTesting();
  return { idbGet, idbSet, idbRemove };
}

async function openRawDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("keyvalue")) {
        db.createObjectStore("keyvalue");
      }
    };
    req.onsuccess = event => resolve((event.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

async function writeRawValue(
  dbName: string,
  key: string,
  value: unknown
): Promise<void> {
  const db = await openRawDb(dbName);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("keyvalue", "readwrite");
    tx.objectStore("keyvalue").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readRawValue(dbName: string, key: string): Promise<unknown> {
  const db = await openRawDb(dbName);
  const value = await new Promise<unknown>(resolve => {
    const tx = db.transaction("keyvalue", "readonly");
    const req = tx.objectStore("keyvalue").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
  db.close();
  return value;
}

const KEYS = {
  images: "gradeflow-images",
  gridSize: "gradeflow-grid-size",
  apiKey: "gradeflow-api-key",
  promptHistory: "gradeflow-prompt-history",
  convertedPhotos: "gradeflow-converted-photos",
  stats: "gradeflow-stats",
};

describe("Gallery Persistence (IndexedDB)", () => {
  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory();
  });

  it("returns fallback when key is missing", async () => {
    const { idbGet } = await freshIdb();
    const result = await idbGet(KEYS.images, []);
    expect(result).toEqual([]);
  });

  it("persists and loads gallery images", async () => {
    const { idbGet, idbSet } = await freshIdb();
    const images = [
      {
        id: "img-1",
        url: "data:image/png;base64,abc",
        name: "test.png",
        addedAt: Date.now(),
      },
    ];
    await idbSet(KEYS.images, images);
    const loaded = await idbGet(KEYS.images, []);
    expect(loaded).toHaveLength(1);
    expect((loaded as typeof images)[0].name).toBe("test.png");
  });

  it("persists and loads converted photos", async () => {
    const { idbGet, idbSet } = await freshIdb();
    const photos = [
      {
        id: "test-1",
        originalPreview: "",
        convertedUrl: "data:image/png;base64,xyz",
        originalName: "photo.jpg",
        prompt: "Make it watercolor",
        status: "done" as const,
      },
      {
        id: "test-2",
        originalPreview: "",
        convertedUrl: "",
        originalName: "photo2.jpg",
        prompt: "Make it sketch",
        status: "error" as const,
        error: "API failed",
      },
    ];

    await idbSet(KEYS.convertedPhotos, photos);
    const loaded = await idbGet<typeof photos>(KEYS.convertedPhotos, []);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].status).toBe("done");
    expect(loaded[1].status).toBe("error");
  });

  it("only persists done and error photos (not pending/converting)", async () => {
    const { idbGet, idbSet } = await freshIdb();
    const allPhotos = [
      { id: "1", status: "done", convertedUrl: "url1" },
      { id: "2", status: "error", error: "fail" },
      { id: "3", status: "pending" },
      { id: "4", status: "converting" },
    ];

    const persistable = allPhotos.filter(
      p => p.status === "done" || p.status === "error"
    );
    await idbSet(KEYS.convertedPhotos, persistable);

    const loaded = await idbGet<typeof persistable>(KEYS.convertedPhotos, []);
    expect(loaded).toHaveLength(2);
    expect(loaded.map(p => p.id)).toEqual(["1", "2"]);
  });

  it("persists and loads grid size", async () => {
    const { idbGet, idbSet } = await freshIdb();
    await idbSet(KEYS.gridSize, 4);
    const loaded = await idbGet(KEYS.gridSize, 3);
    expect(loaded).toBe(4);
  });

  it("persists and loads API key", async () => {
    const { idbGet, idbSet } = await freshIdb();
    await idbSet(KEYS.apiKey, "my-secret-key");
    const loaded = await idbGet(KEYS.apiKey, "");
    expect(loaded).toBe("my-secret-key");
  });

  it("migrates values from legacy ToneLab IndexedDB storage", async () => {
    const { idbGet } = await freshIdb();
    const images = [
      {
        id: "tonelab-img",
        url: "data:image/png;base64,tonelab",
        name: "tonelab.png",
        addedAt: Date.now(),
      },
    ];

    await writeRawValue("tonelab-db", "tonelab-images", images);

    const loaded = await idbGet<typeof images>(KEYS.images, []);
    const migrated = await readRawValue("gradeflow-db", KEYS.images);

    expect(loaded).toEqual(images);
    expect(migrated).toEqual(images);
  });

  it("migrates values from legacy PixelBoard IndexedDB storage", async () => {
    const { idbGet } = await freshIdb();
    const images = [
      {
        id: "pixelboard-img",
        url: "data:image/png;base64,pixelboard",
        name: "pixelboard.png",
        addedAt: Date.now(),
      },
    ];

    await writeRawValue("pixelboard-db", "pixelboard-images", images);

    const loaded = await idbGet<typeof images>(KEYS.images, []);
    const migrated = await readRawValue("gradeflow-db", KEYS.images);

    expect(loaded).toEqual(images);
    expect(migrated).toEqual(images);
  });

  it("removes a key", async () => {
    const { idbGet, idbSet, idbRemove } = await freshIdb();
    await idbSet(KEYS.apiKey, "to-delete");
    await idbRemove(KEYS.apiKey);
    const loaded = await idbGet(KEYS.apiKey, "");
    expect(loaded).toBe("");
  });

  it("removes matching legacy storage when deleting a key", async () => {
    const { idbGet, idbRemove } = await freshIdb();
    await writeRawValue("tonelab-db", "tonelab-api-key", "tonelab-key");
    await writeRawValue(
      "pixelboard-db",
      "pixelboard-api-key",
      "pixelboard-key"
    );

    await idbRemove(KEYS.apiKey);

    const loaded = await idbGet(KEYS.apiKey, "");
    expect(loaded).toBe("");
  });

  it("persists and loads prompt history", async () => {
    const { idbGet, idbSet } = await freshIdb();
    const history = [
      {
        id: "p1",
        text: "watercolor",
        usedAt: Date.now(),
        useCount: 3,
        isFavorite: true,
      },
    ];
    await idbSet(KEYS.promptHistory, history);
    const loaded = await idbGet<typeof history>(KEYS.promptHistory, []);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].isFavorite).toBe(true);
  });

  it("persists and loads cumulative stats", async () => {
    const { idbGet, idbSet } = await freshIdb();
    const st = { totalConverted: 42, totalSuccess: 38 };
    await idbSet(KEYS.stats, st);
    const loaded = await idbGet(KEYS.stats, {
      totalConverted: 0,
      totalSuccess: 0,
    });
    expect(loaded).toEqual(st);
  });

  it("overwrites an existing value", async () => {
    const { idbGet, idbSet } = await freshIdb();
    await idbSet(KEYS.gridSize, 2);
    await idbSet(KEYS.gridSize, 4);
    const loaded = await idbGet(KEYS.gridSize, 3);
    expect(loaded).toBe(4);
  });

  it("returns fallback on missing key after delete", async () => {
    const { idbGet, idbSet, idbRemove } = await freshIdb();
    await idbSet(KEYS.gridSize, 2);
    await idbRemove(KEYS.gridSize);
    const loaded = await idbGet(KEYS.gridSize, 3);
    expect(loaded).toBe(3);
  });
});
