<script lang="ts">
  import {
    MAX_DEGREE,
    MAX_DEPTH,
    MAX_HARMONICS,
    MAX_K,
    MAX_SEGMENTS,
    MAX_TREES,
    usesLength,
    usesPeriod,
    type ClassicalConfig,
  } from '@xtraplaytion/engine';
  import { useTranslations, type MessageKey } from '../../i18n';
  import {
    gpPointsUsed,
    kernelChoice,
    kernelParts,
    KERNELS,
    type KernelChoice,
  } from '../../lib/models.ts';
  import type { ClassicSpec, Playground } from '../../lib/playground.svelte.ts';

  const { pg, index, spec }: { pg: Playground; index: number; spec: ClassicSpec } = $props();
  const t = useTranslations();
  const c = $derived(spec.config);
  const width = $derived(pg.domain[1] - pg.domain[0]);
  const points = $derived(pg.data ? pg.data.trainY.length : pg.n);

  const set = (patch: Partial<ClassicalConfig>) => pg.updateClassical(index, patch);

  /** Applies a typed number if it is valid, otherwise restores the field. */
  function commit(
    el: HTMLInputElement,
    old: number,
    min: number,
    max: number,
    apply: (v: number) => void,
    integer = true,
  ) {
    const raw = Number(el.value);
    if (el.value.trim() === '' || !Number.isFinite(raw)) {
      el.value = String(old);
      return;
    }
    const v = Math.min(max, Math.max(min, integer ? Math.round(raw) : raw));
    el.value = String(v);
    if (v !== old) apply(v);
  }
</script>

{#snippet num(
  label: string,
  value: number,
  min: number,
  max: number,
  apply: (v: number) => void,
  integer = true,
)}
  <label class="flex flex-col gap-1"
    ><span class="xp-label">{label}</span>
    <input
      class="xp-input font-mono"
      type="number"
      inputmode={integer ? 'numeric' : 'decimal'}
      {min}
      {max}
      step={integer ? 1 : 'any'}
      {value}
      onchange={(e) => commit(e.currentTarget, value, min, max, apply, integer)}
    />
  </label>
{/snippet}

<div class="grid grid-cols-2 gap-2">
  {#if c.kind === 'poly'}
    {@render num(t('pg.poly.degree'), c.degree, 0, MAX_DEGREE, (degree) => set({ degree }))}
  {:else if c.kind === 'fourier'}
    {@render num(t('pg.fourier.harmonics'), c.harmonics, 0, MAX_HARMONICS, (harmonics) =>
      set({ harmonics }),
    )}
    {@render num(t('pg.fourier.period'), c.period, 0, 1e6, (period) => set({ period }), false)}
    <p class="col-span-2 text-xs text-muted">{t('pg.fourier.periodHint')}</p>
  {:else if c.kind === 'spline'}
    {@render num(t('pg.spline.segments'), c.segments, 1, MAX_SEGMENTS, (segments) =>
      set({ segments }),
    )}
    {@render num(
      t('pg.spline.smoothing'),
      c.smoothing,
      0,
      1e6,
      (smoothing) => set({ smoothing }),
      false,
    )}
    <p class="col-span-2 text-xs text-muted">{t('pg.spline.hint')}</p>
  {:else if c.kind === 'knn'}
    {@render num(t('pg.knn.k'), c.k, 1, MAX_K, (k) => set({ k }))}
    <label class="flex flex-col gap-1"
      ><span class="xp-label">{t('pg.knn.weights')}</span>
      <select
        class="xp-input"
        value={c.weights}
        onchange={(e) => set({ weights: e.currentTarget.value as 'uniform' | 'distance' })}
      >
        <option value="uniform">{t('pg.knn.uniform')}</option>
        <option value="distance">{t('pg.knn.distance')}</option>
      </select>
    </label>
  {:else if c.kind === 'tree'}
    <label class="col-span-2 flex flex-col gap-1"
      ><span class="xp-label">{t('pg.tree.ensemble')}</span>
      <select
        class="xp-input"
        value={c.ensemble}
        onchange={(e) => {
          const ensemble = e.currentTarget.value as 'single' | 'forest' | 'boost';
          // Typical depths: forests grow deep trees, boosting stacks shallow ones.
          set({ ensemble, depth: ensemble === 'boost' ? 3 : ensemble === 'forest' ? 8 : 5 });
        }}
      >
        {#each ['single', 'forest', 'boost'] as e (e)}<option value={e}
            >{t(`tree.${e}` as MessageKey)}</option
          >{/each}
      </select>
    </label>
    {@render num(t('pg.tree.depth'), c.depth, 1, MAX_DEPTH, (depth) => set({ depth }))}
    {@render num(t('pg.tree.minLeaf'), c.minLeaf, 1, 1000, (minLeaf) => set({ minLeaf }))}
    {#if c.ensemble !== 'single'}
      {@render num(
        t(c.ensemble === 'boost' ? 'pg.tree.rounds' : 'pg.tree.trees'),
        c.trees,
        1,
        MAX_TREES,
        (trees) => set({ trees }),
      )}
    {/if}
    {#if c.ensemble === 'boost'}
      {@render num(t('pg.tree.lr'), c.lr, 0.0001, 1, (lr) => set({ lr }), false)}
    {/if}
  {:else if c.kind === 'gp'}
    {@const parts = c.kernel}
    <label class="col-span-2 flex flex-col gap-1"
      ><span class="xp-label">{t('pg.gp.kernel')}</span>
      <select
        class="xp-input"
        value={kernelChoice(parts)}
        onchange={(e) =>
          set({ kernel: kernelParts(e.currentTarget.value as KernelChoice, width, parts) })}
      >
        {#each KERNELS as k (k)}<option value={k}>{t(`kernel.${k}` as MessageKey)}</option>{/each}
      </select>
    </label>
    <fieldset class="col-span-2 flex flex-col gap-1">
      <legend class="xp-label mb-1">{t('pg.gp.mode')}</legend>
      <div class="grid grid-cols-2 gap-1 rounded-lg border border-line p-0.5" role="radiogroup">
        {#each [true, false] as tune (tune)}
          <button
            type="button"
            role="radio"
            aria-checked={c.tune === tune}
            class="min-h-9 rounded-md text-[13px] font-semibold {c.tune === tune
              ? 'bg-accent-soft text-ink'
              : 'text-muted hover:text-ink'}"
            onclick={() => set({ tune })}>{t(tune ? 'pg.gp.tune' : 'pg.gp.fixed')}</button
          >
        {/each}
      </div>
    </fieldset>
    {#each parts as p, i (i)}
      {#if usesLength(p.kind)}
        {@render num(
          parts.length > 1 ? `${t('pg.gp.length')} ${i + 1}` : t('pg.gp.length'),
          p.length,
          1e-6,
          1e6,
          (length) => set({ kernel: parts.map((q, k) => (k === i ? { ...q, length } : q)) }),
          false,
        )}
      {/if}
      {#if usesPeriod(p.kind)}
        {@render num(
          t('pg.gp.period'),
          p.period,
          1e-6,
          1e6,
          (period) => set({ kernel: parts.map((q, k) => (k === i ? { ...q, period } : q)) }),
          false,
        )}
      {/if}
    {/each}
    {@render num(t('pg.gp.noise'), c.noise, 0.0001, 100, (noise) => set({ noise }), false)}
    <p class="col-span-2 text-xs text-muted">{t(c.tune ? 'pg.gp.tuneHint' : 'pg.gp.fixedHint')}</p>
    {#if gpPointsUsed(points) < points}
      <p class="col-span-2 text-xs text-muted">
        {t('pg.gp.subset', { used: gpPointsUsed(points), total: points })}
      </p>
    {/if}
  {/if}
</div>
