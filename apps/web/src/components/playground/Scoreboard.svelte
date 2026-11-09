<script lang="ts">
  import { useTranslations } from '../../i18n';
  import type { Playground } from '../../lib/playground.svelte.ts';
  import Swatch from './Swatch.svelte';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();

  const fmt = (v: number | undefined) => {
    if (v === undefined || !Number.isFinite(v)) return '-';
    return v >= 100 ? v.toExponential(1).replace('e+', 'e') : v >= 10 ? v.toFixed(1) : v.toFixed(3);
  };
  // Validation in the same units as the other columns (RMSE) when the loss is MSE.
  const val = $derived(pg.loss === 'mse' ? Math.sqrt(pg.valLossNow) : pg.valLossNow);
</script>

<div class="overflow-x-auto">
  <table class="w-full border-collapse text-[13px]">
    <thead>
      <tr
        class="border-b border-line text-end text-[11.5px] font-semibold whitespace-nowrap text-muted"
      >
        <th scope="col" class="px-2.5 py-1.5 text-start">{t('pg.score.model')}</th>
        <th scope="col" class="px-2.5 py-1.5">{t('pg.score.inside')}</th>
        <th scope="col" class="px-2.5 py-1.5">{t('pg.score.val')}</th>
        <th scope="col" class="px-2.5 py-1.5"
          ><abbr title={t('pg.score.gapHelp')} class="no-underline">{t('pg.score.gap')}</abbr></th
        >
        <th scope="col" class="px-2.5 py-1.5"
          ><abbr title={t('pg.score.beyondHelp')} class="no-underline">{t('pg.score.beyond')}</abbr
          ></th
        >
        <th scope="col" class="px-2.5 py-1.5">{t('pg.score.params')}</th>
      </tr>
    </thead>
    <tbody>
      <tr class="text-end font-mono text-[12.5px]">
        <th scope="row" class="px-2.5 py-2 text-start font-sans font-semibold"
          ><span class="flex items-center gap-2"><Swatch color={1} width={22} />N1</span></th
        >
        <td class="px-2.5 py-2">{fmt(pg.metrics?.inside)}</td>
        <td class="px-2.5 py-2">{fmt(val)}</td>
        <td class="px-2.5 py-2">{fmt(pg.metrics?.gap)}</td>
        <td class="px-2.5 py-2">{fmt(pg.metrics?.beyond)}</td>
        <td class="px-2.5 py-2">{pg.paramCount.toLocaleString('en')}</td>
      </tr>
    </tbody>
  </table>
</div>
