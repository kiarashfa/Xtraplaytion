// The browser database (IndexedDB) behind the library and the profile. Kept apart from
// library.ts so the site header can read the profile without loading the experiment code.

const DB = 'xtraplaytion';
const VERSION = 2;
export const ENTRIES = 'entries';
export const RESULTS = 'results';
/** Keys 'profile' (the visitor's profile) and 'removed' (entry id -> when it was deleted). */
export const META = 'meta';
/** Deleted entries are remembered this long, so other devices learn about the deletion. */
const REMEMBER_REMOVED_MS = 180 * 86_400_000;

export type LibraryError = 'unavailable' | 'full' | 'missing' | 'failed';

export class LibraryFailure extends Error {
  readonly code: LibraryError;
  constructor(code: LibraryError) {
    super(code);
    this.code = code;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new LibraryFailure('unavailable'));
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, VERSION);
    } catch {
      return reject(new LibraryFailure('unavailable'));
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(RESULTS)) db.createObjectStore(RESULTS);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer page (another tab after an update) needs the database: let it go.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(new LibraryFailure('unavailable'));
    req.onblocked = () => reject(new LibraryFailure('unavailable'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function failure(e: unknown): LibraryFailure {
  if (e instanceof LibraryFailure) return e;
  const name = e instanceof DOMException ? e.name : '';
  return new LibraryFailure(name === 'QuotaExceededError' ? 'full' : 'failed');
}

/** Runs `fn` in one transaction and resolves when it commits. */
export async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => T | Promise<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(stores, mode);
    } catch (e) {
      return reject(failure(e));
    }
    let result: T;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(failure(t.error));
    t.onabort = () => reject(failure(t.error));
    Promise.resolve(fn(t)).then(
      (r) => (result = r),
      (e) => {
        t.abort();
        reject(failure(e));
      },
    );
  });
}

export const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(failure(r.error));
  });

/** The deletion notes, without junk and without notes older than REMEMBER_REMOVED_MS. */
export function pruneRemoved(value: unknown, now: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
    if (typeof at !== 'string' || id.length > 64) continue;
    const time = Date.parse(at);
    if (Number.isFinite(time) && now - time < REMEMBER_REMOVED_MS) out[id] = at;
  }
  return out;
}

/** How many experiments this browser keeps (for the header menu). */
export async function countEntries(): Promise<number> {
  return tx([ENTRIES], 'readonly', (t) => req(t.objectStore(ENTRIES).count()));
}
