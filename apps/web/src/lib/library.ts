// The local library: saved experiments in this browser's IndexedDB. Each entry keeps the
// settings, a thumbnail and (separately, so listing stays fast) the results as a
// compressed recording. Nothing leaves the device.
import { compressRecording, decompressRecording, type Recording } from './recording.ts';
import { validateState, type ExperimentState } from './share.ts';

const DB = 'xtraplaytion';
const VERSION = 1;
const ENTRIES = 'entries';
const RESULTS = 'results';

export interface LibraryEntry {
  id: string;
  name: string;
  created: string;
  updated: string;
  state: ExperimentState;
  /** Small picture of the fit (PNG bytes; Blobs are not stored, since some WebKit builds
   *  cannot keep them in IndexedDB). */
  thumb: Uint8Array | null;
  /** Model names (N1, P2...) and the epoch the saved results reach (0: settings only). */
  models: string[];
  epoch: number;
  /** Size of the stored results in bytes (0 when there are none). */
  resultBytes: number;
}

export type LibraryError = 'unavailable' | 'full' | 'missing' | 'failed';

export class LibraryFailure extends Error {
  readonly code: LibraryError;
  constructor(code: LibraryError) {
    super(code);
    this.code = code;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
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
    };
    req.onsuccess = () => resolve(req.result);
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
async function tx<T>(
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

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(failure(r.error));
  });

/** All entries, most recently changed first. Entries that no longer validate are skipped. */
export async function listEntries(): Promise<LibraryEntry[]> {
  const all = await tx([ENTRIES], 'readonly', (t) =>
    req(t.objectStore(ENTRIES).getAll() as IDBRequest<LibraryEntry[]>),
  );
  return all
    .flatMap((e) => {
      const state = validateState(e.state);
      return state ? [{ ...e, state }] : [];
    })
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

export async function getEntry(id: string): Promise<LibraryEntry | null> {
  const e = await tx([ENTRIES], 'readonly', (t) =>
    req(t.objectStore(ENTRIES).get(id) as IDBRequest<LibraryEntry | undefined>),
  );
  if (!e) return null;
  const state = validateState(e.state);
  return state ? { ...e, state } : null;
}

/** Saved results of an entry (null when there are none or they cannot be read). */
export async function getResults(id: string): Promise<Recording | null> {
  const raw = await tx([RESULTS], 'readonly', (t) =>
    req(t.objectStore(RESULTS).get(id) as IDBRequest<Uint8Array | undefined>),
  );
  if (!raw) return null;
  try {
    return await decompressRecording(raw);
  } catch {
    return null;
  }
}

export interface SaveInput {
  /** Overwrite this entry (keeps its creation date); absent: a new entry. */
  id?: string;
  name: string;
  state: ExperimentState;
  results: Recording | null;
  thumb: Blob | null;
  models: string[];
}

export async function saveEntry(input: SaveInput): Promise<LibraryEntry> {
  const now = new Date().toISOString();
  const bytes = input.results ? await compressRecording(input.results) : null;
  const old = input.id ? await getEntry(input.id).catch(() => null) : null;
  const entry: LibraryEntry = {
    id: old?.id ?? crypto.randomUUID(),
    name: input.name.trim().slice(0, 120) || 'Untitled',
    created: old?.created ?? now,
    updated: now,
    state: input.state,
    thumb: input.thumb ? new Uint8Array(await input.thumb.arrayBuffer()) : null,
    models: input.models,
    epoch: input.results
      ? Math.max(0, ...input.results.models.map((m) => m.frameEpochs.at(-1) ?? 0))
      : 0,
    resultBytes: bytes?.byteLength ?? 0,
  };
  await tx([ENTRIES, RESULTS], 'readwrite', (t) => {
    t.objectStore(ENTRIES).put(entry);
    if (bytes) t.objectStore(RESULTS).put(bytes, entry.id);
    else t.objectStore(RESULTS).delete(entry.id);
  });
  return entry;
}

export async function renameEntry(id: string, name: string): Promise<void> {
  await tx([ENTRIES], 'readwrite', async (t) => {
    const store = t.objectStore(ENTRIES);
    const e = (await req(store.get(id))) as LibraryEntry | undefined;
    if (!e) throw new LibraryFailure('missing');
    store.put({
      ...e,
      name: name.trim().slice(0, 120) || e.name,
      updated: new Date().toISOString(),
    });
  });
}

export async function duplicateEntry(id: string, name: string): Promise<LibraryEntry> {
  const copyId = crypto.randomUUID();
  const now = new Date().toISOString();
  let copy: LibraryEntry | null = null;
  await tx([ENTRIES, RESULTS], 'readwrite', async (t) => {
    const e = (await req(t.objectStore(ENTRIES).get(id))) as LibraryEntry | undefined;
    if (!e) throw new LibraryFailure('missing');
    const raw = (await req(t.objectStore(RESULTS).get(id))) as Uint8Array | undefined;
    copy = { ...e, id: copyId, name, created: now, updated: now };
    t.objectStore(ENTRIES).put(copy);
    if (raw) t.objectStore(RESULTS).put(raw, copyId);
  });
  if (!copy) throw new LibraryFailure('missing');
  return copy;
}

export async function deleteEntry(id: string): Promise<void> {
  await tx([ENTRIES, RESULTS], 'readwrite', (t) => {
    t.objectStore(ENTRIES).delete(id);
    t.objectStore(RESULTS).delete(id);
  });
}

/** Used and available storage for this site, when the browser tells. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate();
    return e && e.usage !== undefined && e.quota !== undefined
      ? { usage: e.usage, quota: e.quota }
      : null;
  } catch {
    return null;
  }
}
