<script lang="ts">
  import { useTranslations } from '../../i18n';
  import { formatDuration } from '../../lib/capability.ts';
  import type { Playground } from '../../lib/playground.svelte.ts';
  import Icon from '../Icon.svelte';

  const {
    pg,
    onshare,
    compact = false,
  }: { pg: Playground; onshare: () => void; compact?: boolean } = $props();
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
    if (!started) return formatDuration(pg.estimateTotal);
    if (!running || rate <= 0) return '-';
    const waiting = pg.runs.filter((r) => r.status === 'queued').length;
    const rounds = 1 + Math.ceil(waiting / pg.maxWorkers);
    return formatDuration(((pg.epochs - pg.clock) / rate) * rounds);
  });
  const nf = new Intl.NumberFormat('en');
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
      class="inline-flex h-6 items-center gap-1.5 rounded-full bg-good/15 px-2.5 text-xs font-semibold text-good"
      title={t('pg.run.backendHint')}
    >
      <span class="size-1.5 rounded-full bg-current"></span>{t('pg.run.backend')}
    </span>
    <button type="button" class="xp-btn min-h-11" onclick={onshare}
      ><Icon name="share" />{#if !compact}{t('pg.share')}{/if}<span class="sr-only"
        >{compact ? t('pg.share') : ''}</span
      ></button
    >
  </div>
</div>
