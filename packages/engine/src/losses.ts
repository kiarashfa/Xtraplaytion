// Losses (mean over points) and their gradients with respect to predictions.
import type { LossKind } from './config.ts';

/**
 * Returns the mean loss and writes dL/dp into `grad` (already divided by n).
 * Matches torch.nn.MSELoss / L1Loss / HuberLoss with reduction 'mean'.
 */
export function lossAndGrad(
  kind: LossKind,
  pred: Float64Array,
  y: Float64Array,
  n: number,
  grad: Float64Array,
  delta = 1,
): number {
  let sum = 0;
  const inv = 1 / n;
  for (let i = 0; i < n; i++) {
    const r = pred[i] - y[i];
    switch (kind) {
      case 'mse':
        sum += r * r;
        grad[i] = 2 * r * inv;
        break;
      case 'l1':
        sum += Math.abs(r);
        grad[i] = (r > 0 ? 1 : r < 0 ? -1 : 0) * inv;
        break;
      case 'huber': {
        const a = Math.abs(r);
        if (a < delta) {
          sum += 0.5 * r * r;
          grad[i] = r * inv;
        } else {
          sum += delta * (a - 0.5 * delta);
          grad[i] = (r > 0 ? delta : -delta) * inv;
        }
        break;
      }
    }
  }
  return sum * inv;
}

export function lossOnly(
  kind: LossKind,
  pred: Float64Array,
  y: Float64Array,
  n: number,
  delta = 1,
): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = pred[i] - y[i];
    if (kind === 'mse') sum += r * r;
    else if (kind === 'l1') sum += Math.abs(r);
    else {
      const a = Math.abs(r);
      sum += a < delta ? 0.5 * r * r : delta * (a - 0.5 * delta);
    }
  }
  return sum / n;
}
