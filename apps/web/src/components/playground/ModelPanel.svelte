<script lang="ts">
  import { modelSummary } from '../../lib/describe.ts';
  import { FAMILIES, type Family } from '../../lib/models.ts';
  import { paramCountOf } from '@xtraplaytion/engine';
  import { useTranslations, type MessageKey } from '../../i18n';
  import { formatDuration } from '../../lib/capability.ts';
  import {
    ACTIVATIONS,
    copiesOf,
    familyOf,
    L2_STEPS,
    LOSSES,
    modelName,
    OPTIMIZERS,
    netConfig,
    type Layer,
    type ModelSpec,
    type NetSpec,
    type Playground,
  } from '../../lib/playground.svelte.ts';
  import { LIMITS } from '../../lib/share.ts';
  import Icon from '../Icon.svelte';
  import ClassicalEditor from './ClassicalEditor.svelte';
  import Swatch from './Swatch.svelte';

  const { pg }: { pg: Playground } = $props();
  const t = useTranslations();
  // Id of the model whose settings are open (none at first).
  let editing = $state<number | null>(null);
  let choosing = $state(false);

  function setLayers(i: number, layers: Layer[]) {
    pg.updateModel(i, { layers });
  }

  function setWidth(i: number, net: NetSpec, k: number, raw: string) {
    const w = Math.round(Number(raw));
    if (!Number.isFinite(w)) return;
    setLayers(
      i,
      net.layers.map((l, j) =>
        j === k ? { ...l, width: Math.min(LIMITS.width, Math.max(1, w)) } : l,
      ),
    );
  }

  const summary = (m: ModelSpec) => modelSummary(m, t);

  const seedLabel = (m: ModelSpec): MessageKey | null =>
    m.kind === 'mlp'
      ? 'pg.models.seed'
      : m.config.kind === 'tree' && m.config.ensemble === 'forest'
        ? 'pg.tree.seed'
        : null;
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
      {@const open = editing === m.id}
      {@const name = modelName(m)}
      {@const sk = seedLabel(m)}
      <li
        class="rounded-xl border bg-surface {open
          ? 'border-accent shadow-[0_0_0_3px_var(--xp-accent-soft)]'
          : 'border-line'}"
        data-model={name}
      >
        <div class="flex items-center gap-0.5 ps-2.5 {m.visible ? '' : 'opacity-60'}">
          <div class="flex min-h-12 min-w-0 flex-1 flex-col justify-center py-1.5">
            <span class="flex items-center gap-2 text-[13px] font-semibold"
              ><Swatch color={m.color} width={22} /><span class="whitespace-nowrap">{name}</span>
              <span class="font-normal text-muted">{t(`family.${familyOf(m)}` as MessageKey)}</span
              ></span
            >
            <span class="mt-0.5 font-mono text-[11.5px] leading-snug text-muted"
              >{summary(m)} ·
              <span title={t('pg.models.etaHint')}
                >{pg.estimates[i] < 1
                  ? formatDuration(pg.estimates[i])
                  : t('pg.models.eta', { time: formatDuration(pg.estimates[i]) })}</span
              ></span
            >
          </div>
          <button
            type="button"
            class="grid size-10 shrink-0 place-items-center rounded-lg hover:text-ink {open
              ? 'text-accent'
              : 'text-muted'}"
            aria-label={t('pg.models.edit', { name })}
            aria-expanded={open}
            aria-controls="model-editor-{m.id}"
            onclick={() => {
              pg.selected = i;
              editing = open ? null : m.id;
            }}><Icon name="edit" size={17} /></button
          >
          <button
            type="button"
            class="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:text-ink"
            aria-label={t(m.visible ? 'pg.models.hide' : 'pg.models.show', { name })}
            aria-pressed={!m.visible}
            onclick={() => pg.updateModel(i, { visible: !m.visible })}
            ><Icon name={m.visible ? 'eye' : 'eye-off'} size={17} /></button
          >
          <button
            type="button"
            class="grid size-10 shrink-0 place-items-center rounded-lg text-faint hover:text-ink disabled:opacity-30"
            aria-label={t('pg.models.remove', { name })}
            disabled={pg.models.length <= 1}
            onclick={() => pg.removeModel(i)}><Icon name="x" size={16} /></button
          >
        </div>
        {#if open}
          <div
            id="model-editor-{m.id}"
            class="flex flex-col gap-2 rounded-b-xl border-t border-line bg-surface-2 p-2.5"
          >
            <label class="flex flex-col gap-1"
              ><span class="xp-label">{t('pg.model.family')}</span>
              <select
                class="xp-input"
                value={familyOf(m)}
                onchange={(e) => pg.changeFamily(i, e.currentTarget.value as Family)}
              >
                {#each FAMILIES as f (f)}<option value={f}>{t(`family.${f}` as MessageKey)}</option
                  >{/each}
              </select>
            </label>
            {#if m.kind === 'mlp'}
              <p class="font-mono text-[11.5px] text-muted">
                {t('pg.model.params', { count: paramCountOf(netConfig(m)) })}
              </p>
              <ol class="flex flex-col gap-1.5">
                {#each m.layers as layer, k (k)}
                  <li class="grid grid-cols-[3.2rem_1fr_auto] items-center gap-1.5">
                    <input
                      class="xp-input min-h-9! px-1.5! text-center font-mono"
                      type="number"
                      min="1"
                      max={LIMITS.width}
                      aria-label={t('pg.model.width', { index: k + 1 })}
                      value={layer.width}
                      onchange={(e) => setWidth(i, m, k, e.currentTarget.value)}
                    />
                    <select
                      class="xp-input min-h-9!"
                      aria-label={t('pg.model.act', { index: k + 1 })}
                      value={layer.act}
                      onchange={(e) =>
                        setLayers(
                          i,
                          m.layers.map((l, j) =>
                            j === k ? { ...l, act: e.currentTarget.value as typeof l.act } : l,
                          ),
                        )}
                    >
                      {#each ACTIVATIONS as a (a)}<option value={a}
                          >{t(`act.${a}` as MessageKey)}</option
                        >{/each}
                    </select>
                    <button
                      type="button"
                      class="grid size-9 place-items-center rounded-lg text-faint hover:text-ink disabled:opacity-30"
                      aria-label={t('pg.model.removeLayer', { index: k + 1 })}
                      disabled={m.layers.length <= 1}
                      onclick={() =>
                        setLayers(
                          i,
                          m.layers.filter((_, j) => j !== k),
                        )}><Icon name="x" size={16} /></button
                    >
                  </li>
                {/each}
              </ol>
              <button
                type="button"
                class="flex min-h-9 items-center gap-1.5 text-[13px] font-semibold text-accent disabled:opacity-50"
                disabled={m.layers.length >= LIMITS.layers}
                onclick={() => setLayers(i, [...m.layers, { ...m.layers[m.layers.length - 1] }])}
              >
                <Icon name="plus" size={16} />{t('pg.model.addLayer')}
              </button>
              <div class="grid grid-cols-2 gap-2">
                <label class="flex flex-col gap-1"
                  ><span class="xp-label">{t('pg.model.optimizer')}</span>
                  <select
                    class="xp-input"
                    value={m.optimizer}
                    onchange={(e) =>
                      pg.updateModel(i, {
                        optimizer: e.currentTarget.value as NetSpec['optimizer'],
                      })}
                  >
                    {#each OPTIMIZERS as o (o)}<option value={o}
                        >{t(`opt.${o}` as MessageKey)}</option
                      >{/each}
                  </select>
                </label>
                <label class="flex flex-col gap-1"
                  ><span class="xp-label">{t('pg.model.lr')}</span>
                  <input
                    class="xp-input font-mono"
                    inputmode="decimal"
                    value={m.lr}
                    onchange={(e) => {
                      const v = Number(e.currentTarget.value);
                      if (v > 0 && v <= 10) pg.updateModel(i, { lr: v });
                      else e.currentTarget.value = String(m.lr);
                    }}
                  />
                </label>
                <label class="flex flex-col gap-1"
                  ><span class="xp-label">{t('pg.model.loss')}</span>
                  <select
                    class="xp-input"
                    value={m.loss}
                    onchange={(e) =>
                      pg.updateModel(i, { loss: e.currentTarget.value as NetSpec['loss'] })}
                  >
                    {#each LOSSES as l (l)}<option value={l}>{t(`loss.${l}` as MessageKey)}</option
                      >{/each}
                  </select>
                </label>
              </div>
              <details class="group rounded-lg border border-line px-2.5 py-1" open={!!m.l2}>
                <summary class="flex min-h-9 cursor-pointer items-center text-[13px] font-semibold"
                  >{t('pg.model.advanced')}</summary
                >
                <label class="flex flex-col gap-1 pb-2"
                  ><span class="xp-label">{t('pg.model.l2')}</span>
                  <select
                    class="xp-input font-mono"
                    value={String(m.l2 ?? 0)}
                    onchange={(e) => {
                      const v = Number(e.currentTarget.value);
                      pg.updateModel(i, { l2: v > 0 ? v : undefined });
                    }}
                    data-l2
                  >
                    {#each L2_STEPS as v (v)}<option value={String(v)}
                        >{v ? v.toExponential(0) : t('pg.model.l2.off')}</option
                      >{/each}
                  </select>
                  <span class="text-xs text-muted">{t('pg.model.l2.hint')}</span>
                </label>
              </details>
            {:else}
              <ClassicalEditor {pg} index={i} spec={m} />
            {/if}
            {#if sk}
              <label class="flex flex-col gap-1"
                ><span class="xp-label">{t(sk)}</span>
                <span class="flex gap-1">
                  <input
                    class="xp-input min-w-0 flex-1 font-mono"
                    type="number"
                    min="0"
                    max="2147483647"
                    value={m.seed}
                    onchange={(e) => {
                      const v = Math.round(Number(e.currentTarget.value));
                      if (v >= 0 && v <= 2147483647) pg.updateModel(i, { seed: v });
                      else e.currentTarget.value = String(m.seed);
                    }}
                  />
                  <button
                    type="button"
                    class="grid size-10 shrink-0 place-items-center rounded-lg border border-line text-muted hover:text-ink"
                    aria-label={t('pg.models.newSeed')}
                    title={t('pg.models.newSeed')}
                    onclick={() => pg.updateModel(i, { seed: (m.seed + 1) % 2147483648 })}
                    ><Icon name="dice" size={16} /></button
                  >
                </span>
              </label>
            {/if}
            {#if m.kind === 'classical' && m.config.kind === 'gp'}
              <p class="text-xs text-muted">{t('pg.copies.gp')}</p>
            {:else}
              {@const k = copiesOf(m)}
              <div
                class="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 p-2"
                data-copies
              >
                <div class="flex items-center gap-2">
                  <label class="flex min-h-10 flex-1 items-center gap-2 text-[13px] font-semibold">
                    <input
                      type="checkbox"
                      class="size-4 accent-[var(--xp-accent)]"
                      checked={k > 1}
                      onchange={(e) =>
                        pg.updateModel(i, { copies: e.currentTarget.checked ? 5 : 1 })}
                    />{t('pg.copies.label')}
                  </label>
                  {#if k > 1}
                    <select
                      class="xp-input w-20 font-mono"
                      aria-label={t('pg.copies.count')}
                      value={k}
                      onchange={(e) => pg.updateModel(i, { copies: Number(e.currentTarget.value) })}
                    >
                      {#each [2, 3, 4, 5, 6, 7, 8] as n (n)}<option value={n}>{n}</option>{/each}
                    </select>
                  {/if}
                </div>
                <p class="text-xs text-muted">
                  {k > 1 ? t('pg.copies.hint', { count: k }) : t('pg.copies.hintOff')}
                </p>
              </div>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  <button
    type="button"
    class="xp-btn min-h-10 justify-center"
    disabled={pg.models.length >= LIMITS.models}
    aria-expanded={choosing}
    aria-controls="add-model-kinds"
    onclick={() => (choosing = !choosing)}
  >
    <Icon name="plus" size={16} />{t('pg.models.add')}
  </button>
  {#if choosing && pg.models.length < LIMITS.models}
    <div
      id="add-model-kinds"
      role="group"
      aria-label={t('pg.models.choose')}
      class="-mt-1 grid grid-cols-1 gap-1 rounded-xl border border-line bg-surface p-1 sm:grid-cols-2"
    >
      {#each FAMILIES as f (f)}
        <button
          type="button"
          class="flex min-h-11 flex-col items-start rounded-lg px-2.5 py-1.5 text-start hover:bg-surface-2"
          onclick={() => {
            pg.addModel(f);
            choosing = false;
            editing = pg.models[pg.selected].id;
          }}
        >
          <span class="text-[13px] font-semibold">{t(`family.${f}` as MessageKey)}</span>
          <span class="text-[11.5px] leading-snug text-muted"
            >{t(`family.${f}.hint` as MessageKey)}</span
          >
        </button>
      {/each}
    </div>
  {/if}
  <p class="-mt-1 text-xs text-muted">
    {pg.models.length >= LIMITS.models
      ? t('pg.models.full', { max: LIMITS.models })
      : t('pg.models.addHint')}
  </p>
  {#if pg.models.filter((m) => m.kind === 'mlp').length > pg.maxWorkers}
    <p class="text-xs text-muted">{t('pg.models.workers', { count: pg.maxWorkers })}</p>
  {/if}
  {#if pg.models.some((m) => m.kind !== 'mlp')}
    <p class="text-xs text-muted">{t('pg.classical.hint')}</p>
  {/if}
</div>
