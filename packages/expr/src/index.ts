/**
 * Expression language for target functions: whitelisted functions, implicit
 * multiplication, deterministic evaluation through dmath, and no eval.
 */
import { ParseError, type Expr, type ExprError } from './ast.ts';
import { parseExpr } from './parser.ts';
import { format, toLatex } from './print.ts';

export type { BinOp, CmpOp, ConstName, ErrorCode, Expr, ExprError } from './ast.ts';
export { ParseError } from './ast.ts';
export { compile, evaluate, sample, type Fn1, type Sampled } from './compile.ts';
export { ALIASES, CONSTANTS, FUNCTIONS } from './functions.ts';
export { MAX_LENGTH } from './lexer.ts';
export { MAX_DEPTH } from './parser.ts';
export { format, toLatex } from './print.ts';

export type ParseResult =
  | { ok: true; expr: Expr; /** canonical text */ text: string; latex: string }
  | { ok: false; error: ExprError };

/** Parses user input. Never throws: errors come back with a code and a character range. */
export function parse(src: string): ParseResult {
  try {
    const expr = parseExpr(src);
    return { ok: true, expr, text: format(expr), latex: toLatex(expr) };
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: err.detail };
    throw err;
  }
}
