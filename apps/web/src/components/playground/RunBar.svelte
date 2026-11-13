<script lang="ts">
  import { useTranslations } from '../../i18n';
  import { formatDuration } from '../../lib/capability.ts';
  import type { Playground } from '../../lib/playground.svelte.ts';
  import Icon from '../Icon.svelte';
  import SaveShare from './SaveShare.svelte';
  import type { Component } from 'svelte';

  const {
    pg,
    say,
    compact = false,
  }: { pg: Playground; say: (text: string) => void; compact?: boolean } = $props();
  const t = useTranslations();
  const speeds = [1, 2, 4, 8, 16, 32, 64, 128];
  const speedIndex = $derived(Math.max(0, speeds.indexOf(pg.speed)));
  const running = $derived(pg.status === 'running');
  const active = $derived(pg.runs.filter((r) => r.status !== 'queued' && !r.finished));
  // The race moves at the pace of its slowest model.
  const rate = $derived(
    active.length && active.every((r) => r.epochsPerSec > 0)
      ? Math.min(...active.map((r) => r.epochsPerSec))
      : 0,
  );
  const started = $derived(pg.clock > 0 || running);
  const left = $derived.by(() => {
    if (pg.mode === 'recorded') {
      const frac = Math.max(0, 1 - pg.clock / pg.epochs);
      return formatDuration(pg.playbackSeconds * (started ? frac : 1));
    }
    if (!started) return formatDuration(pg.estimateTotal);
    if (!running || rate <= 0) return '-';
    const waiting = pg.runs.filter((r) => r.status === 'queued').length;
    const rounds = 1 + Math.ceil(waiting / pg.maxWorkers);
    return formatDuration(((pg.epochs - pg.clock) / rate) * rounds);
  });
  const nf = new Intl.NumberFormat('en');
  // The export dialog and its encoders load on first use.
  let Exporter = $state<Component<{ pg: Playground; onclose: () => void }> | null>(null);
  let exporting = $state(false);
  async function openExport() {
    pg.pause();
    Exporter ??= (await import('./ExportDialog.svelte')).default;
    exporting = true;
  }
  // What trains where: the runs' real backends once known, the expected one before.
  const where = $derived.by((): 'cpu' | 'gpu' | 'mixed' | 'recorded' | 'saved' => {
    if (pg.mode === 'recorded') return pg.recordedKind === 'saved' ? 'saved' : 'recorded';
    const b = pg.backends;
    if (b.length > 1) return 'mixed';
    if (b.length === 1) return b[0] === 'webgpu' ? 'gpu' : 'cpu';
    return pg.onGpu ? 'gpu' : 'cpu';
  });
</script>

<div class="xp-card flex flex-wrap items-center gap-x-3 gap-y-2 px-2.5 py-2">
  <button
    type="button"
    class="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink shadow-[0_2px_8px_color-mix(in_srgb,var(--xp-accent)_40%,transparent)] disabled:opacity-50"
    aria-label={running ? t('pg.run.pause') : t('pg.run.play')}
    disabled={!pg.data}
    onclick={() => pg.toggle()}
  >
    <Icon name={running ? 'pause' : 'play'} size={20} />
  </button>
  <button
    type="button"
    class="grid size-11 place-items-center rounded-lg text-muted hover:text-ink disabled:opacity-40"
    aria-label={t('pg.run.step')}
    title={t('pg.run.step')}
    disabled={!pg.data || pg.status === 'done' || pg.status === 'diverged'}
    onclick={() => pg.step()}
  >
    <Icon name="step" />
  </button>
  <button
    type="button"
    class="grid size-11 place-items-center rounded-lg text-muted hover:text-ink"
    aria-label={t('pg.run.reset')}
    title={t('pg.run.reset')}
    onclick={() => pg.restart()}
  >
    <Icon name="reset" />
  </button>
  <div class="min-w-36 flex-1 {compact ? '' : 'sm:max-w-56'}">
    <p class="font-mono text-[15px] font-semibold" data-epoch>
      <span class="sr-only">{t('pg.run.epoch')}</span>{nf.format(pg.viewEpoch)}
      <span class="font-normal text-faint">/ {nf.format(pg.epochs)}</span>
      {#if pg.rounds}
        <span
          class="ms-1.5 font-sans text-xs font-medium text-muted"
          title={t('pg.run.round.hint')}
          data-round>{t('pg.run.round', { n: pg.rounds[0], total: pg.rounds[1] })}</span
        >
      {/if}
    </p>
    <div class="mt-1 h-1 overflow-hidden rounded bg-line" aria-hidden="true">
      <i
        class="block h-full bg-accent"
        style:width="{Math.min(100, (100 * pg.viewEpoch) / pg.epochs)}%"
      ></i>
    </div>
  </div>
  {#if !compact}
    <label class="flex w-40 flex-col text-[11px] font-semibold text-muted">
      <span class="flex justify-between"
        >{t('pg.run.speed')}<span class="font-mono text-ink"
          >{t('pg.run.speedValue', { n: pg.speed })}</span
        ></span
      >
      <input
        type="range"
        min="0"
        max={speeds.length - 1}
        step="1"
        value={speedIndex}
        class="h-6 accent-[var(--xp-accent)]"
        oninput={(e) => pg.setSpeed(speeds[Number(e.currentTarget.value)])}
      />
    </label>
    <p class="flex flex-col text-xs leading-tight text-muted">
      {t('pg.run.rate')}<b class="font-mono text-[13px] text-ink"
        >{rate ? t('pg.run.rateValue', { n: Math.round(rate) }) : '-'}</b
      >
    </p>
    <p class="flex flex-col text-xs leading-tight text-muted">
      {started ? t('pg.run.left') : t('pg.run.estimate')}<b class="font-mono text-[13px] text-ink"
        >{left}</b
      >
    </p>
  {/if}
  <div class="ms-auto flex items-center gap-2">
    <span
      class="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap {where ===
      'cpu'
        ? 'bg-good/15 text-good'
        : where === 'recorded' || where === 'saved'
          ? 'bg-line text-muted'
          : 'bg-accent-soft text-accent'}"
      title={t(`pg.run.backend.${where}.hint`)}
      data-backend={where}
    >
      <span class="size-1.5 rounded-full bg-current"></span>{t(`pg.run.backend.${where}`)}
    </span>
    <SaveShare {pg} {compact} {say} />
    <button
      type="button"
      class="xp-btn min-h-11"
      disabled={!pg.runs.length}
      onclick={openExport}
      data-export
      ><Icon name="video" />{#if !compact}{t('export.open')}{/if}<span class="sr-only"
        >{compact ? t('export.open') : ''}</span
      ></button
    >
  </div>
</div>
{#if exporting && Exporter}
  <Exporter {pg} onclose={() => (exporting = false)} />
{/if}
