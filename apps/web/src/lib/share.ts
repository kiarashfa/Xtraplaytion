// Share links: the whole experiment, compressed into the URL fragment (#s=...).
// The fragment never reaches a server. Decoding validates everything and caps sizes.
import type { Activation, LossKind, MLPConfig, Noise, OptimizerKind } from '@xtraplaytion/engine';

export const STATE_VERSION = 1;
const MAX_DECODED = 64 * 1024;

export interface ExperimentState {
  v: 1;
  expr: string;
  domain: [number, number];
  n: number;
  noise: Noise;
  seed: number;
  valFraction: number;
  bands: [number, number][];
  model: MLPConfig;
  epochs: number;
}

export const LIMITS = { layers: 8, width: 1024, n: 5000, epochs: 100_000, exprLength: 1000 };

const ACTS: Activation[] = [
  'relu',
  'leaky_relu',
  'elu',
  'gelu',
  'silu',
  'softplus',
  'tanh',
  'sigmoid',
  'sin',
  'abs',
  'identity',
];
const OPTS: OptimizerKind[] = ['sgd', 'momentum', 'nesterov', 'rmsprop', 'adam', 'adamw'];
const LOSSES: LossKind[] = ['mse', 'l1', 'huber'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
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
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function encodeState(state: ExperimentState): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(state));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeState(text: string): Promise<ExperimentState | null> {
  try {
    const bytes = await pipe(
      fromBase64Url(text),
      new DecompressionStream('deflate-raw'),
      MAX_DECODED,
    );
    return validateState(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** Accepts only well-formed states; clamps sizes to the playground limits. */
export function validateState(o: unknown): ExperimentState | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  if (
    s['v'] !== STATE_VERSION ||
    typeof s['expr'] !== 'string' ||
    s['expr'].length > LIMITS.exprLength
  )
    return null;
  const dom = s['domain'];
  if (
    !Array.isArray(dom) ||
    dom.length !== 2 ||
    !isNum(dom[0]) ||
    !isNum(dom[1]) ||
    dom[0] >= dom[1]
  )
    return null;
  const domain: [number, number] = [dom[0], dom[1]];
  if (!isNum(s['n']) || !isNum(s['seed']) || !isNum(s['valFraction']) || !isNum(s['epochs']))
    return null;
  const bandsIn = s['bands'];
  if (!Array.isArray(bandsIn) || bandsIn.length > 8) return null;
  const bands: [number, number][] = [];
  for (const b of bandsIn) {
    if (!Array.isArray(b) || b.length !== 2 || !isNum(b[0]) || !isNum(b[1])) return null;
    const lo = clamp(Math.min(b[0], b[1]), domain[0], domain[1]);
    const hi = clamp(Math.max(b[0], b[1]), domain[0], domain[1]);
    if (hi > lo) bands.push([lo, hi]);
  }
  const noise = validNoise(s['noise']);
  const model = validModel(s['model']);
  if (!noise || !model) return null;
  return {
    v: 1,
    expr: s['expr'],
    domain,
    n: Math.round(clamp(s['n'], 2, LIMITS.n)),
    noise,
    seed: Math.round(clamp(s['seed'], 0, 2 ** 31 - 1)),
    valFraction: clamp(s['valFraction'], 0, 0.5),
    bands,
    model,
    epochs: Math.round(clamp(s['epochs'], 1, LIMITS.epochs)),
  };
}

function validNoise(o: unknown): Noise | null {
  if (!o || typeof o !== 'object') return null;
  const n = o as Record<string, unknown>;
  const pos = (k: string, max: number) => (isNum(n[k]) ? clamp(n[k], 0, max) : null);
  switch (n['kind']) {
    case 'none':
      return { kind: 'none' };
    case 'gaussian': {
      const sigma = pos('sigma', 100);
      return sigma === null ? null : { kind: 'gaussian', sigma };
    }
    case 'uniform': {
      const width = pos('width', 100);
      return width === null ? null : { kind: 'uniform', width };
    }
    case 'hetero': {
      const sigma = pos('sigma', 100);
      return sigma === null || (n['by'] !== 'f' && n['by'] !== 'x')
        ? null
        : { kind: 'hetero', sigma, by: n['by'] };
    }
    case 'outliers': {
      const sigma = pos('sigma', 100);
      const percent = pos('percent', 50);
      const magnitude = pos('magnitude', 1000);
      return sigma === null || percent === null || magnitude === null
        ? null
        : { kind: 'outliers', sigma, percent, magnitude };
    }
    default:
      return null;
  }
}

function validModel(o: unknown): MLPConfig | null {
  if (!o || typeof o !== 'object') return null;
  const m = o as Record<string, unknown>;
  const hidden = m['hidden'];
  const acts = m['activations'];
  if (m['kind'] !== 'mlp' || !Array.isArray(hidden) || !Array.isArray(acts)) return null;
  if (hidden.length < 1 || hidden.length > LIMITS.layers || acts.length !== hidden.length)
    return null;
  if (!hidden.every((w) => isNum(w) && w >= 1 && w <= LIMITS.width && Number.isInteger(w)))
    return null;
  if (!acts.every((a) => ACTS.includes(a as Activation))) return null;
  const opt = m['optimizer'] as Record<string, unknown> | undefined;
  if (
    !opt ||
    !OPTS.includes(opt['kind'] as OptimizerKind) ||
    !isNum(opt['lr']) ||
    opt['lr'] <= 0 ||
    opt['lr'] > 10
  )
    return null;
  const loss = m['loss'] as Record<string, unknown> | undefined;
  if (!loss || !LOSSES.includes(loss['kind'] as LossKind)) return null;
  return {
    kind: 'mlp',
    inDim: 1,
    hidden: hidden as number[],
    activations: acts as Activation[],
    init: { kind: 'torch_default' },
    optimizer: {
      kind: opt['kind'] as OptimizerKind,
      lr: opt['lr'],
      ...(isNum(opt['weightDecay']) ? { weightDecay: clamp(opt['weightDecay'], 0, 1) } : {}),
    },
    schedule: { kind: 'constant' },
    loss: {
      kind: loss['kind'] as LossKind,
      ...(isNum(loss['delta']) ? { delta: clamp(loss['delta'], 1e-6, 1e6) } : {}),
    },
    l1: isNum(m['l1']) ? clamp(m['l1'], 0, 10) : 0,
    l2: isNum(m['l2']) ? clamp(m['l2'], 0, 10) : 0,
    batch: { kind: 'full' },
    dropout: 0,
  };
}
