// Turns a tree into a plain closure (no eval, no new Function: CSP-safe), plus a
// reference interpreter used by the tests.
import type { Expr } from './ast.ts';
import { CONSTANTS, FUNCTIONS } from './functions.ts';
import { pow } from '@xtraplaytion/dmath';

export type Fn1 = (x: number) => number;

const cmp = (op: string, a: number, b: number): number => {
  if (a !== a || b !== b) return NaN;
  switch (op) {
    case '<':
      return a < b ? 1 : 0;
    case '<=':
      return a <= b ? 1 : 0;
    case '>':
      return a > b ? 1 : 0;
    case '>=':
      return a >= b ? 1 : 0;
    case '==':
      return a === b ? 1 : 0;
    default:
      return a !== b ? 1 : 0;
  }
};

export function compile(e: Expr): Fn1 {
  switch (e.type) {
    case 'num': {
      const v = e.value;
      return () => v;
    }
    case 'var':
      return (x) => x;
    case 'const': {
      const v = CONSTANTS[e.name];
      return () => v;
    }
    case 'neg': {
      const a = compile(e.arg);
      return (x) => -a(x);
    }
    case 'cmp': {
      const a = compile(e.left);
      const b = compile(e.right);
      const op = e.op;
      return (x) => cmp(op, a(x), b(x));
    }
    case 'bin': {
      const a = compile(e.left);
      const b = compile(e.right);
      switch (e.op) {
        case '+':
          return (x) => a(x) + b(x);
        case '-':
          return (x) => a(x) - b(x);
        case '*':
          return (x) => a(x) * b(x);
        case '/':
          return (x) => a(x) / b(x);
        case '^':
          // x^2 is common enough to deserve an exact fast path.
          if (e.right.type === 'num' && e.right.value === 2)
            return (x) => {
              const v = a(x);
              return v * v;
            };
          return (x) => pow(a(x), b(x));
      }
      break;
    }
    case 'call': {
      const impl = FUNCTIONS[e.fn].impl;
      const args = e.args.map(compile);
      if (e.fn === 'if') {
        const [c, t, f] = args;
        return (x) => {
          const v = c(x);
          return v !== v ? NaN : v !== 0 ? t(x) : f(x);
        };
      }
      if (args.length === 1) {
        const [a] = args;
        return (x) => impl(a(x));
      }
      if (args.length === 2) {
        const [a, b] = args;
        return (x) => impl(a(x), b(x));
      }
      return (x) => impl(...args.map((f) => f(x)));
    }
  }
  throw new Error('unreachable');
}

/** Straightforward interpreter; must agree with compile() bit for bit. */
export function evaluate(e: Expr, x: number): number {
  switch (e.type) {
    case 'num':
      return e.value;
    case 'var':
      return x;
    case 'const':
      return CONSTANTS[e.name];
    case 'neg':
      return -evaluate(e.arg, x);
    case 'cmp':
      return cmp(e.op, evaluate(e.left, x), evaluate(e.right, x));
    case 'bin': {
      const a = evaluate(e.left, x);
      const b = evaluate(e.right, x);
      switch (e.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
        case '^':
          return pow(a, b); // pow(a, 2) is exactly a*a, matching the compile() fast path
      }
      break;
    }
    case 'call': {
      const args = e.args.map((a) => evaluate(a, x));
      return FUNCTIONS[e.fn].impl(...args);
    }
  }
  throw new Error('unreachable');
}

export interface Sampled {
  ys: Float64Array;
  /** Points where the value is NaN or infinite (set to NaN in ys). */
  invalid: number;
}

/** Evaluates on a grid, masking non-finite values. */
export function sample(f: Fn1, xs: ArrayLike<number>): Sampled {
  const ys = new Float64Array(xs.length);
  let invalid = 0;
  for (let i = 0; i < xs.length; i++) {
    const y = f(xs[i]);
    if (Number.isFinite(y)) ys[i] = y;
    else {
      ys[i] = NaN;
      invalid++;
    }
  }
  return { ys, invalid };
}
