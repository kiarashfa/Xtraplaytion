<script lang="ts">
  import { useTranslations } from '../../i18n';
  import type { Playground } from '../../lib/playground.svelte.ts';
  import Icon from '../Icon.svelte';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();

  const pct = (x: number) => ((x - pg.domain[0]) / (pg.domain[1] - pg.domain[0])) * 100;
  const sorted = $derived(pg.bands.slice().sort((a, b) => a[0] - b[0]));

  function setEdge(i: number, side: 0 | 1, raw: string) {
    const v = Number(raw.replace('−', '-'));
    if (!Number.isFinite(v)) return;
    const [lo, hi] = pg.domain;
    const next = pg.bands.map((b) => [...b] as [number, number]);
    next[i][side] = Math.min(hi, Math.max(lo, v));
    if (next[i][0] > next[i][1]) next[i].reverse();
    pg.bands = next;
  }

  function addRange() {
    const [lo, hi] = pg.domain;
    const span = hi - lo;
    // Put the new range in the widest free stretch of the domain.
    const edges = [lo, ...sorted.flat(), hi];
    let best = [lo, hi];
    for (let i = 0; i + 1 < edges.length; i += 2)
      if (edges[i + 1] - edges[i] > best[1] - best[0] || i === 0) best = [edges[i], edges[i + 1]];
    const mid = (best[0] + best[1]) / 2;
    const half = Math.min((best[1] - best[0]) / 3, span / 8);
    pg.bands = [...pg.bands, [+(mid - half).toFixed(2), +(mid + half).toFixed(2)]];
  }
</script>

<div class="flex flex-col gap-2.5">
  <div
    class="relative h-7 overflow-hidden rounded-lg border border-line bg-[var(--xp-extrap-bg)]"
    aria-hidden="true"
  >
    {#if sorted.length === 0}
      <i class="absolute inset-0 bg-band"></i>
    {:else}
      {#each sorted as [a, b], i (i)}
        {#if i + 1 < sorted.length}
          <b
            class="absolute inset-y-0 bg-[var(--xp-interp-bg)]"
            style:left="{pct(b)}%"
            style:width="{pct(sorted[i + 1][0]) - pct(b)}%"
          ></b>
        {/if}
        <i
          class="absolute inset-y-0 border-x-[1.5px] border-dashed border-band-edge bg-band"
          style:left="{pct(a)}%"
          style:width="{pct(b) - pct(a)}%"
        ></i>
      {/each}
    {/if}
  </div>

  {#if pg.bands.length === 0}
    <p class="text-xs text-muted">{t('pg.ranges.none')}</p>
  {/if}
  <ul class="flex flex-col gap-1.5">
    {#each pg.bands as band, i (i)}
      <li class="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 py-1">
        <span
          class="size-3 shrink-0 rounded-[3px] border-[1.5px] border-dashed border-band-edge bg-band"
          aria-hidden="true"
        ></span>
        <input
          class="xp-input min-h-9! w-0 flex-1 bg-surface! font-mono"
          inputmode="decimal"
          aria-label={t('pg.ranges.from', { index: i + 1 })}
          value={band[0]}
          onchange={(e) => setEdge(i, 0, e.currentTarget.value)}
        />
        <span class="text-xs text-faint" aria-hidden="true">–</span>
        <input
          class="xp-input min-h-9! w-0 flex-1 bg-surface! font-mono"
          inputmode="decimal"
          aria-label={t('pg.ranges.to', { index: i + 1 })}
          value={band[1]}
          onchange={(e) => setEdge(i, 1, e.currentTarget.value)}
        />
        <button
          type="button"
          class="grid size-9 place-items-center rounded-lg text-faint hover:text-ink"
          aria-label={t('pg.ranges.remove', { index: i + 1 })}
          onclick={() => (pg.bands = pg.bands.filter((_, k) => k !== i))}
          ><Icon name="x" size={16} /></button
        >
      </li>
    {/each}
  </ul>
  <div class="flex items-center justify-between gap-2">
    <button
      type="button"
      class="flex min-h-9 items-center gap-1.5 text-[13px] font-semibold text-accent disabled:opacity-50"
      disabled={pg.bands.length >= 6}
      onclick={addRange}
    >
      <Icon name="plus" size={16} />{t('pg.ranges.add')}
    </button>
    <label class="flex items-center gap-2 text-xs text-muted">
      {t('pg.validation')}
      <select
        class="xp-input min-h-8! w-auto! px-1.5"
        value={pg.valFraction}
        onchange={(e) => (pg.valFraction = Number(e.currentTarget.value))}
      >
        {#each [0, 0.1, 0.2, 0.3] as v (v)}<option value={v}>{Math.round(v * 100)}%</option>{/each}
      </select>
    </label>
  </div>
</div>
