// Fuzzing every reader of untrusted input: share links, experiment files, recordings and saved
// results, pasted tables, embed fragments. None may throw (except decodeRecording, whose callers
// catch), hang, or let through a state outside the playground limits.
import type { MLPConfig } from '@xtraplaytion/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseEmbedHash, MAX_TITLE } from './embed.ts';
import { presetState } from './experiment.ts';
import { experimentFile, readExperimentFile } from './file.ts';
import { PRESETS } from './presets.ts';
import {
  compressRecording,
  decodeRecording,
  decompressRecording,
  encodeRecording,
  type Recording,
} from './recording.ts';
import { decodeState, encodeState, LIMITS, validateState, type ExperimentState } from './share.ts';
import { parseTable, validSource } from './source.ts';

const RUNS = 300;

function withinLimits(s: ExperimentState) {
  expect(s.expr.length).toBeLessThanOrEqual(LIMITS.exprLength);
  expect(s.n).toBeLessThanOrEqual(LIMITS.n);
  expect(s.epochs).toBeLessThanOrEqual(LIMITS.epochs);
  expect(s.models.length).toBeGreaterThan(0);
  expect(s.models.length).toBeLessThanOrEqual(LIMITS.models);
  expect(s.domain[0]).toBeLessThan(s.domain[1]);
  for (const v of [...s.domain, s.n, s.seed, s.valFraction, s.epochs, ...s.bands.flat()])
    expect(Number.isFinite(v)).toBe(true);
  for (const m of s.models) {
    if (m.model.kind !== 'mlp') continue;
    const c = m.model as MLPConfig;
    expect(c.hidden.length).toBeLessThanOrEqual(LIMITS.layers);
    for (const w of c.hidden) expect(w).toBeLessThanOrEqual(LIMITS.width);
  }
  // A state that passed validation passes again unchanged (links and files are stable).
  // (Compared as JSON, which is how links and files carry it: JSON has no -0.)
  const json = JSON.parse(JSON.stringify(s)) as unknown;
  expect(validateState(json)).toEqual(json);
}

/** Random JSON-like values, including nested objects shaped a little like a state. */
const junk = fc.oneof(
  fc.anything({ maxDepth: 4 }),
  fc.jsonValue({ maxDepth: 5 }),
  fc.constant(null),
  fc.constant(Number.NaN),
  fc.constant(1e308),
  fc.constant(-0),
  fc.constant('__proto__'),
);

/** Valid states (every preset), with random paths replaced by junk. */
const base = PRESETS.map((p) => presetState(p));
function mutate(o: unknown, path: (string | number)[], value: unknown): unknown {
  if (!path.length || o === null || typeof o !== 'object') return value;
  const copy = (Array.isArray(o) ? [...o] : { ...o }) as Record<string | number, unknown>;
  const keys = Object.keys(copy);
  const key = keys.length ? keys[Math.abs(Number(path[0]) || 0) % keys.length] : path[0];
  copy[key] = mutate(copy[key], path.slice(1), value);
  return copy;
}
const mutated = fc
  .tuple(
    fc.integer({ min: 0, max: base.length - 1 }),
    fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 5 }),
    junk,
  )
  .map(([i, path, v]) => mutate(JSON.parse(JSON.stringify(base[i])), path, v));

describe('share links and states', () => {
  it('validateState never throws and only accepts states within the limits', () => {
    fc.assert(
      fc.property(fc.oneof(junk, mutated), (o) => {
        const s = validateState(o);
        if (s) withinLimits(s);
      }),
      { numRuns: RUNS * 4 },
    );
  });

  it('every preset is a valid state (the mutation corpus starts valid)', () => {
    for (const s of base) expect(validateState(JSON.parse(JSON.stringify(s)))).not.toBeNull();
  });

  it('decodeState returns null for random text and for damaged links', async () => {
    const good = await encodeState(base[0]);
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string({ maxLength: 400 }),
          fc.stringMatching(/^[A-Za-z0-9_-]{0,600}$/),
          fc
            .tuple(fc.integer({ min: 0, max: good.length - 1 }), fc.string({ maxLength: 3 }))
            .map(([at, s]) => good.slice(0, at) + s + good.slice(at + 1)),
        ),
        async (text) => {
          const s = await decodeState(text);
          if (s) withinLimits(s);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('refuses a link that inflates past the decoded-size cap (zip bomb)', async () => {
    const huge = new TextEncoder().encode(`{"v":4,"expr":"${'x'.repeat(4 << 20)}"}`);
    const deflated = new Uint8Array(
      await new Response(
        new Blob([huge]).stream().pipeThrough(new CompressionStream('deflate-raw')),
      ).arrayBuffer(),
    );
    let bin = '';
    for (const b of deflated) bin += String.fromCharCode(b);
    const code = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(code.length).toBeLessThan(12_000);
    expect(await decodeState(code)).toBeNull();
  });
});

describe('experiment files', () => {
  it('readExperimentFile never throws on random text or damaged files', () => {
    const good = experimentFile(base[1], 'A race');
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 300 }),
          junk.map((v) => JSON.stringify(v) ?? 'undefined'),
          mutated.map((state) =>
            JSON.stringify({ format: 'xtraplaytion-experiment', version: 1, name: 'x', state }),
          ),
          fc
            .tuple(fc.integer({ min: 0, max: good.length - 1 }), fc.string({ maxLength: 2 }))
            .map(([at, s]) => good.slice(0, at) + s + good.slice(at + 1)),
        ),
        (text) => {
          const r = readExperimentFile(text);
          if (typeof r !== 'string') {
            withinLimits(r.state);
            expect(r.name.length).toBeLessThanOrEqual(120);
          }
        },
      ),
      { numRuns: RUNS * 2 },
    );
  });
});

function recording(): Recording {
  const state = presetState(PRESETS[0]);
  return {
    key: 'k',
    state,
    backend: 'cpu-f64',
    adapter: '',
    created: '2026-11-11',
    gridSize: 32,
    models: [0, 1].map((m) => ({
      trainLoss: Float32Array.from({ length: 12 }, (_, e) => 1 / (e + 1 + m)),
      valLoss: Float32Array.from({ length: 12 }, (_, e) => 2 / (e + 1 + m)),
      frameEpochs: Uint32Array.of(0, 6, 12),
      grids: [0, 1, 2].map((k) => Float32Array.from({ length: 32 }, (_, i) => Math.sin(i + k))),
      diverged: false,
    })),
  };
}

describe('recordings and saved results', () => {
  it('decodeRecording fails cleanly (an Error, quickly) on random and damaged bytes', () => {
    const good = encodeRecording(recording());
    fc.assert(
      fc.property(
        fc.oneof(
          fc.uint8Array({ maxLength: 600 }),
          fc
            .tuple(
              fc.array(
                fc.tuple(
                  fc.integer({ min: 0, max: good.length - 1 }),
                  fc.integer({ min: 0, max: 255 }),
                ),
                {
                  minLength: 1,
                  maxLength: 8,
                },
              ),
              fc.integer({ min: 0, max: good.length }),
            )
            .map(([edits, cut]) => {
              const b = good.slice(0, cut || good.length);
              for (const [at, v] of edits) if (at < b.length) b[at] = v;
              return b;
            }),
        ),
        (bytes) => {
          const t0 = performance.now();
          try {
            const r = decodeRecording(bytes);
            expect(Array.isArray(r.models)).toBe(true);
          } catch (e) {
            expect(e).toBeInstanceOf(Error);
          }
          expect(performance.now() - t0).toBeLessThan(500);
        },
      ),
      { numRuns: RUNS * 2 },
    );
  });

  it('decompressRecording rejects random bytes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 400 }), async (bytes) => {
        await expect(decompressRecording(bytes)).rejects.toBeInstanceOf(Error);
      }),
      { numRuns: 100 },
    );
    // and still reads a real one
    const back = await decompressRecording(await compressRecording(recording()));
    expect(back.models).toHaveLength(2);
  });
});

describe('pasted data, sources, embed fragments', () => {
  it('parseTable never throws and keeps every number finite', () => {
    const cell = fc.oneof(
      fc.double({ noNaN: false }).map(String),
      fc.string({ maxLength: 6 }),
      fc.constantFrom('', '#', '"', '1,5', '1e400', '-', 'NaN', 'Infinity', ' '),
    );
    const sep = fc.constantFrom(',', ';', '\t', ' ', '|', '  ');
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 400 }),
          fc
            .tuple(fc.array(fc.array(cell, { maxLength: 5 }), { maxLength: 30 }), sep)
            .map(([rows, d]) => rows.map((r) => r.join(d)).join('\n')),
        ),
        (text) => {
          const t = parseTable(text);
          if (typeof t === 'string') return;
          for (const row of t.rows)
            for (const v of row) expect(Number.isNaN(v) || Number.isFinite(v)).toBe(true);
        },
      ),
      { numRuns: RUNS * 2 },
    );
  });

  it('validSource never throws on junk', () => {
    fc.assert(
      fc.property(junk, (o) => {
        validSource(o);
      }),
      { numRuns: RUNS },
    );
  });

  it('parseEmbedHash never throws and caps the title', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 600 }), (s) => {
        const p = parseEmbedHash(s);
        if (p.title) expect(p.title.length).toBeLessThanOrEqual(MAX_TITLE);
        if (p.theme) expect(['light', 'dark']).toContain(p.theme);
      }),
      { numRuns: RUNS },
    );
  });
});
