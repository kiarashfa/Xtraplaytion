<script lang="ts">
  import { useTranslations } from '../../i18n';
  import type { Playground } from '../../lib/playground.svelte.ts';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();
  const nf = new Intl.NumberFormat('en');
  const live = $derived(pg.replayEpoch === null);
</script>

<div class="flex items-center gap-2.5 px-3.5 pb-3">
  <span class="xp-label shrink-0">{t('pg.replay')}</span>
  <input
    type="range"
    class="h-6 min-w-0 flex-1 accent-[var(--xp-accent)]"
    min="0"
    max={Math.max(1, pg.maxEpoch)}
    step="1"
    value={pg.viewEpoch}
    disabled={pg.maxEpoch <= 0}
    aria-label={t('pg.replay.label')}
    aria-valuetext={nf.format(pg.viewEpoch)}
    title={t('pg.replay.hint')}
    oninput={(e) => pg.scrub(Number(e.currentTarget.value))}
  />
  <button
    type="button"
    class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold {live
      ? 'border-transparent bg-good/15 text-good'
      : 'border-line text-muted hover:text-ink'}"
    aria-pressed={live}
    onclick={() => pg.scrub(null)}
    ><span class="size-1.5 rounded-full bg-current"></span>{t('pg.replay.live')}</button
  >
</div>
