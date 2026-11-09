import { describe, expect, it } from 'vitest';
import { licenseAllowed, renderNotices } from './notices.ts';

const allow = new Set(['MIT', 'Apache-2.0', 'OFL-1.1']);

describe('licenseAllowed', () => {
  it('accepts allowed identifiers and rejects others', () => {
    expect(licenseAllowed('MIT', allow)).toBe(true);
    expect(licenseAllowed('GPL-3.0-only', allow)).toBe(false);
    expect(licenseAllowed('LGPL-3.0-or-later', allow)).toBe(false);
    expect(licenseAllowed('UNKNOWN', allow)).toBe(false);
  });

  it('evaluates OR, AND and parentheses', () => {
    expect(licenseAllowed('(MIT OR GPL-3.0-only)', allow)).toBe(true);
    expect(licenseAllowed('MIT AND GPL-2.0-only', allow)).toBe(false);
    expect(licenseAllowed('(MIT AND OFL-1.1) OR GPL-2.0-only', allow)).toBe(true);
    expect(licenseAllowed('Apache-2.0+', allow)).toBe(true);
  });
});

describe('renderNotices', () => {
  it('is sorted and deterministic', () => {
    const pkg = (name: string) => ({
      name,
      version: '1.0.0',
      license: 'MIT',
      homepage: `https://example.com/${name}`,
      text: `License for ${name}`,
    });
    const a = renderNotices([pkg('zeta'), pkg('alpha')], []);
    const b = renderNotices([pkg('alpha'), pkg('zeta')], []);
    expect(a).toBe(b);
    expect(a.indexOf('alpha 1.0.0')).toBeLessThan(a.indexOf('zeta 1.0.0'));
  });
});
