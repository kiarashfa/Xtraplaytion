<script lang="ts">
  // Lesson island: the visitor draws a curve across the whole plot (or picks an example),
  // the models train on the shaded middle only, and the drawing judges how each one
  // continues it beyond the data.
  import { onMount } from 'svelte';
  import { useTranslations, type MessageKey } from '../../i18n';
  import { modelName, Playground } from '../../lib/playground.svelte.ts';
  import { modelSummary } from '../../lib/describe.ts';
  import { PRESETS } from '../../lib/presets.ts';
  import { drawStroke, latticeFor } from '../../lib/source.ts';
  import Icon from '../Icon.svelte';
  import FitPlot from '../playground/FitPlot.svelte';
  import Leaderboard from '../playground/Leaderboard.svelte';
  import Swatch from '../playground/Swatch.svelte';

  const { preset = 'draw-challenge' }: { preset?: string } = $props();
  const t = useTranslations();
  const pg = new Playground();
  pg.alwaysRecorded = true;
  pg.kinksOnPlot = false;
  let pick = $state<number | null>(null);
  let ready = $state(false);
  /** The pen is on the plot (before a race, or after Draw again). */
  let drawingMode = $state(true);
  const Y: [number, number] = [-4, 4];

  /** Example curves (also the way to play without a pointer). Each one suits one model. */
  const EXAMPLES: { id: string; f: (x: number) => number }[] = [
    { id: 'v', f: (x) => Math.abs(x) - 2 },
    { id: 's', f: (x) => 2 * Math.tanh(1.5 * x) },
    { id: 'ramp', f: (x) => 0.5 * x },
  ];

  onMount(() => {
    const p = PRESETS.find((x) => x.id === preset);
    if (p) pg.applyPreset(p);
    pg.setSpeed(16);
    pg.setTargetTab('draw');
    pg.drawY = Y;
    ready = true;
    return () => pg.dispose();
  });

  // A new drawing starts a fresh race (paused at epoch 0), like the playground.
  $effect(() => {
    if (!ready) return;
    void pg.data;
    void pg.trainingKey;
    pg.restartPending = true;
    const id = setTimeout(() => pg.restart(), 120);
    return () => clearTimeout(id);
  });

  function example(f: (x: number) => number) {
    const [a, b] = pg.domain;
    const stroke = Array.from({ length: 513 }, (_, i) => {
      const x = a + ((b - a) * i) / 512;
      return { x, y: f(x) };
    });
    pg.drawing = drawStroke(null, stroke, latticeFor(pg.domain));
    pg.drawY = Y;
    drawingMode = true;
  }
  function clear() {
    pg.pause();
    pg.drawing = null;
    pg.drawY = Y;
    drawingMode = true;
  }
  function race() {
    drawingMode = false;
    pg.toggle();
  }

  const hasDrawing = $derived(!!pg.drawing);
  const covers = $derived(
    !!pg.drawing && pg.drawing.x0 <= pg.domain[0] + 0.5 && pg.drawing.x1 >= pg.domain[1] - 0.5,
  );
  const done = $derived(pg.status === 'done' || pg.status === 'diverged');
  const running = $derived(pg.status === 'running');
  const winner = $derived.by(() => {
    if (!done) return -1;
    let best = -1;
    let bestV = Infinity;
    pg.runs.forEach((r, i) => {
      const v = r.frameAt(pg.viewEpoch)?.metrics.beyond ?? NaN;
      if (Number.isFinite(v) && v < bestV) {
        bestV = v;
        best = i;
      }
    });
    return best;
  });
  const name = (i: number) => {
    const m = pg.models[i];
    return m ? `${modelName(m)} · ${modelSummary(m, t)}` : '';
  };
</script>

<div class="not-prose my-6 flex flex-col gap-4" data-draw-challenge>
  <div class="xp-card p-4 sm:p-5">
    <span
      class="inline-flex h-6 items-center rounded-full bg-accent-soft px-2.5 text-xs font-semibold text-accent"
      >{t('predict.badge')}</span
    >
    <p class="mt-2 mb-3 font-semibold">{t('draw.question')}</p>
    <div
      class="grid grid-cols-1 gap-2.5 sm:grid-cols-3"
      role="radiogroup"
      aria-label={t('predict.badge')}
    >
      {#each pg.models as m, i (m.id)}
        <button
          type="button"
          role="radio"
          aria-checked={pick === i}
          class="flex min-h-11 flex-col items-start gap-1 rounded-xl border-[1.5px] p-2.5 text-start {pick ===
          i
            ? 'border-accent bg-surface shadow-[0_0_0_3px_var(--xp-accent-soft)]'
            : 'border-line-strong bg-surface-2'}"
          onclick={() => (pick = i)}
        >
          <Swatch color={m.color} />
          <b class="font-mono text-[13px]">{name(i)}</b>
        </button>
      {/each}
    </div>
    <div class="mt-3.5 flex flex-wrap items-center justify-between gap-3">
      <p class="text-[13px] text-muted" aria-live="polite" data-draw-status>
        {#if !hasDrawing}
          {t('draw.start')}
        {:else if !covers}
          {t('draw.cover')}
        {:else if done && winner >= 0}
          {pick === null
            ? t('draw.winner', { choice: name(winner) })
            : t(pick === winner ? 'draw.right' : 'draw.wrong', { choice: name(winner) })}
        {:else if pick !== null}
          {t('predict.picked', { choice: name(pick) })}
        {:else}
          {t('predict.pick')}
        {/if}
      </p>
      <button
        type="button"
        class="xp-btn xp-btn-primary min-h-11"
        disabled={!ready || !covers || !pg.runs.length}
        onclick={race}
      >
        <Icon name={running ? 'pause' : done ? 'reset' : 'play'} />{running
          ? t('pg.run.pause')
          : done
            ? t('race.again')
            : t('race.play')}
      </button>
    </div>
  </div>

  <div class="xp-card">
    <div class="flex flex-wrap items-center gap-2 px-3.5 pt-3">
      <span class="text-xs font-semibold text-muted">{t('draw.examples')}</span>
      {#each EXAMPLES as ex (ex.id)}
        <button type="button" class="xp-btn min-h-10 px-3 text-[13px]" onclick={() => example(ex.f)}
          >{t(`draw.example.${ex.id}` as MessageKey)}</button
        >
      {/each}
      <span class="ms-auto flex gap-2">
        {#if !drawingMode}
          <button
            type="button"
            class="xp-btn min-h-10 px-3 text-[13px]"
            onclick={() => {
              pg.pause();
              drawingMode = true;
            }}><Icon name="pen" size={16} />{t('draw.again')}</button
          >
        {/if}
        {#if hasDrawing}
          <button type="button" class="xp-btn min-h-10 px-3 text-[13px]" onclick={clear}
            ><Icon name="trash" size={16} />{t('pg.draw.clear')}</button
          >
        {/if}
      </span>
    </div>
    <div class="px-1.5 pt-1 pb-2 sm:px-2">
      <FitPlot {pg} runs={pg.runs} fixed drawing={drawingMode} />
    </div>
    <p class="px-3.5 pb-2 text-xs text-muted">
      {drawingMode ? t('draw.hint') : t('draw.hint.race')}
    </p>
    <div class="px-2 pb-3"><Leaderboard {pg} /></div>
  </div>
</div>
