// Tokenizer. Positions always refer to the original input so errors can be
// highlighted. Runs of letters are cut greedily into known names, which is
// what makes implicit multiplication like `xsin(x)` or `2pix` work.
import { ParseError, type ConstName } from './ast.ts';
import { ALIASES, CONSTANTS, FUNCTIONS, VOCABULARY } from './functions.ts';

export type Op =
  '+' | '-' | '*' | '/' | '^' | '(' | ')' | ',' | '<' | '<=' | '>' | '>=' | '==' | '!=';

export type Token =
  | { t: 'num'; v: number; s: number; e: number }
  | { t: 'var'; s: number; e: number }
  | { t: 'const'; name: ConstName; s: number; e: number }
  | { t: 'fn'; name: string; s: number; e: number }
  | { t: 'op'; v: Op; s: number; e: number }
  | { t: 'end'; s: number; e: number };

export const MAX_LENGTH = 1000;

/** Unicode spellings mapped to ASCII operators. */
const SYMBOLS: Record<string, Op> = {
  '+': '+',
  '-': '-',
  '−': '-', // minus sign
  '–': '-', // en dash typed as minus
  '*': '*',
  '×': '*', // multiplication sign
  '·': '*', // middle dot
  '⋅': '*', // dot operator
  '/': '/',
  '÷': '/', // division sign
  '^': '^',
  '(': '(',
  ')': ')',
  '[': '(',
  ']': ')',
  ',': ',',
  '<': '<',
  '>': '>',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
};

const SUPERSCRIPT: Record<string, number> = { '²': 2, '³': 3 };
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const WORD = /^[A-Za-z_][A-Za-z0-9_]*/;

export function tokenize(src: string): Token[] {
  if (src.length > MAX_LENGTH) {
    throw new ParseError({
      code: 'tooLong',
      start: MAX_LENGTH,
      end: src.length,
      params: { max: MAX_LENGTH },
    });
  }
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = src.slice(i);

    const num = NUMBER.exec(rest);
    if (num) {
      const v = Number(num[0]);
      if (!Number.isFinite(v)) {
        throw new ParseError({
          code: 'numberTooLarge',
          start: i,
          end: i + num[0].length,
          params: {},
        });
      }
      out.push({ t: 'num', v, s: i, e: i + num[0].length });
      i += num[0].length;
      continue;
    }

    if (c === 'π') {
      out.push({ t: 'const', name: 'pi', s: i, e: i + 1 });
      i++;
      continue;
    }

    const word = WORD.exec(rest);
    if (word) {
      splitWord(word[0], i, out);
      i += word[0].length;
      continue;
    }

    if (c in SUPERSCRIPT) {
      out.push(
        { t: 'op', v: '^', s: i, e: i + 1 },
        { t: 'num', v: SUPERSCRIPT[c], s: i, e: i + 1 },
      );
      i++;
      continue;
    }

    const two = rest.slice(0, 2);
    if (two === '**') {
      out.push({ t: 'op', v: '^', s: i, e: i + 2 });
      i += 2;
      continue;
    }
    if (two === '<=' || two === '>=' || two === '==' || two === '!=') {
      out.push({ t: 'op', v: two, s: i, e: i + 2 });
      i += 2;
      continue;
    }
    if (c === '=') {
      out.push({ t: 'op', v: '==', s: i, e: i + 1 });
      i++;
      continue;
    }
    const op = SYMBOLS[c];
    if (op) {
      out.push({ t: 'op', v: op, s: i, e: i + 1 });
      i++;
      continue;
    }
    const ch = String.fromCodePoint(src.codePointAt(i) ?? 0);
    throw new ParseError({
      code: 'unexpectedChar',
      start: i,
      end: i + ch.length,
      params: { char: ch },
    });
  }
  out.push({ t: 'end', s: src.length, e: src.length });
  return out;
}

/** Cut a run of letters into known names, longest match first (case-insensitive). */
function splitWord(word: string, offset: number, out: Token[]) {
  const lower = word.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    const name = VOCABULARY.find((w) => lower.startsWith(w, i));
    if (!name) {
      const restStart = offset + i;
      if (/\d/.test(lower[i])) {
        throw new ParseError({
          code: 'missingOperator',
          start: restStart,
          end: restStart + 1,
          params: {},
        });
      }
      throw new ParseError({
        code: 'unknownName',
        start: restStart,
        end: offset + word.length,
        params: { name: word.slice(i) },
      });
    }
    const s = offset + i;
    const e = s + name.length;
    if (name === 'x') out.push({ t: 'var', s, e });
    else if (name in CONSTANTS) out.push({ t: 'const', name: name as ConstName, s, e });
    else out.push({ t: 'fn', name: FUNCTIONS[name] ? name : (ALIASES[name] ?? name), s, e });
    i += name.length;
  }
}
