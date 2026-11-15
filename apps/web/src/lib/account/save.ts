// The save file: the visitor's profile and whole library (settings, thumbnails and results) in
// one JSON file. It is the "login key" of a site without accounts: opening it in another
// browser merges it with what is there, and the cloud save keeps the same file in the visitor's
// own Google Drive or Dropbox.
//
// Merging never loses work: entries are matched by id and the newer edit wins; deletions are
// remembered (META 'removed') so a deleted entry does not come back from an older copy; the
// profile with the newer change wins.
import { ENTRIES, META, pruneRemoved, req, RESULTS, tx } from '../db.ts';
import type { LibraryEntry } from '../library.ts';
import { validateState } from '../share.ts';
import {
  emptyLearning,
  LEARNING_KEY,
  learningKey,
  learningMirror,
  mergeLearning,
  mirrorLearning,
  validLearning,
  type Learning,
} from './learning.ts';
import {
  CHANGED_EVENT,
  CHANGED_KEY,
  initialsOf,
  isTint,
  markChanged,
  PROFILE_KEY,
  writeJson,
  type ProfileMirror,
  type Tint,
} from './local.ts';

export const SAVE_FORMAT = 'xtraplaytion-save';
export const SAVE_VERSION = 1;
/** Largest save file accepted (Dropbox takes up to 150 MB in one upload). */
export const MAX_SAVE = 100 * 1024 * 1024;
export const SAVE_FILE_NAME = 'xtraplaytion-save.json';
export const NAME_MAX = 60;
export const LETTERS_MAX = 3;
/** Largest stored photo (data: URL length); the picture dialog makes about 10 KB. */
export const PICTURE_MAX = 200_000;
const THUMB_MAX = 1_500_000;
const PICTURE_RE = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const ID_RE = /^[\w-]{1,64}$/;

export interface Profile {
  name: string;
  /** Photo as a small data: URL, or null for initials. */
  picture: string | null;
  /** Initials chosen by the visitor ('' uses the name's). */
  letters: string;
  tint: Tint;
  createdAt: string;
  updatedAt: string;
}

export interface SavedEntry {
  id: string;
  name: string;
  created: string;
  updated: string;
  state: LibraryEntry['state'];
  models: string[];
  epoch: number;
  /** PNG thumbnail, base64. */
  thumb: string | null;
  /** Compressed results (the library's recording bytes), base64. */
  results: string | null;
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: typeof SAVE_VERSION;
  saved: string;
  profile: Profile | null;
  entries: SavedEntry[];
  /** Entry id -> when it was deleted. */
  removed: Record<string, string>;
  /** Lessons learned, guesses, challenge rounds, gallery favorites (absent in older saves). */
  learning?: Learning;
}

export type SaveError = 'tooBig' | 'notJson' | 'notSave' | 'experiment' | 'newer' | 'invalid';

/* base64 ------------------------------------------------------------------------------------ */

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

export function fromBase64(text: string): Uint8Array | null {
  try {
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const PNG = [0x89, 0x50, 0x4e, 0x47];
const isPng = (b: Uint8Array) => PNG.every((v, i) => b[i] === v);

/* Validation -------------------------------------------------------------------------------- */

const isDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const time = (iso: string | undefined | null) => (iso ? Date.parse(iso) || 0 : 0);

export function cleanLetters(v: string): string {
  return [...v.replace(/\s+/g, '')].slice(0, LETTERS_MAX).join('').toLocaleUpperCase();
}

export function validProfile(v: unknown): Profile | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (!isDate(p['createdAt']) || !isDate(p['updatedAt'])) return null;
  const picture = p['picture'];
  return {
    name: typeof p['name'] === 'string' ? p['name'].trim().slice(0, NAME_MAX) : '',
    picture:
      typeof picture === 'string' && picture.length <= PICTURE_MAX && PICTURE_RE.test(picture)
        ? picture
        : null,
    letters: typeof p['letters'] === 'string' ? cleanLetters(p['letters']) : '',
    tint: isTint(p['tint']) ? p['tint'] : 'blue',
    createdAt: p['createdAt'],
    updatedAt: p['updatedAt'],
  };
}

function validEntry(v: unknown): SavedEntry | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (typeof e['id'] !== 'string' || !ID_RE.test(e['id'])) return null;
  if (!isDate(e['created']) || !isDate(e['updated'])) return null;
  const state = validateState(e['state']);
  if (!state) return null;
  const thumbText =
    typeof e['thumb'] === 'string' && e['thumb'].length <= THUMB_MAX ? e['thumb'] : null;
  const thumb = thumbText ? fromBase64(thumbText) : null;
  const results =
    typeof e['results'] === 'string' && e['results'] && fromBase64(e['results'].slice(0, 8))
      ? e['results']
      : null;
  const models = Array.isArray(e['models'])
    ? e['models']
        .filter((m): m is string => typeof m === 'string')
        .slice(0, 12)
        .map((m) => m.slice(0, 8))
    : [];
  const epoch = Number(e['epoch']);
  return {
    id: e['id'],
    name: (typeof e['name'] === 'string' ? e['name'].trim().slice(0, 120) : '') || 'Untitled',
    created: e['created'],
    updated: e['updated'],
    state,
    models,
    epoch: Number.isInteger(epoch) && epoch >= 0 ? epoch : 0,
    thumb: thumb && isPng(thumb) ? thumbText : null,
    results,
  };
}

/** Reads a save file. Entries that do not validate are left out (`skipped` counts them). */
export function parseSave(text: string): { save: SaveFile; skipped: number } | SaveError {
  if (text.length > MAX_SAVE) return 'tooBig';
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return 'notJson';
  }
  if (!o || typeof o !== 'object') return 'notSave';
  const f = o as Record<string, unknown>;
  if (f['format'] === 'xtraplaytion-experiment') return 'experiment';
  if (f['format'] !== SAVE_FORMAT) return 'notSave';
  if (typeof f['version'] !== 'number' || f['version'] > SAVE_VERSION) return 'newer';
  if (!Array.isArray(f['entries'])) return 'invalid';
  const entries: SavedEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of f['entries']) {
    const e = validEntry(raw);
    if (!e || seen.has(e.id)) skipped++;
    else {
      seen.add(e.id);
      entries.push(e);
    }
  }
  return {
    save: {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      saved: isDate(f['saved']) ? f['saved'] : new Date(0).toISOString(),
      profile: validProfile(f['profile']),
      entries,
      removed: pruneRemoved(f['removed'], Date.now()),
      learning: validLearning(f['learning']),
    },
    skipped,
  };
}

/* Merging ----------------------------------------------------------------------------------- */

export interface MergePlan {
  /** Incoming entries to write over (or next to) the local ones. */
  put: SavedEntry[];
  /** Local entries deleted elsewhere. */
  remove: string[];
  removed: Record<string, string>;
  /** The incoming profile when it is newer, else null (keep the local one). */
  profile: Profile | null;
  /** The joined learning record when it differs from the local one, else null. */
  learning: Learning | null;
  added: number;
  updated: number;
}

/** What opening `incoming` changes here. Pure, so it is unit tested. */
export function planMerge(
  local: {
    entries: Map<string, string>;
    removed: Record<string, string>;
    profile: Profile | null;
    learning?: Learning;
  },
  incoming: Pick<SaveFile, 'entries' | 'removed' | 'profile' | 'learning'>,
  now = Date.now(),
): MergePlan {
  const removed = { ...local.removed };
  for (const [id, at] of Object.entries(incoming.removed)) {
    if (time(at) > time(removed[id])) removed[id] = at;
  }
  const plan: MergePlan = {
    put: [],
    remove: [],
    removed: pruneRemoved(removed, now),
    profile: null,
    learning: null,
    added: 0,
    updated: 0,
  };
  const gone = (id: string, updated: string) =>
    plan.removed[id] !== undefined && time(plan.removed[id]) >= time(updated);
  for (const e of incoming.entries) {
    if (gone(e.id, e.updated)) continue;
    const mine = local.entries.get(e.id);
    if (mine !== undefined && time(mine) >= time(e.updated)) continue;
    plan.put.push(e);
    if (mine === undefined) plan.added++;
    else plan.updated++;
  }
  for (const [id, updated] of local.entries) if (gone(id, updated)) plan.remove.push(id);
  if (incoming.profile && time(incoming.profile.updatedAt) > time(local.profile?.updatedAt)) {
    plan.profile = incoming.profile;
  }
  const mine = local.learning ?? emptyLearning();
  const joined = mergeLearning(mine, incoming.learning ?? emptyLearning());
  if (learningKey(joined) !== learningKey(mine)) plan.learning = joined;
  return plan;
}

/* This browser ------------------------------------------------------------------------------ */

function mirror(p: Profile | null): void {
  const m: ProfileMirror | null = p
    ? { name: p.name, picture: p.picture, letters: p.letters || initialsOf(p.name), tint: p.tint }
    : null;
  writeJson(PROFILE_KEY, m);
}

export async function getProfile(): Promise<Profile | null> {
  const raw = await tx([META], 'readonly', (t) => req(t.objectStore(META).get('profile')));
  return validProfile(raw);
}

export type ProfilePatch = Partial<Pick<Profile, 'name' | 'picture' | 'letters' | 'tint'>>;

/** Changes the profile (starting one when there is none). */
export async function updateProfile(patch: ProfilePatch): Promise<Profile> {
  const at = new Date().toISOString();
  const result = await tx([META], 'readwrite', async (t) => {
    const store = t.objectStore(META);
    const before = validProfile(await req(store.get('profile')));
    const next: Profile = {
      name: '',
      picture: null,
      letters: '',
      tint: 'blue',
      ...before,
      ...patch,
      createdAt: before?.createdAt ?? at,
      updatedAt: at,
    };
    store.put(next, 'profile');
    return next;
  });
  mirror(result);
  markChanged();
  return result;
}

/** Copies the stored profile to the header's mirror (after an update of the site, or a repair). */
export async function refreshMirror(): Promise<Profile | null> {
  const p = await getProfile();
  mirror(p);
  return p;
}

/** The whole save of this browser as file text. */
export async function exportSave(): Promise<{ text: string; count: number }> {
  const save = await tx([ENTRIES, RESULTS, META], 'readonly', async (t) => {
    const entries = (await req(t.objectStore(ENTRIES).getAll())) as LibraryEntry[];
    const out: SavedEntry[] = [];
    for (const e of entries) {
      const state = validateState(e.state);
      if (!state || !ID_RE.test(e.id)) continue;
      const bytes = (await req(t.objectStore(RESULTS).get(e.id))) as Uint8Array | undefined;
      out.push({
        id: e.id,
        name: e.name,
        created: e.created,
        updated: e.updated,
        state,
        models: e.models,
        epoch: e.epoch,
        thumb: e.thumb ? toBase64(e.thumb) : null,
        results: bytes ? toBase64(bytes) : null,
      });
    }
    const meta = t.objectStore(META);
    const file: SaveFile = {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      saved: new Date().toISOString(),
      profile: validProfile(await req(meta.get('profile'))),
      entries: out.sort((a, b) => a.created.localeCompare(b.created)),
      removed: pruneRemoved(await req(meta.get('removed')), Date.now()),
      learning: mergeLearning(validLearning(await req(meta.get('learning'))), learningMirror()),
    };
    return file;
  });
  return { text: JSON.stringify(save), count: save.entries.length };
}

/** True when this browser holds a profile or at least one experiment. */
export async function hasSave(): Promise<boolean> {
  return tx([ENTRIES, META], 'readonly', async (t) => {
    const count = await req(t.objectStore(ENTRIES).count());
    return count > 0 || (await req(t.objectStore(META).get('profile'))) !== undefined;
  });
}

export interface MergeSummary {
  added: number;
  updated: number;
  removed: number;
  profile: boolean;
  learning: boolean;
}

export const nothingNew = (s: MergeSummary) =>
  !s.added && !s.updated && !s.removed && !s.profile && !s.learning;

/** Merges a save file into this browser in one transaction. */
export async function importSave(save: SaveFile): Promise<MergeSummary> {
  let plan: MergePlan | null = null;
  let profile: Profile | null = null;
  let learning: Learning | null = null;
  await tx([ENTRIES, RESULTS, META], 'readwrite', async (t) => {
    const entries = t.objectStore(ENTRIES);
    const results = t.objectStore(RESULTS);
    const meta = t.objectStore(META);
    const all = (await req(entries.getAll())) as LibraryEntry[];
    const localProfile = validProfile(await req(meta.get('profile')));
    const p = planMerge(
      {
        entries: new Map(all.map((e) => [e.id, e.updated])),
        removed: pruneRemoved(await req(meta.get('removed')), Date.now()),
        profile: localProfile,
        learning: mergeLearning(validLearning(await req(meta.get('learning'))), learningMirror()),
      },
      save,
    );
    for (const e of p.put) {
      const bytes = e.results ? fromBase64(e.results) : null;
      const entry: LibraryEntry = {
        id: e.id,
        name: e.name,
        created: e.created,
        updated: e.updated,
        state: e.state,
        thumb: e.thumb ? fromBase64(e.thumb) : null,
        models: e.models,
        epoch: bytes ? e.epoch : 0,
        resultBytes: bytes?.byteLength ?? 0,
      };
      entries.put(entry);
      if (bytes) results.put(bytes, e.id);
      else results.delete(e.id);
    }
    for (const id of p.remove) {
      entries.delete(id);
      results.delete(id);
    }
    meta.put(p.removed, 'removed');
    if (p.profile) meta.put(p.profile, 'profile');
    if (p.learning) {
      meta.put(p.learning, 'learning');
      learning = p.learning;
    }
    profile = p.profile ?? localProfile;
    plan = p;
  });
  const p = plan as MergePlan | null;
  const summary: MergeSummary = {
    added: p?.added ?? 0,
    updated: p?.updated ?? 0,
    removed: p?.remove.length ?? 0,
    profile: !!p?.profile,
    learning: !!p?.learning,
  };
  mirror(profile);
  if (learning) mirrorLearning(learning);
  if (!nothingNew(summary)) markChanged();
  return summary;
}

/** Removes the profile, every experiment and the deletion notes from this browser. */
export async function clearBrowser(): Promise<void> {
  await tx([ENTRIES, RESULTS, META], 'readwrite', (t) => {
    t.objectStore(ENTRIES).clear();
    t.objectStore(RESULTS).clear();
    t.objectStore(META).clear();
  });
  writeJson(PROFILE_KEY, null);
  writeJson(CHANGED_KEY, null);
  writeJson(LEARNING_KEY, null);
  dispatchEvent(new CustomEvent(CHANGED_EVENT));
}
