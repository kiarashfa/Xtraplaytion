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
    void pg.lossVersion;
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
        series: [{ train: pg.trainer.trainLoss.view(), val: pg.trainer.valLoss.view(), color: 1 }],
      },
      theme,
    );
  });
</script>

<canvas bind:this={canvas} class="block w-full {compact ? 'h-12' : 'h-44'}" aria-hidden="true"
></canvas>
