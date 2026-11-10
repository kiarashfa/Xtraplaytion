// An experiment as plain data: dataset construction and identity, shared by the
// playground, presets and the recorded-run generator (no Svelte, no DOM).
import {
  buildDataset,
  datasetFromPoints,
  mlp,
  type Dataset,
  type Noise,
} from '@xtraplaytion/engine';
import { compile, parse } from '@xtraplaytion/expr';
import type { Preset } from './presets.ts';
import { LIMITS, STATE_VERSION, type ExperimentState } from './share.ts';
import { drawnFunction, type DataSource } from './source.ts';

/** Points on the evaluation grid (plots, metrics, recordings). */
export const GRID_SIZE = 512;

export interface DataInputs {
  domain: [number, number];
  n: number;
  noise: Noise;
  seed: number;
  valFraction: number;
  bands: [number, number][];
}

export function datasetFor(fn: (x: number) => number, d: DataInputs): Dataset | null {
  const [a, b] = d.domain;
  if (!(b > a)) return null;
  return buildDataset(fn, {
    domain: [a, b],
    n: Math.max(2, Math.min(LIMITS.n, Math.round(d.n))),
    bands: d.bands,
    noise: d.noise,
    valFraction: d.valFraction,
    seed: d.seed,
    gridSize: GRID_SIZE,
  });
}

/** Dataset of imported points (the noise and point count do not apply). */
export function datasetForPoints(
  src: { xs: number[]; ys: number[] },
  d: Pick<DataInputs, 'domain' | 'bands' | 'valFraction' | 'seed'>,
): Dataset | null {
  const [a, b] = d.domain;
  if (!(b > a)) return null;
  return datasetFromPoints(src.xs, src.ys, {
    domain: [a, b],
    bands: d.bands,
    valFraction: d.valFraction,
    seed: d.seed,
    gridSize: GRID_SIZE,
  });
}

/** Dataset of any target: formula, drawing or imported points. */
export function datasetFrom(
  expr: string,
  source: DataSource | undefined | null,
  d: DataInputs,
): Dataset | null {
  if (source?.kind === 'points') return datasetForPoints(source, d);
  if (source?.kind === 'drawn') return datasetFor(drawnFunction(source), d);
  const parsed = parse(expr);
  return parsed.ok ? datasetFor(compile(parsed.expr), d) : null;
}

export function datasetOf(s: ExperimentState): Dataset | null {
  return datasetFrom(s.expr, s.source, s);
}

/** Default data seed and validation share of the playground. */
export const DEFAULT_SEED = 7;
export const DEFAULT_VAL = 0.2;

/** The experiment a preset describes (model i gets weight seed i + 1). */
export function presetState(p: Preset): ExperimentState {
  const list: NonNullable<Preset['models']> = p.models ?? [
    { hidden: p.hidden, act: p.act, lr: p.lr },
  ];
  return {
    v: STATE_VERSION,
    expr: p.expr,
    domain: [...p.domain],
    n: p.n,
    noise: p.sigma > 0 ? { kind: 'gaussian', sigma: p.sigma } : { kind: 'none' },
    seed: DEFAULT_SEED,
    valFraction: DEFAULT_VAL,
    bands: p.bands.map((b) => [...b] as [number, number]),
    models: list.map((m, i) => ({
      model:
        'model' in m
          ? m.model
          : mlp({
              hidden: m.hidden,
              activations: m.hidden.map(() => m.act),
              optimizer: { kind: 'adam', lr: m.lr ?? p.lr },
              loss: { kind: 'mse' },
            }),
      seed: m.seed ?? i + 1,
      visible: true,
    })),
    epochs: p.epochs,
    layout: p.layout ?? (list.length > 1 ? 'stacked' : 'overlay'),
  };
}

/** Identity of what gets trained: equal keys give the same runs (layout, visibility and
 *  backend choice do not matter). */
export function trainingIdentity(s: ExperimentState): string {
  return JSON.stringify([
    s.expr,
    s.domain,
    s.n,
    s.noise,
    s.seed,
    s.valFraction,
    s.bands,
    s.epochs,
    // A copy count is appended only when there is one, so older keys stay the same.
    s.models.map((m) => (m.copies ? [m.model, m.seed, m.copies] : [m.model, m.seed])),
    // Appended only when present, so formula experiments keep their identity.
    ...(s.source ? [s.source] : []),
  ]);
}
