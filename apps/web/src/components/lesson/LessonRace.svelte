<script lang="ts">
  // Lesson island: guess, then watch a preset race (its recording when it has one,
  // otherwise trained live). Built on the playground state and plots.
  import { onMount } from 'svelte';
  import { useTranslations } from '../../i18n';
  import { dimsLabel, modelName, Playground } from '../../lib/playground.svelte.ts';
  import { PRESETS } from '../../lib/presets.ts';
  import { url } from '../../lib/url.ts';
  import Icon from '../Icon.svelte';
  import FitPlot from '../playground/FitPlot.svelte';
  import Leaderboard from '../playground/Leaderboard.svelte';
  import LossPlot from '../playground/LossPlot.svelte';
  import Scrubber from '../playground/Scrubber.svelte';
  import Swatch from '../playground/Swatch.svelte';

  interface Props {
    preset: string;
    /** The prediction question, written in the lesson. */
    question: string;
    /** Which error decides the winner. */
    metric?: 'inside' | 'gap' | 'beyond';
    /** Epochs per animation frame. */
    speed?: number;
  }
  const { preset, question, metric = 'inside', speed = 8 }: Props = $props();
  const t = useTranslations();
  const pg = new Playground();
  pg.alwaysRecorded = true;
  let pick = $state<number | null>(null);
  let ready = $state(false);

  onMount(() => {
    const p = PRESETS.find((x) => x.id === preset);
    if (p) pg.applyPreset(p);
    pg.setSpeed(speed);
    pg.restart();
    ready = true;
    return () => pg.dispose();
  });

  const done = $derived(pg.status === 'done' || pg.status === 'diverged');
  const running = $derived(pg.status === 'running');
  const winner = $derived.by(() => {
    if (!done) return -1;
    let best = -1;
    let bestV = Infinity;
    pg.runs.forEach((r, i) => {
      const v = r.frameAt(pg.viewEpoch)?.metrics[metric] ?? NaN;
      if (Number.isFinite(v) && v < bestV) {
        bestV = v;
        best = i;
      }
    });
    return best;
  });
  const name = (i: number) => {
    const m = pg.models[i];
    return m ? `${modelName(m)}${m.kind === 'mlp' ? ` ${dimsLabel(m)}` : ''}` : '';
  };
  const nf = new Intl.NumberFormat('en');
</script>

<div class="not-prose my-6 flex flex-col gap-4" data-lesson-race={preset}>
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
      <p class="text-[13px] text-muted" aria-live="polite">
        {#if done && pick !== null && winner >= 0}
          {t(pick === winner ? 'lrace.right' : 'lrace.wrong', {
            choice: name(winner),
            where: t(`lrace.where.${metric}`),
          })}
        {:else if pick !== null}
          {t('predict.picked', { choice: name(pick) })}
        {:else}
          {t('predict.pick')}
        {/if}
      </p>
      <button
        type="button"
        class="xp-btn xp-btn-primary min-h-11"
        disabled={!ready || !pg.runs.length}
        onclick={() => pg.toggle()}
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
        {nf.format(pg.viewEpoch)}
        <span class="font-normal text-faint">/ {nf.format(pg.epochs)}</span></span
      >
      {#if pg.mode === 'recorded'}
        <span
          class="inline-flex h-6 items-center rounded-full bg-line px-2.5 text-xs font-semibold text-muted"
          title={t('pg.run.backend.recorded.hint')}>{t('pg.run.backend.recorded')}</span
        >
      {/if}
      <a class="xp-btn ms-auto min-h-9 text-[13px]" href={url(`playground/#preset=${preset}`)}
        ><Icon name="ext" size={16} />{t('race.open')}</a
      >
    </div>
    <div class="flex flex-col gap-1 px-1.5 pt-1 pb-2 sm:px-2">
      {#each pg.runs as r (r.spec.id)}
        <FitPlot {pg} runs={[r]} compact short fixed tag={name(pg.runs.indexOf(r))} />
      {/each}
    </div>
    <Scrubber {pg} />
    <div class="grid grid-cols-[minmax(0,1fr)] gap-2 px-2 pb-3 lg:grid-cols-2">
      <div>
        <p class="px-1.5 text-xs font-semibold text-muted">
          {t('pg.loss')} <span class="font-normal text-faint">{t('pg.loss.legend')}</span>
        </p>
        <LossPlot {pg} />
      </div>
      <Leaderboard {pg} />
    </div>
  </div>
</div>
