<script lang="ts">
  import { paramCountOf } from '@xtraplaytion/engine';
  import { useTranslations, type MessageKey } from '../../i18n';
  import { specConfig, type Playground } from '../../lib/playground.svelte.ts';
  import Swatch from './Swatch.svelte';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();

  type Key = 'inside' | 'val' | 'gap' | 'beyond' | 'params';
  const columns: { key: Key; label: MessageKey; help?: MessageKey }[] = [
    { key: 'inside', label: 'pg.score.inside' },
    { key: 'val', label: 'pg.score.val' },
    { key: 'gap', label: 'pg.score.gap', help: 'pg.score.gapHelp' },
    { key: 'beyond', label: 'pg.score.beyond', help: 'pg.score.beyondHelp' },
    { key: 'params', label: 'pg.score.params' },
  ];
  let sortKey = $state<Key | null>(null);

  const rows = $derived(
    pg.models.map((m) => {
      const run = pg.runOf(m);
      const f = run?.frameAt(pg.viewEpoch) ?? null;
      // Validation in the same units as the other columns (RMSE) when the loss is MSE.
      const val = f ? (m.loss === 'mse' ? Math.sqrt(f.valLoss) : f.valLoss) : NaN;
      return {
        spec: m,
        status: run?.status,
        gpu: run?.backend === 'webgpu',
        values: {
          inside: f?.metrics.inside ?? NaN,
          val,
          gap: f?.metrics.gap ?? NaN,
          beyond: f?.metrics.beyond ?? NaN,
          params: paramCountOf(specConfig(m)),
        } as Record<Key, number>,
      };
    }),
  );

  // Lower is better in every column; missing values go last.
  const sorted = $derived.by(() => {
    const k = sortKey;
    if (!k) return rows;
    const v = (x: number) => (Number.isFinite(x) ? x : Infinity);
    return rows.slice().sort((a, b) => v(a.values[k]) - v(b.values[k]));
  });

  const fmt = (v: number) => {
    if (!Number.isFinite(v)) return '-';
    return v >= 100 ? v.toExponential(1).replace('e+', 'e') : v >= 10 ? v.toFixed(1) : v.toFixed(3);
  };
  const badge = (s: string | undefined): MessageKey | null =>
    s === 'diverged'
      ? 'pg.score.diverged'
      : s === 'queued'
        ? 'pg.score.queued'
        : s === 'error'
          ? 'pg.score.error'
          : null;
</script>

<div class="overflow-x-auto">
  <table class="w-full border-collapse text-[13px]">
    <thead>
      <tr
        class="border-b border-line text-end text-[11.5px] font-semibold whitespace-nowrap text-muted"
      >
        <th scope="col" class="px-2.5 py-1.5 text-start">{t('pg.score.model')}</th>
        {#each columns as c (c.key)}
          <th scope="col" class="px-1 py-0.5" aria-sort={sortKey === c.key ? 'ascending' : 'none'}>
            <button
              type="button"
              class="min-h-8 rounded-md px-1.5 hover:text-ink {sortKey === c.key
                ? 'text-ink underline decoration-accent decoration-2 underline-offset-4'
                : ''}"
              title={c.help ? t(c.help) : t('pg.score.sort', { column: t(c.label) })}
              onclick={() => (sortKey = sortKey === c.key ? null : c.key)}>{t(c.label)}</button
            >
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each sorted as r (r.spec.id)}
        {@const b = badge(r.status)}
        <tr
          class="border-b border-line/60 text-end font-mono text-[12.5px] last:border-0 {r.spec
            .visible
            ? ''
            : 'opacity-55'}"
        >
          <th scope="row" class="px-2.5 py-2 text-start font-sans font-semibold whitespace-nowrap"
            ><span class="flex items-center gap-2"
              ><Swatch color={r.spec.color} width={22} />N{r.spec.color}
              {#if r.gpu}<abbr
                  class="rounded-full border border-line px-1.5 text-[10.5px] font-medium text-muted no-underline"
                  title={t('pg.score.gpuHelp')}>{t('pg.score.gpu')}</abbr
                >{/if}
              {#if b}<span
                  class="rounded-full bg-accent-soft px-1.5 text-[11px] font-medium text-muted"
                  >{t(b)}</span
                >{/if}</span
            ></th
          >
          {#each columns as c (c.key)}
            <td class="px-2.5 py-2"
              >{c.key === 'params'
                ? r.values.params.toLocaleString('en')
                : fmt(r.values[c.key])}</td
            >
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
