// One export frame: title, epoch chip, model box, fit plot(s), loss plot, legend and
// credit, composed with the same scene renderer as the screen. Everything is laid out
// in "scene pixels" (540 wide for portrait and square formats, 960 for 16:9) and drawn
// with a scale transform, so every size of a format looks the same.

import {
  DASHES,
  drawFit,
  drawLoss,
  type Ctx,
  type FitScene,
  type SceneTheme,
} from '../scene/draw.ts';
import { layoutTitle, type TitleBlock, type TitleLayout } from './title.ts';

export type Aspect = '9:16' | '1:1' | '4:5' | '16:9';

export const ASPECTS: Record<Aspect, { w: number; h: number; sizes: [number, number][] }> = {
  '9:16': {
    w: 540,
    h: 960,
    sizes: [
      [1080, 1920],
      [720, 1280],
    ],
  },
  '1:1': {
    w: 540,
    h: 540,
    sizes: [
      [1080, 1080],
      [720, 720],
    ],
  },
  '4:5': {
    w: 540,
    h: 675,
    sizes: [
      [1080, 1350],
      [864, 1080],
    ],
  },
  '16:9': {
    w: 960,
    h: 540,
    sizes: [
      [1920, 1080],
      [1280, 720],
    ],
  },
};

export interface ExportModel {
  name: string;
  color: number;
  /** "[1, 64, 64, 1] · ReLU", "degree 9" */
  summary: string;
}

export interface ExportShow {
  epoch: boolean;
  config: boolean;
  loss: boolean;
  legend: boolean;
  glow: boolean;
  regions: boolean;
  credit: boolean;
}

/** Everything that stays the same for the whole video. */
export interface ExportStatic {
  aspect: Aspect;
  layout: 'overlay' | 'stacked';
  theme: SceneTheme;
  title: TitleBlock;
  subtitle: TitleBlock;
  scene: Pick<
    FitScene,
    | 'xDomain'
    | 'yDomain'
    | 'bands'
    | 'trainX'
    | 'trainY'
    | 'valX'
    | 'valY'
    | 'gridX'
    | 'truth'
    | 'testX'
    | 'testY'
    | 'drawn'
  >;
  models: ExportModel[];
  epochs: number;
  show: ExportShow;
  /** Optional line of the creator's own (name, handle), next to the credit. */
  signature: string;
  labels: {
    epoch: string;
    credit: string;
    data: string;
    truth: string;
    drawing: string;
    heldOut: string;
    band: string;
    spread: string;
    regions: { train: string; gap: string; beyond: string };
  };
}

/** One moment of the race. `models[i]` is null before model i has a frame. */
export interface ExportMoment {
  epoch: number;
  models: ({ ys: ArrayLike<number>; band?: ArrayLike<number>; spread?: boolean } | null)[];
  loss: { train: ArrayLike<number>; val?: ArrayLike<number> }[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const wide = (a: Aspect) => a === '16:9';

function card(ctx: Ctx, r: Rect, th: SceneTheme) {
  ctx.fillStyle = th.surface;
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 12);
  ctx.fill();
  ctx.stroke();
}

function chip(ctx: Ctx, text: string, x: number, y: number, th: SceneTheme, right = false) {
  ctx.font = `700 14px ${th.mono}`;
  const w = ctx.measureText(text).width + 22;
  const left = right ? x - w : x;
  card(ctx, { x: left, y, w, h: 30 }, th);
  ctx.fillStyle = th.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 11, y + 15.5);
  return w;
}

/** Height of the model box for `lines` lines. */
const boxHeight = (lines: number) => 14 + lines * 17;

function modelBox(ctx: Ctx, lines: string[], x: number, y: number, maxW: number, th: SceneTheme) {
  ctx.font = `400 12px ${th.mono}`;
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 22);
  const h = boxHeight(lines.length);
  card(ctx, { x: x - w, y, w, h }, th);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - w + 4, y, w - 8, h);
  ctx.clip();
  ctx.fillStyle = th.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x - w + 11, y + 7 + 17 * i + 8.5));
  ctx.restore();
}

interface LegendItem {
  kind: 'dot' | 'line' | 'cross' | 'area';
  color: string;
  dash?: number[];
  dotted?: boolean;
  label: string;
}

function legendItems(st: ExportStatic, m: ExportMoment): LegendItem[] {
  const th = st.theme;
  const out: LegendItem[] = [{ kind: 'dot', color: th.target, label: st.labels.data }];
  if (st.scene.truth && !st.scene.drawn)
    out.push({ kind: 'line', color: th.truth, dotted: true, label: st.labels.truth });
  if (st.scene.truth && st.scene.drawn)
    out.push({ kind: 'line', color: th.truth, label: st.labels.drawing });
  if (st.scene.testX?.length)
    out.push({ kind: 'cross', color: th.muted, label: st.labels.heldOut });
  st.models.forEach((md) =>
    out.push({
      kind: 'line',
      color: th.competitors[(md.color - 1) % th.competitors.length],
      dash: DASHES[(md.color - 1) % DASHES.length],
      label: md.name,
    }),
  );
  const bands = m.models.filter((x) => x?.band);
  if (bands.some((x) => !x?.spread))
    out.push({ kind: 'area', color: th.muted, label: st.labels.band });
  if (bands.some((x) => x?.spread))
    out.push({ kind: 'area', color: th.muted, label: st.labels.spread });
  return out;
}

const SWATCH = 26;

function itemWidth(ctx: Ctx, it: LegendItem) {
  return SWATCH + 7 + ctx.measureText(it.label).width;
}

function drawSwatch(ctx: Ctx, it: LegendItem, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = it.color;
  ctx.fillStyle = it.color;
  ctx.lineCap = 'round';
  if (it.kind === 'dot') {
    ctx.beginPath();
    ctx.arc(x + SWATCH / 2, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (it.kind === 'cross') {
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + SWATCH / 2 - 4, y - 4);
    ctx.lineTo(x + SWATCH / 2 + 4, y + 4);
    ctx.moveTo(x + SWATCH / 2 + 4, y - 4);
    ctx.lineTo(x + SWATCH / 2 - 4, y + 4);
    ctx.stroke();
  } else if (it.kind === 'area') {
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x, y - 6, SWATCH, 12);
  } else {
    ctx.lineWidth = it.dotted ? 2 : 3;
    ctx.setLineDash(it.dotted ? [1.5, 4] : (it.dash ?? []));
    ctx.beginPath();
    ctx.moveTo(x + 1, y);
    ctx.lineTo(x + SWATCH - 1, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Legend in rows centered in `r` (or one item per row when `column`). */
function legend(ctx: Ctx, items: LegendItem[], r: Rect, th: SceneTheme, column = false) {
  ctx.font = `500 14px ${th.sans}`;
  const gap = 18;
  const rows: LegendItem[][] = [];
  let row: LegendItem[] = [];
  let w = 0;
  for (const it of items) {
    const iw = itemWidth(ctx, it);
    if (row.length && (column || w + gap + iw > r.w)) {
      rows.push(row);
      row = [];
      w = 0;
    }
    w += (row.length ? gap : 0) + iw;
    row.push(it);
  }
  if (row.length) rows.push(row);
  rows.forEach((rw, i) => {
    const total = rw.reduce((s, it, k) => s + itemWidth(ctx, it) + (k ? gap : 0), 0);
    let x = column ? r.x : r.x + (r.w - total) / 2;
    const y = r.y + 12 + i * 26;
    for (const it of rw) {
      drawSwatch(ctx, it, x, y);
      ctx.fillStyle = th.ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.label, x + SWATCH + 7, y + 0.5);
      x += itemWidth(ctx, it) + gap;
    }
  });
}

/** Rows a legend takes in `width`. */
function legendRows(ctx: Ctx, items: LegendItem[], width: number, th: SceneTheme, column = false) {
  if (column) return items.length;
  ctx.font = `500 14px ${th.sans}`;
  let rows = 1;
  let w = 0;
  for (const it of items) {
    const iw = itemWidth(ctx, it);
    if (w && w + 18 + iw > width) {
      rows++;
      w = iw;
    } else w += (w ? 18 : 0) + iw;
  }
  return rows;
}

function fitPanels(ctx: Ctx, st: ExportStatic, m: ExportMoment, area: Rect, pixelRatio: number) {
  const th = st.theme;
  const base = {
    ...st.scene,
    bands: st.show.regions ? st.scene.bands : [],
    regionLabels: st.show.regions ? st.labels.regions : null,
    handles: false,
    clear: false,
    glow: st.show.glow,
    pixelRatio,
  };
  const modelOf = (i: number) => {
    const x = m.models[i];
    return x ? [{ ys: x.ys, color: st.models[i].color, ...(x.band ? { band: x.band } : {}) }] : [];
  };
  const panels =
    st.layout === 'stacked'
      ? st.models.map((md, i) => ({
          models: modelOf(i),
          tag: `${md.name}: ${md.summary}`,
        }))
      : [{ models: st.models.flatMap((_, i) => modelOf(i)), tag: '' }];
  // Stacked plots go into columns when rows would get too short to read.
  const gap = 10;
  const maxRows = Math.max(1, Math.floor((area.h + gap) / (110 + gap)));
  const cols = Math.min(panels.length, Math.ceil(panels.length / maxRows));
  const rows = Math.ceil(panels.length / cols);
  const h = (area.h - gap * (rows - 1)) / rows;
  const w = (area.w - gap * (cols - 1)) / cols;
  panels.forEach((p, i) => {
    const r = {
      x: area.x + (i % cols) * (w + gap),
      y: area.y + Math.floor(i / cols) * (h + gap),
      w,
      h,
    };
    card(ctx, r, th);
    ctx.save();
    ctx.translate(r.x + 8, r.y + 6);
    drawFit(
      ctx,
      {
        ...base,
        width: r.w - 16,
        height: r.h - 10,
        models: p.models,
        compact: rows > 2 || cols > 1,
        ...(p.tag ? { tags: { right: p.tag } } : {}),
      },
      th,
    );
    ctx.restore();
  });
}

function lossPanel(ctx: Ctx, st: ExportStatic, m: ExportMoment, r: Rect) {
  card(ctx, r, st.theme);
  ctx.save();
  ctx.translate(r.x + 4, r.y + 4);
  drawLoss(
    ctx,
    {
      width: r.w - 8,
      height: r.h - 6,
      epochs: st.epochs,
      clear: false,
      series: m.loss.map((s, i) => ({ ...s, color: st.models[i].color })),
    },
    st.theme,
  );
  ctx.restore();
}

/** Title layouts depend only on the static part and the context's fonts: cache them. */
const titleCache = new WeakMap<ExportStatic, { title: TitleLayout; sub: TitleLayout }>();

function titles(ctx: Ctx, st: ExportStatic, maxW: number) {
  let c = titleCache.get(st);
  if (!c) {
    const th = st.theme;
    const big = wide(st.aspect) ? 30 : st.aspect === '9:16' ? 29 : 25;
    c = {
      title: layoutTitle(
        ctx,
        st.title,
        {
          size: big,
          weight: 700,
          mathScale: 1.12,
          family: th.sans,
          mono: th.mono,
          color: th.ink,
          align: wide(st.aspect) ? 'left' : 'center',
          lineGap: 6,
        },
        maxW,
      ),
      sub: layoutTitle(
        ctx,
        st.subtitle,
        {
          size: big * 0.56,
          weight: 500,
          mathScale: 1.1,
          family: th.sans,
          mono: th.mono,
          color: th.muted,
          align: wide(st.aspect) ? 'left' : 'center',
          lineGap: 4,
        },
        maxW,
      ),
    };
    titleCache.set(st, c);
  }
  return c;
}

function footer(ctx: Ctx, st: ExportStatic, x: number, y: number, align: CanvasTextAlign) {
  const text = [st.signature.trim(), st.show.credit ? st.labels.credit : '']
    .filter(Boolean)
    .join('  ·  ');
  if (!text) return;
  ctx.font = `500 13px ${st.theme.sans}`;
  ctx.fillStyle = st.theme.faint;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

const hasFooter = (st: ExportStatic) => st.show.credit || !!st.signature.trim();

/**
 * Draws one frame. `scale` maps scene pixels to canvas pixels (canvas width divided by
 * the format's scene width).
 */
export function drawExportFrame(ctx: Ctx, st: ExportStatic, m: ExportMoment, scale: number) {
  const { w: W, h: H } = ASPECTS[st.aspect];
  const th = st.theme;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  const epochText = `${st.labels.epoch} ${m.epoch}/${st.epochs}`;
  const boxLines =
    st.show.config && st.layout === 'overlay'
      ? st.models.map((md) => `${md.name}: ${md.summary}`)
      : [];
  const items = st.show.legend ? legendItems(st, m) : [];

  if (wide(st.aspect)) {
    const pad = 28;
    const side = 300;
    const left = W - pad * 2 - side - 20;
    const t = titles(ctx, st, left);
    let y = pad;
    t.title.draw(ctx, pad, y);
    y += t.title.height;
    if (t.sub.height) {
      y += 6;
      t.sub.draw(ctx, pad, y);
      y += t.sub.height;
    }
    y += 16;
    fitPanels(ctx, st, m, { x: pad, y, w: left, h: H - pad - y }, scale);
    const sx = W - pad - side;
    let sy = pad;
    if (st.show.epoch) {
      chip(ctx, epochText, sx, sy, th);
      sy += 42;
    }
    if (boxLines.length) {
      modelBox(ctx, boxLines, sx + side, sy, side, th);
      sy += boxHeight(boxLines.length) + 12;
    }
    const foot = hasFooter(st) ? 22 : 0;
    const legH = items.length ? legendRows(ctx, items, side, th, true) * 26 + 4 : 0;
    const lossH = st.show.loss ? Math.max(90, H - pad - foot - legH - sy - 12) : 0;
    if (st.show.loss) {
      lossPanel(ctx, st, m, { x: sx, y: sy, w: side, h: Math.min(lossH, 190) });
      sy += Math.min(lossH, 190) + 14;
    }
    if (items.length) legend(ctx, items, { x: sx + 4, y: sy, w: side, h: legH }, th, true);
    if (foot) footer(ctx, st, W - pad, H - pad + 6, 'right');
  } else {
    const pad = 24;
    const inner = W - pad * 2;
    const t = titles(ctx, st, inner - 8);
    let y = st.aspect === '9:16' ? 44 : 26;
    t.title.draw(ctx, pad + 4, y);
    y += t.title.height;
    if (t.sub.height) {
      y += 6;
      t.sub.draw(ctx, pad + 4, y);
      y += t.sub.height;
    }
    y += st.aspect === '9:16' ? 22 : 14;
    const chipsH = Math.max(
      st.show.epoch ? 30 : 0,
      boxLines.length ? boxHeight(boxLines.length) : 0,
    );
    if (st.show.epoch) chip(ctx, epochText, pad, y, th);
    if (boxLines.length) modelBox(ctx, boxLines, W - pad, y, inner * 0.62, th);
    if (chipsH) y += chipsH + 12;

    let bottom = H - (st.aspect === '9:16' ? 30 : 16);
    if (hasFooter(st)) {
      footer(ctx, st, W / 2, bottom, 'center');
      bottom -= 30;
    }
    if (items.length) {
      const rows = legendRows(ctx, items, inner, th);
      const legH = rows * 26;
      legend(ctx, items, { x: pad, y: bottom - legH, w: inner, h: legH }, th);
      bottom -= legH + 10;
    }
    if (st.show.loss) {
      const lossH = st.aspect === '9:16' ? 160 : st.aspect === '4:5' ? 118 : 92;
      lossPanel(ctx, st, m, { x: pad, y: bottom - lossH, w: inner, h: lossH });
      bottom -= lossH + 12;
    }
    fitPanels(ctx, st, m, { x: pad, y, w: inner, h: Math.max(80, bottom - y) }, scale);
  }
  ctx.restore();
}

/** Epoch shown at each video frame: `hold` frames at the end show the last epoch, and
 *  the race starts slowly (early epochs change the picture the most). */
export function timeline(endEpoch: number, frames: number, hold: number, ease = 1.7): number[] {
  const moving = Math.max(1, frames - hold);
  const out: number[] = [];
  for (let k = 0; k < frames; k++) {
    const u = moving === 1 ? 1 : Math.min(1, k / (moving - 1));
    out.push(Math.round(endEpoch * u ** ease));
  }
  return out;
}
