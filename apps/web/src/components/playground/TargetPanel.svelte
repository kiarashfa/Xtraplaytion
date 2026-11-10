<script lang="ts">
  import { useTranslations, type MessageKey } from '../../i18n';
  import type { NoiseKind, Playground, TargetTab } from '../../lib/playground.svelte.ts';
  import { PRESETS } from '../../lib/presets.ts';
  import Icon from '../Icon.svelte';
  import Tex from '../Tex.svelte';
  import DrawPanel from './DrawPanel.svelte';
  import ImportPanel from './ImportPanel.svelte';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();
  const tab = $derived(pg.targetTab);
  const TABS: [TargetTab, MessageKey][] = [
    ['formula', 'pg.tab.formula'],
    ['presets', 'pg.tab.presets'],
    ['draw', 'pg.tab.draw'],
    ['data', 'pg.tab.data'],
  ];
  const noiseKinds: NoiseKind[] = ['none', 'gaussian', 'uniform', 'outliers'];

  const errorText = $derived.by(() => {
    if (pg.parsed.ok) return '';
    const e = pg.parsed.error;
    return t(`expr.error.${e.code}` as MessageKey, e.params);
  });
  // Split the input around the error range for highlighting.
  const marked = $derived.by(() => {
    if (pg.parsed.ok) return null;
    const { start, end } = pg.parsed.error;
    const s = pg.expr;
    return {
      before: s.slice(0, start),
      bad: s.slice(start, Math.max(end, start + 1)) || ' ',
      after: s.slice(Math.max(end, start + 1)),
    };
  });

  const num = (v: string, fallback: number) => {
    const x = Number(v.replace('−', '-'));
    return Number.isFinite(x) ? x : fallback;
  };
</script>

<div class="flex flex-col gap-2.5">
  <div
    class="-mx-3 flex gap-0.5 border-b border-line px-2.5"
    role="tablist"
    aria-label={t('pg.step.target')}
  >
    {#each TABS as [id, key] (id)}
      <button
        type="button"
        role="tab"
        aria-selected={tab === id}
        data-target-tab={id}
        class="-mb-px min-h-11 border-b-2 px-2 text-[13px] font-semibold whitespace-nowrap {tab ===
        id
          ? 'border-accent text-ink'
          : 'border-transparent text-muted'}"
        onclick={() => pg.setTargetTab(id)}>{t(key)}</button
      >
    {/each}
  </div>

  {#if tab === 'formula'}
    <label class="flex flex-col gap-1">
      <span class="xp-label">{t('pg.formula.label')}</span>
      <input
        class="xp-input font-mono {pg.parsed.ok ? '' : 'border-bad!'}"
        value={pg.expr}
        oninput={(e) => (pg.expr = e.currentTarget.value)}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        aria-invalid={!pg.parsed.ok}
        aria-describedby="formula-feedback"
      />
    </label>
    <div id="formula-feedback" class="min-h-7 text-xs" aria-live="polite">
      {#if pg.parsed.ok}
        <div class="flex items-center gap-2 overflow-hidden text-muted">
          <span class="text-good"><Icon name="check" size={16} /></span>
          <span class="shrink-0">{t('pg.formula.readAs')}</span>
          <span class="truncate text-ink"><Tex tex={pg.parsed.latex} /></span>
        </div>
        {#if pg.invalidPoints > 0}
          <p class="mt-1 text-muted">{t('pg.formula.invalid', { count: pg.invalidPoints })}</p>
        {/if}
      {:else}
        <p class="flex gap-2 text-bad"><Icon name="alert" size={16} />{errorText}</p>
        {#if marked}
          <p class="mt-1 font-mono text-muted">
            {marked.before}<mark class="rounded-sm bg-bad/20 text-ink">{marked.bad}</mark
            >{marked.after}
          </p>
        {/if}
      {/if}
    </div>
  {:else if tab === 'draw'}
    <DrawPanel {pg} />
  {:else if tab === 'data'}
    <ImportPanel {pg} />
  {:else}
    <ul class="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto pe-1">
      {#each PRESETS as p (p.id)}
        <li>
          <button
            type="button"
            class="flex min-h-11 w-full flex-col items-start rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-start hover:border-accent"
            onclick={() => pg.applyPreset(p)}
          >
            <span class="text-[13px] font-semibold">{t(`preset.${p.id}.name` as MessageKey)}</span>
            <span class="font-mono text-[11.5px] text-muted">{p.expr}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="grid {tab === 'data' ? 'grid-cols-2' : 'grid-cols-3'} gap-2">
    <label class="flex flex-col gap-1"
      ><span class="xp-label">{t('pg.domain.from')}</span>
      <input
        class="xp-input font-mono"
        inputmode="decimal"
        value={pg.domain[0]}
        onchange={(e) => (pg.domain = [num(e.currentTarget.value, pg.domain[0]), pg.domain[1]])}
      />
    </label>
    <label class="flex flex-col gap-1"
      ><span class="xp-label">{t('pg.domain.to')}</span>
      <input
        class="xp-input font-mono"
        inputmode="decimal"
        value={pg.domain[1]}
        onchange={(e) => (pg.domain = [pg.domain[0], num(e.currentTarget.value, pg.domain[1])])}
      />
    </label>
    {#if tab !== 'data'}<label class="flex flex-col gap-1"
        ><span class="xp-label">{t('pg.points')}</span>
        <input
          class="xp-input font-mono"
          type="number"
          min="2"
          max="5000"
          value={pg.n}
          onchange={(e) => (pg.n = Math.round(num(e.currentTarget.value, pg.n)))}
        />
      </label>{/if}
  </div>

  {#if tab !== 'data'}<div class="grid grid-cols-[1fr_1.2fr] items-end gap-2">
      <label class="flex flex-col gap-1">
        <span class="xp-label">{t('pg.noise')}</span>
        <select
          class="xp-input"
          value={pg.noiseKind}
          onchange={(e) => (pg.noiseKind = e.currentTarget.value as NoiseKind)}
        >
          {#each noiseKinds as k (k)}<option value={k}>{t(`pg.noise.${k}`)}</option>{/each}
        </select>
      </label>
      <label class="flex flex-col gap-1 {pg.noiseKind === 'none' ? 'opacity-50' : ''}">
        <span class="xp-label"
          >{t('pg.noise.amount')}
          <span class="font-mono text-ink">σ {pg.sigma.toFixed(2)}</span></span
        >
        <input
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          class="h-9 w-full accent-[var(--xp-accent)]"
          value={pg.sigma}
          disabled={pg.noiseKind === 'none'}
          oninput={(e) => (pg.sigma = Number(e.currentTarget.value))}
        />
      </label>
    </div>{/if}
  <div class="flex items-center justify-between gap-2">
    <span class="xp-label">{t('pg.seed')} <span class="font-mono text-ink">{pg.seed}</span></span>
    <button
      type="button"
      class="xp-btn min-h-9! px-3 text-[13px]"
      onclick={() => (pg.seed = (pg.seed * 1103515245 + 12345) % 100000)}
    >
      <Icon name="dice" size={16} />{t(tab === 'data' ? 'pg.newSplit' : 'pg.newNoise')}
    </button>
  </div>
</div>
