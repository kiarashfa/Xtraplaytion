import { describe, expect, it } from 'vitest';
import * as d from '@xtraplaytion/dmath';
import { compile, parse, sample, type ErrorCode } from '../src/index.ts';

const text = (src: string) => {
  const r = parse(src);
  if (!r.ok) throw new Error(`${src}: ${r.error.code}`);
  return r.text;
};
const errorOf = (src: string): [ErrorCode, number, number] => {
  const r = parse(src);
  if (r.ok) throw new Error(`${src} parsed as ${r.text}`);
  return [r.error.code, r.error.start, r.error.end];
};
const value = (src: string, x: number) => {
  const r = parse(src);
  if (!r.ok) throw new Error(src);
  return compile(r.expr)(x);
};

describe('canonical form', () => {
  it.each([
    // implicit multiplication, as typed in the reference examples
    ['xsin(x)', 'x*sin(x)'],
    ['x sin(x)', 'x*sin(x)'],
    ['2x', '2*x'],
    ['x(x+1)', 'x*(x + 1)'],
    ['(x+1)(x-1)', '(x + 1)*(x - 1)'],
    ['2pix', '2*pi*x'],
    ['sin(x)cos(x)', 'sin(x)*cos(x)'],
    ['sin(x) + 0.5 sin(2x) + (1/3) sin(3x)', 'sin(x) + 0.5*sin(2*x) + (1/3)*sin(3*x)'],
    ['1/(1+25x^2)', '1/(1 + 25*x^2)'],
    ['exp(-x^2)cos(5x)', 'exp(-x^2)*cos(5*x)'],
    // precedence
    ['-x^2', '-x^2'],
    ['2^-x', '2^(-x)'],
    ['x^2^3', 'x^2^3'],
    ['(x^2)^3', '(x^2)^3'],
    ['1/2x', '(1/2)*x'],
    ['2^3x', '2^3*x'],
    ['-2x', '-2*x'],
  ])('%s -> %s', (src, want) => {
    expect(text(src)).toBe(want);
  });

  it('accepts unicode and alternative spellings', () => {
    expect(text('2πx')).toBe('2*pi*x');
    expect(text('x²+x³')).toBe('x^2 + x^3');
    expect(text('3×x − 1')).toBe('3*x - 1');
    expect(text('x**2')).toBe('x^2');
    expect(text('log(x) + arctan(x)')).toBe('ln(x) + atan(x)');
    expect(text('SIN(X)')).toBe('sin(x)');
    expect(text('[x+1]^2')).toBe('(x + 1)^2');
    expect(text('2e3 + 2e')).toBe('2000 + 2*e');
  });

  it('reads comparisons and piecewise helpers', () => {
    expect(text('if(x < 0, -x, x^2)')).toBe('if(x < 0, -x, x^2)');
    expect(value('if(x < 0, -x, x^2)', -3)).toBe(3);
    expect(value('if(x < 0, -x, x^2)', 3)).toBe(9);
    expect(value('step(x)', 0)).toBe(1);
    expect(value('step(x)', -1e-300)).toBe(0);
    expect(value('mod(x, 2pi)', -1)).toBe(2 * d.PI - 1);
    expect(value('round(x)', -2.5)).toBe(-3);
    expect(value('clamp(x, -1, 1)', 5)).toBe(1);
    expect(text('(x < 0) < 1')).toBe('(x < 0) < 1');
  });
});

describe('evaluation', () => {
  it('uses dmath, so results are deterministic', () => {
    for (const x of [-3, -0.5, 0.1, 2, 7.25]) {
      expect(value('x sin(x)', x)).toBe(x * d.sin(x));
      expect(value('sin(x)+0.5 sin(2x)', x)).toBe(d.sin(x) + 0.5 * d.sin(2 * x));
      expect(value('1/(1+x^2)', x)).toBe(1 / (1 + x * x));
    }
  });

  it('masks invalid points instead of failing', () => {
    const r = parse('ln(x)');
    if (!r.ok) throw new Error();
    const { ys, invalid } = sample(compile(r.expr), [-1, 0, 1, Math.E]);
    expect(invalid).toBe(2);
    expect(Number.isNaN(ys[0])).toBe(true);
    expect(ys[2]).toBe(0);
  });

  it('produces LaTeX for display', () => {
    const r = parse('x sin(x) + 1/(1+x^2) + sqrt(abs(x))');
    if (!r.ok) throw new Error();
    expect(r.latex).toBe(
      'x \\sin\\left(x\\right) + \\frac{1}{1 + x^{2}} + \\sqrt{\\left|x\\right|}',
    );
    const coeff = parse('2pix + 2*3');
    expect(coeff.ok && coeff.latex).toBe('2 \\pi x + 2 \\cdot 3');
  });
});

describe('errors point at the problem', () => {
  it.each<[string, ErrorCode, number, number]>([
    ['', 'empty', 0, 1],
    ['   ', 'empty', 3, 4],
    ['sin x', 'needsParens', 0, 3],
    ['sinx', 'needsParens', 0, 3],
    ['x2', 'missingOperator', 1, 2],
    ['2 3', 'missingOperator', 2, 3],
    ['(x+1', 'unclosedParen', 0, 1],
    ['x+', 'unexpectedEnd', 2, 3],
    ['x)', 'unexpectedToken', 1, 2],
    ['foo(x)', 'unknownName', 0, 3],
    ['xfoo', 'unknownName', 1, 4],
    ['min(x)', 'arity', 0, 6],
    ['sin(x, 1)', 'arity', 0, 9],
    ['x $ 2', 'unexpectedChar', 2, 3],
    ['1 < x < 2', 'chainedComparison', 6, 7],
    ['1e400', 'numberTooLarge', 0, 5],
  ])('%j -> %s', (src, code, start, end) => {
    expect(errorOf(src)).toEqual([code, start, end]);
  });

  it('limits length and depth', () => {
    expect(errorOf('x+'.repeat(600) + 'x')[0]).toBe('tooLong');
    expect(errorOf('('.repeat(200) + 'x' + ')'.repeat(200))[0]).toBe('tooDeep');
  });
});
