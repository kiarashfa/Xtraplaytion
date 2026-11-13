<script lang="ts">
  import { onMount } from 'svelte';
  import { useTranslations } from '../../i18n';
  import {
    cachedGpu,
    cachedSpeed,
    formatDuration,
    measureGpu,
    measureSpeed,
  } from '../../lib/capability.ts';
  import { copiesOf, modelName, Playground } from '../../lib/playground.svelte.ts';
  import { PRESETS } from '../../lib/presets.ts';
  import { getEntry, getResults } from '../../lib/library.ts';
  import { decodeState } from '../../lib/share.ts';
  import Icon from '../Icon.svelte';
  import InsightCard from './InsightCard.svelte';
  import ValuesTable from './ValuesTable.svelte';
  import Tex from '../Tex.svelte';
  import DataPanel from './DataPanel.svelte';
  import FitPlot from './FitPlot.svelte';
  import LossPlot from './LossPlot.svelte';
  import Leaderboard from './Leaderboard.svelte';
  import ModelPanel from './ModelPanel.svelte';
  import RunBar from './RunBar.svelte';
  import Scrubber from './Scrubber.svelte';
  import Swatch, { COLOR_CLASS } from './Swatch.svelte';
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

    // #preset=... or #s=... (also when a link is pasted into an open playground)
    const fromHash = async () => {
      const params = new URLSearchParams(location.hash.slice(1));
      const code = params.get('s');
      const lib = params.get('lib');
      const preset = PRESETS.find((p) => p.id === params.get('preset'));
      if (preset) pg.applyPreset(preset);
      if (lib) {
        try {
          const entry = await getEntry(lib);
          if (!entry) say(t('pg.lib.missing'));
          else {
            const rec = entry.resultBytes ? await getResults(lib) : null;
            pg.openSaved({ id: entry.id, name: entry.name, rec }, entry.state);
            say(t('pg.lib.opened', { name: entry.name }));
          }
        } catch {
          say(t('pg.lib.unavailable'));
        }
      }
      if (code) {
        const s = await decodeState(code);
        if (s) {
          pg.loadState(s);
          say(t('pg.share.loaded'));
        } else say(t('pg.share.bad'));
      }
    };
    fromHash().then(() => (loaded = true));
    const onHash = () => void fromHash();
    addEventListener('hashchange', onHash);

    // Device speed for time estimates: cached, or measured once the page has settled.
    // The GPU (when there is WebGPU) is measured right after the processor.
    const cached = cachedSpeed();
    const cachedG = cachedGpu();
    if (cached) {
      pg.deviceSpeed = cached;
      pg.deviceMeasured = true;
    }
    if (cachedG) pg.gpuSpeed = cachedG;
    let benchTimer = 0;
    if (!cached || (pg.webgpu && !cachedG)) {
      benchTimer = window.setTimeout(async () => {
        if (!cached) {
          pg.deviceSpeed = await measureSpeed();
          pg.deviceMeasured = true;
        }
        if (pg.webgpu && !cachedG) pg.gpuSpeed = await measureGpu();
      }, 1200);
    }

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
      removeEventListener('hashchange', onHash);
      clearTimeout(benchTimer);
      pg.dispose();
    };
  });

  // Any change to the data or a model starts a fresh race from the same seeds.
  $effect(() => {
    if (!loaded) return;
    void pg.data;
    void pg.trainingKey;
    void pg.recordingWanted;
    pg.restartPending = true; // Play pressed meanwhile starts the new race
    const id = setTimeout(() => pg.restart(), 120);
    return () => clearTimeout(id);
  });

  const diverged = $derived(
    pg.runs
      .filter((r) => r.status === 'diverged')
      .map((r) => modelName(r.spec))
      .join(', '),
  );
  const failure = $derived(pg.runs.find((r) => r.status === 'error')?.errorMessage ?? '');
  // Out of memory reads differently per browser (RangeError, allocation failed, out of memory).
  const failureText = $derived(
    /memory|alloc|RangeError/i.test(failure)
      ? t('pg.status.memory')
      : t('pg.status.error', { message: failure }),
  );
  // Announced to screen readers on status changes (not every frame).
  const statusText = $derived(
    pg.status === 'error'
      ? failureText
      : t(`pg.status.${pg.status}`, {
          epoch: pg.viewEpoch,
          total: pg.epochs,
          names: diverged,
          message: failure,
        }),
  );
  const slow = $derived(pg.clock === 0 && pg.status !== 'running' && pg.estimateTotal > 600);
  const backendChoices = ['auto', 'cpu', 'gpu'] as const;
  const names = (rs: typeof pg.runs) => rs.map((r) => modelName(r.spec)).join(', ');
  // GPU trouble worth telling (a lost device, or a model that could not use the GPU).
  const gpuNotice = $derived.by(() => {
    const lost = pg.runs.filter((r) => r.recoveredAt !== null);
    if (lost.length) {
      const onCpu = lost.filter((r) => r.backend === 'cpu-f64');
      const key = onCpu.length ? 'pg.backend.lost' : 'pg.backend.restarted';
      return t(key, {
        names: names(lost),
        epoch: Math.min(...lost.map((r) => r.recoveredAt ?? 0)),
      });
    }
    if (pg.backend === 'cpu') return '';
    const big = pg.runs.filter((r) => r.fallback === 'outOfMemory');
    if (big.length) return t('pg.backend.tooBig', { names: names(big), count: big.length });
    const failed = pg.runs.filter(
      (r) => r.fallback === 'deviceError' || (r.fallback === 'noAdapter' && pg.backend === 'gpu'),
    );
    if (failed.length)
      return t('pg.backend.failed', { names: names(failed), count: failed.length });
    return '';
  });
  const backendHint = $derived(
    pg.backend !== 'cpu' && !pg.gpuSpeed ? 'none' : (pg.backend as 'auto' | 'cpu' | 'gpu'),
  );
  const layouts = ['overlay', 'stacked'] as const;
  // Round epoch counts on a roughly logarithmic scale (the number field takes any value).
  const EPOCH_STEPS = [
    50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000, 15000,
    20000, 30000, 50000, 75000, 100000,
  ];
  const epochStep = $derived.by(() => {
    let best = 0;
    for (let k = 1; k < EPOCH_STEPS.length; k++)
      if (
        Math.abs(Math.log(EPOCH_STEPS[k] / pg.epochs)) <
        Math.abs(Math.log(EPOCH_STEPS[best] / pg.epochs))
      )
        best = k;
    return best;
  });
  const stacked = $derived(pg.layout === 'stacked' && pg.visibleRuns.length > 1);
  // Strokes on the plot draw while the Draw tab is open (and visible, on phones).
  const drawActive = $derived(pg.targetTab === 'draw' && (!mobile || tab === 'target'));
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
              <div class="flex flex-col gap-1">
                <label class="xp-label" for="epochs">{t('pg.epochs')}</label>
                <div class="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2.5">
                  <input
                    id="epochs"
                    class="xp-input font-mono"
                    type="number"
                    min="1"
                    max="100000"
                    value={pg.epochs}
                    onchange={(e) => {
                      const v = Math.round(Number(e.currentTarget.value));
                      if (v >= 1 && v <= 100000) pg.epochs = v;
                      else e.currentTarget.value = String(pg.epochs);
                    }}
                  />
                  <input
                    type="range"
                    class="h-10 w-full accent-[var(--xp-accent)]"
                    min="0"
                    max={EPOCH_STEPS.length - 1}
                    step="1"
                    value={epochStep}
                    aria-label={t('pg.epochs.slider')}
                    aria-valuetext={pg.epochs.toLocaleString('en')}
                    oninput={(e) => (pg.epochs = EPOCH_STEPS[Number(e.currentTarget.value)])}
                  />
                </div>
                <span class="xp-label mt-2" id="backend-label">{t('pg.backend')}</span>
                <div
                  class="flex rounded-lg border border-line bg-surface-2 p-0.5 text-[13px]"
                  role="group"
                  aria-labelledby="backend-label"
                >
                  {#each backendChoices as b (b)}
                    <button
                      type="button"
                      class="min-h-10 flex-1 rounded-md px-2.5 font-semibold {pg.backend === b
                        ? 'bg-surface text-ink shadow-sm'
                        : 'text-muted hover:text-ink'}"
                      aria-pressed={pg.backend === b}
                      data-backend-choice={b}
                      onclick={() => (pg.backend = b)}>{t(`pg.backend.${b}`)}</button
                    >
                  {/each}
                </div>
                <p class="text-xs text-muted" data-backend-hint>
                  {t(`pg.backend.hint.${backendHint}`)}
                </p>
              </div>
            {/if}
          </div>
        </section>
      {/each}
    </div>
  </aside>

  <div class="order-1 flex min-w-0 flex-col gap-3 p-2.5 sm:p-3.5 md:order-2">
    <RunBar {pg} {say} compact={mobile} />

    {#if pg.mode === 'recorded'}
      <div
        class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm"
        role="status"
        data-recorded-notice
      >
        <Icon name="info" /><span class="min-w-0 flex-1"
          >{pg.recordedKind === 'saved'
            ? t('pg.saved.notice', { name: pg.saved?.name ?? '' })
            : t('pg.recorded.notice', { time: formatDuration(pg.estimateTotal) })}</span
        >
        <button type="button" class="xp-btn min-h-10" onclick={() => pg.trainLive()}
          >{pg.recordedKind === 'saved' ? t('pg.saved.again') : t('pg.recorded.live')}</button
        >
      </div>
    {/if}
    {#if gpuNotice}
      <p
        class="flex items-center gap-2 rounded-xl border border-line bg-accent-soft px-3 py-2 text-sm"
        role="status"
        data-gpu-notice
      >
        <Icon name="info" />{gpuNotice}
      </p>
    {/if}
    {#if diverged || failure || pg.pausedByHiddenTab || slow}
      <p
        class="flex items-center gap-2 rounded-xl border border-line bg-accent-soft px-3 py-2 text-sm"
        role="status"
      >
        <Icon name="info" />{pg.pausedByHiddenTab
          ? t('pg.status.hidden')
          : failure
            ? failureText
            : diverged
              ? t('pg.status.diverged', { names: diverged })
              : t('pg.run.slow', { time: formatDuration(pg.estimateTotal) })}
      </p>
    {/if}

    <section class="xp-card" aria-labelledby="fit-title">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 pt-2.5">
        <h2 id="fit-title" class="text-sm font-bold">{t('pg.fit')}</h2>
        {#if pg.targetKind !== 'formula'}<span class="text-faint" aria-hidden="true">·</span><span
            class="min-w-0 truncate text-[13px] text-muted"
            >{t(pg.targetKind === 'drawn' ? 'pg.fit.drawn' : 'pg.fit.points')}</span
          >{:else if pg.parsed.ok && !mobile}<span class="text-faint" aria-hidden="true">·</span
          ><span class="min-w-0 truncate text-[15px]"><Tex tex={`f(x)=${pg.parsed.latex}`} /></span
          >{/if}
        <ul class="ms-auto flex flex-wrap gap-1.5 text-[12.5px]" aria-label="Legend">
          <li
            class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2"
          >
            <span class="size-2 rounded-full bg-target"></span>{t('pg.legend.data')}
          </li>
          {#if pg.targetKind === 'points'}
            <li
              class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2"
            >
              <span class="text-[13px] leading-none text-muted" aria-hidden="true">×</span>{t(
                'pg.legend.heldOut',
              )}
            </li>
          {:else}
            <li
              class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2"
            >
              <span
                class="w-4 border-t-2 {pg.targetKind === 'drawn'
                  ? 'border-solid'
                  : 'border-dotted'} border-[var(--xp-truth)]"
              ></span>{t(pg.targetKind === 'drawn' ? 'pg.legend.drawing' : 'pg.legend.truth')}
            </li>
          {/if}
          {#each pg.models.filter((m) => m.visible) as m (m.id)}
            <li
              class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2"
            >
              <Swatch color={m.color} width={20} />{modelName(m)}
            </li>
          {/each}
          {#if pg.models.some((m) => m.visible && m.kind === 'classical' && m.config.kind === 'gp')}
            <li
              class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2"
              title={t('pg.legend.bandHint')}
            >
              <span class="h-3 w-4 rounded-sm bg-ink/15"></span>{t('pg.legend.band')}
            </li>
          {/if}
          {#if pg.models.some((m) => m.visible && copiesOf(m) > 1)}
            <li
              class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2"
              title={t('pg.legend.spreadHint')}
            >
              <span class="h-3 w-4 rounded-sm bg-ink/15"></span>{t('pg.legend.spread')}
            </li>
          {/if}
          {#if pg.kinkMarks && pg.inspected}
            <li
              class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2"
              data-legend-kinks
            >
              <svg width="10" height="8" viewBox="0 0 10 8" aria-hidden="true"
                ><path
                  d="M5 0 0.5 8h9z"
                  fill="currentColor"
                  class="fill-current {COLOR_CLASS[(pg.inspected.spec.color - 1) % 6]}"
                /></svg
              >{t('pg.legend.kinks', { name: modelName(pg.inspected.spec) })}
            </li>
          {/if}
        </ul>
        {#if pg.models.length > 1}
          <div
            class="flex rounded-lg border border-line bg-surface-2 p-0.5 text-[12.5px]"
            role="group"
            aria-label={t('pg.layout')}
          >
            {#each layouts as l (l)}
              <button
                type="button"
                class="h-7 rounded-md px-2.5 font-semibold {pg.layout === l
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-muted hover:text-ink'}"
                aria-pressed={pg.layout === l}
                onclick={() => (pg.layout = l)}>{t(`pg.layout.${l}`)}</button
              >
            {/each}
          </div>
        {/if}
      </div>
      {#if stacked}
        <div class="flex flex-col gap-1 px-1.5 pt-1 pb-2 sm:px-2">
          {#each pg.visibleRuns as r (r.spec.id)}
            <FitPlot
              {pg}
              runs={[r]}
              compact={mobile}
              short
              tag={modelName(r.spec)}
              drawing={drawActive}
            />
          {/each}
        </div>
      {:else}
        <div class="px-1.5 pt-1 pb-2 sm:px-2">
          <FitPlot {pg} runs={pg.visibleRuns} compact={mobile} drawing={drawActive} />
        </div>
      {/if}
      <Scrubber {pg} />
      <p class="px-3.5 text-xs text-muted">{t('pg.plot.hint')}</p>
      <ValuesTable {pg} />
    </section>

    <InsightCard {pg} compact={mobile} />

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
          <span class="text-xs text-faint"
            >{t(
              pg.targetKind === 'formula' ? 'pg.score.legend' : `pg.score.legend.${pg.targetKind}`,
            )}</span
          >
        </div>
        <div class="p-1.5"><Leaderboard {pg} /></div>
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
