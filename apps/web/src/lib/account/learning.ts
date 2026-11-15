// The visitor's learning record: lessons learned, first guesses in the predict-then-reveal
// races, rounds of the drawing challenge, and gallery favorites. It lives next to the profile
// (IndexedDB META 'learning'), goes into the save file and the cloud, and has a copy in
// localStorage so pages can show it at once.
//
// Merging two records never loses anything: a lesson or a favorite keeps its latest change,
// a guess keeps the first answer, challenge rounds and opened races are joined.
import { META, req, tx } from '../db.ts';
import { CHANGED_EVENT, markChanged, readJson, writeJson } from './local.ts';

export const LEARNING_KEY = 'xp-learning';
/** Fired on window when a lesson island finishes a race (detail: { key }). */
export const RACE_DONE_EVENT = 'xp:race-done';
const ROUNDS_MAX = 100;
const KEY_RE = /^[\w:+./-]{1,160}$/;

export interface LessonMark {
  /** When it was marked learned, or null after "Mark as not learned". */
  learned: string | null;
  at: string;
}
export interface Guess {
  guess: string;
  winner: string;
  right: boolean;
  at: string;
}
export interface Round {
  id: string;
  at: string;
  winner: string;
  guess: string | null;
  /** Each model's error beyond the data. */
  errors: Record<string, number>;
}
export interface Learning {
  lessons: Record<string, LessonMark>;
  /** Keyed by "<lesson slug>/<race key>". */
  guesses: Record<string, Guess>;
  rounds: Round[];
  favorites: Record<string, { on: boolean; at: string }>;
  /** Gallery race id -> first opened. */
  opened: Record<string, string>;
}

export const emptyLearning = (): Learning => ({
  lessons: {},
  guesses: {},
  rounds: [],
  favorites: {},
  opened: {},
});

/* Validation and merging (pure, unit tested) -------------------------------------------------- */

const isDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);
const text = (v: unknown, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function entries<T>(v: unknown, check: (x: Record<string, unknown>) => T | null) {
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(record(v))) {
    if (!KEY_RE.test(k)) continue;
    const ok = check(record(x));
    if (ok) out[k] = ok;
  }
  return out;
}

export function validLearning(v: unknown): Learning {
  const o = record(v);
  const opened: Record<string, string> = {};
  for (const [k, at] of Object.entries(record(o['opened']))) {
    if (KEY_RE.test(k) && isDate(at)) opened[k] = at;
  }
  const rounds: Round[] = [];
  for (const raw of Array.isArray(o['rounds']) ? o['rounds'] : []) {
    const r = record(raw);
    if (typeof r['id'] !== 'string' || !KEY_RE.test(r['id']) || !isDate(r['at'])) continue;
    const errors: Record<string, number> = {};
    for (const [m, e] of Object.entries(record(r['errors'])).slice(0, 12)) {
      if (typeof e === 'number' && Number.isFinite(e) && e >= 0) errors[m.slice(0, 120)] = e;
    }
    rounds.push({
      id: r['id'],
      at: r['at'],
      winner: text(r['winner']),
      guess: typeof r['guess'] === 'string' ? text(r['guess']) : null,
      errors,
    });
  }
  return {
    lessons: entries(o['lessons'], (x) =>
      isDate(x['at']) && (x['learned'] === null || isDate(x['learned']))
        ? { learned: x['learned'] as string | null, at: x['at'] }
        : null,
    ),
    guesses: entries(o['guesses'], (x) =>
      isDate(x['at']) && typeof x['guess'] === 'string' && typeof x['winner'] === 'string'
        ? {
            guess: text(x['guess']),
            winner: text(x['winner']),
            right: x['right'] === true,
            at: x['at'],
          }
        : null,
    ),
    rounds: newestRounds(rounds),
    favorites: entries(o['favorites'], (x) =>
      isDate(x['at']) ? { on: x['on'] === true, at: x['at'] } : null,
    ),
    opened,
  };
}

function newestRounds(rounds: Round[]): Round[] {
  const byId = new Map<string, Round>();
  for (const r of rounds) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => time(a.at) - time(b.at)).slice(-ROUNDS_MAX);
}

function latest<T extends { at: string }>(a: Record<string, T>, b: Record<string, T>) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || time(v.at) > time(out[k].at)) out[k] = v;
  return out;
}

export function mergeLearning(a: Learning, b: Learning): Learning {
  const guesses = { ...a.guesses };
  for (const [k, v] of Object.entries(b.guesses)) {
    if (!guesses[k] || time(v.at) < time(guesses[k].at)) guesses[k] = v;
  }
  const opened = { ...a.opened };
  for (const [k, at] of Object.entries(b.opened)) {
    if (!opened[k] || time(at) < time(opened[k])) opened[k] = at;
  }
  return {
    lessons: latest(a.lessons, b.lessons),
    guesses,
    rounds: newestRounds([...a.rounds, ...b.rounds]),
    favorites: latest(a.favorites, b.favorites),
    opened,
  };
}

/** Stable text of a record, to tell whether a merge changed anything. */
export function learningKey(l: Learning): string {
  const sorted = (o: object) =>
    JSON.stringify(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1)));
  return [
    sorted(l.lessons),
    sorted(l.guesses),
    JSON.stringify(l.rounds.map((r) => r.id)),
    sorted(l.favorites),
    sorted(l.opened),
  ].join('|');
}

export const hasLearning = (l: Learning) =>
  Object.values(l.lessons).some((m) => m.learned) ||
  Object.keys(l.guesses).length > 0 ||
  l.rounds.length > 0 ||
  Object.values(l.favorites).some((f) => f.on) ||
  Object.keys(l.opened).length > 0;

/* Derived numbers ----------------------------------------------------------------------------- */

export const isLearned = (l: Learning, slug: string) => !!l.lessons[slug]?.learned;

export function guessStats(l: Learning): { right: number; total: number } {
  const all = Object.values(l.guesses);
  return { right: all.filter((g) => g.right).length, total: all.length };
}

export interface ModelRecord {
  name: string;
  wins: number;
  best: number;
}
export function challengeStats(l: Learning): {
  rounds: number;
  guessed: number;
  right: number;
  models: ModelRecord[];
} {
  const models = new Map<string, ModelRecord>();
  let guessed = 0;
  let right = 0;
  for (const r of l.rounds) {
    if (r.guess !== null) {
      guessed++;
      if (r.guess === r.winner) right++;
    }
    for (const [name, e] of Object.entries(r.errors)) {
      const m = models.get(name) ?? { name, wins: 0, best: Infinity };
      m.best = Math.min(m.best, e);
      if (name === r.winner) m.wins++;
      models.set(name, m);
    }
  }
  return {
    rounds: l.rounds.length,
    guessed,
    right,
    models: [...models.values()].sort((a, b) => b.wins - a.wins || a.best - b.best),
  };
}

export const favoriteIds = (l: Learning) =>
  Object.entries(l.favorites)
    .filter(([, f]) => f.on)
    .sort(([, a], [, b]) => time(b.at) - time(a.at))
    .map(([id]) => id);

/* This browser -------------------------------------------------------------------------------- */

/** The copy in localStorage (empty when there is none). */
export function learningMirror(): Learning {
  return validLearning(readJson(LEARNING_KEY));
}

export function mirrorLearning(l: Learning | null): void {
  writeJson(LEARNING_KEY, l && hasLearningOrMarks(l) ? l : null);
}
const hasLearningOrMarks = (l: Learning) => hasLearning(l) || Object.keys(l.lessons).length > 0;

/**
 * Changes the record. The stored record and the localStorage copy are merged first, so a change
 * whose database write was cut short (a click that leaves the page) is never lost.
 */
export async function updateLearning(change: (l: Learning) => Learning): Promise<Learning> {
  const fromMirror = learningMirror();
  // The copy first, so this page and the header see the change even if storage is blocked.
  const quick = change(fromMirror);
  mirrorLearning(quick);
  dispatchEvent(new CustomEvent(CHANGED_EVENT));
  try {
    const result = await tx([META], 'readwrite', async (t) => {
      const store = t.objectStore(META);
      const stored = validLearning(await req(store.get('learning')));
      const next = change(mergeLearning(stored, fromMirror));
      store.put(next, 'learning');
      return next;
    });
    mirrorLearning(result);
    markChanged();
    return result;
  } catch {
    return quick;
  }
}

export async function getLearning(): Promise<Learning> {
  const stored = await tx([META], 'readonly', (t) => req(t.objectStore(META).get('learning')));
  return mergeLearning(validLearning(stored), learningMirror());
}

/* What pages report --------------------------------------------------------------------------- */

const now = () => new Date().toISOString();

/** The lesson this page is (from its address), or null. */
export function lessonSlug(path = location.pathname): string | null {
  return /\/lessons\/([\w-]+)\/?$/.exec(path)?.[1] ?? null;
}

export function setLearned(slug: string, learned: boolean): Promise<Learning> {
  const at = now();
  return updateLearning((l) => ({
    ...l,
    lessons: { ...l.lessons, [slug]: { learned: learned ? at : null, at } },
  }));
}

/**
 * A lesson race finished. The first guess on this race is kept (later replays know the answer);
 * `guess` is null when the visitor did not pick.
 */
export function reportRace(key: string, result: { guess: string | null; winner: string }): void {
  dispatchEvent(new CustomEvent(RACE_DONE_EVENT, { detail: { key } }));
  const slug = lessonSlug();
  const { guess, winner } = result;
  if (!slug || guess === null || !winner) return;
  const id = `${slug}/${key}`;
  if (learningMirror().guesses[id]) return;
  void updateLearning((l) =>
    l.guesses[id]
      ? l
      : {
          ...l,
          guesses: { ...l.guesses, [id]: { guess, winner, right: guess === winner, at: now() } },
        },
  );
}

/** The first guess recorded for a race on this page, if any. */
export function pastGuess(key: string): Guess | null {
  const slug = lessonSlug();
  return slug ? (learningMirror().guesses[`${slug}/${key}`] ?? null) : null;
}

/** A round of the drawing challenge finished. */
export function reportRound(round: Omit<Round, 'id' | 'at'>): void {
  dispatchEvent(new CustomEvent(RACE_DONE_EVENT, { detail: { key: 'draw' } }));
  const r: Round = { ...round, id: crypto.randomUUID(), at: now() };
  void updateLearning((l) => ({ ...l, rounds: newestRounds([...l.rounds, r]) }));
}

export function setFavorite(id: string, on: boolean): Promise<Learning> {
  return updateLearning((l) => ({ ...l, favorites: { ...l.favorites, [id]: { on, at: now() } } }));
}

export function markOpened(id: string): Promise<Learning> {
  return updateLearning((l) => (l.opened[id] ? l : { ...l, opened: { ...l.opened, [id]: now() } }));
}
