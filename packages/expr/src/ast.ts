export type BinOp = '+' | '-' | '*' | '/' | '^';
export type CmpOp = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type ConstName = 'pi' | 'e' | 'tau';

export type Expr =
  | { type: 'num'; value: number }
  | { type: 'var'; name: 'x' }
  | { type: 'const'; name: ConstName }
  | { type: 'neg'; arg: Expr }
  | { type: 'bin'; op: BinOp; left: Expr; right: Expr; implicit?: boolean }
  | { type: 'cmp'; op: CmpOp; left: Expr; right: Expr }
  | { type: 'call'; fn: string; args: Expr[] };

/** Machine-readable parse error; the UI turns `code` + `params` into a translated message. */
export type ErrorCode =
  | 'empty'
  | 'tooLong'
  | 'tooDeep'
  | 'unexpectedChar'
  | 'numberTooLarge'
  | 'unexpectedToken'
  | 'unexpectedEnd'
  | 'unclosedParen'
  | 'unknownName'
  | 'needsParens'
  | 'arity'
  | 'missingOperator'
  | 'chainedComparison';

export interface ExprError {
  code: ErrorCode;
  /** Character range [start, end) in the original input. */
  start: number;
  end: number;
  params: Record<string, string | number>;
}

export class ParseError extends Error {
  readonly detail: ExprError;

  constructor(detail: ExprError) {
    super(`${detail.code} at ${detail.start}`);
    this.detail = detail;
  }
}
