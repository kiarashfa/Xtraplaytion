// Input and output scaling for networks (used for imported data with large numbers).
// The network trains on x' = (x - xShift) * xScale and y' = (y - yShift) * yScale; the
// host maps its predictions and losses back, so everything outside sees original units.
import type { LossKind, Scaling } from './config.ts';
import type { Dataset } from './data.ts';

export function scaleData(d: Dataset, s: Scaling): Dataset {
  const fx = (a: Float64Array) => a.map((x) => (x - s.xShift) * s.xScale);
  const fy = (a: Float64Array) => a.map((y) => (y - s.yShift) * s.yScale);
  return {
    ...d,
    trainX: fx(d.trainX),
    trainY: fy(d.trainY),
    valX: fx(d.valX),
    valY: fy(d.valY),
    gridX: fx(d.gridX),
    clean: fy(d.clean),
    ...(d.test ? { test: { x: fx(d.test.x), y: fy(d.test.y), region: d.test.region } } : {}),
  };
}

/** Grid predictions back in original units (in place). */
export function unscaleGrid(grid: Float32Array, s: Scaling): Float32Array {
  for (let i = 0; i < grid.length; i++) grid[i] = grid[i] / s.yScale + s.yShift;
  return grid;
}

/** A data loss back in original units. MSE and Huber divide by yScale^2 (Huber then equals
 *  Huber in original units with delta / yScale), L1 by yScale. */
export function unscaleLoss(v: number, s: Scaling, loss: LossKind): number {
  return loss === 'l1' ? v / s.yScale : v / (s.yScale * s.yScale);
}
