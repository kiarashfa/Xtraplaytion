// LaTeX to canvas for export titles. MathJax typesets to SVG on a light DOM (no page
// DOM, no eval); the SVG is walked once into plain drawing commands that Path2D draws
// on any 2D context. Loaded on demand: only titles with $...$ need it.

import type { Ctx } from '../scene/draw.ts';

export type DisplayItem =
  | { kind: 'path'; m: Matrix; d: string }
  | { kind: 'rect'; m: Matrix; x: number; y: number; w: number; h: number };

/** A typeset formula. Units are 1/1000 em; y = 0 is the baseline, up is negative. */
export interface DisplayList {
  /** Left edge, top (negative: above the baseline), width and height (viewBox). */
  box: [number, number, number, number];
  items: DisplayItem[];
}

type Matrix = [number, number, number, number, number, number];

const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

export function parseTransform(t: string | null): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (fn === 'translate') m = mul(m, [1, 0, 0, 1, v[0], v[1] ?? 0]);
    else if (fn === 'scale') m = mul(m, [v[0], 0, 0, v[1] ?? v[0], 0, 0]);
    else if (fn === 'matrix' && v.length === 6) m = mul(m, v as Matrix);
  }
  return m;
}

/** Minimal view of an SVG tree (MathJax's lite DOM or a real one). */
export interface SvgNode {
  tag: string;
  attr: (name: string) => string | null;
  children: SvgNode[];
}

export function toDisplayList(svg: SvgNode): DisplayList {
  const items: DisplayItem[] = [];
  const walk = (el: SvgNode, m: Matrix) => {
    const mm = mul(m, parseTransform(el.attr('transform')));
    if (el.tag === 'path') {
      const d = el.attr('d');
      if (d) items.push({ kind: 'path', m: mm, d });
    } else if (el.tag === 'rect') {
      const n = (a: string) => Number(el.attr(a) ?? 0);
      items.push({ kind: 'rect', m: mm, x: n('x'), y: n('y'), w: n('width'), h: n('height') });
    }
    for (const c of el.children) walk(c, mm);
  };
  walk(svg, [1, 0, 0, 1, 0, 0]);
  const vb = (svg.attr('viewBox') ?? '0 0 0 0').split(/\s+/).map(Number);
  return { box: [vb[0] || 0, vb[1] || 0, vb[2] || 0, vb[3] || 0], items };
}

/** Draws a formula with its baseline at (x, y), `em` pixels per em. */
export function drawDisplayList(
  ctx: Ctx,
  dl: DisplayList,
  x: number,
  y: number,
  em: number,
  color: string,
) {
  const s = em / 1000;
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.translate(-dl.box[0], 0);
  for (const it of dl.items) {
    ctx.save();
    ctx.transform(it.m[0], it.m[1], it.m[2], it.m[3], it.m[4], it.m[5]);
    if (it.kind === 'path') ctx.fill(new Path2D(it.d));
    else ctx.fillRect(it.x, it.y, it.w, it.h);
    ctx.restore();
  }
  ctx.restore();
}

type Typeset = (tex: string) => Promise<DisplayList>;
let engine: Promise<Typeset> | null = null;

/** Rare characters live in extra font files that MathJax asks for while typesetting. */
const fontFiles = import.meta.glob(
  '../../../node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js',
);

async function load(): Promise<Typeset> {
  const [{ mathjax }, { TeX }, , , , { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, font] =
    await Promise.all([
      import('@mathjax/src/js/mathjax.js'),
      import('@mathjax/src/js/input/tex.js'),
      import('@mathjax/src/js/input/tex/base/BaseConfiguration.js'),
      import('@mathjax/src/js/input/tex/ams/AmsConfiguration.js'),
      import('@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'),
      import('@mathjax/src/js/output/svg.js'),
      import('@mathjax/src/js/adaptors/liteAdaptor.js'),
      import('@mathjax/src/js/handlers/html.js'),
      import('@mathjax/mathjax-newcm-font/js/svg.js'),
    ]);
  mathjax.asyncLoad = (name: string) => {
    const file = /([\w-]+)(?:\.js)?$/.exec(name)?.[1];
    const key = Object.keys(fontFiles).find((k) => k.endsWith(`/${file}.js`));
    return key ? fontFiles[key]() : Promise.reject(new Error(`missing ${name}`));
  };
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const doc = mathjax.document('', {
    InputJax: new TeX({ packages: ['base', 'ams', 'newcommand'] }),
    OutputJax: new SVG({
      fontCache: 'none',
      fontData: font.MathJaxNewcmFont,
      // MathJax 4 breaks inline math into several SVGs by default; titles need one.
      linebreaks: { inline: false },
    }),
  });
  type Lite = Parameters<typeof adaptor.getAttribute>[0];
  const elements = (n: Lite) =>
    (adaptor.childNodes(n) as Lite[]).filter((c) => adaptor.kind(c) !== '#text');
  const wrap = (n: Lite): SvgNode => ({
    tag: adaptor.kind(n),
    attr: (a) => (adaptor.getAttribute(n, a) as string | null | undefined) ?? null,
    children: elements(n).map(wrap),
  });
  return async (tex: string) => {
    const node = (await doc.convertPromise(tex, { display: false })) as Lite;
    const svg = elements(node).find((c) => adaptor.kind(c) === 'svg');
    if (!svg) throw new Error('no svg');
    // MathJax reports errors inside the output (merror) instead of throwing.
    if (adaptor.outerHTML(svg).includes('data-mjx-error')) throw new Error('tex');
    return toDisplayList(wrap(svg));
  };
}

const cache = new Map<string, Promise<DisplayList>>();

/** Typesets a formula (cached). Rejects when the TeX has errors. */
export function typeset(tex: string): Promise<DisplayList> {
  let p = cache.get(tex);
  if (!p) {
    engine ??= load();
    p = engine.then((f) => f(tex));
    cache.set(tex, p);
    p.catch(() => cache.delete(tex));
  }
  return p;
}
