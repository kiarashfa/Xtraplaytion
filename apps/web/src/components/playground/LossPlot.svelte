<script lang="ts">
  import type { Playground } from '../../lib/playground.svelte.ts';
  import { drawLoss, type SceneTheme } from '../../lib/scene/draw.ts';
  import { prepare, watchSize, watchTheme } from './canvas.ts';

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

  $effect(() => {
    void size;
    const upTo = pg.viewEpoch;
    const runs = pg.visibleRuns;
    for (const r of runs) void r.version;
    if (!canvas || !theme) return;
    const { ctx, w, h } = prepare(canvas);
    if (!ctx) return;
    drawLoss(
      ctx,
      {
        width: w,
        height: h,
        epochs: pg.epochs,
        compact,
        // Losses up to the epoch shown, so a replay rewinds the loss curves too.
        series: runs.map((r) => ({
          train: r.trainer.trainLoss.view().subarray(0, upTo),
          val: r.trainer.valLoss.view().subarray(0, upTo),
          color: r.spec.color,
        })),
      },
      theme,
    );
  });
</script>

<canvas bind:this={canvas} class="block w-full {compact ? 'h-12' : 'h-44'}" aria-hidden="true"
></canvas>
