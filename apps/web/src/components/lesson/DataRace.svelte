<script lang="ts">
  // Lesson island: the same network trained on different layouts of training data (one preset
  // per layout, each its own race), side by side. Guess which layout gives the best curve over
  // the whole plot, then watch. Scored against the true function on the whole plot range.
  import { onMount, untrack } from 'svelte';
  import { useTranslations } from '../../i18n';
  import { Playground } from '../../lib/playground.svelte.ts';
  import { PRESETS } from '../../lib/presets.ts';
  import { url } from '../../lib/url.ts';
  import Icon from '../Icon.svelte';
  import FitPlot from '../playground/FitPlot.svelte';

  interface Props {
    /** One preset per layout (each with one model). */
    presets: string[];
    /** A short name per layout, written in the lesson. */
    labels: string[];
    question: string;
    /** Epochs per animation frame. */
    speed?: number;
  }
  const { presets, labels, question, speed = 8 }: Props = $props();
  const t = useTranslations();
  // One race per layout, for the island's lifetime (the presets never change).
  const races = untrack(() =>
    presets.map(() => {
      const pg = new Playground();
      pg.alwaysRecorded = true;
      pg.kinksOnPlot = false;
      return pg;
    }),
  );
  let pick = $state<number | null>(null);
  let ready = $state(false);

  onMount(() => {
    races.forEach((pg, i) => {
      const p = PRESETS.find((x) => x.id === presets[i]);
      if (p) pg.applyPreset(p);
      pg.setSpeed(speed);
      pg.restart();
    });
    ready = true;
    return () => races.forEach((pg) => pg.dispose());
  });

  const running = $derived(races.some((pg) => pg.status === 'running'));
  const done = $derived(races.every((pg) => pg.status === 'done' || pg.status === 'diverged'));
  const epoch = $derived(Math.min(...races.map((pg) => pg.viewEpoch)));
  const total = $derived(races[0]?.epochs ?? 0);

  /** RMSE against the true function over the whole plot range, at the epoch shown. */
  function wholeRange(pg: Playground): number {
    const d = pg.data;
    const grid = pg.runs[0]?.frameAt(pg.viewEpoch)?.grid;
    if (!d || !grid) return NaN;
    let s = 0;
    let k = 0;
    for (let i = 0; i < grid.length; i++) {
      const e = grid[i] - d.clean[i];
      if (Number.isFinite(e)) {
        s += e * e;
        k++;
      }
    }
    return k ? Math.sqrt(s / k) : NaN;
  }
  const rows = $derived(
    races.map((pg) => ({
      points: pg.data?.trainX.length ?? 0,
      inside: pg.runs[0]?.frameAt(pg.viewEpoch)?.metrics.inside ?? NaN,
      whole: wholeRange(pg),
    })),
  );
  const winner = $derived.by(() => {
    if (!done) return -1;
    let best = -1;
    rows.forEach((r, i) => {
      if (Number.isFinite(r.whole) && (best < 0 || r.whole < rows[best].whole)) best = i;
    });
    return best;
  });
  const nf = new Intl.NumberFormat('en');
  const num = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '-');

  function toggle() {
    if (running) races.forEach((pg) => pg.pause());
    else races.forEach((pg) => pg.play());
  }
</script>

<div class="not-prose my-6 flex flex-col gap-4" data-data-race={presets.join(' ')}>
  <div class="xp-card p-4 sm:p-5">
    <span
      class="inline-flex h-6 items-center rounded-full bg-accent-soft px-2.5 text-xs font-semibold text-accent"
      >{t('predict.badge')}</span
    >
    <p class="mt-2 mb-3 font-semibold">{question}</p>
    <div
      class="grid grid-cols-1 gap-2.5 sm:grid-cols-3"
      role="radiogroup"
      aria-label={t('predict.badge')}
    >
      {#each labels as label, i (i)}
        <button
          type="button"
          role="radio"
          aria-checked={pick === i}
          class="flex min-h-11 flex-col items-start gap-0.5 rounded-xl border-[1.5px] p-2.5 text-start {pick ===
          i
            ? 'border-accent bg-surface shadow-[0_0_0_3px_var(--xp-accent-soft)]'
            : 'border-line-strong bg-surface-2'}"
          onclick={() => (pick = i)}
        >
          <b class="text-[13px]">{label}</b>
          <span class="text-xs text-muted">{t('drace.points', { n: rows[i]?.points ?? 0 })}</span>
        </button>
      {/each}
    </div>
    <div class="mt-3.5 flex flex-wrap items-center justify-between gap-3">
      <p class="text-[13px] text-muted" aria-live="polite">
        {#if done && pick !== null && winner >= 0}
          {t(pick === winner ? 'drace.right' : 'drace.wrong', { choice: labels[winner] })}
        {:else if pick !== null}
          {t('predict.picked', { choice: labels[pick] })}
        {:else}
          {t('predict.pick')}
        {/if}
      </p>
      <button
        type="button"
        class="xp-btn xp-btn-primary min-h-11"
        disabled={!ready || races.some((pg) => !pg.runs.length)}
        onclick={toggle}
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
      <span class="font-mono text-sm font-semibold" data-epoch
        >{t('pg.run.epoch')}
        {nf.format(epoch)}
        <span class="font-normal text-faint">/ {nf.format(total)}</span></span
      >
    </div>
    <div class="flex flex-col gap-1 px-1.5 pt-1 pb-2 sm:px-2">
      {#each races as pg, i (i)}
        <div class="flex flex-col">
          <FitPlot {pg} runs={pg.runs} compact short fixed tag={labels[i]} />
          <a
            class="self-end px-2 text-xs text-muted underline hover:text-ink"
            href={url(`playground/#preset=${presets[i]}`)}>{t('race.open')}</a
          >
        </div>
      {/each}
    </div>
    <div class="overflow-x-auto px-3.5 pb-3">
      <table class="w-full text-[13px]" data-data-race-table>
        <thead>
          <tr class="text-start text-xs text-muted">
            <th scope="col" class="py-1 pe-3 text-start font-semibold">{t('drace.layout')}</th>
            <th scope="col" class="py-1 pe-3 text-end font-semibold">{t('drace.trainPoints')}</th>
            <th scope="col" class="py-1 pe-3 text-end font-semibold">{t('drace.inside')}</th>
            <th scope="col" class="py-1 text-end font-semibold">{t('drace.whole')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r, i (i)}
            <tr class="border-t border-line {winner === i ? 'font-semibold' : ''}">
              <th scope="row" class="py-1.5 pe-3 text-start font-normal">{labels[i]}</th>
              <td class="py-1.5 pe-3 text-end font-mono">{r.points}</td>
              <td class="py-1.5 pe-3 text-end font-mono">{num(r.inside)}</td>
              <td class="py-1.5 text-end font-mono">{num(r.whole)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
