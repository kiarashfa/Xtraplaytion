<script lang="ts">
  import { useTranslations } from '../../i18n';
  import { modelName, type ModelRun, type Playground } from '../../lib/playground.svelte.ts';
  import {
    autoYDomain,
    drawFit,
    fitLayout,
    PlotLayers,
    invX,
    invY,
    sx,
    type FitScene,
    type SceneTheme,
  } from '../../lib/scene/draw.ts';
  import type { Dataset } from '@xtraplaytion/engine';
  import { drawStroke, latticeFor, latticeOf } from '../../lib/source.ts';
  import { prepare, watchSize, watchTheme } from './canvas.ts';
  import { FramePaint } from './paint.svelte.ts';
  import { COLOR_CLASS } from './Swatch.svelte';

  const {
    pg,
    runs,
    compact = false,
    short = false,
    tag,
    fixed = false,
    drawing = false,
  }: {
    pg: Playground;
    /** The models drawn in this plot (all visible ones, or one when stacked). */
    runs: ModelRun[];
    compact?: boolean;
    short?: boolean;
    tag?: string;
    /** No draggable range edges (lessons). */
    fixed?: boolean;
    /** Strokes on the plot draw the target (the Draw tab is open). */
    drawing?: boolean;
  } = $props();
  const t = useTranslations();

  let canvas = $state<HTMLCanvasElement>();
  let theme = $state.raw<SceneTheme | null>(null);
  let size = $state(0); // bumps on resize
  let drag = $state<{ bands: [number, number][]; edge: [number, number] } | null>(null);
  let hoverX = $state<number | null>(null);
  let stroke = $state<{ x: number; y: number }[] | null>(null);

  const bands = $derived(drag ? drag.bands : pg.bands.slice().sort((a, b) => a[0] - b[0]));
  const yDomain = $derived(
    drawing && pg.drawY
      ? pg.drawY
      : pg.data
        ? autoYDomain(pg.data.clean, pg.data.trainY, pg.data.valY, pg.data.test?.y ?? [])
        : ([-1, 1] as [number, number]),
  );

  // Every model is shown at the same epoch (the shared clock, or the replay position).
  const shown = $derived(
    runs.flatMap((run) => {
      const frame = run.frameAt(pg.viewEpoch);
      return frame ? [{ run, frame }] : [];
    }),
  );

  const EMPTY = new Float64Array(0);
  // An empty canvas to draw on before anything is drawn.
  const emptyData: Pick<
    Dataset,
    'trainX' | 'trainY' | 'valX' | 'valY' | 'gridX' | 'clean' | 'test'
  > = {
    trainX: EMPTY,
    trainY: EMPTY,
    valX: EMPTY,
    valY: EMPTY,
    gridX: EMPTY,
    clean: EMPTY,
  };
  const layers = new PlotLayers();
  function scene(w: number, h: number): FitScene | null {
    const d = pg.data ?? (drawing ? emptyData : null);
    if (!d) return null;
    return {
      width: w,
      height: h,
      xDomain: pg.domain,
      yDomain,
      bands,
      trainX: d.trainX,
      trainY: d.trainY,
      valX: d.valX,
      valY: d.valY,
      gridX: d.gridX,
      truth: d.clean,
      ...(d.test ? { testX: d.test.x, testY: d.test.y } : {}),
      drawn: drawing,
      ...(stroke ? { stroke } : {}),
      models: shown.map(({ run, frame }) => ({
        ys: frame.grid,
        color: run.spec.color,
        ...(frame.band ? { band: frame.band } : {}),
        ...(pg.kinkMarks && pg.kinkMarks.id === run.spec.id ? { kinks: pg.kinkMarks.xs } : {}),
      })),
      regionLabels: {
        train: t('pg.region.train'),
        gap: t('pg.region.gap'),
        beyond: t('pg.region.beyond'),
      },
      handles: !fixed,
      activeEdge: drag?.edge ?? null,
      crosshairX: hoverX,
      compact,
      layers,
      ...(tag ? { tags: { left: tag } } : {}),
    };
  }

  $effect(() => {
    if (!canvas) return;
    const offTheme = watchTheme((th) => (theme = th));
    const offSize = watchSize(canvas, () => size++);
    return () => {
      offTheme();
      offSize();
    };
  });

  const paint = new FramePaint();
  $effect(() => () => paint.dispose());
  $effect(() => {
    void size;
    if (!canvas || !theme || !paint.ready()) return;
    const { ctx, w, h } = prepare(canvas);
    const s = scene(w, h);
    if (ctx && s) drawFit(ctx, s, theme);
  });

  // ---- band edge dragging (keyboard users edit the ranges in the side panel)
  function hit(e: PointerEvent): [number, number] | null {
    if (!canvas) return null;
    const s = scene(canvas.clientWidth, canvas.clientHeight);
    if (!s) return null;
    const f = fitLayout(s);
    const px = e.offsetX;
    let best: [number, number] | null = null;
    let dist = 12;
    bands.forEach(([a, b], i) => {
      [a, b].forEach((x, side) => {
        const d = Math.abs(sx(f, x) - px);
        if (d < dist) {
          dist = d;
          best = [i, side];
        }
      });
    });
    return best;
  }

  function onDown(e: PointerEvent) {
    if (fixed || !canvas) return;
    const edge = hit(e);
    if (edge) {
      canvas.setPointerCapture(e.pointerId);
      drag = { bands: bands.map((b) => [...b] as [number, number]), edge };
      e.preventDefault();
      return;
    }
    if (!drawing || e.button > 0) return;
    if (!pg.drawY) pg.drawY = yDomain; // keep the scale while drawing
    canvas.setPointerCapture(e.pointerId);
    hoverX = null;
    stroke = [];
    addPoint(e);
    e.preventDefault();
  }

  function addPoint(e: PointerEvent) {
    if (!canvas || !stroke) return;
    const s = scene(canvas.clientWidth, canvas.clientHeight);
    if (!s) return;
    const f = fitLayout(s);
    const x = Math.min(pg.domain[1], Math.max(pg.domain[0], invX(f, e.offsetX)));
    const y = Math.min(f.yDomain[1], Math.max(f.yDomain[0], invY(f, e.offsetY)));
    stroke = [...stroke, { x, y }];
  }

  function onMove(e: PointerEvent) {
    if (!canvas) return;
    const s = scene(canvas.clientWidth, canvas.clientHeight);
    if (!s) return;
    const f = fitLayout(s);
    const x = Math.min(pg.domain[1], Math.max(pg.domain[0], invX(f, e.offsetX)));
    if (stroke) {
      addPoint(e);
      return;
    }
    if (drag) {
      const [i, side] = drag.edge;
      const next = drag.bands.map((b) => [...b] as [number, number]);
      const snapped = Math.round(x * 20) / 20;
      next[i][side] =
        side === 0 ? Math.min(snapped, next[i][1] - 0.05) : Math.max(snapped, next[i][0] + 0.05);
      drag = { ...drag, bands: next };
      return;
    }
    canvas.style.cursor = !fixed && hit(e) ? 'ew-resize' : 'crosshair';
    hoverX = e.pointerType === 'mouse' && e.offsetX >= f.x0 && e.offsetX <= f.x0 + f.w ? x : null;
  }

  function onUp() {
    if (drag) {
      pg.bands = drag.bands;
      drag = null;
    }
    if (stroke) {
      const old = pg.drawing;
      pg.drawing = drawStroke(old, stroke, old ? latticeOf(old) : latticeFor(pg.domain));
      stroke = null;
    }
  }

  const hoverInfo = $derived.by(() => {
    const d = pg.data;
    if (hoverX === null || !d || !canvas) return null;
    const i = Math.round(
      ((hoverX - pg.domain[0]) / (pg.domain[1] - pg.domain[0])) * (d.gridX.length - 1),
    );
    const s = scene(canvas.clientWidth, canvas.clientHeight);
    if (!s) return null;
    const left = sx(fitLayout(s), hoverX);
    return {
      x: d.gridX[i],
      truth: d.clean[i],
      models: shown.map(({ run, frame }) => ({
        color: run.spec.color,
        name: modelName(run.spec),
        y: frame.grid[i],
      })),
      left,
      flip: left > canvas.clientWidth - 180,
    };
  });

  const num = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '-');
  const summary = $derived(
    shown
      .map(({ run, frame }) =>
        t('pg.plot.model', {
          name: modelName(run.spec),
          inside: num(frame.metrics.inside),
          beyond: num(frame.metrics.beyond),
        }),
      )
      .join(' '),
  );
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(2).replace('-', '−') : '-');
</script>

<div class="relative" role="img" aria-label={t('pg.plot.label', { summary })}>
  <canvas
    bind:this={canvas}
    class="block w-full {drawing ? 'touch-none' : 'touch-pan-y'} {short
      ? 'h-[210px]'
      : compact
        ? 'h-[300px]'
        : 'h-[clamp(300px,46vh,460px)]'}"
    aria-hidden="true"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    onpointerleave={() => (hoverX = null)}
  ></canvas>
  {#if hoverInfo}
    <div
      class="pointer-events-none absolute top-8 w-40 rounded-lg border border-line-strong bg-surface p-2 text-xs shadow-[var(--xp-shadow)]"
      style:left="{hoverInfo.flip ? hoverInfo.left - 172 : hoverInfo.left + 12}px"
    >
      <p class="font-mono font-semibold text-muted">x = {fmt(hoverInfo.x)}</p>
      <p class="mt-1 flex justify-between">
        <span>{t('pg.tooltip.truth')}</span><span class="font-mono">{fmt(hoverInfo.truth)}</span>
      </p>
      {#each hoverInfo.models as m (m.color)}
        <p class="flex justify-between">
          <span class="font-semibold {COLOR_CLASS[(m.color - 1) % 6]}">{m.name}</span><span
            class="font-mono">{fmt(m.y)}</span
          >
        </p>
      {/each}
    </div>
  {/if}
</div>
