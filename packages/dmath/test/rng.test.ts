import { describe, expect, it } from 'vitest';
import { Rng } from '../src/index.ts';

describe('Rng', () => {
  it('is reproducible and seed/stream dependent', () => {
    const take = (r: Rng) => Array.from({ length: 8 }, () => r.nextU32());
    expect(take(new Rng(7))).toEqual(take(new Rng(7)));
    expect(take(new Rng(7))).not.toEqual(take(new Rng(8)));
    expect(take(new Rng(7, 1))).not.toEqual(take(new Rng(7, 2)));
  });

  it('has a fixed sequence (format guard for saved runs and share links)', () => {
    const r = new Rng(1);
    expect(Array.from({ length: 4 }, () => r.nextU32())).toMatchInlineSnapshot(`
      [
        2442144158,
        3238099751,
        3819917871,
        2104621829,
      ]
    `);
    expect(new Rng(1).next()).toMatchInlineSnapshot(`0.5686059948349658`);
  });

  it('draws uniform doubles in [0, 1) with the right moments', () => {
    const r = new Rng(123);
    let sum = 0;
    let sq = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const u = r.next();
      expect(u >= 0 && u < 1).toBe(true);
      sum += u;
      sq += u * u;
    }
    expect(sum / n).toBeCloseTo(0.5, 2);
    expect(sq / n - (sum / n) ** 2).toBeCloseTo(1 / 12, 2);
  });

  it('draws normals with the right mean and spread', () => {
    const r = new Rng(99);
    let sum = 0;
    let sq = 0;
    let within1 = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const z = r.normal(3, 2);
      sum += z;
      sq += z * z;
      if (Math.abs(z - 3) < 2) within1++;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(3, 1);
    expect(Math.sqrt(sq / n - mean * mean)).toBeCloseTo(2, 1);
    expect(within1 / n).toBeCloseTo(0.6827, 2);
  });

  it('int(n) covers 0..n-1 evenly', () => {
    const r = new Rng(5);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60_000; i++) counts[r.int(6)]++;
    for (const c of counts) expect(c / 10_000).toBeCloseTo(1, 1);
  });
});
