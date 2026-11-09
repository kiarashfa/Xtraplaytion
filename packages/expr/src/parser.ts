// Pratt parser. Precedence, loosest to tightest:
//   comparison (10, no chaining) < + - (20) < * / and implicit multiplication (30)
//   < unary minus (35) < ^ (40, right associative).
// So -x^2 = -(x^2), 2^-x = 2^(-x), 1/2x = (1/2)*x, 2^3x = (2^3)*x. The UI shows the
// canonical form back to the user, which removes any doubt.
import { ParseError, type BinOp, type CmpOp, type ErrorCode, type Expr } from './ast.ts';
import { FUNCTIONS } from './functions.ts';
import { tokenize, type Token } from './lexer.ts';

export const MAX_DEPTH = 120;

const ADD = 20;
const MUL = 30;
const NEG = 35;
const POW = 40;
const CMP = 10;

const CMP_OPS = new Set(['<', '<=', '>', '>=', '==', '!=']);

class Parser {
  private i = 0;
  private depth = 0;
  private readonly toks: Token[];
  /** Nodes that were written inside parentheses: (a < b) < c is not a chain. */
  private readonly grouped = new WeakSet<Expr>();

  constructor(toks: Token[]) {
    this.toks = toks;
  }

  private peek(): Token {
    return this.toks[this.i];
  }

  private take(): Token {
    return this.toks[this.i++];
  }

  private fail(code: ErrorCode, tok: Token, params: Record<string, string | number> = {}): never {
    throw new ParseError({ code, start: tok.s, end: Math.max(tok.e, tok.s + 1), params });
  }

  parse(): Expr {
    if (this.peek().t === 'end') this.fail('empty', this.peek());
    const e = this.expr(0);
    const t = this.peek();
    if (t.t !== 'end') this.fail('unexpectedToken', t, { token: show(t) });
    return e;
  }

  private expr(rbp: number): Expr {
    if (++this.depth > MAX_DEPTH) this.fail('tooDeep', this.peek(), { max: MAX_DEPTH });
    let left = this.nud(this.take());
    for (;;) {
      const t = this.peek();
      const lbp = this.lbp(t);
      if (lbp <= rbp) break;
      left = this.led(t, left);
    }
    this.depth--;
    return left;
  }

  /** Binding power of the token that follows a complete operand. */
  private lbp(t: Token): number {
    switch (t.t) {
      case 'op':
        if (t.v === '+' || t.v === '-') return ADD;
        if (t.v === '*' || t.v === '/') return MUL;
        if (t.v === '^') return POW;
        if (CMP_OPS.has(t.v)) return CMP;
        if (t.v === '(') return MUL; // implicit: x(x+1), 2(x)
        return 0;
      case 'var':
      case 'const':
      case 'fn':
        return MUL; // implicit: 2x, xsin(x), 2pi
      case 'num':
        return this.fail('missingOperator', t); // x 2, (x+1) 3
      default:
        return 0;
    }
  }

  private nud(t: Token): Expr {
    switch (t.t) {
      case 'num':
        return { type: 'num', value: t.v };
      case 'var':
        return { type: 'var', name: 'x' };
      case 'const':
        return { type: 'const', name: t.name };
      case 'fn':
        return this.call(t);
      case 'end':
        return this.fail('unexpectedEnd', t);
      case 'op':
        if (t.v === '(') {
          const inner = this.expr(0);
          this.close(t);
          this.grouped.add(inner);
          return inner;
        }
        if (t.v === '-') return { type: 'neg', arg: this.expr(NEG) };
        if (t.v === '+') return this.expr(NEG);
        return this.fail('unexpectedToken', t, { token: t.v });
    }
  }

  private led(t: Token, left: Expr): Expr {
    if (t.t !== 'op' || t.v === '(') {
      // implicit multiplication: do not consume, parse the next factor
      return { type: 'bin', op: '*', left, right: this.expr(MUL), implicit: true };
    }
    this.take();
    switch (t.v) {
      case '+':
      case '-':
        return { type: 'bin', op: t.v, left, right: this.expr(ADD) };
      case '*':
      case '/':
        return { type: 'bin', op: t.v as BinOp, left, right: this.expr(MUL) };
      case '^':
        return { type: 'bin', op: '^', left, right: this.expr(POW - 1) };
      default:
        if (left.type === 'cmp' && !this.grouped.has(left)) this.fail('chainedComparison', t);
        return { type: 'cmp', op: t.v as CmpOp, left, right: this.expr(CMP) };
    }
  }

  private call(t: Extract<Token, { t: 'fn' }>): Expr {
    const def = FUNCTIONS[t.name];
    const open = this.peek();
    if (open.t !== 'op' || open.v !== '(') this.fail('needsParens', t, { name: def.name });
    this.take();
    const args: Expr[] = [];
    const next = this.peek();
    if (!(next.t === 'op' && next.v === ')')) {
      args.push(this.expr(0));
      for (;;) {
        const sep = this.peek();
        if (sep.t === 'op' && sep.v === ',') {
          this.take();
          args.push(this.expr(0));
        } else break;
      }
    }
    const closeTok = this.peek();
    this.close(open);
    if (args.length < def.min || args.length > def.max) {
      throw new ParseError({
        code: 'arity',
        start: t.s,
        end: closeTok.e,
        params: { name: def.name, min: def.min, max: def.max, got: args.length },
      });
    }
    return { type: 'call', fn: def.name, args };
  }

  private close(open: Token) {
    const t = this.peek();
    if (t.t === 'op' && t.v === ')') {
      this.take();
      return;
    }
    if (t.t === 'end') this.fail('unclosedParen', open);
    this.fail('unexpectedToken', t, { token: show(t) });
  }
}

function show(t: Token): string {
  switch (t.t) {
    case 'num':
      return String(t.v);
    case 'var':
      return 'x';
    case 'const':
    case 'fn':
      return t.name;
    case 'op':
      return t.v;
    default:
      return '';
  }
}

export function parseExpr(src: string): Expr {
  return new Parser(tokenize(src)).parse();
}
