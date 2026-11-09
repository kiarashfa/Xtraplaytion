<script lang="ts">
  import { paramCountOf } from '@xtraplaytion/engine';
  import { useTranslations, type MessageKey } from '../../i18n';
  import { formatDuration } from '../../lib/capability.ts';
  import {
    ACTIVATIONS,
    dimsLabel,
    LOSSES,
    OPTIMIZERS,
    specConfig,
    type Layer,
    type Playground,
  } from '../../lib/playground.svelte.ts';
  import { LIMITS } from '../../lib/share.ts';
  import Icon from '../Icon.svelte';
  import Swatch from './Swatch.svelte';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();
  const sel = $derived(pg.models[pg.selected] ?? pg.models[0]);
  const name = (color: number) => `N${color}`;

  function setLayers(layers: Layer[]) {
    pg.updateModel(pg.selected, { layers });
  }

  function setWidth(i: number, raw: string) {
    const w = Math.round(Number(raw));
    if (!Number.isFinite(w)) return;
    setLayers(
      sel.layers.map((l, k) =>
        k === i ? { ...l, width: Math.min(LIMITS.width, Math.max(1, w)) } : l,
      ),
    );
  }
</script>

<div class="flex flex-col gap-2.5">
  <div class="flex items-center justify-between">
    <span class="xp-label">{t('pg.models.list')}</span>
    <span class="text-xs text-faint"
      >{t('pg.models.count', { count: pg.models.length, max: LIMITS.models })}</span
    >
  </div>
  <ul class="flex flex-col gap-1.5">
    {#each pg.models as m, i (m.id)}
      {@const active = i === pg.selected}
      <li
        class="flex items-center gap-1 rounded-xl border bg-surface ps-2.5 {active
          ? 'border-accent shadow-[0_0_0_3px_var(--xp-accent-soft)]'
          : 'border-line'} {m.visible ? '' : 'opacity-60'}"
      >
        <button
          type="button"
          class="flex min-h-12 min-w-0 flex-1 flex-col items-start justify-center py-1.5 text-start"
          aria-label={t('pg.models.edit', { name: name(m.color) })}
          aria-pressed={active}
          onclick={() => (pg.selected = i)}
        >
          <span class="flex items-center gap-2 text-[13px] font-semibold"
            ><Swatch color={m.color} width={22} />{name(m.color)}
            <span class="font-normal text-muted">{t('pg.model.kind')}</span></span
          >
          <span class="mt-0.5 truncate font-mono text-[11.5px] text-muted"
            >{dimsLabel(m)} · {t(`act.${m.layers[0].act}` as MessageKey)} ·
            <span title={t('pg.models.etaHint')}
              >{pg.estimates[i] < 1
                ? formatDuration(pg.estimates[i])
                : t('pg.models.eta', { time: formatDuration(pg.estimates[i]) })}</span
            ></span
          >
        </button>
        <button
          type="button"
          class="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:text-ink"
          aria-label={t(m.visible ? 'pg.models.hide' : 'pg.models.show', { name: name(m.color) })}
          aria-pressed={!m.visible}
          onclick={() => pg.updateModel(i, { visible: !m.visible })}
          ><Icon name={m.visible ? 'eye' : 'eye-off'} size={17} /></button
        >
        <button
          type="button"
          class="grid size-10 shrink-0 place-items-center rounded-lg text-faint hover:text-ink disabled:opacity-30"
          aria-label={t('pg.models.remove', { name: name(m.color) })}
          disabled={pg.models.length <= 1}
          onclick={() => pg.removeModel(i)}><Icon name="x" size={16} /></button
        >
      </li>
    {/each}
  </ul>
  <button
    type="button"
    class="xp-btn min-h-10 justify-center"
    disabled={pg.models.length >= LIMITS.models}
    onclick={() => pg.addModel()}
  >
    <Icon name="copy" size={16} />{t('pg.models.duplicate', { name: name(sel.color) })}
  </button>
  {#if pg.models.length > pg.maxWorkers}
    <p class="text-xs text-muted">{t('pg.models.workers', { count: pg.maxWorkers })}</p>
  {/if}

  <div class="mt-1 rounded-xl border border-line bg-surface-2 p-2.5">
    <p class="flex items-center gap-2 text-[13px] font-semibold">
      <Swatch color={sel.color} width={22} />{t('pg.models.editing', { name: name(sel.color) })}
    </p>
    <p class="mt-0.5 font-mono text-[11.5px] text-muted">
      {dimsLabel(sel)} · {t('pg.model.params', { count: paramCountOf(specConfig(sel)) })}
    </p>
    <ol class="mt-2 flex flex-col gap-1.5">
      {#each sel.layers as layer, i (i)}
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
              setLayers(
                sel.layers.map((l, k) =>
                  k === i ? { ...l, act: e.currentTarget.value as typeof l.act } : l,
                ),
              )}
          >
            {#each ACTIVATIONS as a (a)}<option value={a}>{t(`act.${a}` as MessageKey)}</option
              >{/each}
          </select>
          <button
            type="button"
            class="grid size-9 place-items-center rounded-lg text-faint hover:text-ink disabled:opacity-30"
            aria-label={t('pg.model.removeLayer', { index: i + 1 })}
            disabled={sel.layers.length <= 1}
            onclick={() => setLayers(sel.layers.filter((_, k) => k !== i))}
            ><Icon name="x" size={16} /></button
          >
        </li>
      {/each}
    </ol>
    <button
      type="button"
      class="mt-1.5 flex min-h-9 items-center gap-1.5 text-[13px] font-semibold text-accent disabled:opacity-50"
      disabled={sel.layers.length >= LIMITS.layers}
      onclick={() => setLayers([...sel.layers, { ...sel.layers[sel.layers.length - 1] }])}
    >
      <Icon name="plus" size={16} />{t('pg.model.addLayer')}
    </button>
    <div class="mt-2 grid grid-cols-2 gap-2">
      <label class="flex flex-col gap-1"
        ><span class="xp-label">{t('pg.model.optimizer')}</span>
        <select
          class="xp-input"
          value={sel.optimizer}
          onchange={(e) =>
            pg.updateModel(pg.selected, {
              optimizer: e.currentTarget.value as typeof sel.optimizer,
            })}
        >
          {#each OPTIMIZERS as o (o)}<option value={o}>{t(`opt.${o}` as MessageKey)}</option>{/each}
        </select>
      </label>
      <label class="flex flex-col gap-1"
        ><span class="xp-label">{t('pg.model.lr')}</span>
        <input
          class="xp-input font-mono"
          inputmode="decimal"
          value={sel.lr}
          onchange={(e) => {
            const v = Number(e.currentTarget.value);
            if (v > 0 && v <= 10) pg.updateModel(pg.selected, { lr: v });
            else e.currentTarget.value = String(sel.lr);
          }}
        />
      </label>
      <label class="flex flex-col gap-1"
        ><span class="xp-label">{t('pg.model.loss')}</span>
        <select
          class="xp-input"
          value={sel.loss}
          onchange={(e) =>
            pg.updateModel(pg.selected, { loss: e.currentTarget.value as typeof sel.loss })}
        >
          {#each LOSSES as l (l)}<option value={l}>{t(`loss.${l}` as MessageKey)}</option>{/each}
        </select>
      </label>
      <label class="flex flex-col gap-1"
        ><span class="xp-label">{t('pg.models.seed')}</span>
        <span class="flex gap-1">
          <input
            class="xp-input min-w-0 flex-1 font-mono"
            type="number"
            min="0"
            max="2147483647"
            value={sel.seed}
            onchange={(e) => {
              const v = Math.round(Number(e.currentTarget.value));
              if (v >= 0 && v <= 2147483647) pg.updateModel(pg.selected, { seed: v });
              else e.currentTarget.value = String(sel.seed);
            }}
          />
          <button
            type="button"
            class="grid size-10 shrink-0 place-items-center rounded-lg border border-line text-muted hover:text-ink"
            aria-label={t('pg.models.newSeed')}
            title={t('pg.models.newSeed')}
            onclick={() => pg.updateModel(pg.selected, { seed: (sel.seed + 1) % 2147483648 })}
            ><Icon name="dice" size={16} /></button
          >
        </span>
      </label>
    </div>
  </div>
  <p class="text-xs text-muted">{t('pg.model.more')}</p>
</div>
