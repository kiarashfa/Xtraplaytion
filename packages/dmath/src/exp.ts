// exp and expm1, ported from fdlibm (FreeBSD msun e_exp.c, s_expm1.c).
// Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use,
// copy, modify, and distribute this software is freely granted, provided that
// this notice is preserved.

import { fromWords, hiWord, loWord, setHi } from './bits.ts';

const o_threshold = 7.09782712893383973096e2;
const u_threshold = -7.4513321910194110842e2;
const ln2HI = 6.9314718036912381649e-1;
const ln2LO = 1.90821492927058770002e-10;
const invln2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;
const twom1000 = 9.3326361850321887899e-302;
const TWO1023 = fromWords(0x7fe00000, 0);

export function exp(x: number): number {
  let hx = hiWord(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  let hi = 0;
  let lo = 0;
  let k = 0;

  if (hx >= 0x40862e42) {
    // |x| >= 709.78...
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | loWord(x)) !== 0) return x + x; // NaN
      return xsb === 0 ? x : 0; // exp(+-inf) = {inf, 0}
    }
    if (x > o_threshold) return Infinity;
    if (x < u_threshold) return 0;
  }

  if (hx > 0x3fd62e42) {
    // |x| > 0.5 ln2
    if (hx < 0x3ff0a2b2) {
      // and |x| < 1.5 ln2
      if (xsb === 0) {
        hi = x - ln2HI;
        lo = ln2LO;
        k = 1;
      } else {
        hi = x + ln2HI;
        lo = -ln2LO;
        k = -1;
      }
    } else {
      k = Math.trunc(invln2 * x + (xsb === 0 ? 0.5 : -0.5));
      hi = x - k * ln2HI; // exact
      lo = k * ln2LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    // |x| < 2^-28
    return 1 + x;
  }

  const t = x * x;
  const twopk =
    k >= -1021
      ? fromWords((0x3ff00000 + (k << 20)) | 0, 0)
      : fromWords((0x3ff00000 + ((k + 1000) << 20)) | 0, 0);
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  if (k >= -1021) {
    if (k === 1024) return y * 2 * TWO1023;
    return y * twopk;
  }
  return y * twopk * twom1000;
}

const Q1 = -3.33333333333331316428e-2;
const Q2 = 1.58730158725481460165e-3;
const Q3 = -7.93650757867487942473e-5;
const Q4 = 4.00821782732936239552e-6;
const Q5 = -2.01099218183624371326e-7;

export function expm1(x: number): number {
  let hx = hiWord(x);
  const xsb = hx & 0x80000000;
  hx &= 0x7fffffff;
  let hi: number;
  let lo: number;
  let k: number;
  let c = 0;

  if (hx >= 0x4043687a) {
    // |x| >= 56 ln2
    if (hx >= 0x40862e42) {
      if (hx >= 0x7ff00000) {
        if (((hx & 0xfffff) | loWord(x)) !== 0) return x + x; // NaN
        return xsb === 0 ? x : -1;
      }
      if (x > o_threshold) return Infinity;
    }
    if (xsb !== 0) return -1; // x < -56 ln2
  }

  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      if (xsb === 0) {
        hi = x - ln2HI;
        lo = ln2LO;
        k = 1;
      } else {
        hi = x + ln2HI;
        lo = -ln2LO;
        k = -1;
      }
    } else {
      k = Math.trunc(invln2 * x + (xsb === 0 ? 0.5 : -0.5));
      hi = x - k * ln2HI;
      lo = k * ln2LO;
    }
    x = hi - lo;
    c = hi - x - lo;
  } else if (hx < 0x3c900000) {
    return x; // |x| < 2^-54
  } else {
    k = 0;
  }

  const hfx = 0.5 * x;
  const hxs = x * hfx;
  const r1 = 1 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
  let t = 3 - r1 * hfx;
  let e = hxs * ((r1 - t) / (6 - x * t));
  if (k === 0) return x - (x * e - hxs);
  const twopk = fromWords((0x3ff + k) << 20, 0);
  e = x * (e - c) - c;
  e -= hxs;
  if (k === -1) return 0.5 * (x - e) - 0.5;
  if (k === 1) {
    if (x < -0.25) return -2 * (e - (x + 0.5));
    return 1 + 2 * (x - e);
  }
  let y: number;
  if (k <= -2 || k > 56) {
    y = 1 - (e - x);
    if (k === 1024) y = y * 2 * TWO1023;
    else y = y * twopk;
    return y - 1;
  }
  if (k < 20) {
    t = setHi(1, 0x3ff00000 - (0x200000 >> k)); // 1 - 2^-k
    y = t - (e - x);
    y = y * twopk;
  } else {
    t = setHi(1, (0x3ff - k) << 20); // 2^-k (low word of 1 is 0)
    y = x - (e + t);
    y += 1;
    y = y * twopk;
  }
  return y;
}
