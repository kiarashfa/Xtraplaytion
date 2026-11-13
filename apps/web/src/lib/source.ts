// Targets that are not formulas: a drawn curve (acts as the true function) or imported
// points (no true function; held-out points score the gaps and beyond). Also the CSV and
// pasted-text reader. Pure (no Svelte, no DOM).

/** A drawing: values at evenly spaced knots from x0 to x1, joined by straight lines.
 *  Outside [x0, x1] the target is unknown. */
export interface DrawnSource {
  kind: 'drawn';
  x0: number;
  x1: number;
  ys: number[];
}

/** Imported points (CSV, pasted text). */
export interface PointsSource {
  kind: 'points';
  xs: number[];
  ys: number[];
}

export type DataSource = DrawnSource | PointsSource;

export const MAX_KNOTS = 401;
export const MAX_POINTS = 5000;
/** Largest text accepted from a file or the clipboard. */
export const MAX_TEXT = 5 * 1024 * 1024;

/** The drawn curve as a function (NaN outside the drawing). */
export function drawnFunction(d: DrawnSource): (x: number) => number {
  const { x0, x1, ys } = d;
  const k = ys.length - 1;
  return (x) => {
    if (!(x >= x0 && x <= x1) || k < 1) return NaN;
    const t = ((x - x0) / (x1 - x0)) * k;
    const i = Math.min(k - 1, Math.floor(t));
    const f = t - i;
    return ys[i] + f * (ys[i + 1] - ys[i]);
  };
}

/** Rounds values to a thousandth of their spread (finer than a pixel), so drawings stay short
 *  in links. The rounded values are the drawing (nothing else is stored). */
export function quantize(ys: number[]): number[] {
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || Math.abs(hi) || 1;
  const digits = Math.max(0, 3 - Math.floor(Math.log10(span)));
  const p = 10 ** Math.min(12, digits);
  return ys.map((y) => Math.round(y * p) / p);
}

/** Light smoothing for shaky strokes (moving average, ends kept). */
export function smooth(ys: number[], radius = 2): number[] {
  return ys.map((_, i) => {
    if (i === 0 || i === ys.length - 1) return ys[i];
    const r = Math.min(radius, i, ys.length - 1 - i);
    let s = 0;
    for (let k = -r; k <= r; k++) s += ys[i + k];
    return s / (2 * r + 1);
  });
}

/** Lattice for a new drawing over a plot range: 257 knots. */
export function latticeFor(domain: [number, number]): { origin: number; step: number } {
  return { origin: domain[0], step: (domain[1] - domain[0]) / 256 };
}

/** Lattice of an existing drawing (new strokes extend it on the same knots). */
export function latticeOf(d: DrawnSource): { origin: number; step: number } {
  return { origin: d.x0, step: (d.x1 - d.x0) / (d.ys.length - 1) };
}

/** Merges a stroke into a drawing: where the stroke goes it replaces the drawing (the
 *  latest pass wins when it goes back and forth), the rest stays, and a hole between the
 *  old drawing and the stroke is bridged with a straight line. Knots sit on the lattice
 *  origin + k * step. Returns the old drawing when the stroke adds nothing usable. */
export function drawStroke(
  old: DrawnSource | null,
  samples: { x: number; y: number }[],
  lattice: { origin: number; step: number },
): DrawnSource | null {
  const { origin, step } = lattice;
  const pts = samples.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length || !(step > 0)) return old;
  const pos = (x: number) => (x - origin) / step;
  const vals = new Map<number, number>();
  const oldAt = old ? Math.round(pos(old.x0)) : 0;
  if (old) old.ys.forEach((y, i) => vals.set(oldAt + i, y));
  for (let s = 0; s < pts.length; s++) {
    const p = pts[s];
    const q = pts[s - 1] ?? p;
    const a = pos(q.x);
    const b = pos(p.x);
    const lo = Math.ceil(Math.min(a, b));
    const hi = Math.floor(Math.max(a, b));
    for (let k = lo; k <= hi; k++) {
      const t = b === a ? 1 : (k - a) / (b - a);
      vals.set(k, q.y + t * (p.y - q.y));
    }
    if (lo > hi) vals.set(Math.round(b), p.y); // a tap between two knots
  }
  const keys = [...vals.keys()].sort((m, n) => m - n);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (last - first < 1 || last - first + 1 > MAX_KNOTS) return old;
  const ys: number[] = [];
  let prev = first;
  let prevY = vals.get(first) ?? 0;
  for (let k = first; k <= last; k++) {
    const v = vals.get(k);
    if (v !== undefined) {
      ys.push(v);
      prev = k;
      prevY = v;
      continue;
    }
    const next = keys.find((i) => i > k) ?? last;
    const nextY = vals.get(next) ?? prevY;
    ys.push(prevY + ((k - prev) / (next - prev)) * (nextY - prevY));
  }
  return {
    kind: 'drawn',
    x0: +(origin + first * step).toPrecision(12),
    x1: +(origin + last * step).toPrecision(12),
    ys: quantize(ys),
  };
}

// ------------------------------------------------------------------ tables

export type TableError = 'empty' | 'tooBig' | 'noNumbers';

export interface Table {
  columns: string[];
  /** Numeric cells (NaN where a cell is not a number). */
  rows: number[][];
  header: boolean;
  delimiter: string;
}

const DELIMS = [',', ';', '\t', '|'];
/** Byte order mark at the start of some exported files. */
const BOM = new RegExp('^' + String.fromCharCode(0xfeff));

function splitLine(line: string, d: string): string[] {
  if (d === ' ') return line.trim().split(/\s+/);
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === d && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Reads a number from a cell. With a delimiter other than the comma, a decimal comma is
 *  accepted (1,5). Unicode minus is accepted. */
function cellNumber(s: string, decimalComma: boolean): number {
  let t = s.trim().replace(/^"|"$/g, '').replace('−', '-');
  if (decimalComma) t = t.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN; // 1e400 overflows to Infinity: not a usable number
}

/** Parses CSV, TSV or whitespace-separated text. Sniffs the delimiter, detects a header row,
 *  skips blank and comment (#) lines. */
export function parseTable(text: string): Table | TableError {
  if (text.length > MAX_TEXT) return 'tooBig';
  const lines = text
    .replace(BOM, '')
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() && !l.trimStart().startsWith('#'));
  if (!lines.length) return 'empty';
  const sample = lines.slice(0, 50);
  // The delimiter that splits the sample into the most consistent number of columns.
  let delimiter = ' ';
  let best = 1;
  for (const d of DELIMS) {
    const counts = sample.map((l) => splitLine(l, d).length);
    const common = counts.filter((c) => c === counts[counts.length - 1]).length;
    const cols = counts[counts.length - 1];
    if (cols > 1 && common >= sample.length * 0.8 && cols >= best) {
      if (cols > best || delimiter === ' ') {
        delimiter = d;
        best = cols;
      }
    }
  }
  const decimalComma = delimiter !== ',';
  const cells = lines.map((l) => splitLine(l, delimiter));
  const numeric = (row: string[]) => row.map((c) => cellNumber(c, decimalComma));
  const firstNums = numeric(cells[0]);
  const header = firstNums.some((v) => Number.isNaN(v)) && cells[0].some((c) => /[a-z]/i.test(c));
  const width = Math.max(...cells.slice(header ? 1 : 0, 50).map((r) => r.length), 1);
  const columns = Array.from(
    { length: width },
    (_, i) => (header ? cells[0][i] : '') || `${i + 1}`,
  );
  const rows = cells.slice(header ? 1 : 0).map((r) => {
    const nums = numeric(r);
    return Array.from({ length: width }, (_, i) => nums[i] ?? NaN);
  });
  const usable = rows.filter((r) => r.some((v) => Number.isFinite(v))).length;
  if (usable < 2) return 'noNumbers';
  return { columns, rows, header, delimiter };
}

export interface ImportResult {
  xs: number[];
  ys: number[];
  /** Rows without two numbers in the chosen columns. */
  dropped: number;
  /** Rows before thinning out to the point limit (0 if not thinned). */
  thinnedFrom: number;
}

/** Picks the x and y columns (x = -1 means the row number). Thins out evenly above the
 *  point limit. */
export function pointsFrom(table: Table, xCol: number, yCol: number): ImportResult | null {
  const xs: number[] = [];
  const ys: number[] = [];
  let dropped = 0;
  table.rows.forEach((r, i) => {
    const x = xCol < 0 ? i : r[xCol];
    const y = r[yCol];
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    } else dropped++;
  });
  if (xs.length < 2) return null;
  let thinnedFrom = 0;
  if (xs.length > MAX_POINTS) {
    thinnedFrom = xs.length;
    const keep = Array.from({ length: MAX_POINTS }, (_, i) =>
      Math.round((i * (xs.length - 1)) / (MAX_POINTS - 1)),
    );
    return {
      xs: keep.map((i) => xs[i]),
      ys: keep.map((i) => ys[i]),
      dropped,
      thinnedFrom,
    };
  }
  return { xs, ys, dropped, thinnedFrom };
}

/** Default columns: the first two numeric columns (or row number + the only one). */
export function defaultColumns(table: Table): [number, number] {
  const numericCols = table.columns
    .map((_, c) => c)
    .filter((c) => table.rows.filter((r) => Number.isFinite(r[c])).length >= 2);
  if (numericCols.length >= 2) return [numericCols[0], numericCols[1]];
  return [-1, numericCols[0] ?? 0];
}

/** Plot range and a first training range for imported points: train on the first 70%,
 *  so the rest scores how well each model continues the data. */
export function pointsLayout(xs: number[]): {
  domain: [number, number];
  bands: [number, number][];
} {
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (!(hi > lo)) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  const nice = (v: number) => +v.toPrecision(4);
  return {
    domain: [nice(lo - 0.05 * span), nice(hi + 0.05 * span)],
    bands: [[nice(lo), nice(lo + 0.7 * span)]],
  };
}

// --------------------------------------------------------------- validation

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const BIG = 1e12;

/** Accepts a well-formed source from a link or a file. */
export function validSource(o: unknown): DataSource | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  const nums = (v: unknown, min: number, max: number): number[] | null =>
    Array.isArray(v) &&
    v.length >= min &&
    v.length <= max &&
    v.every((n) => isNum(n) && Math.abs(n) <= BIG)
      ? (v as number[])
      : null;
  if (s['kind'] === 'drawn') {
    const ys = nums(s['ys'], 2, MAX_KNOTS);
    const x0 = s['x0'];
    const x1 = s['x1'];
    if (!ys || !isNum(x0) || !isNum(x1) || !(x1 > x0) || Math.abs(x0) > BIG || Math.abs(x1) > BIG)
      return null;
    return { kind: 'drawn', x0, x1, ys: [...ys] };
  }
  if (s['kind'] === 'points') {
    const xs = nums(s['xs'], 2, MAX_POINTS);
    const ys = nums(s['ys'], 2, MAX_POINTS);
    if (!xs || !ys || xs.length !== ys.length) return null;
    return { kind: 'points', xs: [...xs], ys: [...ys] };
  }
  return null;
}
