// Whitelisted functions and constants. Everything numeric goes through dmath,
// so a typed expression evaluates to the same bits in every browser.
import * as d from '@xtraplaytion/dmath';
import type { ConstName } from './ast.ts';

export interface FnDef {
  /** Canonical name used when printing. */
  name: string;
  min: number;
  max: number;
  impl: (...args: number[]) => number;
  latex?: string;
}

/** Round half away from zero (2.5 -> 3, -2.5 -> -3). */
function round(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** Floored modulo: the result has the sign of the divisor, so mod(x, 2pi) is periodic. */
function mod(a: number, b: number): number {
  const r = a % b;
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

const unary = (name: string, impl: (x: number) => number, latex?: string): FnDef => ({
  name,
  min: 1,
  max: 1,
  impl,
  ...(latex ? { latex } : {}),
});

export const FUNCTIONS: Record<string, FnDef> = {
  sin: unary('sin', d.sin, '\\sin'),
  cos: unary('cos', d.cos, '\\cos'),
  tan: unary('tan', d.tan, '\\tan'),
  asin: unary('asin', d.asin, '\\arcsin'),
  acos: unary('acos', d.acos, '\\arccos'),
  atan: unary('atan', d.atan, '\\arctan'),
  sinh: unary('sinh', d.sinh, '\\sinh'),
  cosh: unary('cosh', d.cosh, '\\cosh'),
  tanh: unary('tanh', d.tanh, '\\tanh'),
  exp: unary('exp', d.exp, '\\exp'),
  ln: unary('ln', d.log, '\\ln'),
  log2: unary('log2', d.log2, '\\log_2'),
  log10: unary('log10', d.log10, '\\log_{10}'),
  sqrt: unary('sqrt', Math.sqrt),
  abs: unary('abs', Math.abs),
  sign: unary('sign', Math.sign, '\\operatorname{sign}'),
  floor: unary('floor', Math.floor),
  ceil: unary('ceil', Math.ceil),
  round: unary('round', round, '\\operatorname{round}'),
  step: unary('step', (x) => (x >= 0 ? 1 : x < 0 ? 0 : NaN), '\\operatorname{step}'),
  erf: unary('erf', d.erf, '\\operatorname{erf}'),
  min: { name: 'min', min: 2, max: 16, impl: (...a) => Math.min(...a), latex: '\\min' },
  max: { name: 'max', min: 2, max: 16, impl: (...a) => Math.max(...a), latex: '\\max' },
  mod: { name: 'mod', min: 2, max: 2, impl: mod, latex: '\\operatorname{mod}' },
  atan2: { name: 'atan2', min: 2, max: 2, impl: d.atan2, latex: '\\operatorname{atan2}' },
  clamp: {
    name: 'clamp',
    min: 3,
    max: 3,
    impl: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
    latex: '\\operatorname{clamp}',
  },
  if: {
    name: 'if',
    min: 3,
    max: 3,
    impl: (c, a, b) => (c !== c ? NaN : c !== 0 ? a : b),
    latex: '\\operatorname{if}',
  },
};

/** Alternative spellings accepted on input. `log` is the natural logarithm. */
export const ALIASES: Record<string, string> = {
  log: 'ln',
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
};

export const CONSTANTS: Record<ConstName, number> = { pi: d.PI, e: d.E, tau: 2 * d.PI };

/** Every name the lexer may cut out of a run of letters, longest first. */
export const VOCABULARY = [
  ...Object.keys(FUNCTIONS),
  ...Object.keys(ALIASES),
  ...Object.keys(CONSTANTS),
  'x',
].sort((a, b) => b.length - a.length || a.localeCompare(b));
