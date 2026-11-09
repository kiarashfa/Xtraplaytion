/**
 * Minimal ICU MessageFormat subset, enough for UI strings:
 *   {name}                                   plain argument (String(value), no grouping)
 *   {n, number}                              locale-formatted number
 *   {n, plural, =0 {none} one {# item} other {# items}}
 *   {kind, select, mlp {Network} other {Model}}
 * Inside plural branches `#` is the locale-formatted number.
 * Quoting: '' is a literal apostrophe, '{' and '}' are literal braces.
 */

export type MessageParams = Record<string, string | number>;

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'arg'; name: string }
  | { kind: 'number'; name: string }
  | { kind: 'pound' }
  | { kind: 'plural'; name: string; branches: Map<string, Node[]> }
  | { kind: 'select'; name: string; branches: Map<string, Node[]> };

class Parser {
  private pos = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  parse(): Node[] {
    const nodes = this.nodes(false, false);
    if (this.pos < this.src.length) this.fail('unexpected "}"');
    return nodes;
  }

  private fail(msg: string): never {
    throw new Error(`Bad message at ${this.pos}: ${msg} in "${this.src}"`);
  }

  private nodes(inBranch: boolean, inPlural: boolean): Node[] {
    const out: Node[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push({ kind: 'text', value: text });
      text = '';
    };
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === "'") {
        const next = this.src[this.pos + 1];
        if (next === "'") {
          text += "'";
          this.pos += 2;
        } else if (next === '{' || next === '}' || next === '#') {
          const end = this.src.indexOf("'", this.pos + 1);
          if (end < 0) this.fail('unterminated quote');
          text += this.src.slice(this.pos + 1, end);
          this.pos = end + 1;
        } else {
          text += "'";
          this.pos++;
        }
      } else if (c === '{') {
        flush();
        out.push(this.argument());
      } else if (c === '}') {
        if (!inBranch) this.fail('unexpected "}"');
        break;
      } else if (c === '#' && inPlural) {
        flush();
        out.push({ kind: 'pound' });
        this.pos++;
      } else {
        text += c;
        this.pos++;
      }
    }
    flush();
    return out;
  }

  private skipSpace() {
    while (/\s/.test(this.src[this.pos] ?? '')) this.pos++;
  }

  private ident(): string {
    this.skipSpace();
    const m = /^[=\w.-]+/.exec(this.src.slice(this.pos));
    if (!m) this.fail('expected identifier');
    this.pos += m[0].length;
    this.skipSpace();
    return m[0];
  }

  private expect(ch: string) {
    if (this.src[this.pos] !== ch) this.fail(`expected "${ch}"`);
    this.pos++;
  }

  private argument(): Node {
    this.expect('{');
    const name = this.ident();
    if (this.src[this.pos] === '}') {
      this.pos++;
      return { kind: 'arg', name };
    }
    this.expect(',');
    const type = this.ident();
    if (type === 'number') {
      this.expect('}');
      return { kind: 'number', name };
    }
    if (type !== 'plural' && type !== 'select') this.fail(`unknown type "${type}"`);
    this.expect(',');
    const branches = new Map<string, Node[]>();
    for (;;) {
      this.skipSpace();
      if (this.src[this.pos] === '}') break;
      const key = this.ident();
      this.expect('{');
      branches.set(key, this.nodes(true, type === 'plural'));
      this.expect('}');
    }
    this.expect('}');
    if (!branches.has('other')) this.fail('missing "other" branch');
    return { kind: type, name, branches };
  }
}

/** First matching branch, else `other` (the parser guarantees it exists). */
function pick(branches: Map<string, Node[]>, ...keys: string[]): Node[] {
  for (const k of keys) {
    const b = branches.get(k);
    if (b) return b;
  }
  return branches.get('other') ?? [];
}

export interface Formatter {
  format(message: string, params?: MessageParams): string;
}

export function createFormatter(locale: string): Formatter {
  const cache = new Map<string, Node[]>();
  const plural = new Intl.PluralRules(locale);
  const number = new Intl.NumberFormat(locale);

  function param(params: MessageParams | undefined, name: string): string | number {
    const v = params?.[name];
    if (v === undefined) throw new Error(`Missing message parameter "${name}"`);
    return v;
  }

  function render(nodes: Node[], params: MessageParams | undefined, pound?: number): string {
    let out = '';
    for (const n of nodes) {
      switch (n.kind) {
        case 'text':
          out += n.value;
          break;
        case 'arg':
          out += String(param(params, n.name));
          break;
        case 'number':
          out += number.format(Number(param(params, n.name)));
          break;
        case 'pound':
          out += pound === undefined ? '#' : number.format(pound);
          break;
        case 'plural': {
          const v = Number(param(params, n.name));
          out += render(pick(n.branches, `=${v}`, plural.select(v)), params, v);
          break;
        }
        case 'select': {
          const v = String(param(params, n.name));
          out += render(pick(n.branches, v), params, pound);
          break;
        }
      }
    }
    return out;
  }

  return {
    format(message, params) {
      let nodes = cache.get(message);
      if (!nodes) {
        nodes = new Parser(message).parse();
        cache.set(message, nodes);
      }
      return render(nodes, params);
    },
  };
}

/** Throws if a message is not valid syntax. Used by catalog tests. */
export function validateMessage(message: string): void {
  new Parser(message).parse();
}
