// asin, acos, atan, atan2, ported from fdlibm (FreeBSD msun e_asin.c,
// e_acos.c, s_atan.c, e_atan2.c).
// Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use,
// copy, modify, and distribute this software is freely granted, provided that
// this notice is preserved.

import { hiWord, loWord, setLo } from './bits.ts';

const pio2_hi = 1.570796326794896558;
const pio2_lo = 6.12323399573676603587e-17;
const pio4_hi = 7.85398163397448278999e-1;
const pi = 3.141592653589793116;
const pS0 = 1.66666666666666657415e-1;
const pS1 = -3.25565818622400915405e-1;
const pS2 = 2.01212532134862925881e-1;
const pS3 = -4.00555345006794114027e-2;
const pS4 = 7.91534994289814532176e-4;
const pS5 = 3.4793310759602116757e-5;
const qS1 = -2.40339491173441421878;
const qS2 = 2.02094576023350569471;
const qS3 = -6.8828397160545329303e-1;
const qS4 = 7.70381505559019352791e-2;

function rat(t: number): number {
  const p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
  const q = 1 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
  return p / q;
}

export function asin(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // |x| >= 1
    if (((ix - 0x3ff00000) | loWord(x)) === 0) return x * pio2_hi + x * pio2_lo;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix < 0x3e500000) return x; // |x| < 2^-26
    return x + x * rat(x * x);
  }
  // 1 > |x| >= 0.5
  const w0 = 1 - Math.abs(x);
  const t0 = w0 * 0.5;
  const p0 = t0 * (pS0 + t0 * (pS1 + t0 * (pS2 + t0 * (pS3 + t0 * (pS4 + t0 * pS5)))));
  const q0 = 1 + t0 * (qS1 + t0 * (qS2 + t0 * (qS3 + t0 * qS4)));
  const s = Math.sqrt(t0);
  let t: number;
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    const w = p0 / q0;
    t = pio2_hi - (2 * (s + s * w) - pio2_lo);
  } else {
    const w = setLo(s, 0);
    const c = (t0 - w * w) / (s + w);
    const r = p0 / q0;
    const p = 2 * s * r - (pio2_lo - 2 * c);
    const q = pio4_hi - 2 * w;
    t = pio4_hi - (p - q);
  }
  return hx > 0 ? t : -t;
}

export function acos(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | loWord(x)) === 0) {
      return hx > 0 ? 0 : pi + 2 * pio2_lo;
    }
    return NaN;
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix <= 0x3c600000) return pio2_hi + pio2_lo; // |x| < 2^-57
    const z = x * x;
    return pio2_hi - (x - (pio2_lo - x * rat(z)));
  }
  if (hx < 0) {
    // x < -0.5
    const z = (1 + x) * 0.5;
    const s = Math.sqrt(z);
    const w = rat(z) * s - pio2_lo;
    return pi - 2 * (s + w);
  }
  // x > 0.5
  const z = (1 - x) * 0.5;
  const s = Math.sqrt(z);
  const df = setLo(s, 0);
  const c = (z - df * df) / (s + df);
  const w = rat(z) * s + c;
  return 2 * (df + w);
}

const atanhi = [
  4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1,
  1.570796326794896558,
];
const atanlo = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17,
  6.12323399573676603587e-17,
];
const aT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1,
  -1.1111110405462355788e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2,
  -3.6531572744216915527e-2, 1.62858201153657823623e-2,
];

export function atan(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) {
    // |x| >= 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && loWord(x) !== 0)) return x + x; // NaN
    return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3];
  }
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e400000) return x; // |x| < 2^-27
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      // |x| < 1.1875
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      // |x| < 2.4375
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
  const s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = atanhi[id] - (x * (s1 + s2) - atanlo[id] - x);
  return hx < 0 ? -r : r;
}

const pi_o_4 = 7.85398163397448279e-1;
const pi_o_2 = 1.570796326794896558;
const pi_lo = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  const hx = hiWord(x);
  const lx = loWord(x);
  const ix = hx & 0x7fffffff;
  const hy = hiWord(y);
  const ly = loWord(y);
  const iy = hy & 0x7fffffff;
  if (hx === 0x3ff00000 && lx === 0) return atan(y); // x = 1.0
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2); // 2*sign(x) + sign(y)

  if ((iy | ly) === 0) {
    // y = 0
    if (m <= 1) return y;
    return m === 2 ? pi : -pi;
  }
  if ((ix | lx) === 0) return hy < 0 ? -pi_o_2 : pi_o_2; // x = 0

  if (ix === 0x7ff00000) {
    // x is inf
    if (iy === 0x7ff00000) {
      return [pi_o_4, -pi_o_4, 3 * pi_o_4, -3 * pi_o_4][m];
    }
    return [0, -0, pi, -pi][m];
  }
  if (iy === 0x7ff00000) return hy < 0 ? -pi_o_2 : pi_o_2; // y is inf

  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    // |y/x| > 2^60
    z = pi_o_2 + 0.5 * pi_lo;
    m &= 1;
  } else if (hx < 0 && k < -60) {
    z = 0; // 0 > |y|/x > -2^-60
  } else {
    z = atan(Math.abs(y / x));
  }
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return pi - (z - pi_lo);
    default:
      return z - pi_lo - pi;
  }
}
