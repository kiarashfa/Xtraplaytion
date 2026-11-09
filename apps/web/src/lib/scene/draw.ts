// Canvas2D scene renderer shared by the playground, lessons and (later) video export.
// Works with any 2D context, including OffscreenCanvas in a worker. Coordinates are
// CSS pixels; the caller sets the device-pixel-ratio transform.

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SceneTheme {
  plotBg: string;
  grid: string;
  gridStrong: string;
  lineStrong: string;
  faint: string;
  muted: string;
  ink: string;
  surface: string;
  band: string;
  bandEdge: string;
  bandInk: string;
  interpBg: string;
  interpInk: string;
  extrapBg: string;
  extrapInk: string;
  target: string;
  truth: string;
  competitors: string[];
  mono: string;
  sans: string;
}

const VARS: Record<keyof Omit<SceneTheme, 'competitors' | 'mono' | 'sans'>, string> = {
  plotBg: '--xp-plot-bg',
  grid: '--xp-grid',
  gridStrong: '--xp-grid-strong',
  lineStrong: '--xp-line-strong',
  faint: '--xp-faint',
  muted: '--xp-muted',
  ink: '--xp-ink',
  surface: '--xp-surface',
  band: '--xp-band',
  bandEdge: '--xp-band-edge',
  bandInk: '--xp-band-ink',
  interpBg: '--xp-interp-bg',
  interpInk: '--xp-interp-ink',
  extrapBg: '--xp-extrap-bg',
  extrapInk: '--xp-extrap-ink',
  target: '--xp-target',
  truth: '--xp-truth',
};

/** Reads the current theme from CSS custom properties (main thread only). */
export function readTheme(el: Element = document.documentElement): SceneTheme {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const out = Object.fromEntries(Object.entries(VARS).map(([k, name]) => [k, v(name)])) as Omit<
    SceneTheme,
    'competitors' | 'mono' | 'sans'
  >;
  return {
    ...out,
    competitors: [1, 2, 3, 4, 5, 6].map((i) => v(`--xp-c${i}`)),
    mono: '"JetBrains Mono", ui-monospace, monospace',
    sans: '"Inter Variable", system-ui, sans-serif',
  };
}

export const DASHES: number[][] = [[], [9, 5], [2, 5], [12, 4, 2, 4], [16, 6], [6, 3, 2, 3, 2, 3]];

export function niceTicks(a: number, b: number, n = 6): number[] {
  const span = b - a;
  if (!(span > 0)) return [a];
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step)
    out.push(+v.toPrecision(12));
  return out;
}

export function fmtTick(v: number): string {
  if (Math.abs(v) < 1e-12) return '0';
  const s =
    Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3 ? v.toExponential(0) : String(+v.toPrecision(6));
  return s.replace('-', '−');
}

export interface Frame2D {
  x0: number;
  y0: number;
  w: number;
  h: number;
  xDomain: [number, number];
  yDomain: [number, number];
}

export const sx = (f: Frame2D, x: number) =>
  f.x0 + ((x - f.xDomain[0]) / (f.xDomain[1] - f.xDomain[0])) * f.w;
export const sy = (f: Frame2D, y: number) =>
  f.y0 + ((f.yDomain[1] - y) / (f.yDomain[1] - f.yDomain[0])) * f.h;
export const invX = (f: Frame2D, px: number) =>
  f.xDomain[0] + ((px - f.x0) / f.w) * (f.xDomain[1] - f.xDomain[0]);

export interface FitScene {
  width: number;
  height: number;
  xDomain: [number, number];
  yDomain: [number, number];
  bands: [number, number][];
  trainX: ArrayLike<number>;
  trainY: ArrayLike<number>;
  valX: ArrayLike<number>;
  valY: ArrayLike<number>;
  gridX: ArrayLike<number>;
  truth: ArrayLike<number> | null;
  models: { ys: ArrayLike<number>; color: number; label?: string }[];
  regionLabels: { train: string; gap: string; beyond: string } | null;
  handles: boolean;
  /** Highlighted band edge (dragging/hover): [band index, 0 = left, 1 = right] */
  activeEdge?: [number, number] | null;
  crosshairX?: number | null;
  tags?: { left?: string; right?: string };
  compact?: boolean;
}

export function fitLayout(s: FitScene): Frame2D {
  const fs = s.compact ? 10 : 11;
  const l = s.compact ? 30 : 42;
  const t = s.regionLabels && s.bands.length ? 24 : 10;
  const b = fs + 14;
  return {
    x0: l,
    y0: t,
    w: Math.max(10, s.width - l - 10),
    h: Math.max(10, s.height - t - b),
    xDomain: s.xDomain,
    yDomain: s.yDomain,
  };
}

/** Pick a y range that shows the data and the true function, with a margin. */
export function autoYDomain(...series: ArrayLike<number>[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (let i = 0; i < s.length; i++) {
      const v = s[i];
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  if (!Number.isFinite(lo)) return [-1, 1];
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const m = (hi - lo) * 0.18;
  return [lo - m, hi + m];
}

function polyline(ctx: Ctx, f: Frame2D, xs: ArrayLike<number>, ys: ArrayLike<number>) {
  const span = f.yDomain[1] - f.yDomain[0];
  const lo = f.yDomain[0] - 4 * span;
  const hi = f.yDomain[1] + 4 * span;
  let pen = false;
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (!Number.isFinite(y)) {
      pen = false;
      continue;
    }
    const px = sx(f, xs[i]);
    const py = sy(f, Math.min(hi, Math.max(lo, y)));
    if (pen) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
    pen = true;
  }
}

export function drawFit(ctx: Ctx, s: FitScene, th: SceneTheme): Frame2D {
  const f = fitLayout(s);
  const fs = s.compact ? 10 : 11;
  ctx.save();
  ctx.clearRect(0, 0, s.width, s.height);
  ctx.fillStyle = th.plotBg;
  ctx.fillRect(f.x0, f.y0, f.w, f.h);

  const bands = s.bands.slice().sort((a, b) => a[0] - b[0]);
  if (bands.length) {
    const lo = sx(f, bands[0][0]);
    const hi = sx(f, bands[bands.length - 1][1]);
    ctx.fillStyle = th.extrapBg;
    ctx.fillRect(f.x0, f.y0, lo - f.x0, f.h);
    ctx.fillRect(hi, f.y0, f.x0 + f.w - hi, f.h);
    ctx.fillStyle = th.interpBg;
    for (let i = 0; i + 1 < bands.length; i++)
      ctx.fillRect(sx(f, bands[i][1]), f.y0, sx(f, bands[i + 1][0]) - sx(f, bands[i][1]), f.h);
    ctx.fillStyle = th.band;
    for (const [a, b] of bands) ctx.fillRect(sx(f, a), f.y0, sx(f, b) - sx(f, a), f.h);
  }

  // grid
  const xt = niceTicks(f.xDomain[0], f.xDomain[1], s.compact ? 5 : 8);
  const yt = niceTicks(f.yDomain[0], f.yDomain[1], s.compact ? 4 : 5);
  ctx.lineWidth = 1;
  ctx.strokeStyle = th.grid;
  ctx.beginPath();
  for (const v of yt) {
    const y = Math.round(sy(f, v)) + 0.5;
    ctx.moveTo(f.x0, y);
    ctx.lineTo(f.x0 + f.w, y);
  }
  for (const v of xt) {
    const x = Math.round(sx(f, v)) + 0.5;
    ctx.moveTo(x, f.y0);
    ctx.lineTo(x, f.y0 + f.h);
  }
  ctx.stroke();
  if (f.yDomain[0] < 0 && f.yDomain[1] > 0) {
    ctx.strokeStyle = th.gridStrong;
    ctx.beginPath();
    const y = Math.round(sy(f, 0)) + 0.5;
    ctx.moveTo(f.x0, y);
    ctx.lineTo(f.x0 + f.w, y);
    ctx.stroke();
  }

  // band edges
  ctx.strokeStyle = th.bandEdge;
  ctx.lineWidth = 1.3;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  for (const [a, b] of bands) {
    for (const x of [a, b]) {
      const px = Math.round(sx(f, x)) + 0.5;
      ctx.moveTo(px, f.y0);
      ctx.lineTo(px, f.y0 + f.h);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.beginPath();
  ctx.rect(f.x0, f.y0, f.w, f.h);
  ctx.clip();

  if (s.truth) {
    ctx.strokeStyle = th.truth;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.setLineDash([1.5, 4]);
    polyline(ctx, f, s.gridX, s.truth);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const r = s.compact ? 2 : 2.6;
  ctx.fillStyle = th.target;
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < s.trainX.length; i++) {
    ctx.beginPath();
    ctx.arc(sx(f, s.trainX[i]), sy(f, s.trainY[i]), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = th.target;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < s.valX.length; i++) {
    ctx.beginPath();
    ctx.arc(sx(f, s.valX[i]), sy(f, s.valY[i]), r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const m of s.models) {
    const color = th.competitors[(m.color - 1) % th.competitors.length];
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // soft glow
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = color;
    ctx.lineWidth = s.compact ? 5 : 7;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    polyline(ctx, f, s.gridX, m.ys);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = s.compact ? 2.2 : 2.6;
    ctx.setLineDash(DASHES[(m.color - 1) % DASHES.length]);
    polyline(ctx, f, s.gridX, m.ys);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (s.crosshairX != null) {
    ctx.strokeStyle = th.ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x = Math.round(sx(f, s.crosshairX)) + 0.5;
    ctx.moveTo(x, f.y0);
    ctx.lineTo(x, f.y0 + f.h);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore(); // clip

  // frame and ticks
  ctx.strokeStyle = th.lineStrong;
  ctx.lineWidth = 1;
  ctx.strokeRect(f.x0 + 0.5, f.y0 + 0.5, f.w - 1, f.h - 1);
  ctx.fillStyle = th.faint;
  ctx.font = `${fs}px ${th.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of xt) ctx.fillText(fmtTick(v), sx(f, v), f.y0 + f.h + 6);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of yt) ctx.fillText(fmtTick(v), f.x0 - 6, sy(f, v));

  // region labels (only where they fit)
  if (s.regionLabels && bands.length) {
    ctx.font = `600 ${fs - 1}px ${th.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const label = (a: number, b: number, text: string, color: string) => {
      if (b - a < ctx.measureText(text).width + 10) return;
      ctx.fillStyle = color;
      ctx.fillText(text, (a + b) / 2, f.y0 - 9);
    };
    const lo = sx(f, bands[0][0]);
    const hi = sx(f, bands[bands.length - 1][1]);
    label(f.x0, lo, s.regionLabels.beyond, th.extrapInk);
    label(hi, f.x0 + f.w, s.regionLabels.beyond, th.extrapInk);
    for (const [a, b] of bands) label(sx(f, a), sx(f, b), s.regionLabels.train, th.bandInk);
    for (let i = 0; i + 1 < bands.length; i++)
      label(sx(f, bands[i][1]), sx(f, bands[i + 1][0]), s.regionLabels.gap, th.interpInk);
  }

  if (s.handles) {
    bands.forEach(([a, b], bi) => {
      [a, b].forEach((x, side) => {
        const px = sx(f, x);
        const py = f.y0 + f.h - 18;
        const active = s.activeEdge && s.activeEdge[0] === bi && s.activeEdge[1] === side;
        ctx.fillStyle = active ? th.bandEdge : th.surface;
        ctx.strokeStyle = th.bandEdge;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.roundRect(px - 7, py - 13, 14, 26, 5);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = active ? th.surface : th.bandEdge;
        ctx.beginPath();
        ctx.moveTo(px - 2, py - 6);
        ctx.lineTo(px - 2, py + 6);
        ctx.moveTo(px + 2, py - 6);
        ctx.lineTo(px + 2, py + 6);
        ctx.stroke();
      });
    });
  }

  if (s.tags?.left || s.tags?.right) {
    ctx.font = `500 ${fs}px ${th.mono}`;
    ctx.textBaseline = 'middle';
    const tag = (text: string, x: number, right: boolean) => {
      const w = ctx.measureText(text).width + 14;
      const left = right ? x - w : x;
      ctx.fillStyle = th.surface;
      ctx.strokeStyle = th.lineStrong;
      ctx.beginPath();
      ctx.roundRect(left, f.y0 + 8, w, fs + 11, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = th.ink;
      ctx.textAlign = 'left';
      ctx.fillText(text, left + 7, f.y0 + 8 + (fs + 11) / 2);
    };
    if (s.tags.left) tag(s.tags.left, f.x0 + 8, false);
    if (s.tags.right) tag(s.tags.right, f.x0 + f.w - 8, true);
  }
  ctx.restore();
  return f;
}

export interface LossScene {
  width: number;
  height: number;
  epochs: number;
  series: { train: ArrayLike<number>; val?: ArrayLike<number>; color: number }[];
  compact?: boolean;
}

export function drawLoss(ctx: Ctx, s: LossScene, th: SceneTheme) {
  ctx.save();
  ctx.clearRect(0, 0, s.width, s.height);
  const pad = s.compact ? { l: 4, r: 6, t: 4, b: 4 } : { l: 48, r: 12, t: 10, b: 24 };
  const w = s.width - pad.l - pad.r;
  const h = s.height - pad.t - pad.b;
  let lo = Infinity;
  let hi = -Infinity;
  for (const se of s.series) {
    for (const arr of [se.train, se.val ?? []]) {
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v > 0 && Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
  }
  if (!Number.isFinite(lo)) {
    lo = 1e-3;
    hi = 1;
  }
  const l0 = Math.floor(Math.log10(lo));
  const l1 = Math.max(l0 + 1, Math.ceil(Math.log10(hi)));
  const total = Math.max(1, s.epochs);
  const X = (e: number) => pad.l + (e / total) * w;
  const Y = (v: number) => pad.t + ((l1 - Math.log10(Math.max(v, 10 ** l0))) / (l1 - l0)) * h;
  ctx.fillStyle = th.plotBg;
  ctx.fillRect(pad.l, pad.t, w, h);
  if (!s.compact) {
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = th.faint;
    ctx.font = `11px ${th.mono}`;
    ctx.beginPath();
    for (let k = l0; k <= l1; k++) {
      const y = Math.round(Y(10 ** k)) + 0.5;
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
    }
    const xt = niceTicks(0, total, 5);
    for (const e of xt) {
      const x = Math.round(X(e)) + 0.5;
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + h);
    }
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const step = Math.max(1, Math.ceil((l1 - l0) / 5));
    for (let k = l0; k <= l1; k += step)
      ctx.fillText(`1e${k}`.replace('-', '−'), pad.l - 6, Y(10 ** k));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const e of xt) ctx.fillText(fmtTick(e), X(e), pad.t + h + 6);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.l, pad.t, w, h);
  ctx.clip();
  // Draw at most ~2 points per pixel column.
  const line = (arr: ArrayLike<number>) => {
    const n = arr.length;
    const stride = Math.max(1, Math.floor(n / (w * 2)));
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < n; i += stride) {
      const v = arr[i];
      if (!(v > 0) || !Number.isFinite(v)) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(X(i + 1), Y(v));
      else ctx.moveTo(X(i + 1), Y(v));
      pen = true;
    }
    ctx.stroke();
  };
  for (const se of s.series) {
    const color = th.competitors[(se.color - 1) % th.competitors.length];
    ctx.strokeStyle = color;
    if (se.val && se.val.length) {
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([3, 3]);
      line(se.val);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = s.compact ? 1.8 : 2;
    line(se.train);
    const n = se.train.length;
    if (n && Number.isFinite(se.train[n - 1])) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(X(n), Y(se.train[n - 1]), s.compact ? 2.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  if (!s.compact) {
    ctx.strokeStyle = th.lineStrong;
    ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, w - 1, h - 1);
  }
  ctx.restore();
}
