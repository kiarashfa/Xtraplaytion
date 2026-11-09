<script lang="ts">
  import { useTranslations, type MessageKey } from '../../i18n';
  import { ACTIVATIONS, LOSSES, OPTIMIZERS, type Playground } from '../../lib/playground.svelte.ts';
  import { LIMITS } from '../../lib/share.ts';
  import Icon from '../Icon.svelte';
  import Swatch from './Swatch.svelte';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();
  const dims = $derived(`[1, ${pg.layers.map((l) => l.width).join(', ')}, 1]`);

  function setWidth(i: number, raw: string) {
    const w = Math.round(Number(raw));
    if (!Number.isFinite(w)) return;
    pg.layers = pg.layers.map((l, k) =>
      k === i ? { ...l, width: Math.min(LIMITS.width, Math.max(1, w)) } : l,
    );
  }
</script>

<div class="flex flex-col gap-2.5">
  <div
    class="rounded-xl border border-accent bg-surface p-2.5 shadow-[0_0_0_3px_var(--xp-accent-soft)]"
  >
    <div class="flex items-center gap-2.5">
      <Swatch color={1} />
      <span class="text-[13px] font-semibold">{t('pg.model.name')}</span>
    </div>
    <p class="mt-0.5 ps-[38px] font-mono text-[11.5px] text-muted">
      {dims} · {t('pg.model.params', { count: pg.paramCount })}
    </p>
    <ol class="mt-2 flex flex-col gap-1.5">
      {#each pg.layers as layer, i (i)}
        <li class="grid grid-cols-[3.2rem_1fr_auto] items-center gap-1.5">
          <input
            class="xp-input min-h-9! px-1.5! text-center font-mono"
            type="number"
            min="1"
            max={LIMITS.width}
            aria-label={t('pg.model.width', { index: i + 1 })}
            value={layer.width}
            onchange={(e) => setWidth(i, e.currentTarget.value)}
          />
          <select
            class="xp-input min-h-9!"
            aria-label={t('pg.model.act', { index: i + 1 })}
            value={layer.act}
            onchange={(e) =>
              (pg.layers = pg.layers.map((l, k) =>
                k === i ? { ...l, act: e.currentTarget.value as typeof l.act } : l,
              ))}
          >
            {#each ACTIVATIONS as a (a)}<option value={a}>{t(`act.${a}` as MessageKey)}</option
              >{/each}
          </select>
          <button
            type="button"
            class="grid size-9 place-items-center rounded-lg text-faint hover:text-ink disabled:opacity-30"
            aria-label={t('pg.model.removeLayer', { index: i + 1 })}
            disabled={pg.layers.length <= 1}
            onclick={() => (pg.layers = pg.layers.filter((_, k) => k !== i))}
            ><Icon name="x" size={16} /></button
          >
        </li>
      {/each}
    </ol>
    <button
      type="button"
      class="mt-1.5 flex min-h-9 items-center gap-1.5 text-[13px] font-semibold text-accent disabled:opacity-50"
      disabled={pg.layers.length >= LIMITS.layers}
      onclick={() => (pg.layers = [...pg.layers, { ...pg.layers[pg.layers.length - 1] }])}
    >
      <Icon name="plus" size={16} />{t('pg.model.addLayer')}
    </button>
  </div>
  <div class="grid grid-cols-2 gap-2">
    <label class="flex flex-col gap-1"
      ><span class="xp-label">{t('pg.model.optimizer')}</span>
      <select
        class="xp-input"
        value={pg.optimizer}
        onchange={(e) => (pg.optimizer = e.currentTarget.value as typeof pg.optimizer)}
      >
        {#each OPTIMIZERS as o (o)}<option value={o}>{t(`opt.${o}` as MessageKey)}</option>{/each}
      </select>
    </label>
    <label class="flex flex-col gap-1"
      ><span class="xp-label">{t('pg.model.lr')}</span>
      <input
        class="xp-input font-mono"
        inputmode="decimal"
        value={pg.lr}
        onchange={(e) => {
          const v = Number(e.currentTarget.value);
          if (v > 0 && v <= 10) pg.lr = v;
          else e.currentTarget.value = String(pg.lr);
        }}
      />
    </label>
  </div>
  <label class="flex flex-col gap-1"
    ><span class="xp-label">{t('pg.model.loss')}</span>
    <select
      class="xp-input"
      value={pg.loss}
      onchange={(e) => (pg.loss = e.currentTarget.value as typeof pg.loss)}
    >
      {#each LOSSES as l (l)}<option value={l}>{t(`loss.${l}` as MessageKey)}</option>{/each}
    </select>
  </label>
  <p class="text-xs text-muted">{t('pg.model.more')}</p>
</div>
