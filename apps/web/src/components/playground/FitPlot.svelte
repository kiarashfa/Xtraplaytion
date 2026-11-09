<script lang="ts">
  import { useTranslations } from '../../i18n';
  import type { ModelRun, Playground } from '../../lib/playground.svelte.ts';
  import {
    autoYDomain,
    drawFit,
    fitLayout,
    invX,
    sx,
    type FitScene,
    type SceneTheme,
  } from '../../lib/scene/draw.ts';
  import { prepare, watchSize, watchTheme } from './canvas.ts';
  import { COLOR_CLASS } from './Swatch.svelte';

  const {
    pg,
    runs,
    compact = false,
    short = false,
    tag,
    fixed = false,
  }: {
    pg: Playground;
    /** The models drawn in this plot (all visible ones, or one when stacked). */
    runs: ModelRun[];
    compact?: boolean;
    short?: boolean;
    tag?: string;
    /** No draggable range edges (lessons). */
    fixed?: boolean;
  } = $props();
  const t = useTranslations();

  let canvas = $state<HTMLCanvasElement>();
  let theme = $state.raw<SceneTheme | null>(null);
  let size = $state(0); // bumps on resize
  let drag = $state<{ bands: [number, number][]; edge: [number, number] } | null>(null);
  let hoverX = $state<number | null>(null);

  const bands = $derived(drag ? drag.bands : pg.bands.slice().sort((a, b) => a[0] - b[0]));
  const yDomain = $derived(
    pg.data
      ? autoYDomain(pg.data.clean, pg.data.trainY, pg.data.valY)
      : ([-1, 1] as [number, number]),
  );

  // Every model is shown at the same epoch (the shared clock, or the replay position).
  const shown = $derived(
    runs.flatMap((run) => {
      const frame = run.frameAt(pg.viewEpoch);
      return frame ? [{ run, frame }] : [];
    }),
  );

  function scene(w: number, h: number): FitScene | null {
    const d = pg.data;
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
      models: shown.map(({ run, frame }) => ({ ys: frame.grid, color: run.spec.color })),
      regionLabels: {
        train: t('pg.region.train'),
        gap: t('pg.region.gap'),
        beyond: t('pg.region.beyond'),
      },
      handles: !fixed,
      activeEdge: drag?.edge ?? null,
      crosshairX: hoverX,
      compact,
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

  $effect(() => {
    void size;
    if (!canvas || !theme) return;
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
    if (fixed) return;
    const edge = hit(e);
    if (!edge || !canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { bands: bands.map((b) => [...b] as [number, number]), edge };
    e.preventDefault();
  }

  function onMove(e: PointerEvent) {
    if (!canvas) return;
    const s = scene(canvas.clientWidth, canvas.clientHeight);
    if (!s) return;
    const f = fitLayout(s);
    const x = Math.min(pg.domain[1], Math.max(pg.domain[0], invX(f, e.offsetX)));
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
      models: shown.map(({ run, frame }) => ({ color: run.spec.color, y: frame.grid[i] })),
      left,
      flip: left > canvas.clientWidth - 180,
    };
  });

  const num = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '-');
  const summary = $derived(
    shown
      .map(({ run, frame }) =>
        t('pg.plot.model', {
          name: `N${run.spec.color}`,
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
    class="block w-full touch-pan-y {short
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
          <span class="font-semibold {COLOR_CLASS[(m.color - 1) % 6]}">N{m.color}</span><span
            class="font-mono">{fmt(m.y)}</span
          >
        </p>
      {/each}
    </div>
  {/if}
</div>
