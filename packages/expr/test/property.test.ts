// Property and fuzz tests (fast-check).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compile, evaluate, format, parse, type Expr } from '../src/index.ts';
import { FUNCTIONS } from '../src/functions.ts';

const UNARY = Object.values(FUNCTIONS)
  .filter((f) => f.min === 1)
  .map((f) => f.name);

const exprArb: fc.Arbitrary<Expr> = fc.letrec<{ e: Expr }>((tie) => ({
  e: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.oneof(
      fc
        .constantFrom(0, 1, 2, 0.5, 3.25, 10, 1e-7, 1e21, 123456.789)
        .map((value) => ({ type: 'num', value }) as Expr),
      fc.constant({ type: 'var', name: 'x' } as Expr),
      fc.constantFrom('pi', 'e', 'tau').map((name) => ({ type: 'const', name }) as Expr),
    ),
    tie('e').map((arg) => ({ type: 'neg', arg }) as Expr),
    fc
      .tuple(fc.constantFrom('+', '-', '*', '/', '^'), tie('e'), tie('e'))
      .map(([op, left, right]) => ({ type: 'bin', op, left, right }) as Expr),
    fc
      .tuple(fc.constantFrom(...UNARY), tie('e'))
      .map(([fn, a]) => ({ type: 'call', fn, args: [a] }) as Expr),
    fc
      .tuple(fc.constantFrom('min', 'max', 'mod', 'atan2'), tie('e'), tie('e'))
      .map(([fn, a, b]) => ({ type: 'call', fn, args: [a, b] }) as Expr),
    fc
      .tuple(fc.constantFrom('<', '>=', '!='), tie('e'), tie('e'))
      .map(([op, left, right]) => ({ type: 'cmp', op, left, right }) as Expr),
  ),
})).e;

/** Structural equality, ignoring the implicit-multiplication flag. */
function strip(e: Expr): unknown {
  return JSON.parse(JSON.stringify(e, (k, v) => (k === 'implicit' ? undefined : v)));
}

const same = (a: number, b: number) => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));
const xs = [-7.5, -1, -0, 0, 0.3, 1, 2.5, 100];

describe('properties', () => {
  it('format -> parse returns the same tree', () => {
    fc.assert(
      fc.property(exprArb, (e) => {
        const r = parse(format(e));
        if (!r.ok) return false;
        expect(strip(r.expr)).toEqual(strip(e));
        expect(r.text).toBe(format(e));
        return true;
      }),
      { numRuns: 3000 },
    );
  });

  it('compiled closures agree with the interpreter bit for bit', () => {
    fc.assert(
      fc.property(exprArb, (e) => {
        const f = compile(e);
        for (const x of xs) {
          if (!same(f(x), evaluate(e, x))) return false;
        }
        return true;
      }),
      { numRuns: 2000 },
    );
  });

  it('never throws on arbitrary input, and error ranges stay inside it', () => {
    const alphabet = fc.constantFrom(
      ...'x0123456789.eE+-*/^()[],<>=! sincoalgtpqrhbdfmuvwyz_π×·−²³$#@\u0000\u{1F600}'.split(''),
    );
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.array(alphabet, { maxLength: 40 }).map((a) => a.join('')),
        ),
        (s) => {
          const r = parse(s);
          if (r.ok) {
            // Canonical text must itself parse to the same canonical text.
            const again = parse(r.text);
            return again.ok && again.text === r.text;
          }
          return r.error.start >= 0 && r.error.start <= s.length && r.error.end >= r.error.start;
        },
      ),
      { numRuns: 5000 },
    );
  });

  it('juxtaposition means multiplication', () => {
    const factor = fc.constantFrom('x', 'pi', 'e', '(x+1)', 'sin(x)', 'sqrt(x)', '(2-x)');
    fc.assert(
      fc.property(fc.constantFrom('2', '0.5', 'x', 'pi', '(x-3)', 'cos(x)'), factor, (a, b) => {
        const implicit = parse(`${a}${b}`);
        const explicit = parse(`(${a})*(${b})`);
        if (!implicit.ok || !explicit.ok) return false;
        return xs.every((x) => same(compile(implicit.expr)(x), compile(explicit.expr)(x)));
      }),
    );
  });
});
