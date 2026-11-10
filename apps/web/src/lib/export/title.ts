// Titles with inline LaTeX: "ReLU networks learn $\sin(x)$". Text between $ signs is
// typeset by MathJax (loaded on demand); everything else is drawn as canvas text.
// Lines wrap at spaces; a formula never breaks.

import type { Ctx } from '../scene/draw.ts';
import { drawDisplayList, typeset, type DisplayList } from './tex.ts';

export type Piece = { kind: 'text'; text: string } | { kind: 'math'; tex: string };

/** Splits a title into text and formulas. `\$` is a literal dollar sign; an unclosed $
 *  is kept as text. */
export function splitTitle(src: string): Piece[] {
  const out: Piece[] = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && src[i + 1] === '$') {
      text += '$';
      i += 2;
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < src.length && !(src[j] === '$' && src[j - 1] !== '\\')) j++;
      if (j < src.length) {
        const tex = src.slice(i + 1, j).trim();
        if (tex) {
          if (text) out.push({ kind: 'text', text });
          text = '';
          out.push({ kind: 'math', tex });
        }
        i = j + 1;
        continue;
      }
    }
    text += c;
    i++;
  }
  if (text) out.push({ kind: 'text', text });
  return out;
}

export const hasMath = (src: string) => splitTitle(src).some((p) => p.kind === 'math');

/** A title ready to draw: formulas typeset (null when a formula failed: drawn as its TeX). */
export interface TitleBlock {
  pieces: (Piece & { dl?: DisplayList | null })[];
}

/** Typesets the formulas of a title (MathJax loads only when there is one). */
export async function prepareTitle(src: string): Promise<TitleBlock> {
  const pieces = splitTitle(src);
  return {
    pieces: await Promise.all(
      pieces.map(async (p) =>
        p.kind === 'math' ? { ...p, dl: await typeset(p.tex).catch(() => null) } : p,
      ),
    ),
  };
}

export interface TitleStyle {
  /** Font size of the text in pixels; formulas get `mathScale` times that. */
  size: number;
  weight: number;
  mathScale: number;
  family: string;
  mono: string;
  color: string;
  align: 'center' | 'left';
  lineGap: number;
}

interface Box {
  w: number;
  asc: number;
  desc: number;
  draw: (ctx: Ctx, x: number, baseline: number) => void;
  space: boolean;
}

function boxes(ctx: Ctx, block: TitleBlock, st: TitleStyle): Box[] {
  const font = `${st.weight} ${st.size}px ${st.family}`;
  const out: Box[] = [];
  const word = (text: string, f: string): Box => {
    ctx.font = f;
    const m = ctx.measureText(text);
    return {
      w: m.width,
      asc: st.size * 0.78,
      desc: st.size * 0.22,
      space: false,
      draw: (c, x, y) => {
        c.font = f;
        c.fillStyle = st.color;
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        c.fillText(text, x, y);
      },
    };
  };
  ctx.font = font;
  const spaceW = ctx.measureText(' ').width;
  const space = (): Box => ({ w: spaceW, asc: 0, desc: 0, space: true, draw: () => {} });
  for (const p of block.pieces) {
    if (p.kind === 'text') {
      p.text.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        out.push(/^\s+$/.test(part) ? space() : word(part, font));
      });
    } else if (p.dl) {
      const em = st.size * st.mathScale;
      const dl = p.dl;
      out.push({
        w: (dl.box[2] / 1000) * em,
        asc: (-dl.box[1] / 1000) * em,
        desc: ((dl.box[3] + dl.box[1]) / 1000) * em,
        space: false,
        draw: (c, x, y) => drawDisplayList(c, dl, x, y, em, st.color),
      });
    } else out.push(word(p.tex, `400 ${st.size * 0.8}px ${st.mono}`));
  }
  return out;
}

export interface TitleLayout {
  height: number;
  draw: (ctx: Ctx, x: number, y: number) => void;
}

/** Wraps a title into lines no wider than `maxW` (a too-wide formula gets a line of its
 *  own and is scaled down to fit). */
export function layoutTitle(
  ctx: Ctx,
  block: TitleBlock,
  st: TitleStyle,
  maxW: number,
): TitleLayout {
  const all = boxes(ctx, block, st);
  const lines: Box[][] = [];
  let line: Box[] = [];
  let w = 0;
  for (const b of all) {
    if (b.space) {
      if (line.length) {
        line.push(b);
        w += b.w;
      }
      continue;
    }
    if (line.length && w + b.w > maxW) {
      while (line.length && line[line.length - 1].space) line.pop();
      lines.push(line);
      line = [];
      w = 0;
    }
    line.push(b);
    w += b.w;
  }
  while (line.length && line[line.length - 1].space) line.pop();
  if (line.length) lines.push(line);

  const metrics = lines.map((l) => {
    const width = l.reduce((s, b) => s + b.w, 0);
    const scale = width > maxW ? maxW / width : 1;
    const asc = Math.max(st.size * 0.78, ...l.map((b) => b.asc)) * scale;
    const desc = Math.max(st.size * 0.22, ...l.map((b) => b.desc)) * scale;
    return { l, width: width * scale, scale, asc, desc };
  });
  const height = metrics.reduce((s, m, i) => s + m.asc + m.desc + (i ? st.lineGap : 0), 0);
  return {
    height,
    draw: (c, x, y) => {
      let top = y;
      for (const m of metrics) {
        const base = top + m.asc;
        let px = st.align === 'center' ? x + (maxW - m.width) / 2 : x;
        c.save();
        c.translate(px, base);
        c.scale(m.scale, m.scale);
        px = 0;
        for (const b of m.l) {
          b.draw(c, px, 0);
          px += b.w;
        }
        c.restore();
        top = base + m.desc + st.lineGap;
      }
    },
  };
}
