<script lang="ts">
  import { useTranslations } from '../../i18n';
  import type { Playground } from '../../lib/playground.svelte.ts';
  import { quantize, smooth } from '../../lib/source.ts';
  import Icon from '../Icon.svelte';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();
  const d = $derived(pg.drawing);
  const fmt = (v: number) => (+v.toPrecision(3)).toString().replace('-', '−');
  // Part of the plot range without a drawing (no true curve there).
  const partial = $derived(!!d && (d.x0 > pg.domain[0] + 1e-9 || d.x1 < pg.domain[1] - 1e-9));
</script>

<div class="flex flex-col gap-2 text-[13px]" data-draw-panel>
  <p class="flex gap-2 text-muted">
    <span class="mt-0.5 shrink-0 text-accent"><Icon name="pen" size={16} /></span>
    <span>{d ? t('pg.draw.again') : t('pg.draw.start')}</span>
  </p>
  {#if d}
    <p class="text-xs text-muted" data-drawn-range>
      {t('pg.draw.range', { from: fmt(d.x0), to: fmt(d.x1), knots: d.ys.length })}
      {#if partial}{t('pg.draw.partial')}{/if}
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="xp-btn min-h-10 px-3"
        onclick={() => d && (pg.drawing = { ...d, ys: quantize(smooth(d.ys)) })}
        ><Icon name="wave" size={16} />{t('pg.draw.smooth')}</button
      >
      <button
        type="button"
        class="xp-btn min-h-10 px-3"
        onclick={() => {
          pg.drawing = null;
          pg.drawY = null;
        }}><Icon name="trash" size={16} />{t('pg.draw.clear')}</button
      >
    </div>
  {/if}
</div>
