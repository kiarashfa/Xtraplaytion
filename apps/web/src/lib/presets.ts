// Ready-made experiments. Names and descriptions are i18n keys: preset.<id>.name / .hint
import type { Activation } from '@xtraplaytion/engine';

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
  models?: { hidden: number[]; act: Activation; lr?: number; seed?: number }[];
  layout?: 'overlay' | 'stacked';
  /** Ships a recorded run (src/recordings/<id>.xpr), played where live training would be slow. */
  recorded?: boolean;
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
