const DB_NAME = "gradeflow-db";
const LEGACY_DB_NAMES = ["tonelab-db", "pixelboard-db"];
const DB_VERSION = 1;
const STORE = "keyvalue";
const CURRENT_KEY_PREFIX = "gradeflow-";
const LEGACY_KEY_PREFIXES = ["tonelab-", "pixelboard-"];

let dbPromise: Promise<IDBDatabase> | null = null;
let legacyDbPromises: Record<string, Promise<IDBDatabase>> = {};

function openNamedDB(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = e => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openNamedDB(DB_NAME);
  }
  return dbPromise;
}

function openLegacyDB(name: string): Promise<IDBDatabase> {
  legacyDbPromises[name] ??= openNamedDB(name);
  return legacyDbPromises[name];
}

function legacyKeysFor(key: string): string[] {
  if (!key.startsWith(CURRENT_KEY_PREFIX)) return [];

  return LEGACY_KEY_PREFIXES.map(prefix =>
    key.replace(CURRENT_KEY_PREFIX, prefix)
  );
}

async function readValue(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise(resolve => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function writeValue(
  db: IDBDatabase,
  key: string,
  value: unknown
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteValue(db: IDBDatabase, key: string): Promise<void> {
  await new Promise<void>(resolve => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function readLegacyValue(key: string): Promise<unknown> {
  const legacyKeys = legacyKeysFor(key);
  for (const legacyDbName of LEGACY_DB_NAMES) {
    const legacyDb = await openLegacyDB(legacyDbName);
    for (const legacyKey of legacyKeys) {
      const value = await readValue(legacyDb, legacyKey);
      if (value !== undefined) return value;
    }
  }

  return undefined;
}

async function removeLegacyValues(key: string): Promise<void> {
  const legacyKeys = legacyKeysFor(key);
  for (const legacyDbName of LEGACY_DB_NAMES) {
    const legacyDb = await openLegacyDB(legacyDbName);
    await Promise.all(
      legacyKeys.map(legacyKey => deleteValue(legacyDb, legacyKey))
    );
  }
}

export async function idbGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await openDB();
    const current = await readValue(db, key);
    if (current !== undefined) return current as T;

    const legacy = await readLegacyValue(key);
    if (legacy !== undefined) {
      await idbSet(key, legacy);
      return legacy as T;
    }

    return fallback;
  } catch {
    return fallback;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    await writeValue(db, key, value);
  } catch (e) {
    console.warn("IndexedDB write failed:", e);
  }
}

export async function idbRemove(key: string): Promise<void> {
  try {
    const db = await openDB();
    await deleteValue(db, key);
    await removeLegacyValues(key);
  } catch {
    /* ignore */
  }
}

// Only used in tests to get a clean DB between test runs.
export function _resetDBForTesting(): void {
  dbPromise = null;
  legacyDbPromises = {};
}
