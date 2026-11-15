import { describe, expect, it } from 'vitest';
import { presetState } from '../experiment.ts';
import { PRESETS } from '../presets.ts';
import { initialsOf } from './local.ts';
import {
  cleanLetters,
  fromBase64,
  parseSave,
  planMerge,
  SAVE_FORMAT,
  toBase64,
  validProfile,
  type Profile,
  type SavedEntry,
  type SaveFile,
} from './save.ts';

const state = presetState(PRESETS[0]);
const at = (day: number) => new Date(Date.UTC(2026, 10, day)).toISOString();
const NOW = Date.UTC(2026, 10, 20);
const PNG = toBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0]));

function entry(id: string, updated: string, extra: Partial<SavedEntry> = {}): SavedEntry {
  return {
    id,
    name: id,
    created: at(1),
    updated,
    state,
    models: ['N1'],
    epoch: 100,
    thumb: PNG,
    results: toBase64(new Uint8Array([1, 2, 3])),
    ...extra,
  };
}

function profile(updatedAt: string, name = 'Ada Lovelace'): Profile {
  return { name, picture: null, letters: '', tint: 'blue', createdAt: at(1), updatedAt };
}

function file(f: Partial<SaveFile>): string {
  return JSON.stringify({
    format: SAVE_FORMAT,
    version: 1,
    saved: at(10),
    profile: null,
    entries: [],
    removed: {},
    ...f,
  });
}

describe('base64', () => {
  it('round-trips bytes of every value, larger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 37) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
  it('refuses junk', () => {
    expect(fromBase64('***')).toBeNull();
  });
});

describe('profile', () => {
  it('derives initials from the first and last word', () => {
    expect(initialsOf('ada lovelace')).toBe('AL');
    expect(initialsOf('  Kiarash ')).toBe('K');
    expect(initialsOf('Jean Paul Sartre')).toBe('JS');
    expect(initialsOf('')).toBe('');
  });
  it('keeps letters short and upper case', () => {
    expect(cleanLetters(' x y z w')).toBe('XYZ');
  });
  it('drops unsafe or oversized pictures and unknown tints', () => {
    const p = validProfile({
      ...profile(at(2)),
      picture: 'javascript:alert(1)',
      tint: 'neon',
      name: 'x'.repeat(200),
    });
    expect(p?.picture).toBeNull();
    expect(p?.tint).toBe('blue');
    expect(p?.name.length).toBe(60);
    const ok = 'data:image/webp;base64,UklGRg==';
    expect(validProfile({ ...profile(at(2)), picture: ok })?.picture).toBe(ok);
    expect(
      validProfile({ ...profile(at(2)), picture: `data:image/webp;base64,${'A'.repeat(300_000)}` })
        ?.picture,
    ).toBeNull();
    expect(validProfile({ name: 'no dates' })).toBeNull();
  });
});

describe('parseSave', () => {
  it('reads a save and keeps only valid entries', () => {
    const r = parseSave(
      file({
        profile: profile(at(3)),
        entries: [
          entry('a', at(2)),
          { ...entry('b', at(2)), state: { junk: true } } as unknown as SavedEntry,
          { ...entry('../evil', at(2)) },
          entry('a', at(4)),
        ],
      }),
    );
    if (typeof r === 'string') throw new Error(r);
    expect(r.save.entries.map((e) => e.id)).toEqual(['a']);
    expect(r.skipped).toBe(3);
    expect(r.save.profile?.name).toBe('Ada Lovelace');
  });
  it('refuses what is not a save file', () => {
    expect(parseSave('{')).toBe('notJson');
    expect(parseSave('[]')).toBe('notSave');
    expect(parseSave(JSON.stringify({ format: 'xtraplaytion-experiment' }))).toBe('experiment');
    expect(parseSave(file({ version: 99 } as unknown as Partial<SaveFile>))).toBe('newer');
    expect(parseSave(file({ entries: 'x' } as unknown as Partial<SaveFile>))).toBe('invalid');
  });
  it('drops thumbnails that are not PNG', () => {
    const r = parseSave(
      file({ entries: [entry('a', at(2), { thumb: toBase64(new Uint8Array(8)) })] }),
    );
    if (typeof r === 'string') throw new Error(r);
    expect(r.save.entries[0]?.thumb).toBeNull();
  });
});

describe('planMerge', () => {
  const local = (entries: [string, string][], removed: Record<string, string> = {}) => ({
    entries: new Map(entries),
    removed,
    profile: profile(at(5)),
  });

  it('adds new entries and keeps the newer edit of the same entry', () => {
    const plan = planMerge(
      local([
        ['a', at(5)],
        ['b', at(5)],
      ]),
      {
        entries: [entry('a', at(6)), entry('b', at(4)), entry('c', at(3))],
        removed: {},
        profile: null,
      },
      NOW,
    );
    expect(plan.put.map((e) => e.id)).toEqual(['a', 'c']);
    expect([plan.added, plan.updated]).toEqual([1, 1]);
    expect(plan.remove).toEqual([]);
  });

  it('a deletion elsewhere removes the entry here, unless it was edited after', () => {
    const plan = planMerge(
      local([
        ['a', at(5)],
        ['b', at(9)],
      ]),
      { entries: [], removed: { a: at(7), b: at(7) }, profile: null },
      NOW,
    );
    expect(plan.remove).toEqual(['a']);
    expect(Object.keys(plan.removed).sort()).toEqual(['a', 'b']);
  });

  it('a deletion here keeps an older copy from coming back', () => {
    const plan = planMerge(
      local([], { a: at(7) }),
      { entries: [entry('a', at(6))], removed: {}, profile: null },
      NOW,
    );
    expect(plan.put).toEqual([]);
  });

  it('forgets very old deletion notes', () => {
    const plan = planMerge(
      local([], { old: '2025-01-01T00:00:00.000Z' }),
      { entries: [], removed: {}, profile: null },
      NOW,
    );
    expect(plan.removed).toEqual({});
  });

  it('takes the newer profile only', () => {
    const base = { entries: [], removed: {} };
    expect(planMerge(local([]), { ...base, profile: profile(at(4), 'Old') }, NOW).profile).toBe(
      null,
    );
    expect(
      planMerge(local([]), { ...base, profile: profile(at(6), 'New') }, NOW).profile?.name,
    ).toBe('New');
  });

  it('merging the same save twice changes nothing the second time', () => {
    const incoming = {
      entries: [entry('a', at(6))],
      removed: { z: at(8) },
      profile: profile(at(6)),
    };
    const first = planMerge(local([]), incoming, NOW);
    const after = {
      entries: new Map(first.put.map((e) => [e.id, e.updated] as [string, string])),
      removed: first.removed,
      profile: first.profile,
    };
    const second = planMerge(after, incoming, NOW);
    expect([second.put.length, second.remove.length, second.profile]).toEqual([0, 0, null]);
  });
});
