// Tiny final frames of the gallery races: per model the grid prediction (and GP band),
// quantized to u16 over its own range and stored as base64. A few KB per experiment,
// drawn in the visitor's theme with the same renderer as the playground.

export interface ThumbModel {
  lo: number;
  hi: number;
  grid: string;
  band?: { lo: number; hi: number; data: string };
}

export interface ThumbFile {
  gridSize: number;
  /** Per preset id: trainingIdentity() it was made for, and its models. */
  items: Record<string, { key: string; models: ThumbModel[] }>;
}

const NONE = 65535;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function packValues(v: ArrayLike<number>): { lo: number; hi: number; data: string } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < v.length; i++)
    if (Number.isFinite(v[i])) {
      lo = Math.min(lo, v[i]);
      hi = Math.max(hi, v[i]);
    }
  if (!Number.isFinite(lo)) lo = hi = 0;
  const span = hi - lo || 1;
  const q = new Uint16Array(v.length);
  for (let i = 0; i < v.length; i++)
    q[i] = Number.isFinite(v[i]) ? Math.round(((v[i] - lo) / span) * (NONE - 1)) : NONE;
  return { lo, hi, data: toBase64(new Uint8Array(q.buffer)) };
}

export function unpackValues(p: { lo: number; hi: number; data: string }): Float32Array {
  const b = fromBase64(p.data);
  const q = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  const span = p.hi - p.lo || 1;
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++)
    out[i] = q[i] === NONE ? NaN : p.lo + (q[i] / (NONE - 1)) * span;
  return out;
}
