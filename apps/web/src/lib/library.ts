// The local library: saved experiments in this browser's IndexedDB. Each entry keeps the
// settings, a thumbnail and (separately, so listing stays fast) the results as a
// compressed recording. The same database keeps the visitor's profile and a note of deleted
// entries (META), so the save file and the cloud copy can be merged without losing anything.
import { markChanged } from './account/local.ts';
import { ENTRIES, LibraryFailure, META, pruneRemoved, req, RESULTS, tx } from './db.ts';
import { compressRecording, decompressRecording, type Recording } from './recording.ts';
import { validateState, type ExperimentState } from './share.ts';

export { LibraryFailure, type LibraryError } from './db.ts';

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
  markChanged();
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
  markChanged();
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
  markChanged();
  return copy;
}

export async function deleteEntry(id: string): Promise<void> {
  await tx([ENTRIES, RESULTS, META], 'readwrite', async (t) => {
    t.objectStore(ENTRIES).delete(id);
    t.objectStore(RESULTS).delete(id);
    const meta = t.objectStore(META);
    const removed = pruneRemoved(await req(meta.get('removed')), Date.now());
    removed[id] = new Date().toISOString();
    meta.put(removed, 'removed');
  });
  markChanged();
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
