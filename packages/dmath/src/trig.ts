// sin, cos, tan with full-range argument reduction, ported from fdlibm
// (FreeBSD msun k_sin.c, k_cos.c, k_tan.c, e_rem_pio2.c, k_rem_pio2.c) and
// musl (__rem_pio2_large.c).
// Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use,
// copy, modify, and distribute this software is freely granted, provided that
// this notice is preserved.

import { fromWords, hiWord, loWord, scalbn, setLo } from './bits.ts';

// ---------------------------------------------------------------- kernels

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

/** sin(x + y) for |x| <= pi/4, y the tail of x; iy = 0 means y is 0. */
function kernelSin(x: number, y: number, iy: number): number {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

function kernelCos(x: number, y: number): number {
  const z = x * x;
  let w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  w = 1 - hz;
  return w + (1 - w - hz + (z * r - x * y));
}

const T = [
  3.33333333333334091986e-1, 1.33333333333201242699e-1, 5.39682539762260521377e-2,
  2.18694882948595424599e-2, 8.86323982359930005737e-3, 3.59207910759131235356e-3,
  1.45620945432529025516e-3, 5.88041240820264096874e-4, 2.46463134818469906812e-4,
  7.817944429395570923e-5, 7.14072491382608190305e-5, -1.85586374855275456654e-5,
  2.59073051863633712884e-5,
];
const pio4 = 7.85398163397448278999e-1;
const pio4lo = 3.06161699786838301793e-17;

/** tan(x + y) for |x| <= pi/4; iy = 1 gives tan, iy = -1 gives -1/tan. */
function kernelTan(x: number, y: number, iy: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  const big = ix >= 0x3fe59428; // |x| >= 0.6744
  if (big) {
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    x = pio4 - x + (pio4lo - y);
    y = 0;
  }
  let z = x * x;
  let w = z * z;
  let r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
  let v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
  let s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T[0] * s;
  w = x + r;
  if (big) {
    v = iy;
    return (1 - ((hx >> 30) & 2)) * (v - 2 * (x - ((w * w) / (w + v) - r)));
  }
  if (iy === 1) return w;
  // -1/(x+r) computed carefully.
  z = setLo(w, 0);
  v = r - (z - x);
  const a = -1 / w;
  const t = setLo(a, 0);
  s = 1 + t * z;
  return t + a * (s + t * v);
}

// ------------------------------------------------- argument reduction

/** 2/pi in 24-bit chunks (enough for any double exponent). */
export const IPIO2 = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c, 0x439041, 0xfe5163,
  0xabdebb, 0xc561b7, 0x246e3a, 0x424dd2, 0xe00649, 0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129,
  0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c, 0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c,
  0x845f8b, 0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11, 0x8b5a0a, 0x6d1f6d, 0x367ecf,
  0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5, 0xf17b3d, 0x0739f7, 0x8a5292,
  0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3,
  0x91615e, 0xe61b08, 0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca,
  0x73a8c9, 0x60e27b, 0xc08c6b,
];

/** pi/2 split into 24-bit pieces. */
const PIo2 = [
  fromWords(0x3ff921fb, 0x40000000),
  fromWords(0x3e74442d, 0x00000000),
  fromWords(0x3cf84698, 0x80000000),
  fromWords(0x3b78cc51, 0x60000000),
  fromWords(0x39f01b83, 0x80000000),
  fromWords(0x387a2520, 0x40000000),
  fromWords(0x36e38222, 0x80000000),
  fromWords(0x3569f31d, 0x00000000),
];

const TWO24 = 16777216;
const TWOM24 = 5.9604644775390625e-8;

const kq = new Float64Array(20);
const kf = new Float64Array(20);
const kfq = new Float64Array(20);
const kiq = new Int32Array(20);
const ky = new Float64Array(2);

/** Payne-Hanek reduction for huge |x| (prec = 1: double). Writes ky, returns n mod 8. */
function remPio2Large(tx: Float64Array, e0: number, nx: number): number {
  const jk = 4;
  const jp = jk;
  const jx = nx - 1;
  let jv = Math.trunc((e0 - 3) / 24);
  if (jv < 0) jv = 0;
  let q0 = e0 - 24 * (jv + 1);

  let j = jv - jx;
  const m = jx + jk;
  for (let i = 0; i <= m; i++, j++) kf[i] = j < 0 ? 0 : IPIO2[j];

  for (let i = 0; i <= jk; i++) {
    let fw = 0;
    for (let jj = 0; jj <= jx; jj++) fw += tx[jj] * kf[jx + i - jj];
    kq[i] = fw;
  }

  let jz = jk;
  let z: number;
  let n: number;
  let ih: number;
  for (;;) {
    // distill q[] into iq[] reversingly
    let i = 0;
    z = kq[jz];
    for (let jj = jz; jj > 0; i++, jj--) {
      const fw = Math.trunc(TWOM24 * z);
      kiq[i] = Math.trunc(z - TWO24 * fw);
      z = kq[jj - 1] + fw;
    }

    z = scalbn(z, q0);
    z -= 8 * Math.floor(z * 0.125);
    n = Math.trunc(z);
    z -= n;
    ih = 0;
    if (q0 > 0) {
      const t = kiq[jz - 1] >> (24 - q0);
      n += t;
      kiq[jz - 1] -= t << (24 - q0);
      ih = kiq[jz - 1] >> (23 - q0);
    } else if (q0 === 0) {
      ih = kiq[jz - 1] >> 23;
    } else if (z >= 0.5) {
      ih = 2;
    }

    if (ih > 0) {
      n += 1;
      let carry = 0;
      for (let k = 0; k < jz; k++) {
        const t = kiq[k];
        if (carry === 0) {
          if (t !== 0) {
            carry = 1;
            kiq[k] = 0x1000000 - t;
          }
        } else {
          kiq[k] = 0xffffff - t;
        }
      }
      if (q0 === 1) kiq[jz - 1] &= 0x7fffff;
      else if (q0 === 2) kiq[jz - 1] &= 0x3fffff;
      if (ih === 2) {
        z = 1 - z;
        if (carry !== 0) z -= scalbn(1, q0);
      }
    }

    if (z === 0) {
      let acc = 0;
      for (let k = jz - 1; k >= jk; k--) acc |= kiq[k];
      if (acc === 0) {
        // need recomputation
        let k = 1;
        while (kiq[jk - k] === 0) k++;
        for (let ii = jz + 1; ii <= jz + k; ii++) {
          kf[jx + ii] = IPIO2[jv + ii];
          let fw = 0;
          for (let jj = 0; jj <= jx; jj++) fw += tx[jj] * kf[jx + ii - jj];
          kq[ii] = fw;
        }
        jz += k;
        continue;
      }
    }
    break;
  }

  // chop off zero terms
  if (z === 0) {
    jz -= 1;
    q0 -= 24;
    while (kiq[jz] === 0) {
      jz--;
      q0 -= 24;
    }
  } else {
    z = scalbn(z, -q0);
    if (z >= TWO24) {
      const fw = Math.trunc(TWOM24 * z);
      kiq[jz] = Math.trunc(z - TWO24 * fw);
      jz += 1;
      q0 += 24;
      kiq[jz] = fw;
    } else {
      kiq[jz] = Math.trunc(z);
    }
  }

  let fw = scalbn(1, q0);
  for (let i = jz; i >= 0; i--) {
    kq[i] = fw * kiq[i];
    fw *= TWOM24;
  }

  for (let i = jz; i >= 0; i--) {
    let s = 0;
    for (let k = 0; k <= jp && k <= jz - i; k++) s += PIo2[k] * kq[i + k];
    kfq[jz - i] = s;
  }

  fw = 0;
  for (let i = jz; i >= 0; i--) fw += kfq[i];
  ky[0] = ih === 0 ? fw : -fw;
  fw = kfq[0] - fw;
  for (let i = 1; i <= jz; i++) fw += kfq[i];
  ky[1] = ih === 0 ? fw : -fw;
  return n & 7;
}

const invpio2 = 6.36619772367581382433e-1;
const pio2_1 = 1.57079632673412561417;
const pio2_1t = 6.07710050650619224932e-11;
const pio2_2 = 6.0771005063039659766e-11;
const pio2_2t = 2.02226624879595063154e-21;
const pio2_3 = 2.0222662487111664558e-21;
const pio2_3t = 8.47842766036889956997e-32;
const toint = 6755399441055744; // 1.5 * 2^52: rounds to nearest integer when added

/** Remainder of x / (pi/2) in y0 + y1. Returns n (the quadrant count). */
let y0 = 0;
let y1 = 0;
const tx = new Float64Array(3);

function remPio2(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;

  const small = (n: number): number => {
    const z = x - n * pio2_1;
    y0 = z - n * pio2_1t;
    y1 = z - y0 - n * pio2_1t;
    return n;
  };

  if (ix <= 0x400f6a7a) {
    // |x| ~<= 5pi/4
    if ((ix & 0xfffff) !== 0x921fb) {
      if (ix <= 0x4002d97c) return small(hx > 0 ? 1 : -1); // |x| ~<= 3pi/4
      return small(hx > 0 ? 2 : -2);
    }
    // |x| ~= pi/2 or 2pi/2: cancellation, use the medium case
  } else if (ix <= 0x401c463b) {
    // |x| ~<= 9pi/4
    if (ix <= 0x4015fdbc) {
      if (ix !== 0x4012d97c) return small(hx > 0 ? 3 : -3);
    } else if (ix !== 0x401921fb) {
      return small(hx > 0 ? 4 : -4);
    }
  }

  if (ix < 0x413921fb) {
    // |x| ~< 2^20 * (pi/2): medium size
    const fn = x * invpio2 + toint - toint;
    const n = fn | 0;
    let r = x - fn * pio2_1;
    let w = fn * pio2_1t; // 1st round, good to 85 bits
    const j = ix >> 20;
    y0 = r - w;
    let i = j - ((hiWord(y0) >> 20) & 0x7ff);
    if (i > 16) {
      // 2nd iteration, good to 118 bits
      let t = r;
      w = fn * pio2_2;
      r = t - w;
      w = fn * pio2_2t - (t - r - w);
      y0 = r - w;
      i = j - ((hiWord(y0) >> 20) & 0x7ff);
      if (i > 49) {
        // 3rd iteration, 151 bits
        t = r;
        w = fn * pio2_3;
        r = t - w;
        w = fn * pio2_3t - (t - r - w);
        y0 = r - w;
      }
    }
    y1 = r - y0 - w;
    return n;
  }

  if (ix >= 0x7ff00000) {
    y0 = y1 = x - x; // inf or NaN
    return 0;
  }

  // Large arguments: z = scalbn(|x|, ilogb(x) - 23), split into 24-bit chunks.
  const e0 = (ix >> 20) - 1046;
  let z = fromWords(ix - (e0 << 20), loWord(x));
  for (let i = 0; i < 2; i++) {
    tx[i] = Math.trunc(z);
    z = (z - tx[i]) * TWO24;
  }
  tx[2] = z;
  let nx = 3;
  while (tx[nx - 1] === 0) nx--;
  const n = remPio2Large(tx, e0, nx);
  if (hx < 0) {
    y0 = -ky[0];
    y1 = -ky[1];
    return -n;
  }
  y0 = ky[0];
  y1 = ky[1];
  return n;
}

// ---------------------------------------------------------- functions

export function sin(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e500000) return x; // |x| < 2^-26
    return kernelSin(x, 0, 0);
  }
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelSin(y0, y1, 1);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1, 1);
    default:
      return -kernelCos(y0, y1);
  }
}

export function cos(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e46a09e) return 1; // |x| < 2^-27 * sqrt(2)
    return kernelCos(x, 0);
  }
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1, 1);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1, 1);
  }
}

export function tan(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e400000) return x; // |x| < 2^-27
    return kernelTan(x, 0, 1);
  }
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  return kernelTan(y0, y1, 1 - ((n & 1) << 1));
}
