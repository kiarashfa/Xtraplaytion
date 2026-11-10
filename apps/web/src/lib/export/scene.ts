// Builds export frames from the playground: the race on screen (visible models, their
// stored frames and losses) as the static part plus one moment per epoch.

import { toLatex } from '@xtraplaytion/expr';
import type { MessageKey, Translate } from '../../i18n';
import { modelSummary } from '../describe.ts';
import { autoYDomain, type SceneTheme } from '../scene/draw.ts';
import { modelName, type ModelRun, type Playground } from '../playground.svelte.ts';
import type { Aspect, ExportMoment, ExportShow, ExportStatic } from './frame.ts';
import type { TitleBlock } from './title.ts';

/** Last epoch every shown model has reached (recordings: their end). */
export function endEpochOf(pg: Playground): number {
  const runs = pg.visibleRuns;
  if (!runs.length) return 0;
  if (pg.mode === 'recorded') return Math.max(...runs.map((r) => r.final));
  return Math.max(0, Math.min(...runs.map((r) => r.latest)));
}

/** "ReLU networks learn $\sin(x)$" and the like, from the experiment. */
export function defaultTitle(pg: Playground, t: Translate): string {
  const specs = pg.visibleRuns.map((r) => r.spec);
  let subject: string;
  const nets = specs.filter((s) => s.kind === 'mlp');
  if (specs.length && nets.length === specs.length) {
    const acts = [...new Set(nets.flatMap((n) => n.layers.map((l) => l.act)))];
    const act = acts.length === 1 ? t(`act.${acts[0]}` as MessageKey) : '';
    subject = act
      ? t(specs.length === 1 ? 'export.title.net' : 'export.title.nets', { act })
      : t(specs.length === 1 ? 'export.title.netAny' : 'export.title.netsAny');
  } else if (specs.length === 1 && specs[0].kind === 'classical') {
    subject = t(`export.title.${specs[0].config.kind}` as MessageKey);
  } else subject = t('export.title.models', { n: specs.length });
  const object =
    pg.targetKind === 'drawn'
      ? t('export.title.drawn')
      : pg.targetKind === 'points'
        ? t('export.title.points')
        : pg.parsed.ok
          ? `$${titleTex(toLatex(pg.parsed.expr))}$`
          : '';
  return object ? `${subject} ${object}` : subject;
}

/** Plain parentheses read better in a title, unless something tall sits inside them. */
export function titleTex(tex: string): string {
  if (/\\[dt]?frac|\\sqrt|\\sum|\\(?:left|right)\./.test(tex)) return tex;
  return tex.replace(/\\(?:left|right)(?=[()[\]|])/g, '');
}

export interface ExportChoices {
  aspect: Aspect;
  layout: 'overlay' | 'stacked';
  show: ExportShow;
  signature: string;
}

export function exportStatic(
  pg: Playground,
  c: ExportChoices,
  theme: SceneTheme,
  title: TitleBlock,
  subtitle: TitleBlock,
  t: Translate,
): ExportStatic | null {
  const d = pg.data;
  if (!d) return null;
  const runs = pg.visibleRuns;
  return {
    aspect: c.aspect,
    layout: runs.length > 1 ? c.layout : 'overlay',
    theme,
    title,
    subtitle,
    scene: {
      xDomain: [pg.domain[0], pg.domain[1]],
      yDomain: autoYDomain(d.clean, d.trainY, d.valY, d.test?.y ?? []),
      bands: pg.bands.map((b) => [b[0], b[1]] as [number, number]).sort((a, b) => a[0] - b[0]),
      trainX: d.trainX,
      trainY: d.trainY,
      valX: d.valX,
      valY: d.valY,
      gridX: d.gridX,
      truth: pg.targetKind === 'points' ? null : d.clean,
      ...(d.test ? { testX: d.test.x, testY: d.test.y } : {}),
      drawn: pg.targetKind === 'drawn',
    },
    models: runs.map((r) => ({
      name: modelName(r.spec),
      color: r.spec.color,
      summary: modelSummary(r.spec, t),
    })),
    epochs: pg.epochs,
    show: c.show,
    signature: c.signature,
    labels: {
      epoch: t('pg.run.epoch'),
      credit: t('export.credit'),
      data: t('pg.legend.data'),
      truth: t('pg.legend.truth'),
      drawing: t('pg.legend.drawing'),
      heldOut: t('pg.legend.heldOut'),
      band: t('pg.legend.band'),
      spread: t('pg.legend.spread'),
      regions: {
        train: t('pg.region.train'),
        gap: t('pg.region.gap'),
        beyond: t('pg.region.beyond'),
      },
    },
  };
}

/** The race at `epoch`, for the models in `runs` (same order as the static part). */
export function momentOf(runs: ModelRun[], epoch: number): ExportMoment {
  return {
    epoch,
    models: runs.map((r) => {
      const f = r.frameAt(epoch);
      if (!f) return null;
      return { ys: f.grid, ...(f.band ? { band: f.band, spread: r.copies > 1 } : {}) };
    }),
    loss: runs.map((r) => ({
      train: r.trainLoss.view().subarray(0, epoch),
      val: r.valLoss.view().subarray(0, epoch),
    })),
  };
}

/** True when the plot has regions without data worth showing (a gap or beyond). */
export function hasRegions(pg: Playground): boolean {
  const b = pg.bands.slice().sort((x, y) => x[0] - y[0]);
  if (!b.length) return false;
  if (b.length > 1) return true;
  return b[0][0] > pg.domain[0] + 1e-9 || b[0][1] < pg.domain[1] - 1e-9;
}
