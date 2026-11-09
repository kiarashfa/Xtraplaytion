/**
 * Deterministic math: functions that return bit-identical results in every
 * JavaScript engine (the built-in Math transcendentals do not). Only IEEE-754
 * basic operations and exactly specified Math functions are used underneath.
 */
export { atan, atan2, asin, acos } from './atrig.ts';
export { erf } from './erf.ts';
export { exp, expm1 } from './exp.ts';
export { cosh, sinh, tanh } from './hyp.ts';
export { log, log10, log1p, log2 } from './log.ts';
export { pow } from './pow.ts';
export { Rng } from './rng.ts';
export { cos, sin, tan } from './trig.ts';

/** Exactly specified by IEEE-754 / ECMAScript, so safe to re-export. */
export const sqrt = Math.sqrt;
export const abs = Math.abs;
export const floor = Math.floor;
export const ceil = Math.ceil;
export const trunc = Math.trunc;
export const sign = Math.sign;
export const min = Math.min;
export const max = Math.max;

export const PI = 3.141592653589793;
export const E = 2.718281828459045;
