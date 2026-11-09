// Canonical text (shown back to the user, re-parses to the same tree) and LaTeX.
import type { Expr } from './ast.ts';
import { FUNCTIONS } from './functions.ts';

function prec(e: Expr): number {
  switch (e.type) {
    case 'num':
    case 'var':
    case 'const':
    case 'call':
      return 100;
    case 'neg':
      return 35;
    case 'cmp':
      return 10;
    case 'bin':
      return e.op === '^' ? 40 : e.op === '*' || e.op === '/' ? 30 : 20;
  }
}

const paren = (s: string) => `(${s})`;

/** Canonical plain-text form with explicit operators, e.g. `x*sin(x) + (1/2)*x`. */
export function format(e: Expr): string {
  switch (e.type) {
    case 'num':
      return String(e.value);
    case 'var':
      return 'x';
    case 'const':
      return e.name;
    case 'call':
      return `${e.fn}(${e.args.map(format).join(', ')})`;
    case 'neg': {
      const a = format(e.arg);
      return `-${prec(e.arg) > 35 ? a : paren(a)}`;
    }
    case 'cmp': {
      const l = prec(e.left) > 10 ? format(e.left) : paren(format(e.left));
      const r = prec(e.right) > 10 ? format(e.right) : paren(format(e.right));
      return `${l} ${e.op} ${r}`;
    }
    case 'bin': {
      const p = prec(e);
      const l = format(e.left);
      const r = format(e.right);
      const rightNeg = e.right.type === 'neg';
      if (e.op === '^') {
        const lw = prec(e.left) <= 40 ? paren(l) : l;
        const rw = prec(e.right) < 40 || rightNeg ? paren(r) : r;
        return `${lw}^${rw}`;
      }
      // Clarity: (1/2)*x rather than 1/2*x.
      const lw =
        prec(e.left) < p || (e.op === '*' && e.left.type === 'bin' && e.left.op === '/')
          ? paren(l)
          : l;
      const rw = prec(e.right) <= p || rightNeg ? paren(r) : r;
      return p === 30 ? `${lw}${e.op}${rw}` : `${lw} ${e.op} ${rw}`;
    }
  }
}

function latexNum(v: number): string {
  const s = String(v);
  const m = /^([\d.]+)e([+-])(\d+)$/.exec(s);
  if (!m) return s;
  return `${m[1]}\\times 10^{${m[2] === '-' ? '-' : ''}${m[3]}}`;
}

const lparen = (s: string) => `\\left(${s}\\right)`;
const CMP_LATEX: Record<string, string> = {
  '<': '<',
  '<=': '\\le',
  '>': '>',
  '>=': '\\ge',
  '==': '=',
  '!=': '\\ne',
};

/** LaTeX for display (titles, the parsed-form preview). */
export function toLatex(e: Expr): string {
  switch (e.type) {
    case 'num':
      return latexNum(e.value);
    case 'var':
      return 'x';
    case 'const':
      return e.name === 'e' ? 'e' : `\\${e.name}`;
    case 'neg': {
      const a = toLatex(e.arg);
      return `-${prec(e.arg) > 35 || (e.arg.type === 'bin' && e.arg.op === '/') ? a : lparen(a)}`;
    }
    case 'cmp':
      return `${toLatex(e.left)} ${CMP_LATEX[e.op]} ${toLatex(e.right)}`;
    case 'call': {
      const args = e.args.map(toLatex);
      switch (e.fn) {
        case 'sqrt':
          return `\\sqrt{${args[0]}}`;
        case 'abs':
          return `\\left|${args[0]}\\right|`;
        case 'floor':
          return `\\left\\lfloor ${args[0]}\\right\\rfloor`;
        case 'ceil':
          return `\\left\\lceil ${args[0]}\\right\\rceil`;
        case 'exp':
          return `e^{${args[0]}}`;
        default:
          return `${FUNCTIONS[e.fn].latex ?? `\\operatorname{${e.fn}}`}${lparen(args.join(', '))}`;
      }
    }
    case 'bin': {
      if (e.op === '/') return `\\frac{${toLatex(e.left)}}{${toLatex(e.right)}}`;
      const l = toLatex(e.left);
      const r = toLatex(e.right);
      if (e.op === '^') {
        const base = prec(e.left) <= 40 || e.left.type === 'call' ? lparen(l) : l;
        return `${base}^{${r}}`;
      }
      const p = prec(e);
      const lw = prec(e.left) < p ? lparen(l) : l;
      const rw = prec(e.right) <= p || e.right.type === 'neg' ? lparen(r) : r;
      if (e.op === '*') {
        // Juxtapose implicit products and number coefficients (2x, x\sin(x)); otherwise a centred dot.
        const juxtapose = (e.implicit || e.left.type === 'num') && !/^[\d.]/.test(rw);
        // A space keeps control words apart (\pi x, not \pix); math mode ignores it.
        return juxtapose ? `${lw} ${rw}` : `${lw} \\cdot ${rw}`;
      }
      return `${lw} ${e.op} ${rw}`;
    }
  }
}
