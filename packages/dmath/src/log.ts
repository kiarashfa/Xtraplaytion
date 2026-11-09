// log, log1p, log2, log10, ported from fdlibm (FreeBSD msun e_log.c,
// s_log1p.c, e_log2.c, e_log10.c, k_log.h).
// Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use,
// copy, modify, and distribute this software is freely granted, provided that
// this notice is preserved.

import { hiWord, loWord, setHi, setLo } from './bits.ts';

const ln2_hi = 6.9314718036912381649e-1;
const ln2_lo = 1.90821492927058770002e-10;
const two54 = 1.8014398509481984e16;
const Lg1 = 6.66666666666673513e-1;
const Lg2 = 3.999999999940941908e-1;
const Lg3 = 2.857142874366239149e-1;
const Lg4 = 2.222219843214978396e-1;
const Lg5 = 1.818357216161805012e-1;
const Lg6 = 1.531383769920937332e-1;
const Lg7 = 1.479819860511658591e-1;

export function log(x: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= two54; // subnormal: scale up
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = setHi(x, hx | (i ^ 0x3ff00000)); // normalize x or x/2
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    // -2^-20 <= f < 2^-20
    if (f === 0) {
      if (k === 0) return 0;
      return k * ln2_hi + k * ln2_lo;
    }
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    return k * ln2_hi - (R - k * ln2_lo - f);
  }
  const s = f / (2 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - (hfsq - (s * (hfsq + R) + dk * ln2_lo) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * ln2_hi - (s * (f - R) - dk * ln2_lo - f);
}

export function log1p(x: number): number {
  const hx = hiWord(x);
  const ax = hx & 0x7fffffff;
  let k = 1;
  let f = 0;
  let hu = 0;
  let c = 0;

  if (hx < 0x3fda827a) {
    // 1+x < sqrt(2)+
    if (ax >= 0x3ff00000) {
      // x <= -1.0
      if (x === -1) return -Infinity;
      return NaN;
    }
    if (ax < 0x3e200000) {
      // |x| < 2^-29
      if (ax < 0x3c900000) return x; // |x| < 2^-54
      return x - x * x * 0.5;
    }
    if (hx > 0 || hx <= (0xbfd2bec4 | 0)) {
      // sqrt(2)/2- <= 1+x < sqrt(2)+
      k = 0;
      f = x;
      hu = 1;
    }
  }
  if (hx >= 0x7ff00000) return x + x;
  if (k !== 0) {
    let u: number;
    if (hx < 0x43400000) {
      u = 1 + x;
      hu = hiWord(u);
      k = (hu >> 20) - 1023;
      c = k > 0 ? 1 - (u - x) : x - (u - 1); // correction term
      c /= u;
    } else {
      u = x;
      hu = hiWord(u);
      k = (hu >> 20) - 1023;
      c = 0;
    }
    hu &= 0x000fffff;
    if (hu < 0x6a09e) {
      u = setHi(u, hu | 0x3ff00000); // normalize u
    } else {
      k += 1;
      u = setHi(u, hu | 0x3fe00000); // normalize u/2
      hu = (0x00100000 - hu) >> 2;
    }
    f = u - 1;
  }
  const hfsq = 0.5 * f * f;
  if (hu === 0) {
    // |f| < 2^-20
    if (f === 0) {
      if (k === 0) return 0;
      c += k * ln2_lo;
      return k * ln2_hi + c;
    }
    const R = hfsq * (1 - 0.66666666666666666 * f);
    if (k === 0) return f - R;
    return k * ln2_hi - (R - (k * ln2_lo + c) - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const R = z * (Lg1 + z * (Lg2 + z * (Lg3 + z * (Lg4 + z * (Lg5 + z * (Lg6 + z * Lg7))))));
  if (k === 0) return f - (hfsq - s * (hfsq + R));
  return k * ln2_hi - (hfsq - (s * (hfsq + R) + (k * ln2_lo + c)) - f);
}

/** log(1+f) - f + f*f/2 for f in [sqrt(2)/2-1, sqrt(2)-1] (k_log.h). */
function k_log1p(f: number): number {
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  const R = t2 + t1;
  const hfsq = 0.5 * f * f;
  return s * (hfsq + R);
}

/** Shared reduction of log2/log10: returns [k, f] with x = 2^k (1+f), or a final value. */
function reduce(x: number): { k: number; f: number } | number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= two54;
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx === 0x3ff00000 && lx === 0) return 0;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  x = setHi(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  return { k, f: x - 1 };
}

const ivln2hi = 1.44269504072144627571;
const ivln2lo = 1.67517131648865118353e-10;

export function log2(x: number): number {
  const red = reduce(x);
  if (typeof red === 'number') return red;
  const { k, f } = red;
  const y = k;
  const hfsq = 0.5 * f * f;
  const r = k_log1p(f);
  let hi = f - hfsq;
  hi = setLo(hi, 0);
  const lo = f - hi - hfsq + r;
  let val_hi = hi * ivln2hi;
  let val_lo = (lo + hi) * ivln2lo + lo * ivln2hi;
  const w = y + val_hi;
  val_lo += y - w + val_hi;
  val_hi = w;
  return val_lo + val_hi;
}

const ivln10hi = 4.34294481878168880939e-1;
const ivln10lo = 2.50829467116452752298e-11;
const log10_2hi = 3.01029995663611771306e-1;
const log10_2lo = 3.69423907715893078616e-13;

export function log10(x: number): number {
  const red = reduce(x);
  if (typeof red === 'number') return red;
  const { k, f } = red;
  const y = k;
  const hfsq = 0.5 * f * f;
  const r = k_log1p(f);
  let hi = f - hfsq;
  hi = setLo(hi, 0);
  const lo = f - hi - hfsq + r;
  let val_hi = hi * ivln10hi;
  const y2 = y * log10_2hi;
  let val_lo = y * log10_2lo + (lo + hi) * ivln10lo + lo * ivln10hi;
  const w = y2 + val_hi;
  val_lo += y2 - w + val_hi;
  val_hi = w;
  return val_lo + val_hi;
}
