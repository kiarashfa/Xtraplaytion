// IEEE-754 word access shared by the fdlibm ports. Every JS engine we target is
// little-endian; the check below fails loudly if that ever changes.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
  throw new Error('dmath requires a little-endian platform');
}

/** High 32 bits as a signed int32 (fdlibm's `int32_t hx`). */
export function hiWord(x: number): number {
  f64[0] = x;
  return u32[1] | 0;
}

/** Low 32 bits as an unsigned int. */
export function loWord(x: number): number {
  f64[0] = x;
  return u32[0];
}

export function fromWords(hi: number, lo: number): number {
  u32[1] = hi;
  u32[0] = lo;
  return f64[0];
}

/** x with its high word replaced. */
export function setHi(x: number, hi: number): number {
  f64[0] = x;
  u32[1] = hi;
  return f64[0];
}

/** x with its low word replaced. */
export function setLo(x: number, lo: number): number {
  f64[0] = x;
  u32[0] = lo;
  return f64[0];
}

const TWO1023 = fromWords(0x7fe00000, 0);

/** x * 2^n, exact (musl scalbn). */
export function scalbn(x: number, n: number): number {
  let y = x;
  if (n > 1023) {
    y *= TWO1023;
    n -= 1023;
    if (n > 1023) {
      y *= TWO1023;
      n -= 1023;
      if (n > 1023) n = 1023;
    }
  } else if (n < -1022) {
    // Keep the final n < -53 so the subnormal range is reached by one rounding.
    y *= 2.2250738585072014e-308 * 9007199254740992; // 0x1p-1022 * 0x1p53
    n += 1022 - 53;
    if (n < -1022) {
      y *= 2.2250738585072014e-308 * 9007199254740992;
      n += 1022 - 53;
      if (n < -1022) n = -1022;
    }
  }
  return y * fromWords((0x3ff + n) << 20, 0);
}
