// Fixed input vectors evaluated identically in Node and in browsers (see
// identical.engines.ts). Only plain TypeScript, no Node APIs: browsers load it.
import * as d from '../src/index.ts';

export interface VectorReport {
  engine: string;
  /** FNV-1a 64-bit hash of every dmath output, per function. */
  dmath: Record<string, string>;
  /** Native Math outputs as hex bit patterns, per function (drift measurement). */
  native: Record<string, string[]>;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function hex(x: number): string {
  f64[0] = x;
  return u32[1].toString(16).padStart(8, '0') + u32[0].toString(16).padStart(8, '0');
}

function hash(values: number[]): string {
  // Two 32-bit FNV-1a lanes over the IEEE bytes.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (const v of values) {
    f64[0] = v;
    for (const w of [u32[0], u32[1]]) {
      for (let b = 0; b < 32; b += 8) {
        const byte = (w >>> b) & 0xff;
        h1 = Math.imul(h1 ^ byte, 0x01000193);
        h2 = Math.imul(h2 ^ byte, 0x01000193);
      }
    }
    h2 = Math.imul(h2 ^ 0x9e, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

type Unary = [string, (x: number) => number, (x: number) => number, number, number];

const UNARY: Unary[] = [
  ['exp', d.exp, Math.exp, -745, 709],
  ['expm1', d.expm1, Math.expm1, -40, 40],
  ['log', d.log, Math.log, 1e-12, 1e6],
  ['log1p', d.log1p, Math.log1p, -0.999, 10],
  ['log2', d.log2, Math.log2, 1e-12, 1e6],
  ['log10', d.log10, Math.log10, 1e-12, 1e6],
  ['sin', d.sin, Math.sin, -50, 50],
  ['cos', d.cos, Math.cos, -50, 50],
  ['tan', d.tan, Math.tan, -50, 50],
  ['asin', d.asin, Math.asin, -1, 1],
  ['acos', d.acos, Math.acos, -1, 1],
  ['atan', d.atan, Math.atan, -50, 50],
  ['sinh', d.sinh, Math.sinh, -20, 20],
  ['cosh', d.cosh, Math.cosh, -20, 20],
  ['tanh', d.tanh, Math.tanh, -10, 10],
];

export function computeVectors(engine = 'unknown', n = 2000): VectorReport {
  const report: VectorReport = { engine, dmath: {}, native: {} };
  const rng = new d.Rng(4242);
  const specials = [0, -0, 1, -1, 0.5, Infinity, -Infinity, NaN, 5e-324, 1e-310, 1e300, 1e22];

  for (const [name, f, g, lo, hi] of UNARY) {
    const xs = [...specials];
    for (let i = 0; i < n; i++) xs.push(rng.uniform(lo, hi));
    report.dmath[name] = hash(xs.map(f));
    report.native[name] = xs.map((x) => hex(g(x)));
  }

  const erfXs = [...specials];
  for (let i = 0; i < n; i++) erfXs.push(rng.uniform(-6, 6));
  report.dmath['erf'] = hash(erfXs.map(d.erf));

  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) pairs.push([rng.uniform(0, 20), rng.uniform(-30, 30)]);
  report.dmath['pow'] = hash(pairs.map(([x, y]) => d.pow(x, y)));
  report.native['pow'] = pairs.map(([x, y]) => hex(Math.pow(x, y)));
  report.dmath['atan2'] = hash(pairs.map(([x, y]) => d.atan2(y - 15, x - 10)));
  report.native['atan2'] = pairs.map(([x, y]) => hex(Math.atan2(y - 15, x - 10)));

  const r = new d.Rng(7, 3);
  const draws: number[] = [];
  for (let i = 0; i < n; i++) draws.push(r.next(), r.normal(), r.int(1000));
  report.dmath['rng'] = hash(draws);
  return report;
}
