// sinh, cosh, tanh, ported from fdlibm (FreeBSD msun e_sinh.c, e_cosh.c,
// s_tanh.c).
// Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use,
// copy, modify, and distribute this software is freely granted, provided that
// this notice is preserved.

import { hiWord } from './bits.ts';
import { exp, expm1 } from './exp.ts';

export function sinh(x: number): number {
  const jx = hiWord(x);
  const ix = jx & 0x7fffffff;
  if (ix >= 0x7ff00000) return x + x; // inf or NaN
  const h = jx < 0 ? -0.5 : 0.5;
  if (ix < 0x40360000) {
    // |x| < 22
    if (ix < 0x3e300000) return x; // |x| < 2^-28
    const t = expm1(Math.abs(x));
    if (ix < 0x3ff00000) return h * (2 * t - (t * t) / (t + 1));
    return h * (t + t / (t + 1));
  }
  if (ix < 0x40862e42) return h * exp(Math.abs(x)); // |x| in [22, log(maxdouble)]
  if (ix <= 0x408633ce) {
    // |x| in [log(maxdouble), overflow threshold]
    const w = exp(0.5 * Math.abs(x));
    const t = h * w;
    return t * w;
  }
  return x * 1e307; // overflow
}

export function cosh(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix >= 0x7ff00000) return x * x;
  if (ix < 0x3fd62e43) {
    // |x| in [0, 0.5 ln2]
    const t = expm1(Math.abs(x));
    const w = 1 + t;
    if (ix < 0x3c800000) return w; // cosh(tiny) = 1
    return 1 + (t * t) / (w + w);
  }
  if (ix < 0x40360000) {
    // |x| in [0.5 ln2, 22]
    const t = exp(Math.abs(x));
    return 0.5 * t + 0.5 / t;
  }
  if (ix < 0x40862e42) return 0.5 * exp(Math.abs(x));
  if (ix <= 0x408633ce) {
    const w = exp(0.5 * Math.abs(x));
    const t = 0.5 * w;
    return t * w;
  }
  return Infinity;
}

export function tanh(x: number): number {
  const jx = hiWord(x);
  const ix = jx & 0x7fffffff;
  if (ix >= 0x7ff00000) {
    // tanh(+-inf) = +-1, tanh(NaN) = NaN
    return jx >= 0 ? 1 / x + 1 : 1 / x - 1;
  }
  let z: number;
  if (ix < 0x40360000) {
    // |x| < 22
    if (ix < 0x3e300000) return x; // |x| < 2^-28
    if (ix >= 0x3ff00000) {
      // |x| >= 1
      const t = expm1(2 * Math.abs(x));
      z = 1 - 2 / (t + 2);
    } else {
      const t = expm1(-2 * Math.abs(x));
      z = -t / (t + 2);
    }
  } else {
    z = 1; // |x| >= 22
  }
  return jx >= 0 ? z : -z;
}
