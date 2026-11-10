// Short plain-language descriptions of models, shared by the model list and exports.
import type { MessageKey, Translate } from '../i18n';
import { kernelChoice } from './models.ts';
import { dimsLabel, type ModelSpec } from './playground.svelte.ts';

/** One line about a model's settings ("[1, 64, 64, 1] · ReLU", "degree 9"). */
export function modelSummary(m: ModelSpec, t: Translate): string {
  if (m.kind === 'mlp')
    return `${dimsLabel(m)} · ${activationsLabel(m, t)}${m.l2 ? ` · L2 ${m.l2.toExponential(0)}` : ''}`;
  const c = m.config;
  switch (c.kind) {
    case 'poly':
      return t('pg.sum.poly', { n: c.degree });
    case 'fourier':
      return t('pg.sum.fourier', { n: c.harmonics });
    case 'spline':
      return t('pg.sum.spline', { n: c.segments });
    case 'knn':
      return t('pg.sum.knn', { n: c.k });
    case 'tree':
      return c.ensemble === 'single'
        ? t('pg.sum.tree.single', { n: c.depth })
        : t(`pg.sum.tree.${c.ensemble}`, { n: c.trees });
    case 'gp':
      return `${t(`kernel.${kernelChoice(c.kernel)}` as MessageKey)} · ${t(
        c.tune ? 'pg.sum.gp.tune' : 'pg.sum.gp.fixed',
      )}`;
  }
}

/** Activation names of a network, in layer order without repeats ("ReLU", "tanh / sin"). */
export function activationsLabel(m: ModelSpec, t: Translate): string {
  if (m.kind !== 'mlp') return '';
  const acts = [...new Set(m.layers.map((l) => l.act))];
  return acts.map((a) => t(`act.${a}` as MessageKey)).join(' / ');
}
