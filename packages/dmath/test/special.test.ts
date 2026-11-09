// Special values follow IEEE-754 / C99 Annex F, which is also what Math does.
import { describe, expect, it } from 'vitest';
import * as d from '../src/index.ts';

// Signed zeros, infinities, NaN, the smallest subnormals and the largest double.
const specials = [
  0,
  -0,
  Infinity,
  -Infinity,
  NaN,
  5e-324,
  -5e-324,
  1.7976931348623157e308,
  -1.7976931348623157e308,
];
// Ordinary values whose results are exact, so every correct implementation agrees.
const exactPoints: [string, (x: number) => number, number, number][] = [
  ['log', d.log, 1, 0],
  ['log2', d.log2, 1, 0],
  ['log10', d.log10, 1, 0],
  ['exp', d.exp, 0, 1],
  ['cos', d.cos, 0, 1],
  ['cosh', d.cosh, 0, 1],
  ['asin', d.asin, 0, 0],
  ['acos', d.acos, 1, 0],
];
const unary: [string, (x: number) => number, (x: number) => number][] = [
  ['exp', d.exp, Math.exp],
  ['expm1', d.expm1, Math.expm1],
  ['log', d.log, Math.log],
  ['log1p', d.log1p, Math.log1p],
  ['log2', d.log2, Math.log2],
  ['log10', d.log10, Math.log10],
  ['sin', d.sin, Math.sin],
  ['cos', d.cos, Math.cos],
  ['tan', d.tan, Math.tan],
  ['asin', d.asin, Math.asin],
  ['acos', d.acos, Math.acos],
  ['atan', d.atan, Math.atan],
  ['sinh', d.sinh, Math.sinh],
  ['cosh', d.cosh, Math.cosh],
  ['tanh', d.tanh, Math.tanh],
];

describe('special values match Math', () => {
  for (const [name, f, g] of unary) {
    it(name, () => {
      for (const x of specials) expect(f(x), `${name}(${x})`).toBe(g(x));
    });
  }

  it('exact points', () => {
    for (const [name, f, x, want] of exactPoints) expect(f(x), `${name}(${x})`).toBe(want);
  });

  it('pow, including ECMAScript rules for 1 and -1', () => {
    const xs = [...specials, 1, -1, 0.5, -0.5, 2, -2];
    for (const x of xs) {
      for (const y of [...xs, 3, -3, 0.25, 1e10]) {
        const want = Math.pow(x, y);
        // Only special or exactly representable results (integers, powers of two) must agree bit for bit.
        const exactResult =
          !Number.isFinite(want) ||
          want === 0 ||
          Number.isInteger(want) ||
          Number.isInteger(Math.log2(Math.abs(want)));
        if (exactResult) expect(d.pow(x, y), `pow(${x}, ${y})`).toBe(want);
      }
    }
  });

  it('atan2', () => {
    const vs = [...specials, 1, -1];
    for (const y of vs) {
      for (const x of vs) expect(d.atan2(y, x), `atan2(${y}, ${x})`).toBe(Math.atan2(y, x));
    }
  });

  it('erf', () => {
    expect(d.erf(0)).toBe(0);
    expect(Object.is(d.erf(-0), -0)).toBe(true);
    expect(d.erf(Infinity)).toBe(1);
    expect(d.erf(-Infinity)).toBe(-1);
    expect(d.erf(NaN)).toBeNaN();
    expect(d.erf(6)).toBe(1);
  });
});

describe('exact results that users will notice', () => {
  it('logs of powers are exact', () => {
    for (let k = -1074; k <= 1023; k += 7) expect(d.log2(2 ** k)).toBe(k);
    for (let k = 0; k <= 22; k++) expect(d.log10(10 ** k)).toBe(k);
    expect(d.log(d.E)).toBe(1);
  });

  it('integer powers are exact when representable', () => {
    for (let b = -20; b <= 20; b++) {
      for (let e = 0; e <= 10; e++) expect(d.pow(b, e), `${b}^${e}`).toBe(b ** e);
    }
  });
});
