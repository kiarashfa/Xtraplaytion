import { describe, expect, it } from 'vitest';
import {
  challengeStats,
  emptyLearning,
  favoriteIds,
  guessStats,
  hasLearning,
  learningKey,
  lessonSlug,
  mergeLearning,
  validLearning,
  type Learning,
  type Round,
} from './learning.ts';
import { planMerge } from './save.ts';

const at = (day: number) => new Date(Date.UTC(2026, 10, day)).toISOString();
const round = (
  id: string,
  day: number,
  winner: string,
  guess: string | null,
  e: number[],
): Round => ({
  id,
  at: at(day),
  winner,
  guess,
  errors: { A: e[0] ?? 1, B: e[1] ?? 1 },
});
const of = (l: Partial<Learning>): Learning => ({ ...emptyLearning(), ...l });

describe('validLearning', () => {
  it('keeps good data and drops junk', () => {
    const l = validLearning({
      lessons: { a: { learned: at(2), at: at(2) }, b: { learned: null, at: at(3) }, c: 'x' },
      guesses: { 'a/race:x': { guess: 'N1', winner: 'N2', right: false, at: at(2) }, bad: {} },
      rounds: [round('r1', 2, 'A', 'A', [0.1, 0.2]), { id: 'r2' }, round('r1', 3, 'B', null, [])],
      favorites: { g: { on: true, at: at(4) }, 'no spaces allowed': { on: true, at: at(4) } },
      opened: { g: at(4), h: 'never' },
    });
    expect(Object.keys(l.lessons)).toEqual(['a', 'b']);
    expect(Object.keys(l.guesses)).toEqual(['a/race:x']);
    expect(l.rounds.map((r) => r.id)).toEqual(['r1']);
    expect(Object.keys(l.favorites)).toEqual(['g']);
    expect(l.opened).toEqual({ g: at(4) });
    expect(validLearning('nonsense')).toEqual(emptyLearning());
  });
});

describe('mergeLearning', () => {
  it('lessons and favorites keep their latest change; guesses keep the first answer', () => {
    const a = of({
      lessons: { x: { learned: at(2), at: at(2) } },
      guesses: { k: { guess: 'A', winner: 'B', right: false, at: at(2) } },
      favorites: { g: { on: true, at: at(5) } },
      opened: { g: at(5) },
    });
    const b = of({
      lessons: { x: { learned: null, at: at(3) } },
      guesses: { k: { guess: 'B', winner: 'B', right: true, at: at(4) } },
      favorites: { g: { on: false, at: at(4) } },
      opened: { g: at(1) },
    });
    const m = mergeLearning(a, b);
    expect(m.lessons['x']?.learned).toBeNull();
    expect(m.guesses['k']?.guess).toBe('A');
    expect(m.favorites['g']?.on).toBe(true);
    expect(m.opened['g']).toBe(at(1));
    expect(learningKey(mergeLearning(a, b))).toBe(learningKey(mergeLearning(b, a)));
  });

  it('joins challenge rounds by id, newest 100 kept', () => {
    const a = of({ rounds: [round('r1', 1, 'A', 'A', [])] });
    const b = of({ rounds: [round('r1', 1, 'A', 'A', []), round('r2', 2, 'B', 'A', [])] });
    expect(mergeLearning(a, b).rounds.map((r) => r.id)).toEqual(['r1', 'r2']);
    const many = of({
      rounds: Array.from({ length: 130 }, (_, i) => ({
        ...round(`r${i}`, 1, 'A', null, []),
        at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      })),
    });
    const kept = mergeLearning(many, emptyLearning()).rounds;
    expect(kept).toHaveLength(100);
    expect(kept.at(-1)?.id).toBe('r129');
  });

  it('is idempotent', () => {
    const a = of({ lessons: { x: { learned: at(2), at: at(2) } }, opened: { g: at(3) } });
    expect(learningKey(mergeLearning(a, a))).toBe(learningKey(a));
  });
});

describe('derived numbers', () => {
  it('guess, challenge and favorite stats', () => {
    const l = of({
      guesses: {
        a: { guess: 'X', winner: 'X', right: true, at: at(1) },
        b: { guess: 'X', winner: 'Y', right: false, at: at(1) },
      },
      rounds: [
        round('r1', 1, 'A', 'A', [0.1, 0.5]),
        round('r2', 2, 'B', 'A', [0.4, 0.2]),
        round('r3', 3, 'A', null, [0.3, 0.6]),
      ],
      favorites: {
        old: { on: true, at: at(1) },
        off: { on: false, at: at(9) },
        new: { on: true, at: at(5) },
      },
    });
    expect(guessStats(l)).toEqual({ right: 1, total: 2 });
    const c = challengeStats(l);
    expect([c.rounds, c.guessed, c.right]).toEqual([3, 2, 1]);
    expect(c.models).toEqual([
      { name: 'A', wins: 2, best: 0.1 },
      { name: 'B', wins: 1, best: 0.2 },
    ]);
    expect(favoriteIds(l)).toEqual(['new', 'old']);
    expect(hasLearning(l)).toBe(true);
    expect(hasLearning(of({ lessons: { x: { learned: null, at: at(1) } } }))).toBe(false);
  });

  it('finds the lesson from the address', () => {
    expect(lessonSlug('/Xtraplaytion/lessons/activations-and-extrapolation/')).toBe(
      'activations-and-extrapolation',
    );
    expect(lessonSlug('/Xtraplaytion/lessons/')).toBeNull();
  });
});

describe('save file merge', () => {
  it('reports learning only when the join differs from what is here', () => {
    const mine = of({ lessons: { x: { learned: at(2), at: at(2) } } });
    const local = {
      entries: new Map<string, string>(),
      removed: {},
      profile: null,
      learning: mine,
    };
    expect(
      planMerge(local, { entries: [], removed: {}, profile: null, learning: mine }).learning,
    ).toBeNull();
    const theirs = of({ lessons: { y: { learned: at(3), at: at(3) } } });
    const plan = planMerge(local, { entries: [], removed: {}, profile: null, learning: theirs });
    expect(Object.keys(plan.learning?.lessons ?? {}).sort()).toEqual(['x', 'y']);
    expect(planMerge(local, { entries: [], removed: {}, profile: null }).learning).toBeNull();
  });
});
