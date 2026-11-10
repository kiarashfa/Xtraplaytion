// Classical model families behind one factory.
import type { ClassicalConfig } from '../config.ts';
import { gpFitter } from './gp.ts';
import { knnFitter } from './knn.ts';
import { fourierFitter, polyFitter } from './poly.ts';
import { splineFitter } from './spline.ts';
import type { Fitter } from './staged.ts';
import { treeFitter } from './tree.ts';

export function makeFitter(
  c: ClassicalConfig,
  x: Float64Array,
  y: Float64Array,
  seed: number,
): Fitter {
  switch (c.kind) {
    case 'poly':
      return polyFitter(c, x, y);
    case 'fourier':
      return fourierFitter(c, x, y);
    case 'spline':
      return splineFitter(c, x, y);
    case 'knn':
      return knnFitter(c, x, y);
    case 'tree':
      return treeFitter(c, x, y, seed);
    case 'gp':
      return gpFitter(c, x, y, seed);
  }
}

export { BUILD_SHARE, StagedRun, type Fitter, type Stage, type StageInfo } from './staged.ts';
export { GP_MAX_POINTS, GP_TUNE_POINTS, gpEvidence, usesLength, usesPeriod } from './gp.ts';
export { MAX_K } from './knn.ts';
export { fourierPeriod, MAX_DEGREE, MAX_HARMONICS } from './poly.ts';
export { MAX_SEGMENTS } from './spline.ts';
export { MAX_DEPTH, MAX_TREES } from './tree.ts';
