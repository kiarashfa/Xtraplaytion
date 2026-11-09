import { describe, expect, it } from 'vitest';
import { createFormatter, validateMessage } from './format.ts';
import { locales, useTranslations } from './index.ts';

describe('ICU subset formatter', () => {
  const f = createFormatter('en');

  it('interpolates plain and number arguments', () => {
    expect(f.format('Hello {name}', { name: 'Ada' })).toBe('Hello Ada');
    expect(f.format('{n, number} points', { n: 12000 })).toBe('12,000 points');
  });

  it('selects plural branches, exact matches first', () => {
    const msg = '{n, plural, =0 {no epochs} one {# epoch} other {# epochs}}';
    expect(f.format(msg, { n: 0 })).toBe('no epochs');
    expect(f.format(msg, { n: 1 })).toBe('1 epoch');
    expect(f.format(msg, { n: 1600 })).toBe('1,600 epochs');
  });

  it('supports select and nesting', () => {
    const msg =
      '{kind, select, mlp {Network with {n, plural, one {# layer} other {# layers}}} other {Model}}';
    expect(f.format(msg, { kind: 'mlp', n: 3 })).toBe('Network with 3 layers');
    expect(f.format(msg, { kind: 'gp', n: 3 })).toBe('Model');
  });

  it('handles quoting', () => {
    expect(f.format("It''s '{literal}'")).toBe("It's {literal}");
    expect(f.format("don't")).toBe("don't");
  });

  it('rejects malformed messages and missing parameters', () => {
    expect(() => validateMessage('{n, plural, one {x}}')).toThrow(/other/);
    expect(() => validateMessage('oops }')).toThrow();
    expect(() => validateMessage('{n, date}')).toThrow(/unknown type/);
    expect(() => f.format('{missing}')).toThrow(/Missing/);
  });

  it('uses Intl plural rules for other locales', () => {
    const ru = createFormatter('ru');
    const msg = '{n, plural, one {# день} few {# дня} many {# дней} other {# дня}}';
    expect(ru.format(msg, { n: 21 })).toBe('21 день');
    expect(ru.format(msg, { n: 22 })).toBe('22 дня');
    expect(ru.format(msg, { n: 25 })).toBe('25 дней');
  });
});

describe('catalogs', () => {
  for (const [code, info] of Object.entries(locales)) {
    it(`${code}: every message parses`, () => {
      for (const [key, msg] of Object.entries(info.catalog)) {
        expect(() => validateMessage(msg), key).not.toThrow();
      }
    });
  }

  it('translator formats a catalog key', () => {
    const t = useTranslations('en');
    expect(t('common.epochs', { count: 1 })).toBe('1 epoch');
    expect(t('footer.copyright', { year: 2026 })).toContain('2026');
  });
});
