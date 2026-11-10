<script lang="ts" module>
  import thumbsUrl from '../../gallery/thumbs.json?url';
  import type { ThumbFile } from '../../lib/thumbs.ts';

  // One small file for every card on the page.
  let file: Promise<ThumbFile | null> | null = null;
  const thumbs = () =>
    (file ??= fetch(thumbsUrl)
      .then((r) => (r.ok ? (r.json() as Promise<ThumbFile>) : null))
      .catch(() => null));
</script>

<script lang="ts">
  // The finished race of a gallery experiment, drawn in the visitor's theme.
  import { datasetOf, presetState, trainingIdentity } from '../../lib/experiment.ts';
  import { PRESETS } from '../../lib/presets.ts';
  import { drawFit, autoYDomain, type SceneTheme } from '../../lib/scene/draw.ts';
  import { unpackValues } from '../../lib/thumbs.ts';
  import { prepare, watchSize, watchTheme } from '../playground/canvas.ts';

  const { id, label }: { id: string; label: string } = $props();
  let canvas = $state<HTMLCanvasElement>();
  let theme = $state.raw<SceneTheme | null>(null);
  let size = $state(0);
  let models = $state.raw<{ ys: Float32Array; color: number; band?: Float32Array }[]>([]);

  const preset = $derived(PRESETS.find((p) => p.id === id));
  const exp = $derived(preset ? presetState(preset) : null);
  const data = $derived(exp ? datasetOf(exp) : null);

  $effect(() => {
    const s = exp;
    if (!s) return;
    let live = true;
    void thumbs().then((f) => {
      const item = f?.items[id];
      // A preset changed since its thumbnail was made: show the data only.
      if (!live || !item || item.key !== trainingIdentity(s)) return;
      models = item.models.map((m, i) => ({
        ys: unpackValues({ lo: m.lo, hi: m.hi, data: m.grid }),
        color: i + 1,
        ...(m.band ? { band: unpackValues(m.band) } : {}),
      }));
    });
    return () => {
      live = false;
    };
  });

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
    const d = data;
    if (!canvas || !theme || !d || !exp) return;
    const { ctx, w, h } = prepare(canvas);
    if (!ctx) return;
    drawFit(
      ctx,
      {
        width: w,
        height: h,
        xDomain: exp.domain,
        yDomain: autoYDomain(d.clean, d.trainY, d.valY),
        bands: exp.bands,
        trainX: d.trainX,
        trainY: d.trainY,
        valX: d.valX,
        valY: d.valY,
        gridX: d.gridX,
        truth: d.clean,
        models,
        regionLabels: null,
        handles: false,
        compact: true,
        pixelRatio: Math.min(3, window.devicePixelRatio || 1),
      },
      theme,
    );
  });
</script>

<div role="img" aria-label={label}>
  <canvas bind:this={canvas} class="block aspect-video w-full" aria-hidden="true" data-thumb={id}
  ></canvas>
</div>
