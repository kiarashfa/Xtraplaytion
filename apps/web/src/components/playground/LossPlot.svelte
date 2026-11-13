<script lang="ts">
  import type { Playground } from '../../lib/playground.svelte.ts';
  import { drawLoss, PlotLayers, type SceneTheme } from '../../lib/scene/draw.ts';
  import { prepare, watchSize, watchTheme } from './canvas.ts';
  import { FramePaint } from './paint.svelte.ts';

  const { pg, compact = false }: { pg: Playground; compact?: boolean } = $props();
  let canvas = $state<HTMLCanvasElement>();
  let theme = $state.raw<SceneTheme | null>(null);
  let size = $state(0);

  $effect(() => {
    if (!canvas) return;
    const a = watchTheme((th) => (theme = th));
    const b = watchSize(canvas, () => size++);
    return () => {
      a();
      b();
    };
  });

  const layers = new PlotLayers();
  const paint = new FramePaint();
  $effect(() => () => paint.dispose());
  $effect(() => {
    void size;
    if (!canvas || !theme || !paint.ready()) return;
    const upTo = pg.viewEpoch;
    const runs = pg.visibleRuns;
    for (const r of runs) void r.version;
    const { ctx, w, h } = prepare(canvas);
    if (!ctx) return;
    drawLoss(
      ctx,
      {
        width: w,
        height: h,
        epochs: pg.epochs,
        compact,
        layers,
        // Losses up to the epoch shown, so a replay rewinds the loss curves too.
        series: runs.map((r) => ({
          train: r.trainLoss.view().subarray(0, upTo),
          val: r.valLoss.view().subarray(0, upTo),
          color: r.spec.color,
        })),
      },
      theme,
    );
  });
</script>

<canvas bind:this={canvas} class="block w-full {compact ? 'h-12' : 'h-44'}" aria-hidden="true"
></canvas>
