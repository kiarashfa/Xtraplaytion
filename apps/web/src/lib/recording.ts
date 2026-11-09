// Recorded runs: the frames of a finished race, stored compactly so a device
// that cannot train it in reasonable time can still watch it.
//
// File = deflate-raw of:
//   "XPR1" | u32 header bytes | header JSON (UTF-8, padded to 4 bytes) | per model:
//     f32 trainLoss[epochs] | f32 valLoss[epochs] | u32 frameEpochs[frames] |
//     u16 grid[frames x gridSize], quantized to the model's [lo, hi] (65535 = no value)
//     and stored as differences from the previous frame (wrapping), which compress well.
import type { ExperimentState } from './share.ts';

export interface RecordedModel {
  trainLoss: Float32Array;
  valLoss: Float32Array;
  /** Epoch of each stored frame, increasing, starting at 0. */
  frameEpochs: Uint32Array;
  /** One grid prediction per stored frame. */
  grids: Float32Array[];
  diverged: boolean;
}

export interface Recording {
  /** trainingIdentity() of the state: a recording is used only for exactly this experiment. */
  key: string;
  state: ExperimentState;
  backend: 'webgpu' | 'cpu-f64';
  /** Graphics card the recording was made on. */
  adapter: string;
  created: string;
  gridSize: number;
  models: RecordedModel[];
}

interface Header {
  v: 1;
  key: string;
  state: ExperimentState;
  backend: Recording['backend'];
  adapter: string;
  created: string;
  gridSize: number;
  models: { epochs: number; frames: number; lo: number; hi: number; diverged: boolean }[];
}

const MAGIC = 0x31525058; // "XPR1" little-endian
const NONE = 65535;
const LEVELS = 65534;
/** Decoded size guard (a 6-model race at 600 frames is about 4 MB). */
const MAX_BYTES = 64 * 1024 * 1024;

export function encodeRecording(r: Recording): Uint8Array {
  const models = r.models.map((m) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const g of m.grids)
      for (const v of g)
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
    if (!(hi >= lo)) [lo, hi] = [0, 1];
    if (hi === lo) hi = lo + 1;
    return { m, lo, hi };
  });
  const header: Header = {
    v: 1,
    key: r.key,
    state: r.state,
    backend: r.backend,
    adapter: r.adapter,
    created: r.created,
    gridSize: r.gridSize,
    models: models.map(({ m, lo, hi }) => ({
      epochs: m.trainLoss.length,
      frames: m.grids.length,
      lo,
      hi,
      diverged: m.diverged,
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const hdr = Math.ceil(json.length / 4) * 4;
  let size = 8 + hdr;
  for (const { m } of models) {
    size += 8 * m.trainLoss.length + 4 * m.grids.length;
    size += Math.ceil((2 * m.grids.length * r.gridSize) / 4) * 4;
  }
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, json.length, true);
  new Uint8Array(buf, 8, json.length).set(json);
  let at = 8 + hdr;
  const f32 = (a: ArrayLike<number>) => {
    for (let i = 0; i < a.length; i++, at += 4) dv.setFloat32(at, a[i], true);
  };
  for (const { m, lo, hi } of models) {
    f32(m.trainLoss);
    f32(m.valLoss);
    for (const e of m.frameEpochs) {
      dv.setUint32(at, e, true);
      at += 4;
    }
    const prev = new Uint16Array(r.gridSize);
    const span = hi - lo;
    for (const g of m.grids) {
      for (let i = 0; i < r.gridSize; i++, at += 2) {
        const v = g[i];
        const q = Number.isFinite(v) ? Math.round(((v - lo) / span) * LEVELS) : NONE;
        dv.setUint16(at, (q - prev[i]) & 0xffff, true);
        prev[i] = q;
      }
    }
    at = Math.ceil(at / 4) * 4;
  }
  return new Uint8Array(buf);
}

export function decodeRecording(bytes: Uint8Array): Recording {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || dv.getUint32(0, true) !== MAGIC) throw new Error('not a recording');
  const len = dv.getUint32(4, true);
  if (8 + len > bytes.byteLength) throw new Error('truncated recording');
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as Header;
  if (h.v !== 1 || !Array.isArray(h.models)) throw new Error('unknown recording version');
  let at = 8 + Math.ceil(len / 4) * 4;
  const need = (n: number) => {
    if (at + n > bytes.byteLength) throw new Error('truncated recording');
  };
  const models: RecordedModel[] = h.models.map((mh) => {
    const f32 = (n: number) => {
      need(4 * n);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++, at += 4) out[i] = dv.getFloat32(at, true);
      return out;
    };
    const trainLoss = f32(mh.epochs);
    const valLoss = f32(mh.epochs);
    need(4 * mh.frames);
    const frameEpochs = new Uint32Array(mh.frames);
    for (let i = 0; i < mh.frames; i++, at += 4) frameEpochs[i] = dv.getUint32(at, true);
    need(2 * mh.frames * h.gridSize);
    const prev = new Uint16Array(h.gridSize);
    const step = (mh.hi - mh.lo) / LEVELS;
    const grids: Float32Array[] = [];
    for (let f = 0; f < mh.frames; f++) {
      const g = new Float32Array(h.gridSize);
      for (let i = 0; i < h.gridSize; i++, at += 2) {
        const q = (prev[i] + dv.getUint16(at, true)) & 0xffff;
        prev[i] = q;
        g[i] = q === NONE ? NaN : mh.lo + q * step;
      }
      grids.push(g);
    }
    at = Math.ceil(at / 4) * 4;
    return { trainLoss, valLoss, frameEpochs, grids, diverged: mh.diverged };
  });
  return {
    key: h.key,
    state: h.state,
    backend: h.backend,
    adapter: h.adapter,
    created: h.created,
    gridSize: h.gridSize,
    models,
  };
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit = Infinity,
) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('recording too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export const compressRecording = (r: Recording) =>
  pipe(encodeRecording(r), new CompressionStream('deflate-raw'));

export async function loadRecording(url: string): Promise<Recording> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`recording ${res.status}`);
  const raw = new Uint8Array(await res.arrayBuffer());
  return decodeRecording(await pipe(raw, new DecompressionStream('deflate-raw'), MAX_BYTES));
}

export const decompressRecording = async (raw: Uint8Array) =>
  decodeRecording(await pipe(raw, new DecompressionStream('deflate-raw'), MAX_BYTES));
