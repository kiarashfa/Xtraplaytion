<script lang="ts">
  // The fit plot as a table (an alternative to the canvas for screen readers and for reading
  // exact values): evenly spaced x positions, their region, the true value and each shown
  // model's prediction at the epoch on screen. Built only while open.
  import { Region } from '@xtraplaytion/engine';
  import { useTranslations } from '../../i18n';
  import { modelName, type Playground } from '../../lib/playground.svelte.ts';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();
  const ROWS = 21;
  let open = $state(false);

  const nf = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
  const num = (v: number) => (Number.isFinite(v) ? nf.format(v).replace('-', '−') : '-');
  const regionName = {
    [Region.Train]: t('pg.table.train'),
    [Region.Gap]: t('pg.table.gap'),
    [Region.Beyond]: t('pg.table.beyond'),
  } as Record<number, string>;

  const table = $derived.by(() => {
    const d = pg.data;
    if (!open || !d || d.gridX.length < 2) return null;
    const n = d.gridX.length;
    const idx = Array.from({ length: ROWS }, (_, k) => Math.round((k * (n - 1)) / (ROWS - 1)));
    const truth = d.clean.some((v) => Number.isFinite(v));
    const models = pg.visibleRuns.map((r) => ({
      name: modelName(r.spec),
      grid: r.frameAt(pg.viewEpoch)?.grid ?? null,
    }));
    return {
      truth,
      models: models.map((m) => m.name),
      rows: idx.map((i) => ({
        x: num(d.gridX[i]),
        region: regionName[d.region[i]] ?? '',
        truth: num(d.clean[i]),
        values: models.map((m) => (m.grid ? num(m.grid[i]) : '-')),
      })),
    };
  });
</script>

<details class="px-3.5 pb-3" bind:open>
  <summary
    class="inline-flex min-h-11 cursor-pointer items-center text-xs font-semibold text-muted hover:text-ink"
    >{t('pg.table.show')}</summary
  >
  {#if table}
    <div class="overflow-x-auto">
      <table class="w-full font-mono text-xs" data-values-table>
        <caption class="pb-1 text-start font-sans text-muted"
          >{t('pg.table.caption', { epoch: pg.viewEpoch })}</caption
        >
        <thead>
          <tr class="text-start text-muted">
            <th scope="col" class="px-2 py-1 text-start font-semibold">x</th>
            <th scope="col" class="px-2 py-1 text-start font-sans font-semibold"
              >{t('pg.table.region')}</th
            >
            {#if table.truth}<th scope="col" class="px-2 py-1 text-end font-sans font-semibold"
                >{t('pg.table.truth')}</th
              >{/if}
            {#each table.models as name (name)}
              <th scope="col" class="px-2 py-1 text-end font-semibold">{name}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each table.rows as row, i (i)}
            <tr class="border-t border-line">
              <th scope="row" class="px-2 py-0.5 text-start font-normal">{row.x}</th>
              <td class="px-2 py-0.5 font-sans text-muted">{row.region}</td>
              {#if table.truth}<td class="px-2 py-0.5 text-end">{row.truth}</td>{/if}
              {#each row.values as v, j (j)}<td class="px-2 py-0.5 text-end">{v}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</details>
