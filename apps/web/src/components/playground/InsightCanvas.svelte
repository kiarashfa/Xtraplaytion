<script lang="ts">
  // A canvas that follows its CSS size and the theme, redrawn by `draw` whenever the
  // values `draw` reads change.
  import type { Ctx, SceneTheme } from '../../lib/scene/draw.ts';
  import { prepare, watchSize, watchTheme } from './canvas.ts';

  const {
    draw,
    cls = 'h-56',
  }: { draw: (ctx: Ctx, w: number, h: number, th: SceneTheme) => void; cls?: string } = $props();
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
    if (!canvas || !theme) return;
    const { ctx, w, h } = prepare(canvas);
    if (ctx && w > 0 && h > 0) draw(ctx, w, h, theme);
  });
</script>

<canvas bind:this={canvas} class="block w-full {cls}" aria-hidden="true"></canvas>
