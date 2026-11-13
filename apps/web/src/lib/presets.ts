// Ready-made experiments. Names and descriptions are i18n keys: preset.<id>.name / .hint
import type { Activation, ClassicalConfig, OptimizerKind } from '@xtraplaytion/engine';

/** A suggested competitor: a network, or a classical model. */
export type PresetModel =
  | {
      hidden: number[];
      act: Activation;
      lr?: number;
      seed?: number;
      l2?: number;
      /** Optimizer (default Adam). */
      opt?: OptimizerKind;
      /** Average of this many copies (different starting weights). */
      copies?: number;
    }
  | { model: ClassicalConfig; seed?: number };

export interface Preset {
  id: string;
  expr: string;
  domain: [number, number];
  n: number;
  sigma: number;
  bands: [number, number][];
  epochs: number;
  hidden: number[];
  act: Activation;
  lr: number;
  /** Suggested competitors (a race). Without it the preset trains one model. */
  models?: PresetModel[];
  layout?: 'overlay' | 'stacked';
  /** Ships a recorded run (src/recordings/<id>.xpr), played where live training would be slow. */
  recorded?: boolean;
  /** Made for a lesson: not listed among the playground's presets (its link still works). */
  unlisted?: boolean;
}

const p = (
  id: string,
  expr: string,
  domain: [number, number],
  rest: Partial<Preset> = {},
): Preset => ({
  id,
  expr,
  domain,
  n: 200,
  sigma: 0,
  bands: [],
  epochs: 1500,
  hidden: [32, 32],
  act: 'relu',
  lr: 3e-3,
  ...rest,
});

export const PRESETS: Preset[] = [
  // Races, after the reference animations.
  p('race-width', 'sin(x) + 0.5 sin(2x) + (1/3) sin(3x)', [-10, 10], {
    sigma: 0.03,
    epochs: 1600,
    models: [
      // Same starting seed for all three: only the width differs.
      { hidden: [10, 10], act: 'relu', seed: 1 },
      { hidden: [100, 100], act: 'relu', seed: 1 },
      { hidden: [1000, 1000], act: 'relu', seed: 1 },
    ],
    layout: 'stacked',
    recorded: true,
  }),
  // Similar parameter counts, different depth (769, 1,153 and 593 parameters).
  p('race-depth', 'sin(x) + 0.5 sin(2x) + (1/3) sin(3x)', [-10, 10], {
    sigma: 0.03,
    epochs: 1600,
    models: [
      { hidden: [256], act: 'relu', seed: 2 },
      { hidden: [32, 32], act: 'relu', seed: 2 },
      { hidden: [16, 16, 16], act: 'relu', seed: 2 },
    ],
    layout: 'stacked',
  }),
  p('race-activations', 'sin(3x)', [-3, 3], {
    bands: [
      [-3, -1],
      [1, 3],
    ],
    epochs: 3000,
    lr: 1e-2,
    models: [
      { hidden: [10, 10], act: 'relu' },
      { hidden: [10, 10], act: 'tanh' },
      { hidden: [10, 10], act: 'sin' },
    ],
    layout: 'stacked',
  }),
  p('race-shallow', 'sin(5x) + x', [-2, 2], {
    sigma: 0.15,
    n: 160,
    epochs: 3000,
    models: [
      { hidden: [81], act: 'relu' },
      { hidden: [161], act: 'relu' },
      { hidden: [362], act: 'relu' },
    ],
  }),
  p('race-noisy-parabola', 'x^2', [-3, 3], {
    sigma: 0.6,
    n: 120,
    bands: [[-2.5, 2.5]],
    epochs: 2500,
    models: [
      { hidden: [4], act: 'tanh' },
      { hidden: [32, 32], act: 'tanh' },
      { hidden: [128, 128, 128], act: 'relu' },
    ],
  }),
  // Classical models out of range: each family has its own way of guessing.
  p('classic-beyond', 'sin(x) + 0.3x', [-10, 10], {
    sigma: 0.05,
    n: 160,
    bands: [[-6, 3]],
    epochs: 1600,
    models: [
      { hidden: [64, 64], act: 'relu' },
      { model: { kind: 'poly', degree: 9 } },
      { model: { kind: 'fourier', harmonics: 8, period: 0 } },
      { model: { kind: 'spline', segments: 20, smoothing: 0.01 } },
      { model: { kind: 'tree', ensemble: 'forest', depth: 8, trees: 40, minLeaf: 2, lr: 0.1 } },
      {
        model: {
          kind: 'gp',
          kernel: [{ kind: 'rbf', scale: 1, length: 2, period: 5 }],
          noise: 0.1,
          tune: true,
        },
      },
    ],
    layout: 'stacked',
  }),
  p('classic-gap', 'sin(x) + 0.5 sin(2x) + (1/3) sin(3x)', [-10, 10], {
    sigma: 0.05,
    bands: [
      [-7.5, -2],
      [1.5, 6.5],
    ],
    epochs: 1600,
    models: [
      { hidden: [64, 64], act: 'relu' },
      { model: { kind: 'poly', degree: 15 } },
      { model: { kind: 'spline', segments: 24, smoothing: 0.01 } },
      { model: { kind: 'knn', k: 5, weights: 'uniform' } },
      {
        model: {
          kind: 'gp',
          kernel: [
            { kind: 'periodic', scale: 1, length: 1, period: 6 },
            { kind: 'rbf', scale: 0.3, length: 6, period: 6 },
          ],
          noise: 0.1,
          tune: true,
        },
      },
    ],
    layout: 'stacked',
  }),
  p('classic-runge', '1/(1+25x^2)', [-1.2, 1.2], {
    n: 21,
    bands: [[-1, 1]],
    epochs: 2000,
    models: [
      { hidden: [32, 32], act: 'tanh', lr: 1e-2 },
      { model: { kind: 'poly', degree: 20 } },
      { model: { kind: 'spline', segments: 12, smoothing: 0 } },
      {
        model: {
          kind: 'gp',
          kernel: [{ kind: 'rbf', scale: 1, length: 0.3, period: 1 }],
          noise: 0.01,
          tune: true,
        },
      },
    ],
  }),
  // Lesson 3: overfitting noisy data. Measured on the CPU over data seeds 7, 8 and 9:
  // degree 7 ends closest to the truth inside the data every time (degree 15 explodes
  // between the points), and the L2 penalty 1e-2 network beats 1e-3 and none every time.
  p('overfit-poly', 'sin(1.5x)', [-3, 3], {
    n: 24,
    sigma: 0.3,
    epochs: 400,
    models: [
      { model: { kind: 'poly', degree: 3 } },
      { model: { kind: 'poly', degree: 7 } },
      { model: { kind: 'poly', degree: 15 } },
    ],
    layout: 'stacked',
  }),
  p('overfit-net', 'sin(1.5x)', [-3, 3], {
    n: 30,
    sigma: 0.3,
    epochs: 2000,
    models: [
      // Same starting weights: only the penalty differs.
      { hidden: [64, 64], act: 'tanh', lr: 1e-2, seed: 1 },
      { hidden: [64, 64], act: 'tanh', lr: 1e-2, seed: 1, l2: 1e-3 },
      { hidden: [64, 64], act: 'tanh', lr: 1e-2, seed: 1, l2: 1e-2 },
    ],
    layout: 'stacked',
  }),
  // Lesson 5: one network, three learning rates; then three optimizers at the same rate.
  p('lr-sweep', 'sin(2x) + 0.5x', [-3, 3], {
    n: 120,
    sigma: 0.05,
    epochs: 1500,
    models: [
      { hidden: [32, 32], act: 'tanh', lr: 1e-4, seed: 1 },
      { hidden: [32, 32], act: 'tanh', lr: 1e-2, seed: 1 },
      { hidden: [32, 32], act: 'tanh', lr: 0.3, seed: 1 },
    ],
    layout: 'stacked',
  }),
  p('optimizers', 'sin(2x) + 0.5x', [-3, 3], {
    n: 120,
    sigma: 0.05,
    epochs: 1500,
    models: [
      { hidden: [32, 32], act: 'tanh', lr: 1e-2, seed: 1, opt: 'sgd' },
      { hidden: [32, 32], act: 'tanh', lr: 1e-2, seed: 1, opt: 'momentum' },
      { hidden: [32, 32], act: 'tanh', lr: 1e-2, seed: 1, opt: 'adam' },
    ],
    layout: 'stacked',
  }),
  // Lesson 6: the same network on three layouts of training data.
  p('layout-crowded', 'sin(1.5x) + 0.3x', [-6, 6], {
    n: 200,
    sigma: 0.05,
    bands: [[-2, 2]],
    hidden: [32, 32],
    act: 'tanh',
    lr: 1e-2,
    models: [{ hidden: [32, 32], act: 'tanh', lr: 1e-2, seed: 1 }],
  }),
  p('layout-clusters', 'sin(1.5x) + 0.3x', [-6, 6], {
    n: 24,
    sigma: 0.05,
    bands: [
      [-6, -4.5],
      [-0.75, 0.75],
      [4.5, 6],
    ],
    models: [{ hidden: [32, 32], act: 'tanh', lr: 1e-2, seed: 1 }],
  }),
  p('layout-spread', 'sin(1.5x) + 0.3x', [-6, 6], {
    n: 24,
    sigma: 0.05,
    bands: [[-6, 6]],
    models: [{ hidden: [32, 32], act: 'tanh', lr: 1e-2, seed: 1 }],
  }),
  // Lesson 7: one network, the average of five copies of it, a Gaussian process.
  p('ensemble', 'sin(x) + 0.3x', [-8, 8], {
    n: 60,
    sigma: 0.25,
    bands: [
      [-6, -1.5],
      [1.5, 6],
    ],
    epochs: 2000,
    models: [
      { hidden: [64, 64], act: 'relu', lr: 1e-2, seed: 1 },
      // Same seed: its first copy is N1 itself.
      { hidden: [64, 64], act: 'relu', lr: 1e-2, seed: 1, copies: 5 },
      {
        model: {
          kind: 'gp',
          kernel: [{ kind: 'rbf', scale: 1, length: 2, period: 5 }],
          noise: 0.1,
          tune: true,
        },
      },
    ],
    layout: 'stacked',
  }),
  // Lesson 8: the visitor draws the target; the models only see the middle.
  p('draw-challenge', 'abs(x)', [-6, 6], {
    n: 60,
    bands: [[-2.5, 2.5]],
    models: [
      { hidden: [32, 32], act: 'relu', lr: 1e-2, seed: 1 },
      { hidden: [32, 32], act: 'tanh', lr: 1e-2, seed: 1 },
      {
        model: {
          kind: 'gp',
          kernel: [{ kind: 'rbf', scale: 1, length: 2, period: 5 }],
          noise: 0.1,
          tune: true,
        },
      },
    ],
    layout: 'overlay',
    unlisted: true,
  }),
  p('waves', 'sin(x) + 0.5 sin(2x) + (1/3) sin(3x)', [-10, 10], {
    bands: [
      [-7.5, -2],
      [1.5, 6.5],
    ],
    sigma: 0.08,
    hidden: [64, 64],
    epochs: 1600,
  }),
  p('xsinx', 'x sin(x)', [-10, 10], { hidden: [10, 10], epochs: 2000 }),
  p('sine-gap', 'sin(3x)', [-3, 3], {
    bands: [
      [-3, -1],
      [1, 3],
    ],
    hidden: [10, 10],
    act: 'tanh',
    lr: 1e-2,
    epochs: 3000,
  }),
  p('bump', '1/(1+x^2)', [-3, 3], {
    sigma: 0.05,
    n: 100,
    hidden: [100, 100],
    act: 'sigmoid',
    epochs: 1500,
  }),
  p('runge', '1/(1+25x^2)', [-1, 1], { n: 60, hidden: [32, 32], act: 'tanh' }),
  p('sign', 'sign(sin(x))', [-10, 10], { hidden: [64, 64], epochs: 2000 }),
  p('square', 'x^2', [-3, 3], { bands: [[-2, 2]], sigma: 0.2, hidden: [16, 16] }),
  p('line-wave', 'sin(x) + x', [-6, 6], { bands: [[-4, 4]], sigma: 0.15, hidden: [64] }),
  p('cubic', 'x^3', [-2, 2], { bands: [[-1.2, 1.2]], hidden: [32, 32], act: 'tanh' }),
  p('abs', 'abs(x)', [-3, 3], { bands: [[-2, 2]], hidden: [8] }),
  p('sawtooth', 'mod(x, 2) - 1', [-6, 6], { hidden: [64, 64], epochs: 2500 }),
  p('step', 'step(x)', [-3, 3], { hidden: [16, 16] }),
  p('damped', 'exp(-x/4) cos(3x)', [0, 12], {
    bands: [[0, 8]],
    hidden: [64, 64],
    act: 'tanh',
    epochs: 2500,
  }),
  p('wavelet', 'exp(-x^2) cos(5x)', [-3, 3], { hidden: [64, 64], act: 'tanh', epochs: 2500 }),
  p('chirp', 'sin(x^2)', [-4, 4], { hidden: [64, 64], epochs: 3000 }),
  p('bumps', 'exp(-(x+2)^2) + 0.6 exp(-4(x-1)^2) - 0.4 exp(-2(x-3)^2)', [-5, 5], {
    sigma: 0.03,
    hidden: [32, 32],
    act: 'tanh',
  }),
];
