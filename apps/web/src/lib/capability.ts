// First-run speed check: how much training work this device does per second.
// One unit = one parameter x one training point x one epoch. Cached per browser
// (a convenience only: without storage it is simply measured again).
import { buildDataset, mlp, paramCountOf, type Activation } from '@xtraplaytion/engine';
import { Trainer } from './trainer.ts';

const KEY = 'xp-speed-v1';
const TRANSCENDENTAL: ReadonlySet<Activation> = new Set([
  'tanh',
  'sigmoid',
  'sin',
  'gelu',
  'silu',
  'softplus',
  'elu',
]);

/** A conservative fallback (a mid-range phone) used until the measurement is in. */
export const FALLBACK_SPEED = 2e8;

export function cachedSpeed(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function measureSpeed(): Promise<number> {
  const cached = cachedSpeed();
  if (cached) return Promise.resolve(cached);
  const config = mlp({ hidden: [64, 64] });
  const n = 200;
  const epochs = 400;
  const data = buildDataset((x) => Math.sin(x), {
    domain: [-3, 3],
    n,
    bands: [],
    noise: { kind: 'none' },
    valFraction: 0,
    seed: 1,
    gridSize: 2,
  });
  return new Promise((resolve) => {
    let t0 = 0;
    const finish = (speed: number) => {
      clearTimeout(timer);
      tr.dispose();
      try {
        localStorage.setItem(KEY, String(Math.round(speed)));
      } catch {
        // storage unavailable: measure again next time
      }
      resolve(speed);
    };
    const tr = new Trainer({
      frame: (f) => {
        if (f.epoch === 0) {
          t0 = performance.now(); // worker is loaded; start timing now
          tr.play();
        }
      },
      done: () => {
        const sec = Math.max(1e-3, (performance.now() - t0) / 1000);
        finish((paramCountOf(config) * n * epochs) / sec);
      },
      error: () => finish(FALLBACK_SPEED),
    });
    const timer = setTimeout(() => finish(FALLBACK_SPEED), 15000);
    tr.start({ config, data, seed: 1, epochs, epochsPerFrame: epochs });
  });
}

/** Estimated seconds to train a model on this device. */
export function estimateSeconds(
  params: number,
  points: number,
  epochs: number,
  acts: Activation[],
  speed: number,
): number {
  const slow = acts.some((a) => TRANSCENDENTAL.has(a)) ? 1.9 : 1;
  return ((params * Math.max(1, points) * epochs) / speed) * slow;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '-';
  if (sec < 1) return '< 1 s';
  if (sec < 90) return `${Math.round(sec)} s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}
