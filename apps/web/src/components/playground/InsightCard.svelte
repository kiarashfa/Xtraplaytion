<script lang="ts">
  import { histogram, paramCountOf, SNAPSHOT_PARAMS, type MLPConfig } from '@xtraplaytion/engine';
  import { useTranslations } from '../../i18n';
  import {
    canKink,
    kinkRegions,
    kinkView,
    lossMapResolution,
    missingWaves,
    neuronView,
    waveSetup,
    weightStats,
  } from '../../lib/insight.ts';
  import {
    copiesOf,
    modelName,
    type InsightTab,
    type Playground,
  } from '../../lib/playground.svelte.ts';
  import { mapLoss, type LossMap, type MapJob } from '../../lib/probe.ts';
  import { autoYDomain } from '../../lib/scene/draw.ts';
  import {
    drawHistogram,
    drawKinks,
    drawLossMap,
    drawNeurons,
    drawSeries,
    drawWaveBars,
    drawWaveHeat,
  } from '../../lib/scene/insight.ts';
  import Icon from '../Icon.svelte';
  import InsightCanvas from './InsightCanvas.svelte';
  import Swatch from './Swatch.svelte';

  const { pg, compact = false }: { pg: Playground; compact?: boolean } = $props();
  const t = useTranslations();

  const TABS: InsightTab[] = ['neurons', 'kinks', 'waves', 'weights', 'map'];
  const tab = $derived(pg.insightTab);
  const spec = $derived(pg.inspected?.spec ?? null);
  const run = $derived(pg.inspected?.run ?? null);
  const name = $derived(spec ? modelName(spec) : '');
  const color = $derived(spec?.color ?? 1);
  const data = $derived(run?.data ?? pg.data);
  const cfg = $derived.by((): MLPConfig | null => {
    const s = run?.spec ?? spec;
    if (!s || s.kind !== 'mlp') return null;
    const c = pg.configOf(s);
    return c.kind === 'mlp' ? c : null;
  });
  const params = $derived(cfg ? paramCountOf(cfg) : 0);
  const live = $derived(pg.mode === 'live');
  const copies = $derived(spec ? copiesOf(spec) : 1);
  const weights = $derived(run && cfg && live && copies === 1 ? run.weightsAt(pg.viewEpoch) : null);
  const latestOnly = $derived(!!weights && !run?.snapshots);

  // Big networks send their weights on request: once now, then every second while training.
  $effect(() => {
    const r = run;
    if (!r || !cfg || !live || copies > 1 || params <= SNAPSHOT_PARAMS) return;
    if (pg.insightTab === 'waves') return;
    void pg.clock;
    r.requestSnapshot();
    if (r.status !== 'running') return;
    const id = setInterval(() => r.requestSnapshot(), 1000);
    return () => clearInterval(id);
  });

  /** Why the open tab cannot show this model (null: it can). */
  const blocked = $derived.by((): string | null => {
    if (!spec) return t('ins.need.model');
    if (tab === 'waves') return data && waveSetup(data) ? null : t('ins.need.truth');
    if (!cfg) return t('ins.need.net');
    if (!live) return t('ins.need.live');
    if (copies > 1) return t('ins.need.copies', { name, count: copies });
    if (tab === 'kinks' && !canKink(cfg)) return t('ins.need.kinks', { name });
    if (tab === 'map' && !lossMapResolution(params, data?.trainY.length ?? 0))
      return t('ins.need.map');
    if (!weights || !data) return t('ins.need.weights');
    return null;
  });

  const yDomain = $derived(
    data
      ? autoYDomain(data.clean, data.trainY, data.valY, data.test?.y ?? [])
      : ([-1, 1] as [number, number]),
  );
  const bands = $derived(pg.bands.slice().sort((a, b) => a[0] - b[0]));
  const num = (v: number, p = 2) =>
    Number.isFinite(v)
      ? (Math.abs(v) >= 1e4 ? v.toExponential(1) : v.toFixed(p)).replace('-', '−')
      : '-';

  // ---- neurons
  const nv = $derived(
    tab === 'neurons' && !blocked && cfg && weights && data
      ? neuronView(cfg, weights.params, data)
      : null,
  );

  // ---- kinks
  const kv = $derived(
    tab === 'kinks' && !blocked && cfg && weights ? kinkView(cfg, weights.params) : null,
  );
  const kr = $derived(kv ? kinkRegions(kv.xs, pg.domain, pg.bands) : null);
  /** Weight snapshots up to the epoch shown, at most ~120 of them (for curves over training). */
  const history = $derived.by(() => {
    if (!run?.snapshots) return [];
    void run.version;
    const all = run.snapshots.frames.filter((s) => s.epoch <= pg.viewEpoch);
    const every = Math.ceil(all.length / 120);
    return all.filter((_, i) => i % every === 0 || i === all.length - 1);
  });
  const kinkCounts = $derived(
    tab === 'kinks' && cfg && kv
      ? history.map((s) => kinkView(cfg, s.params)?.xs.length ?? NaN)
      : [],
  );
  const shownGrid = $derived(run?.frameAt(pg.viewEpoch)?.grid ?? null);

  // ---- waves
  const ws = $derived(tab === 'waves' && data ? waveSetup(data) : null);
  const waveNow = $derived(ws && shownGrid ? missingWaves(ws, shownGrid) : null);
  const waveRows = $derived.by(() => {
    if (!ws || !run) return { epochs: [] as number[], rows: [] as Float32Array[] };
    void run.version;
    const frames = run.history.frames;
    return {
      epochs: frames.map((f) => f.epoch),
      rows: frames.map((f) => missingWaves(ws, f.grid)),
    };
  });
  const waveMax = $derived(ws ? Math.max(...ws.truth) * 0.8 || 1 : 1);

  // ---- weights
  const stats = $derived(
    tab === 'weights' && !blocked && cfg && weights && data
      ? weightStats(cfg, weights.params, data)
      : null,
  );
  const hists = $derived(
    stats?.map((s) => {
      const sorted = Array.from(s.weights, Math.abs).sort((a, b) => a - b);
      const limit = Math.max(1e-6, (sorted[Math.floor(0.99 * (sorted.length - 1))] ?? 1) * 1.1);
      return { limit, counts: histogram(s.weights, 30, -limit, limit).counts, s };
    }) ?? [],
  );
  const grads = $derived(
    tab === 'weights' && cfg && data && stats
      ? history.map((h) => weightStats(cfg, h.params, data).map((l) => l.gradNorm))
      : [],
  );
  const DASHES = [[], [6, 4], [2, 3], [10, 3, 2, 3], [14, 5], [4, 2, 1, 2]];
  const layerName = (i: number, n: number) =>
    i === n - 1 ? t('ins.weights.out') : t('ins.weights.layerN', { n: i + 1 });

  // ---- loss map
  let lossMap = $state.raw<LossMap | null>(null);
  let job: MapJob | null = null;
  let progress = $state<number | null>(null);
  let mapError = $state('');
  let mapSeed = 1;
  $effect(() => {
    void run;
    return () => {
      job?.cancel();
      job = null;
      lossMap = null;
      progress = null;
      mapError = '';
    };
  });
  function makeMap(newDirections: boolean) {
    if (!cfg || !weights || !data) return;
    const res = lossMapResolution(params, data.trainY.length);
    if (!res) return;
    if (newDirections) mapSeed++;
    job?.cancel();
    progress = 0;
    mapError = '';
    const j = mapLoss(
      {
        config: $state.snapshot(cfg) as MLPConfig,
        params: weights.params,
        data,
        res,
        epoch: weights.epoch,
        seed: mapSeed,
      },
      (share) => (progress = share),
    );
    job = j;
    j.promise.then(
      (m) => {
        if (job !== j) return;
        lossMap = m;
        progress = null;
        job = null;
      },
      (e: Error) => {
        if (job !== j || e.message === 'cancelled') return;
        mapError = e.message;
        progress = null;
        job = null;
      },
    );
  }
  const mapTicks = $derived.by(() => {
    if (!lossMap) return [];
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of lossMap.values)
      if (v > 0 && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    const out: number[] = [];
    for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) out.push(e);
    return out;
  });

  const h = (big: string, small: string) => (compact ? small : big);
</script>

<section class="xp-card" aria-labelledby="ins-title" data-insight>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 pt-2.5">
    <h2 id="ins-title" class="flex items-center gap-2 text-sm font-bold">
      <Icon name="target" />{t('ins.title')}
    </h2>
    <div class="flex flex-wrap gap-1.5" role="group" aria-label={t('ins.models')}>
      {#each pg.models.filter((m) => m.visible) as m (m.id)}
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[12.5px] font-semibold {spec?.id ===
          m.id
            ? 'border-accent bg-surface text-ink shadow-[0_0_0_2px_var(--xp-accent-soft)]'
            : 'border-line bg-surface-2 text-muted hover:text-ink'}"
          aria-pressed={spec?.id === m.id}
          onclick={() => (pg.inspectId = m.id)}
          ><Swatch color={m.color} width={16} />{modelName(m)}</button
        >
      {/each}
    </div>
    <span class="ms-auto text-xs text-faint" data-insight-at>
      {latestOnly && weights
        ? t('ins.atLatest', { epoch: weights.epoch.toLocaleString('en') })
        : t('ins.at', { epoch: pg.viewEpoch.toLocaleString('en') })}
    </span>
  </div>
  <div
    class="mt-2 flex gap-0.5 overflow-x-auto border-b border-line px-2.5"
    role="tablist"
    aria-label={t('ins.title')}
  >
    {#each TABS as k (k)}
      <button
        type="button"
        role="tab"
        id="ins-tab-{k}"
        aria-selected={tab === k}
        aria-controls="ins-panel"
        class="-mb-px min-h-10 shrink-0 border-b-2 px-2.5 text-[13px] font-semibold {tab === k
          ? 'border-accent text-ink'
          : 'border-transparent text-muted hover:text-ink'}"
        onclick={() => (pg.insightTab = k)}>{t(`ins.tab.${k}`)}</button
      >
    {/each}
  </div>

  <div class="p-3.5" id="ins-panel" role="tabpanel" aria-labelledby="ins-tab-{tab}">
    {#if blocked}
      <p
        class="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted"
        data-insight-blocked
      >
        <Icon name="info" />{blocked}
      </p>
    {:else if tab === 'neurons' && nv && data}
      <div
        class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
      >
        <InsightCanvas
          cls={h('h-64', 'h-52')}
          draw={(ctx, w, hh, th) =>
            drawNeurons(
              ctx,
              {
                width: w,
                height: hh,
                xDomain: pg.domain,
                yDomain,
                bands,
                gridX: data.gridX,
                color,
                compact,
                parts: nv.top.map((p) => p.ys),
                rest: nv.rest,
                sum: nv.sum,
              },
              th,
            )}
        />
        <div class="flex min-w-0 flex-col gap-2.5 text-[13px]" data-insight-neurons>
          <p>
            {nv.width > nv.top.length
              ? t('ins.neurons.lead', { name, count: nv.width, rest: nv.width - nv.top.length })
              : t('ins.neurons.leadAll', { name, count: nv.width })}
          </p>
          <ul class="flex flex-col gap-1" aria-label={t('ins.neurons.sizes')}>
            {#each nv.top as p, i (p.index)}
              <li
                class="grid grid-cols-[2.4rem_minmax(0,1fr)_3rem] items-center gap-2 text-[11.5px]"
              >
                <span class="font-mono text-faint">#{p.index + 1}</span>
                <span
                  class="h-2 rounded-full"
                  style:background-color="var(--xp-c{color})"
                  style:width="{(100 * p.size) / (nv.top[0].size || 1)}%"
                  style:opacity={Math.max(0.3, 0.95 - i * 0.08)}
                ></span>
                <span class="text-end font-mono">{num(p.size)}</span>
              </li>
            {/each}
          </ul>
          {#if nv.dead.some((d) => d)}
            <p class="flex gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[12.5px]">
              <Icon name="info" /><span
                >{nv.dead
                  .map((d, l) =>
                    d
                      ? t('ins.neurons.dead', {
                          count: d,
                          width: cfg?.hidden[l] ?? 0,
                          layer: l + 1,
                        })
                      : '',
                  )
                  .filter(Boolean)
                  .join(' ')}</span
              >
            </p>
          {/if}
          {#if latestOnly}<p class="text-xs text-muted">
              {t('ins.big', { epoch: weights?.epoch ?? 0 })}
            </p>{/if}
        </div>
      </div>
    {:else if tab === 'kinks' && data && shownGrid}
      {#if !kv}
        <p class="text-sm text-muted" data-insight-blocked>{t('ins.need.kinksBig')}</p>
      {:else}
        <div
          class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
        >
          <InsightCanvas
            cls={h('h-56', 'h-48')}
            draw={(ctx, w, hh, th) =>
              drawKinks(
                ctx,
                {
                  width: w,
                  height: hh,
                  xDomain: pg.domain,
                  yDomain,
                  bands,
                  gridX: data.gridX,
                  color,
                  compact,
                  ys: shownGrid,
                  kinks: kv.xs,
                },
                th,
              )}
          />
          <div class="flex min-w-0 flex-col gap-2.5 text-[13px]" data-insight-kinks={kv.xs.length}>
            <p>{t('ins.kinks.lead', { name, count: kv.xs.length })}</p>
            {#if kr}
              <dl class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {#each [['train', 'text-band-ink'], ['gap', 'text-interp-ink'], ['beyond', 'text-extrap-ink'], ['outside', 'text-muted']] as const as [k, c] (k)}
                  <div class="flex flex-col rounded-lg border border-line bg-surface-2 px-2 py-1.5">
                    <dt class="text-[11px] font-semibold {c}">{t(`ins.kinks.${k}`)}</dt>
                    <dd class="font-mono text-base font-semibold">{kr[k]}</dd>
                  </div>
                {/each}
              </dl>
            {/if}
            <p class="flex gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[12.5px]">
              <Icon name="info" /><span
                >{kv.xs.length
                  ? t('ins.kinks.straight', {
                      left: num(kv.xs[0], 1),
                      right: num(kv.xs[kv.xs.length - 1], 1),
                      sl: num(kv.slopeLeft),
                      sr: num(kv.slopeRight),
                    })
                  : t('ins.kinks.none', { name })}</span
              >
            </p>
            {#if kinkCounts.length > 1}
              <div>
                <span class="text-[11.5px] font-semibold text-muted">{t('ins.kinks.during')}</span>
                <InsightCanvas
                  cls="h-20"
                  draw={(ctx, w, hh, th) =>
                    drawSeries(
                      ctx,
                      {
                        width: w,
                        height: hh,
                        xs: history.map((s) => s.epoch),
                        xMax: Math.max(1, pg.epochs),
                        series: [{ ys: kinkCounts, dash: [] }],
                        color,
                      },
                      th,
                    )}
                />
              </div>
            {/if}
            {#if latestOnly}<p class="text-xs text-muted">
                {t('ins.big', { epoch: weights?.epoch ?? 0 })}
              </p>{/if}
          </div>
        </div>
      {/if}
    {:else if tab === 'waves' && ws}
      <div
        class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
      >
        <div class="flex min-w-0 flex-col gap-1">
          <span class="text-[11.5px] font-semibold text-muted">{t('ins.waves.bars')}</span>
          <InsightCanvas
            cls="h-32"
            draw={(ctx, w, hh, th) =>
              drawWaveBars(
                ctx,
                { width: w, height: hh, ks: ws.ks, truth: ws.truth, now: waveNow, color },
                th,
              )}
          />
          <span class="mt-1 text-[11.5px] font-semibold text-muted">{t('ins.waves.heat')}</span>
          <InsightCanvas
            cls={h('h-48', 'h-40')}
            draw={(ctx, w, hh, th) =>
              drawWaveHeat(
                ctx,
                {
                  width: w,
                  height: hh,
                  ks: ws.ks,
                  epochs: waveRows.epochs,
                  rows: waveRows.rows,
                  vmax: waveMax,
                  xMax: Math.max(1, pg.epochs),
                  at: pg.viewEpoch,
                  color,
                },
                th,
              )}
          />
          <span class="text-center text-[11px] text-faint">{t('ins.waves.axis')}</span>
        </div>
        <div class="flex min-w-0 flex-col gap-2.5 text-[13px]" data-insight-waves>
          <p>{t('ins.waves.lead', { name })}</p>
          <p class="flex gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[12.5px]">
            <Icon name="info" /><span>{t('ins.waves.note')}</span>
          </p>
          <p class="text-xs text-muted">{t('ins.waves.small')}</p>
        </div>
      </div>
    {:else if tab === 'weights' && stats}
      <div
        class="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-insight-weights
      >
        {#each hists as hg, i (i)}
          <div class="min-w-0">
            <span class="block text-[11.5px] font-semibold text-muted"
              >{t('ins.weights.layer', {
                name: layerName(i, hists.length),
                count: hg.s.weights.length.toLocaleString('en'),
                size: num(hg.s.weightRms),
              })}</span
            >
            <InsightCanvas
              cls="h-28"
              draw={(ctx, w, hh, th) =>
                drawHistogram(
                  ctx,
                  { width: w, height: hh, counts: hg.counts, limit: hg.limit, color },
                  th,
                )}
            />
          </div>
        {/each}
      </div>
      <div
        class="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
      >
        <div class="min-w-0">
          <span class="text-[11.5px] font-semibold text-muted">{t('ins.weights.grads')}</span>
          {#if grads.length > 1}
            <InsightCanvas
              cls="h-32"
              draw={(ctx, w, hh, th) =>
                drawSeries(
                  ctx,
                  {
                    width: w,
                    height: hh,
                    xs: history.map((s) => s.epoch),
                    xMax: Math.max(1, pg.epochs),
                    log: true,
                    series: stats.map((_, li) => ({
                      ys: grads.map((g) => g[li]),
                      dash: DASHES[li % DASHES.length],
                    })),
                  },
                  th,
                )}
            />
            <ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted">
              {#each stats as _, li (li)}
                <li class="inline-flex items-center gap-1.5">
                  <svg width="22" height="6" aria-hidden="true"
                    ><line
                      x1="1"
                      x2="21"
                      y1="3"
                      y2="3"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-dasharray={DASHES[li % DASHES.length].join(' ')}
                    /></svg
                  >{layerName(li, stats.length)}
                </li>
              {/each}
            </ul>
          {:else}
            <ul class="mt-1 flex flex-col gap-1 font-mono text-[12px]">
              {#each stats as l, li (li)}
                <li>{layerName(li, stats.length)}: {num(l.gradNorm, 4)}</li>
              {/each}
            </ul>
          {/if}
        </div>
        <div class="flex min-w-0 flex-col gap-2.5 text-[13px]">
          <p>{t('ins.weights.lead')}</p>
          {#if latestOnly}<p class="text-xs text-muted">
              {t('ins.big', { epoch: weights?.epoch ?? 0 })}
            </p>{/if}
        </div>
      </div>
    {:else if tab === 'map' && weights}
      <div
        class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
      >
        <div class="min-w-0">
          {#if lossMap}
            {@const lm = lossMap}
            <div class="flex items-stretch gap-2">
              <div class="min-w-0 max-w-[340px] flex-1">
                <InsightCanvas
                  cls="aspect-[1.1] h-auto"
                  draw={(ctx, w, hh, th) =>
                    drawLossMap(
                      ctx,
                      { width: w, height: hh, values: lm.values, res: lm.res, color },
                      th,
                    )}
                />
              </div>
              <div class="flex gap-1.5 pt-1 pb-6">
                <span
                  class="w-3 rounded border border-line-strong"
                  style:background-image="linear-gradient(var(--xp-c{color}), var(--xp-plot-bg))"
                ></span>
                <span class="flex flex-col justify-between font-mono text-[10.5px] text-faint">
                  {#each mapTicks as e (e)}<span>{`1e${e}`.replace('-', '−')}</span>{/each}
                </span>
              </div>
            </div>
          {:else}
            <p class="rounded-xl bg-surface-2 px-3 py-6 text-center text-sm text-muted">
              {t('ins.map.empty', {
                passes: (lossMapResolution(params, data?.trainY.length ?? 0) ?? 0) ** 2,
              })}
            </p>
          {/if}
        </div>
        <div class="flex min-w-0 flex-col gap-2.5 text-[13px]" data-insight-map>
          {#if lossMap}
            <p>
              {t('ins.map.lead', {
                name,
                epoch: lossMap.epoch.toLocaleString('en'),
                loss: num(lossMap.center, 4),
              })}
            </p>
            <p class="flex gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[12.5px]">
              <Icon name="info" /><span>{t('ins.map.note')}</span>
            </p>
          {/if}
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="xp-btn min-h-10"
              disabled={progress !== null}
              onclick={() => makeMap(false)}
              data-map-make>{lossMap ? t('ins.map.remap') : t('ins.map.make')}</button
            >
            {#if lossMap}
              <button
                type="button"
                class="xp-btn min-h-10"
                disabled={progress !== null}
                onclick={() => makeMap(true)}><Icon name="dice" />{t('ins.map.again')}</button
              >
            {/if}
          </div>
          {#if progress !== null}
            <p class="text-xs text-muted" role="status">
              {t('ins.map.busy', { percent: Math.round(progress * 100) })}
            </p>
          {:else if lossMap}
            <p class="text-xs text-faint">
              {t('ins.map.info', { res: lossMap.res, time: lossMap.seconds.toFixed(1) })}
            </p>
          {/if}
          {#if mapError}<p class="text-xs text-bad" role="alert">
              {t('ins.map.failed', { message: mapError })}
            </p>{/if}
        </div>
      </div>
    {/if}
  </div>
</section>
