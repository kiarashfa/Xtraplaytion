<script lang="ts">
  import { onMount } from 'svelte';
  import { useTranslations } from '../../i18n';
  import { Playground } from '../../lib/playground.svelte.ts';
  import { PRESETS } from '../../lib/presets.ts';
  import { decodeState, encodeState } from '../../lib/share.ts';
  import Icon from '../Icon.svelte';
  import Tex from '../Tex.svelte';
  import DataPanel from './DataPanel.svelte';
  import FitPlot from './FitPlot.svelte';
  import LossPlot from './LossPlot.svelte';
  import ModelPanel from './ModelPanel.svelte';
  import RunBar from './RunBar.svelte';
  import Scoreboard from './Scoreboard.svelte';
  import Swatch from './Swatch.svelte';
  import TargetPanel from './TargetPanel.svelte';

  const t = useTranslations();
  const pg = new Playground();
  let loaded = $state(false);
  let toast = $state('');
  let tab = $state<'target' | 'data' | 'model' | 'training'>('target');
  let mobile = $state(false);

  const sections = [
    { id: 'target', key: 'pg.step.target', short: 'pg.short.target' },
    { id: 'data', key: 'pg.step.data', short: 'pg.short.data' },
    { id: 'model', key: 'pg.step.model', short: 'pg.short.model' },
    { id: 'training', key: 'pg.step.training', short: 'pg.short.training' },
  ] as const;

  function say(text: string) {
    toast = text;
    setTimeout(() => {
      if (toast === text) toast = '';
    }, 2600);
  }

  onMount(() => {
    const mq = matchMedia('(max-width: 767px)');
    mobile = mq.matches;
    const onMq = () => (mobile = mq.matches);
    mq.addEventListener('change', onMq);

    const params = new URLSearchParams(location.hash.slice(1));
    const hash = params.get('s');
    const preset = PRESETS.find((p) => p.id === params.get('preset'));
    if (preset) pg.applyPreset(preset);
    (async () => {
      if (hash) {
        const s = await decodeState(hash);
        if (s) {
          pg.loadState(s);
          say(t('pg.share.loaded'));
        } else say(t('pg.share.bad'));
      }
      loaded = true;
    })();

    const onVis = () => {
      if (document.hidden && pg.status === 'running') {
        pg.pause();
        pg.pausedByHiddenTab = true;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mq.removeEventListener('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
      pg.trainer.dispose();
    };
  });

  // Any change to the data or the model starts a fresh run from the same seed.
  $effect(() => {
    if (!loaded) return;
    void pg.data;
    void pg.config;
    void pg.epochs;
    const id = setTimeout(() => pg.restart(), 120);
    return () => clearTimeout(id);
  });

  async function share() {
    const code = await encodeState(pg.snapshotState());
    history.replaceState(null, '', `#s=${code}`);
    try {
      await navigator.clipboard.writeText(location.href);
      say(t('pg.share.copied'));
    } catch {
      say(t('pg.share.failed'));
    }
  }

  const lossStr = $derived(Number.isFinite(pg.trainLossNow) ? pg.trainLossNow.toPrecision(3) : '-');
  // Announced to screen readers on status changes (not every frame).
  const statusText = $derived(
    t(`pg.status.${pg.status}`, {
      epoch: pg.epoch,
      total: pg.epochs,
      loss: lossStr,
      message: pg.errorMessage,
    }),
  );
</script>

<div
  class="grid min-h-[calc(100dvh-4.5rem)] grid-cols-[minmax(0,1fr)] md:grid-cols-[356px_minmax(0,1fr)]"
>
  <!-- settings: a column on desktop, tabs under the plot on phones -->
  <aside class="order-2 border-line bg-surface md:order-1 md:border-e" aria-label={t('pg.title')}>
    <div
      class="sticky top-0 z-10 flex border-b border-line bg-surface md:hidden"
      role="tablist"
      aria-label={t('pg.mobile.tabs')}
    >
      {#each sections as s (s.id)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === s.id}
          class="min-h-12 flex-1 border-b-2 text-[14px] font-semibold {tab === s.id
            ? 'border-accent text-ink'
            : 'border-transparent text-muted'}"
          onclick={() => (tab = s.id)}>{t(s.short)}</button
        >
      {/each}
    </div>
    <div class="flex flex-col gap-3 p-3.5 md:sticky md:top-0 md:max-h-dvh md:overflow-y-auto">
      {#each sections as s, i (s.id)}
        <section
          class="rounded-xl border border-line bg-surface {mobile && tab !== s.id ? 'hidden' : ''}"
          aria-labelledby="sec-{s.id}"
        >
          <h2
            id="sec-{s.id}"
            class="flex items-center gap-2 px-3 pt-2.5 pb-2 text-[13px] font-bold"
          >
            <span
              class="grid size-5 place-items-center rounded-md bg-accent-soft text-[11px] text-accent"
              >{i + 1}</span
            >{t(s.key)}
            {#if s.id === 'data'}<span class="ms-auto text-xs font-medium text-faint"
                >{t('pg.ranges.count', { count: pg.bands.length })}</span
              >{/if}
          </h2>
          <div class="px-3 pb-3">
            {#if s.id === 'target'}
              <TargetPanel {pg} />
            {:else if s.id === 'data'}
              <DataPanel {pg} />
            {:else if s.id === 'model'}
              <ModelPanel {pg} />
            {:else}
              <label class="flex flex-col gap-1">
                <span class="xp-label">{t('pg.epochs')}</span>
                <input
                  class="xp-input font-mono"
                  type="number"
                  min="1"
                  max="100000"
                  value={pg.epochs}
                  onchange={(e) => {
                    const v = Math.round(Number(e.currentTarget.value));
                    if (v >= 1 && v <= 100000) pg.epochs = v;
                  }}
                />
              </label>
            {/if}
          </div>
        </section>
      {/each}
    </div>
  </aside>

  <div class="order-1 flex min-w-0 flex-col gap-3 p-2.5 sm:p-3.5 md:order-2">
    <RunBar {pg} onshare={share} compact={mobile} />

    {#if pg.status === 'diverged' || pg.status === 'error' || pg.pausedByHiddenTab}
      <p
        class="flex items-center gap-2 rounded-xl border border-line bg-accent-soft px-3 py-2 text-sm"
        role="status"
      >
        <Icon name="info" />{pg.pausedByHiddenTab ? t('pg.status.hidden') : statusText}
      </p>
    {/if}

    <section class="xp-card" aria-labelledby="fit-title">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 pt-2.5">
        <h2 id="fit-title" class="text-sm font-bold">{t('pg.fit')}</h2>
        {#if pg.parsed.ok && !mobile}<span class="text-faint" aria-hidden="true">·</span><span
            class="min-w-0 truncate text-[15px]"><Tex tex={`f(x)=${pg.parsed.latex}`} /></span
          >{/if}
        <ul class="ms-auto flex flex-wrap gap-1.5 text-[12.5px]" aria-label="Legend">
          <li
            class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2"
          >
            <span class="size-2 rounded-full bg-target"></span>{t('pg.legend.data')}
          </li>
          <li
            class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2"
          >
            <span class="w-4 border-t-2 border-dotted border-[var(--xp-truth)]"></span>{t(
              'pg.legend.truth',
            )}
          </li>
          <li
            class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2"
          >
            <Swatch color={1} width={20} />N1
          </li>
        </ul>
      </div>
      <div class="px-1.5 pt-1 pb-2 sm:px-2"><FitPlot {pg} compact={mobile} /></div>
      <p class="px-3.5 pb-3 text-xs text-muted">{t('pg.plot.hint')}</p>
    </section>

    <div class="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <section class="xp-card" aria-labelledby="loss-title">
        <div class="flex flex-wrap items-baseline gap-x-2 px-3.5 pt-2.5">
          <h2 id="loss-title" class="text-sm font-bold">{t('pg.loss')}</h2>
          <span class="text-xs text-faint">{t('pg.loss.legend')}</span>
        </div>
        <div class="p-2"><LossPlot {pg} /></div>
      </section>
      <section class="xp-card" aria-labelledby="score-title">
        <div class="flex flex-wrap items-baseline gap-x-2 px-3.5 pt-2.5">
          <h2 id="score-title" class="text-sm font-bold">{t('pg.score')}</h2>
          <span class="text-xs text-faint">{t('pg.score.legend')}</span>
        </div>
        <div class="p-1.5"><Scoreboard {pg} /></div>
      </section>
    </div>
    <p class="sr-only" aria-live="polite">{statusText}</p>
  </div>
</div>

{#if toast}
  <div class="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4" role="status">
    <p class="rounded-full bg-ink px-4 py-2 text-sm text-bg shadow-lg">{toast}</p>
  </div>
{/if}
