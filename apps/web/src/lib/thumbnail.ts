// Library thumbnails: the fit plot as it is on screen, drawn small with the scene renderer.
import type { Playground } from './playground.svelte.ts';
import { autoYDomain, drawFit, readTheme } from './scene/draw.ts';

const W = 400;
const H = 225;

export async function thumbnail(pg: Playground): Promise<Blob | null> {
  const d = pg.data;
  if (!d || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  const theme = readTheme();
  ctx.fillStyle = theme.surface;
  ctx.fillRect(0, 0, W, H);
  const models = pg.visibleRuns.flatMap((run) => {
    const f = run.frameAt(pg.viewEpoch);
    return f ? [{ ys: f.grid, color: run.spec.color, ...(f.band ? { band: f.band } : {}) }] : [];
  });
  drawFit(
    ctx,
    {
      width: W,
      height: H,
      xDomain: pg.domain,
      yDomain: autoYDomain(d.clean, d.trainY, d.valY, d.test?.y ?? []),
      bands: pg.bands,
      trainX: d.trainX,
      trainY: d.trainY,
      valX: d.valX,
      valY: d.valY,
      gridX: d.gridX,
      truth: d.clean,
      ...(d.test ? { testX: d.test.x, testY: d.test.y } : {}),
      drawn: pg.targetKind === 'drawn',
      models,
      regionLabels: null,
      handles: false,
      compact: true,
    },
    theme,
  );
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
