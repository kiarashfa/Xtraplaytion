import { describe, expect, it } from 'vitest';
import { timeline } from './frame.ts';
import { frameCount, gifSize } from './render.ts';
import { titleTex } from './scene.ts';
import { typeset } from './tex.ts';
import { splitTitle } from './title.ts';

describe('titles', () => {
  it('splits text and formulas', () => {
    expect(splitTitle('ReLU networks learn $\\sin(x)$')).toEqual([
      { kind: 'text', text: 'ReLU networks learn ' },
      { kind: 'math', tex: '\\sin(x)' },
    ]);
    expect(splitTitle('$a$ and $b$!')).toEqual([
      { kind: 'math', tex: 'a' },
      { kind: 'text', text: ' and ' },
      { kind: 'math', tex: 'b' },
      { kind: 'text', text: '!' },
    ]);
  });

  it('keeps escaped and unclosed dollars as text', () => {
    expect(splitTitle('Costs \\$5')).toEqual([{ kind: 'text', text: 'Costs $5' }]);
    expect(splitTitle('half $open')).toEqual([{ kind: 'text', text: 'half $open' }]);
    expect(splitTitle('empty $$ here')).toEqual([{ kind: 'text', text: 'empty  here' }]);
  });

  it('drops \\left and \\right around plain arguments only', () => {
    expect(titleTex('\\sin\\left(3 x\\right)')).toBe('\\sin(3 x)');
    expect(titleTex('\\frac{1}{1+x^{2}}\\left(x\\right)')).toBe(
      '\\frac{1}{1+x^{2}}\\left(x\\right)',
    );
    expect(titleTex('\\left. x \\right|')).toBe('\\left. x \\right|');
  });

  it('typesets formulas into drawing commands', async () => {
    const dl = await typeset('\\sin(x)+\\tfrac{1}{2}\\sin(2x)');
    expect(dl.items.length).toBeGreaterThan(3);
    const ink = dl.items.reduce((n, it) => n + (it.kind === 'path' ? it.d.length : 0), 0);
    expect(ink).toBeGreaterThan(2000);
    expect(dl.box[2]).toBeGreaterThan(5000); // wider than five em
    expect(dl.box[1]).toBeLessThan(0); // the top is above the baseline
    for (const it of dl.items) expect(it.m.every(Number.isFinite)).toBe(true);
  });

  it('typesets rare characters from the extra font files', async () => {
    const dl = await typeset('\\mathfrak{A} \\oint \\hbar');
    expect(dl.items.length).toBeGreaterThan(2);
  });

  it('rejects TeX with errors', async () => {
    await expect(typeset('\\frac{1}')).rejects.toThrow();
    await expect(typeset('\\nosuchcommand')).rejects.toThrow();
  });
});

describe('timeline', () => {
  it('starts slowly, ends on the last epoch and holds it', () => {
    const e = timeline(1600, 360, 60);
    expect(e).toHaveLength(360);
    expect(e[0]).toBe(0);
    expect(e[299]).toBe(1600);
    expect(e.slice(300).every((v) => v === 1600)).toBe(true);
    for (let k = 1; k < e.length; k++) expect(e[k]).toBeGreaterThanOrEqual(e[k - 1]);
    // ease-in: the first half of the video covers less than half of the epochs
    expect(e[150]).toBeLessThan(800);
  });

  it('counts frames and caps GIFs', () => {
    expect(frameCount({ format: 'mp4', fps: 30, seconds: 12 })).toBe(360);
    expect(frameCount({ format: 'gif', fps: 30, seconds: 12 })).toBe(180);
    expect(frameCount({ format: 'png', fps: 30, seconds: 12 })).toBe(1);
    expect(frameCount({ format: 'webm', fps: 30, seconds: 999 })).toBe(1800);
    expect(gifSize(1080, 1920)).toEqual([540, 960]);
    expect(gifSize(1920, 1080)).toEqual([540, 304]);
    expect(gifSize(540, 540)).toEqual([540, 540]);
  });
});
