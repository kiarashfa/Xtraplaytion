// Seeded random numbers that are identical in every JS engine: xoshiro128**
// (Blackman and Vigna, public domain) seeded with splitmix32, 53-bit uniform
// doubles, and Gaussian samples via the Marsaglia polar method on dmath log.

import { log } from './log.ts';

function splitmix32(state: number): [number, number] {
  state = (state + 0x9e3779b9) | 0;
  let z = state;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  z ^= z >>> 16;
  return [state, z >>> 0];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  /**
   * @param seed any integer (only the low 32 bits are used)
   * @param stream optional stream id, so one seed can feed independent generators
   */
  constructor(seed: number, stream = 0) {
    let s = (seed ^ Math.imul(stream, 0x632be5ab)) | 0;
    let v: number;
    [s, v] = splitmix32(s);
    this.a = v;
    [s, v] = splitmix32(s);
    this.b = v;
    [s, v] = splitmix32(s);
    this.c = v;
    [, v] = splitmix32(s);
    this.d = v;
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return result;
  }

  /** Uniform double in [0, 1) with 53 random bits. */
  next(): number {
    const hi = this.nextU32() >>> 5; // 27 bits
    const lo = this.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform double in [lo, hi). */
  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Normal sample with the given mean and standard deviation. */
  normal(mean = 0, std = 1): number {
    if (this.spare !== null) {
      const z = this.spare;
      this.spare = null;
      return mean + std * z;
    }
    let u: number;
    let v: number;
    let s: number;
    do {
      u = 2 * this.next() - 1;
      v = 2 * this.next() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * log(s)) / s);
    this.spare = v * f;
    return mean + std * (u * f);
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}
