// High-precision reference values (decimal.js) and ULP error measurement.
import Decimal from 'decimal.js';

export const D = Decimal.clone({ precision: 70, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** The exact value of a double as a Decimal (not its shortest decimal string). */
export function exact(x: number, Ctor: typeof D = D): Dec {
  if (x === 0) return new Ctor(0);
  f64[0] = x;
  const hi = u32[1];
  const lo = u32[0];
  const sign = hi >>> 31 ? -1 : 1;
  const bexp = (hi >>> 20) & 0x7ff;
  const mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  const m = bexp === 0 ? mant : mant | (1n << 52n);
  const e = (bexp === 0 ? 1 : bexp) - 1075;
  return new Ctor(m.toString()).times(new Ctor(2).pow(e)).times(sign);
}

/** Error of `got` against the true value `ref`, in units in the last place of ref. */
export function ulpError(got: number, ref: Dec): number {
  if (!Number.isFinite(got)) return ref.isFinite() ? Infinity : 0;
  const ar = ref.abs();
  if (ar.isZero()) return got === 0 ? 0 : Infinity;
  const near = Math.abs(ar.toNumber());
  f64[0] = near;
  let e = ((u32[1] >>> 20) & 0x7ff) - 1023;
  if (new D(2).pow(e).gt(ar)) e -= 1;
  const ulp = new D(2).pow(Math.max(e, -1022) - 52);
  return exact(got).minus(ref).abs().div(ulp).toNumber();
}

/** erf by its Maclaurin series (fine for |x| <= 6 at this precision). */
export function erfRef(x: Dec): Dec {
  const Dp = Decimal.clone({ precision: 110 });
  const xx = new Dp(x);
  const x2 = xx.times(xx);
  let term = new Dp(xx);
  let sum = new Dp(xx);
  for (let n = 1; n < 2000; n++) {
    term = term.times(x2).neg().div(n);
    const add = term.div(2 * n + 1);
    sum = sum.plus(add);
    if (add.abs().lt(new Dp(10).pow(-90))) break;
  }
  const pi = Dp.acos(-1);
  return new D(sum.times(2).div(pi.sqrt()));
}
