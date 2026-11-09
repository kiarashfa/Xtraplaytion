// pow, ported from fdlibm (FreeBSD msun e_pow.c).
// Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use,
// copy, modify, and distribute this software is freely granted, provided that
// this notice is preserved.

import { hiWord, loWord, scalbn, setHi, setLo } from './bits.ts';

const bp = [1, 1.5];
const dp_h = [0, 5.84962487220764160156e-1];
const dp_l = [0, 1.35003920212974897128e-8];
const two53 = 9007199254740992;
const huge = 1e300;
const tiny = 1e-300;
const L1 = 5.99999999999994648725e-1;
const L2 = 4.28571428578550184252e-1;
const L3 = 3.33333329818377432918e-1;
const L4 = 2.72728123808534006489e-1;
const L5 = 2.30660745775561754067e-1;
const L6 = 2.06975017800338417784e-1;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;
const lg2 = 6.93147180559945286227e-1;
const lg2_h = 6.93147182464599609375e-1;
const lg2_l = -1.90465429995776804525e-9;
const ovt = 8.0085662595372944372e-17;
const cp = 9.61796693925975554329e-1;
const cp_h = 9.61796700954437255859e-1;
const cp_l = -7.02846165095275826516e-9;
const ivln2 = 1.442695040888963387;
const ivln2_h = 1.44269502162933349609;
const ivln2_l = 1.92596299112661746887e-8;

export function pow(x: number, y: number): number {
  const hx = hiWord(x);
  const lx = loWord(x);
  const hy = hiWord(y);
  const ly = loWord(y);
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;

  // ECMAScript semantics (differs from C99): x^0 = 1 even for NaN, but 1^NaN and
  // (+-1)^(+-inf) are NaN, so dmath.pow can replace Math.pow and ** exactly.
  if ((iy | ly) === 0) return 1;
  if (x !== x || y !== y) return NaN;

  // yisint: 0 = not an integer, 1 = odd integer, 2 = even integer (only needed for x < 0)
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) {
      yisint = 2;
    } else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff;
      if (k > 20) {
        const j = ly >>> (52 - k);
        if ((j << (52 - k)) >>> 0 === ly) yisint = 2 - (j & 1);
      } else if (ly === 0) {
        const j = iy >> (20 - k);
        if (j << (20 - k) === iy) yisint = 2 - (j & 1);
      }
    }
  }

  if (ly === 0) {
    if (iy === 0x7ff00000) {
      // y is +-inf
      if (((ix - 0x3ff00000) | lx) === 0) return NaN; // (+-1)^+-inf
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0; // (|x|>1)^+-inf = inf, 0
      return hy < 0 ? -y : 0; // (|x|<1)^-,+inf = inf, 0
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x; // y = +-1
    if (hy === 0x40000000) return x * x; // y = 2
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x); // y = 0.5, x >= +0
  }

  let ax = Math.abs(x);
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    // x is +-0, +-inf, +-1
    let z = ax;
    if (hy < 0) z = 1 / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) return NaN; // (-1)^non-int
      if (yisint === 1) z = -z; // (x<0)^odd = -(|x|^odd)
    }
    return z;
  }

  let n = (hx >>> 31) - 1;
  if ((n | yisint) === 0) return NaN; // (x<0)^(non-int)

  let s = 1; // sign of the result
  if ((n | (yisint - 1)) === 0) s = -1; // (-ve)^(odd int)

  let t1: number;
  let t2: number;
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      // |y| > 2^64: must over/underflow
      if (ix <= 0x3fefffff) return hy < 0 ? Infinity : 0;
      if (ix >= 0x3ff00000) return hy > 0 ? Infinity : 0;
    }
    if (ix < 0x3fefffff) return hy < 0 ? s * huge * huge : s * tiny * tiny;
    if (ix > 0x3ff00000) return hy > 0 ? s * huge * huge : s * tiny * tiny;
    // |1-x| is tiny: log(x) by x - x^2/2 + x^3/3 - x^4/4
    const t = ax - 1;
    const w = t * t * (0.5 - t * (0.3333333333333333 - t * 0.25));
    const u = ivln2_h * t;
    const v = t * ivln2_l - w * ivln2;
    t1 = setLo(u + v, 0);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    if (ix < 0x00100000) {
      // subnormal x
      ax *= two53;
      n -= 53;
      ix = hiWord(ax);
    }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    let k: number;
    ix = j | 0x3ff00000; // normalize ix
    if (j <= 0x3988e) {
      k = 0; // |x| < sqrt(3/2)
    } else if (j < 0xbb67a) {
      k = 1; // |x| < sqrt(3)
    } else {
      k = 0;
      n += 1;
      ix -= 0x00100000;
    }
    ax = setHi(ax, ix);

    // ss = s_h + s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5)
    let u = ax - bp[k];
    let v = 1 / (ax + bp[k]);
    const ss = u * v;
    const s_h = setLo(ss, 0);
    let t_h = setHi(0, ((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18));
    let t_l = ax - (t_h - bp[k]);
    const s_l = v * (u - s_h * t_h - s_h * t_l);
    // log(ax)
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    s2 = s_h * s_h;
    t_h = setLo(3 + s2 + r, 0);
    t_l = r - (t_h - 3 - s2);
    u = s_h * t_h;
    v = s_l * t_h + t_l * ss;
    const p_h = setLo(u + v, 0);
    const p_l = v - (p_h - u);
    const z_h = cp_h * p_h;
    const z_l = cp_l * p_h + p_l * cp + dp_l[k];
    const t = n;
    t1 = setLo(z_h + z_l + dp_h[k] + t, 0);
    t2 = z_l - (t1 - t - dp_h[k] - z_h);
  }

  // (y1 + y2) * (t1 + t2)
  const y1 = setLo(y, 0);
  const p_l = (y - y1) * t1 + y * t2;
  let p_h = y1 * t1;
  let z = p_l + p_h;
  let j = hiWord(z);
  let i = loWord(z);
  if (j >= 0x40900000) {
    // z >= 1024
    if (((j - 0x40900000) | i) !== 0) return s * huge * huge;
    if (p_l + ovt > z - p_h) return s * huge * huge;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z <= -1075
    if (((j - (0xc090cc00 | 0)) | i) !== 0) return s * tiny * tiny;
    if (p_l <= z - p_h) return s * tiny * tiny;
  }

  // 2^(p_h + p_l)
  i = j & 0x7fffffff;
  let k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {
    // |z| > 0.5: n = [z + 0.5]
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = setHi(0, n & ~(0x000fffff >> k));
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  const t = setLo(p_l + p_h, 0);
  const u = t * lg2_h;
  const v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
  z = u + v;
  const w = v - (z - u);
  const tt = z * z;
  t1 = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
  const r = (z * t1) / (t1 - 2) - (w + z * w);
  z = 1 - (r - z);
  j = hiWord(z);
  j += n << 20;
  if (j >> 20 <= 0)
    z = scalbn(z, n); // subnormal output
  else z = setHi(z, j);
  return s * z;
}
