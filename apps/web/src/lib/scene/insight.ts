// Canvas2D drawers for the insight views (same theme and conventions as draw.ts).
import { fmtTick, niceTicks, sx, sy, type Ctx, type Frame2D, type SceneTheme } from './draw.ts';

const pad = (l = 40, r = 12, t = 8, b = 22) => ({ l, r, t, b });
type Pad = ReturnType<typeof pad>;

function frameOf(
  w: number,
  h: number,
  xDomain: [number, number],
  yDomain: [number, number],
  p: Pad,
): Frame2D {
  return {
    x0: p.l,
    y0: p.t,
    w: Math.max(10, w - p.l - p.r),
    h: Math.max(10, h - p.t - p.b),
    xDomain,
    yDomain,
  };
}

const color = (th: SceneTheme, c: number) => th.competitors[(c - 1) % th.competitors.length];

function base(ctx: Ctx, f: Frame2D, width: number, height: number, th: SceneTheme) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = th.plotBg;
  ctx.fillRect(f.x0, f.y0, f.w, f.h);
}

function grid(
  ctx: Ctx,
  f: Frame2D,
  th: SceneTheme,
  xt: number[],
  yt: number[],
  fy: (v: number) => string = fmtTick,
  fx: (v: number) => string = fmtTick,
  lines = true,
) {
  ctx.strokeStyle = th.grid;
  ctx.lineWidth = 1;
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
  if (lines) ctx.stroke();
  ctx.fillStyle = th.faint;
  ctx.font = `10.5px ${th.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of xt) ctx.fillText(fx(v), sx(f, v), f.y0 + f.h + 5);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of yt) ctx.fillText(fy(v), f.x0 - 5, sy(f, v));
}

function frameBox(ctx: Ctx, f: Frame2D, th: SceneTheme) {
  ctx.strokeStyle = th.lineStrong;
  ctx.lineWidth = 1;
  ctx.strokeRect(f.x0 + 0.5, f.y0 + 0.5, f.w - 1, f.h - 1);
}

function clip(ctx: Ctx, f: Frame2D) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.x0, f.y0, f.w, f.h);
  ctx.clip();
}

function regions(ctx: Ctx, f: Frame2D, bands: [number, number][], th: SceneTheme) {
  const b = bands.slice().sort((p, q) => p[0] - q[0]);
  if (!b.length) return;
  const lo = sx(f, b[0][0]);
  const hi = sx(f, b[b.length - 1][1]);
  ctx.fillStyle = th.extrapBg;
  ctx.fillRect(f.x0, f.y0, lo - f.x0, f.h);
  ctx.fillRect(hi, f.y0, f.x0 + f.w - hi, f.h);
  ctx.fillStyle = th.interpBg;
  for (let i = 0; i + 1 < b.length; i++)
    ctx.fillRect(sx(f, b[i][1]), f.y0, sx(f, b[i + 1][0]) - sx(f, b[i][1]), f.h);
  ctx.fillStyle = th.band;
  for (const [a, c] of b) ctx.fillRect(sx(f, a), f.y0, sx(f, c) - sx(f, a), f.h);
  ctx.strokeStyle = th.bandEdge;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (const [a, c] of b)
    for (const x of [a, c]) {
      const px = Math.round(sx(f, x)) + 0.5;
      ctx.moveTo(px, f.y0);
      ctx.lineTo(px, f.y0 + f.h);
    }
  ctx.stroke();
  ctx.setLineDash([]);
}

function line(ctx: Ctx, f: Frame2D, xs: ArrayLike<number>, ys: ArrayLike<number>) {
  const span = f.yDomain[1] - f.yDomain[0];
  const lo = f.yDomain[0] - 4 * span;
  const hi = f.yDomain[1] + 4 * span;
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    const v = ys[i];
    if (!Number.isFinite(v)) {
      pen = false;
      continue;
    }
    const px = sx(f, xs[i]);
    const py = sy(f, Math.min(hi, Math.max(lo, v)));
    if (pen) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
    pen = true;
  }
}

export interface CurveScene {
  width: number;
  height: number;
  xDomain: [number, number];
  yDomain: [number, number];
  bands: [number, number][];
  gridX: ArrayLike<number>;
  color: number;
  compact?: boolean;
}

/** Neurons: one thin line per large contribution, the others together, and their sum. */
export function drawNeurons(
  ctx: Ctx,
  s: CurveScene & { parts: ArrayLike<number>[]; rest: ArrayLike<number>; sum: ArrayLike<number> },
  th: SceneTheme,
) {
  const f = frameOf(s.width, s.height, s.xDomain, s.yDomain, pad(s.compact ? 30 : 40));
  ctx.save();
  base(ctx, f, s.width, s.height, th);
  regions(ctx, f, s.bands, th);
  grid(ctx, f, th, niceTicks(...s.xDomain, s.compact ? 5 : 8), niceTicks(...s.yDomain, 4));
  clip(ctx, f);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = th.faint;
  ctx.lineWidth = 1.3;
  ctx.setLineDash([4, 3]);
  line(ctx, f, s.gridX, s.rest);
  ctx.stroke();
  ctx.setLineDash([]);
  const c = color(th, s.color);
  s.parts.forEach((ys, i) => {
    ctx.strokeStyle = c;
    ctx.globalAlpha = Math.max(0.3, 0.95 - i * 0.08);
    ctx.lineWidth = 1.5;
    line(ctx, f, s.gridX, ys);
    ctx.stroke();
  });
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 2.4;
  line(ctx, f, s.gridX, s.sum);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
  frameBox(ctx, f, th);
  ctx.restore();
}

/** A model's curve with a line and a mark at every kink. */
export function drawKinks(
  ctx: Ctx,
  s: CurveScene & { ys: ArrayLike<number>; kinks: ArrayLike<number> },
  th: SceneTheme,
) {
  const f = frameOf(s.width, s.height, s.xDomain, s.yDomain, pad(s.compact ? 30 : 40));
  ctx.save();
  base(ctx, f, s.width, s.height, th);
  regions(ctx, f, s.bands, th);
  grid(ctx, f, th, niceTicks(...s.xDomain, s.compact ? 5 : 8), niceTicks(...s.yDomain, 4));
  clip(ctx, f);
  const c = color(th, s.color);
  ctx.strokeStyle = c;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < s.kinks.length; i++) {
    const x = Math.round(sx(f, s.kinks[i])) + 0.5;
    ctx.moveTo(x, f.y0);
    ctx.lineTo(x, f.y0 + f.h);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  kinkMarks(ctx, f, s.kinks, c);
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  line(ctx, f, s.gridX, s.ys);
  ctx.stroke();
  ctx.restore();
  frameBox(ctx, f, th);
  ctx.restore();
}

/** Small triangles along the bottom of a plot at each kink (also used on the fit plot). */
export function kinkMarks(ctx: Ctx, f: Frame2D, xs: ArrayLike<number>, fill: string) {
  ctx.fillStyle = fill;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  const y = f.y0 + f.h;
  for (let i = 0; i < xs.length; i++) {
    const x = sx(f, xs[i]);
    if (x < f.x0 || x > f.x0 + f.w) continue;
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x - 3.2, y);
    ctx.lineTo(x + 3.2, y);
    ctx.closePath();
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

export interface SeriesScene {
  width: number;
  height: number;
  /** x of every point (epochs). */
  xs: ArrayLike<number>;
  xMax: number;
  series: { ys: ArrayLike<number>; dash: number[] }[];
  /** Log scale on y (values must be positive). */
  log?: boolean;
  color?: number;
}

/** Line chart over training (kinks during training, gradient sizes). */
export function drawSeries(ctx: Ctx, s: SeriesScene, th: SceneTheme) {
  let lo = Infinity;
  let hi = -Infinity;
  const tr = (v: number) => (s.log ? Math.log10(v) : v);
  for (const se of s.series)
    for (let i = 0; i < se.ys.length; i++) {
      const v = se.ys[i];
      if (!Number.isFinite(v) || (s.log && !(v > 0))) continue;
      lo = Math.min(lo, tr(v));
      hi = Math.max(hi, tr(v));
    }
  if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
  if (s.log) [lo, hi] = [Math.floor(lo), Math.max(Math.floor(lo) + 1, Math.ceil(hi))];
  else if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
  else {
    const m = (hi - lo) * 0.12;
    [lo, hi] = [Math.max(0, lo - m), hi + m];
  }
  const f = frameOf(s.width, s.height, [0, Math.max(1, s.xMax)], [lo, hi], pad(40, 14, 6, 20));
  ctx.save();
  base(ctx, f, s.width, s.height, th);
  const yt = s.log
    ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter(
        (_, i, a) => a.length <= 5 || i % Math.ceil(a.length / 5) === 0,
      )
    : niceTicks(lo, hi, 3);
  grid(
    ctx,
    f,
    th,
    niceTicks(0, Math.max(1, s.xMax), 4),
    yt,
    s.log ? (v) => `1e${v}`.replace('-', '−') : fmtTick,
  );
  clip(ctx, f);
  ctx.strokeStyle = s.color ? color(th, s.color) : th.ink;
  ctx.globalAlpha = s.color ? 1 : 0.8;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  for (const se of s.series) {
    ctx.setLineDash(se.dash);
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < s.xs.length; i++) {
      const v = se.ys[i];
      if (!Number.isFinite(v) || (s.log && !(v > 0))) {
        pen = false;
        continue;
      }
      const px = sx(f, s.xs[i]);
      const py = sy(f, tr(v));
      if (pen) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
      pen = true;
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
  frameBox(ctx, f, th);
  ctx.restore();
}

/** Waves of the target (grey area) and still missing (model color), by k. */
export function drawWaveBars(
  ctx: Ctx,
  s: {
    width: number;
    height: number;
    ks: ArrayLike<number>;
    truth: ArrayLike<number>;
    now: ArrayLike<number> | null;
    color: number;
  },
  th: SceneTheme,
) {
  const kmax = s.ks[s.ks.length - 1] ?? 1;
  let amax = 0;
  for (let i = 0; i < s.truth.length; i++) amax = Math.max(amax, s.truth[i]);
  if (s.now)
    for (let i = 0; i < s.now.length; i++) amax = Math.max(amax, Math.min(s.now[i], 3 * amax));
  amax = (amax || 1) * 1.08;
  const f = frameOf(s.width, s.height, [0, kmax], [0, amax], pad(40, 14, 6, 20));
  ctx.save();
  base(ctx, f, s.width, s.height, th);
  grid(ctx, f, th, niceTicks(0, kmax, 8), niceTicks(0, amax, 2));
  clip(ctx, f);
  const area = (ys: ArrayLike<number>) => {
    ctx.beginPath();
    ctx.moveTo(sx(f, s.ks[0]), sy(f, 0));
    for (let i = 0; i < s.ks.length; i++)
      ctx.lineTo(sx(f, s.ks[i]), sy(f, Math.min(ys[i], amax * 2)));
    ctx.lineTo(sx(f, kmax), sy(f, 0));
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = th.truth;
  ctx.globalAlpha = 0.3;
  area(s.truth);
  if (s.now) {
    ctx.fillStyle = color(th, s.color);
    ctx.globalAlpha = 0.75;
    area(s.now);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  frameBox(ctx, f, th);
  ctx.restore();
}

/** Still missing during training: epochs across, k up, stronger color = more missing. */
export function drawWaveHeat(
  ctx: Ctx,
  s: {
    width: number;
    height: number;
    ks: ArrayLike<number>;
    epochs: ArrayLike<number>;
    rows: ArrayLike<number>[];
    vmax: number;
    xMax: number;
    /** Epoch shown (a marker line). */
    at: number;
    color: number;
  },
  th: SceneTheme,
) {
  const kmax = s.ks[s.ks.length - 1] ?? 1;
  const f = frameOf(s.width, s.height, [0, Math.max(1, s.xMax)], [0, kmax], pad(40, 14, 6, 20));
  ctx.save();
  base(ctx, f, s.width, s.height, th);
  clip(ctx, f);
  ctx.fillStyle = color(th, s.color);
  const n = s.rows.length;
  const dk = s.ks.length > 1 ? s.ks[1] - s.ks[0] : kmax;
  for (let c = 0; c < n; c++) {
    const x0 = Math.round(sx(f, s.epochs[c]));
    const x1 = Math.round(
      c + 1 < n ? sx(f, s.epochs[c + 1]) : Math.min(f.x0 + f.w, x0 + Math.max(2, f.w / n)),
    );
    if (x1 <= x0) continue;
    const row = s.rows[c];
    for (let q = 0; q < s.ks.length; q++) {
      const v = Math.min(1, row[q] / s.vmax);
      if (!(v > 0.01)) continue;
      ctx.globalAlpha = v;
      const y0 = Math.round(sy(f, s.ks[q] + dk / 2));
      const y1 = Math.round(sy(f, s.ks[q] - dk / 2));
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  grid(ctx, f, th, niceTicks(0, Math.max(1, s.xMax), 4), niceTicks(0, kmax, 4));
  ctx.strokeStyle = th.ink;
  ctx.globalAlpha = 0.6;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  const ax = Math.round(sx(f, Math.min(s.at, s.xMax))) + 0.5;
  ctx.moveTo(ax, f.y0);
  ctx.lineTo(ax, f.y0 + f.h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  frameBox(ctx, f, th);
  ctx.restore();
}

/** Histogram of a layer's weights over [-limit, limit]. */
export function drawHistogram(
  ctx: Ctx,
  s: { width: number; height: number; counts: ArrayLike<number>; limit: number; color: number },
  th: SceneTheme,
) {
  let cmax = 1;
  for (let i = 0; i < s.counts.length; i++) cmax = Math.max(cmax, s.counts[i]);
  const f = frameOf(s.width, s.height, [-s.limit, s.limit], [0, cmax], pad(14, 14, 6, 20));
  ctx.save();
  base(ctx, f, s.width, s.height, th);
  const t = +s.limit.toPrecision(2);
  grid(ctx, f, th, [-t, 0, t], []);
  ctx.fillStyle = color(th, s.color);
  ctx.globalAlpha = 0.8;
  const bw = f.w / s.counts.length;
  for (let i = 0; i < s.counts.length; i++) {
    const c = s.counts[i];
    if (!c) continue;
    const y = sy(f, c);
    ctx.fillRect(f.x0 + i * bw + 0.5, y, Math.max(1, bw - 1), f.y0 + f.h - y);
  }
  ctx.globalAlpha = 1;
  frameBox(ctx, f, th);
  ctx.restore();
}

/** Loss map: log loss on a res x res grid, stronger color = lower; ring at the centre. */
export function drawLossMap(
  ctx: Ctx,
  s: { width: number; height: number; values: ArrayLike<number>; res: number; color: number },
  th: SceneTheme,
) {
  const size = Math.min(s.width - 46, s.height - 26);
  const f = frameOf(size + 46, size + 26, [-1, 1], [-1, 1], pad(36, 10, 4, 22));
  ctx.save();
  ctx.clearRect(0, 0, s.width, s.height);
  ctx.fillStyle = th.plotBg;
  ctx.fillRect(f.x0, f.y0, f.w, f.h);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < s.values.length; i++) {
    const v = s.values[i];
    if (v > 0 && Number.isFinite(v)) {
      lo = Math.min(lo, Math.log10(v));
      hi = Math.max(hi, Math.log10(v));
    }
  }
  const span = Math.max(1e-9, hi - lo);
  const cs = f.w / s.res;
  ctx.fillStyle = color(th, s.color);
  for (let k = 0; k < s.values.length; k++) {
    const v = s.values[k];
    const t = v > 0 && Number.isFinite(v) ? (Math.log10(v) - lo) / span : 1;
    ctx.globalAlpha = (1 - t) ** 1.6;
    const i = k % s.res;
    const j = s.res - 1 - Math.floor(k / s.res);
    // Whole-pixel cells that touch without overlapping (overlaps would show as seams).
    const x0 = Math.round(f.x0 + i * cs);
    const y0 = Math.round(f.y0 + j * cs);
    ctx.fillRect(
      x0,
      y0,
      Math.round(f.x0 + (i + 1) * cs) - x0,
      Math.round(f.y0 + (j + 1) * cs) - y0,
    );
  }
  ctx.globalAlpha = 1;
  grid(ctx, f, th, [-1, 0, 1], [-1, 0, 1], fmtTick, fmtTick, false);
  ctx.fillStyle = th.surface;
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx(f, 0), sy(f, 0), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  frameBox(ctx, f, th);
  ctx.restore();
}
