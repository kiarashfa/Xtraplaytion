// Accuracy against high-precision references. The bounds are those of fdlibm:
// below 1 ULP for most functions, below 2 ULP for the hyperbolic ones and atan2
// (V8's built-in Math returns the same bits for those, so they match it).
import { describe, expect, it } from 'vitest';
import * as d from '../src/index.ts';
import { D, erfRef, exact, ulpError, type Dec } from './reference.ts';

const rng = new d.Rng(20261109);

type Sampler = () => number;
const lin =
  (lo: number, hi: number): Sampler =>
  () =>
    rng.uniform(lo, hi);
/** Log-uniform magnitude, random sign if `signed`. */
const logu =
  (lo: number, hi: number, signed = false): Sampler =>
  () => {
    const m = Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * rng.next());
    return signed && rng.next() < 0.5 ? -m : m;
  };

interface Case {
  name: string;
  f: (x: number) => number;
  ref: (x: Dec) => Dec;
  samplers: Sampler[];
  n?: number;
  /** Maximum allowed error in ULPs (default 1). */
  bound?: number;
}

const cases: Case[] = [
  {
    name: 'exp',
    f: d.exp,
    ref: (x) => x.exp(),
    samplers: [lin(-745, 709), lin(-1, 1), logu(1e-20, 1, true)],
  },
  {
    name: 'expm1',
    f: d.expm1,
    ref: (x) => x.exp().minus(1),
    samplers: [lin(-40, 40), logu(1e-20, 1, true)],
  },
  { name: 'log', f: d.log, ref: (x) => x.ln(), samplers: [logu(1e-300, 1e300), lin(0.5, 2)] },
  {
    name: 'log1p',
    f: d.log1p,
    ref: (x) => x.plus(1).ln(),
    samplers: [lin(-0.999, 3), logu(1e-20, 1e10)],
  },
  {
    name: 'log2',
    f: d.log2,
    ref: (x) => x.ln().div(new D(2).ln()),
    samplers: [logu(1e-300, 1e300), lin(0.5, 2)],
  },
  {
    name: 'log10',
    f: d.log10,
    ref: (x) => x.ln().div(new D(10).ln()),
    samplers: [logu(1e-300, 1e300), lin(0.5, 2)],
  },
  {
    name: 'sin',
    f: d.sin,
    ref: (x) => x.sin(),
    samplers: [lin(-10, 10), lin(-1e4, 1e4), logu(1e-10, 1, true)],
  },
  { name: 'cos', f: d.cos, ref: (x) => x.cos(), samplers: [lin(-10, 10), lin(-1e4, 1e4)] },
  { name: 'tan', f: d.tan, ref: (x) => x.tan(), samplers: [lin(-10, 10), lin(-1e4, 1e4)] },
  { name: 'asin', f: d.asin, ref: (x) => x.asin(), samplers: [lin(-1, 1), logu(1e-10, 1, true)] },
  { name: 'acos', f: d.acos, ref: (x) => x.acos(), samplers: [lin(-1, 1)] },
  {
    name: 'atan',
    f: d.atan,
    ref: (x) => x.atan(),
    samplers: [lin(-4, 4), logu(1e-10, 1e20, true)],
  },
  {
    name: 'sinh',
    f: d.sinh,
    ref: (x) => x.sinh(),
    samplers: [lin(-30, 30), logu(1e-10, 1, true)],
    bound: 2,
  },
  { name: 'cosh', f: d.cosh, ref: (x) => x.cosh(), samplers: [lin(-30, 30)], bound: 2 },
  {
    name: 'tanh',
    f: d.tanh,
    ref: (x) => x.tanh(),
    samplers: [lin(-20, 20), logu(1e-10, 1, true)],
    bound: 2,
  },
  { name: 'erf', f: d.erf, ref: erfRef, samplers: [lin(-6, 6), logu(1e-10, 1, true)], n: 400 },
];

describe('ULP accuracy', () => {
  for (const c of cases) {
    it(`${c.name} < ${c.bound ?? 1} ULP`, () => {
      let worst = 0;
      let worstX = 0;
      const n = c.n ?? 1500;
      for (const sample of c.samplers) {
        for (let i = 0; i < n; i++) {
          const x = sample();
          const err = ulpError(c.f(x), c.ref(exact(x)));
          if (err > worst) {
            worst = err;
            worstX = x;
          }
        }
      }
      expect(worst, `${c.name}(${worstX})`).toBeLessThan(c.bound ?? 1);
    });
  }

  it('sin and cos of huge arguments < 1 ULP (Payne-Hanek reduction)', () => {
    // Reduce modulo 2 pi with 420 digits first; decimal.js trig cannot take 1e300 directly.
    const Big = D.clone({ precision: 420 });
    const twoPi = Big.acos(-1).times(2);
    let worst = 0;
    for (let i = 0; i < 60; i++) {
      const x = logu(1e6, 1e300, true)();
      const r = new D(exact(x, Big).mod(twoPi));
      worst = Math.max(worst, ulpError(d.sin(x), r.sin()), ulpError(d.cos(x), r.cos()));
    }
    expect(worst).toBeLessThan(1);
  });

  it('atan2 < 2 ULP in all quadrants', () => {
    let worst = 0;
    for (let i = 0; i < 1500; i++) {
      const y = rng.uniform(-5, 5);
      const x = rng.uniform(-5, 5);
      worst = Math.max(worst, ulpError(d.atan2(y, x), D.atan2(exact(y), exact(x))));
    }
    expect(worst).toBeLessThan(2);
  });

  it('pow < 1 ULP', () => {
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const x = i % 2 ? rng.uniform(0, 20) : logu(1e-100, 1e100)();
      const y = i % 2 ? rng.uniform(-30, 30) : rng.uniform(-2, 2);
      worst = Math.max(worst, ulpError(d.pow(x, y), exact(x).pow(exact(y))));
    }
    expect(worst).toBeLessThan(1);
  });
});

describe('argument reduction table', () => {
  it('IPIO2 holds the bits of 2/pi', async () => {
    const { IPIO2 } = await import('../src/trig.ts');
    const P = D.clone({ precision: 600 });
    let v = new P(2).div(P.acos(-1));
    const chunks: number[] = [];
    for (let i = 0; i < IPIO2.length; i++) {
      v = v.times(16777216);
      const c = v.floor();
      chunks.push(c.toNumber());
      v = v.minus(c);
    }
    expect(IPIO2).toEqual(chunks);
  });
});
