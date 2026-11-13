<script lang="ts">
  // Lesson island: predict, then race several activations on the same data.
  import { buildDataset, mlp, type Activation, type RegionMetrics } from '@xtraplaytion/engine';
  import { compile, parse } from '@xtraplaytion/expr';
  import { onMount } from 'svelte';
  import { useTranslations, type MessageKey } from '../../i18n';
  import { autoYDomain, drawFit, PlotLayers, type SceneTheme } from '../../lib/scene/draw.ts';
  import { Trainer } from '../../lib/trainer.ts';
  import { url } from '../../lib/url.ts';
  import Icon from '../Icon.svelte';
  import { prepare, watchTheme } from '../playground/canvas.ts';
  import { FramePaint } from '../playground/paint.svelte.ts';
  import Swatch from '../playground/Swatch.svelte';

  interface Props {
    expr?: string;
    domain?: [number, number];
    bands?: [number, number][];
    activations?: Activation[];
    hidden?: number[];
    epochs?: number;
    lr?: number;
    preset?: string;
    /** The prediction question, written in the lesson. */
    question: string;
  }
  const {
    expr = 'sin(3x)',
    domain = [-3, 3],
    bands = [
      [-3, -1],
      [1, 3],
    ],
    activations = ['relu', 'tanh', 'sin'],
    hidden = [10, 10],
    epochs = 3000,
    lr = 0.01,
    preset = 'sine-gap',
    question,
  }: Props = $props();

  const t = useTranslations();
  const data = $derived.by(() => {
    const parsed = parse(expr);
    const fn = parsed.ok ? compile(parsed.expr) : (x: number) => x;
    return buildDataset(fn, {
      domain,
      n: 120,
      bands,
      noise: { kind: 'none' },
      valFraction: 0,
      seed: 3,
      gridSize: 301,
    });
  });
  const yDomain = $derived(autoYDomain(data.clean, data.trainY));

  let pick = $state<number | null>(null);
  let status = $state<'idle' | 'running' | 'done'>('idle');
  let epoch = $state(0);
  let grids = $state.raw<(Float32Array | null)[]>([]);
  let metrics = $state.raw<(RegionMetrics | null)[]>([]);
  let theme = $state.raw<SceneTheme | null>(null);
  const canvases: HTMLCanvasElement[] = $state([]);
  let trainers: Trainer[] = [];
  let finished = 0;

  const winner = $derived.by(() => {
    if (status !== 'done') return -1;
    let best = -1;
    metrics.forEach((m, i) => {
      if (m && (best < 0 || m.gap < (metrics[best]?.gap ?? Infinity))) best = i;
    });
    return best;
  });

  function run() {
    trainers.forEach((tr) => tr.dispose());
    finished = 0;
    status = 'running';
    epoch = 0;
    grids = activations.map(() => null);
    metrics = activations.map(() => null);
    trainers = activations.map((act, i) => {
      const tr = new Trainer({
        frame: (f) => {
          grids = grids.map((g, k) => (k === i ? f.grid : g));
          metrics = metrics.map((m, k) => (k === i ? f.metrics : m));
          if (i === 0) epoch = f.epoch;
        },
        done: () => {
          finished++;
          if (finished === activations.length) status = 'done';
        },
      });
      tr.start({
        config: mlp({
          hidden,
          activations: hidden.map(() => act),
          optimizer: { kind: 'adam', lr },
        }),
        data,
        seed: 1,
        epochs,
        epochsPerFrame: 25,
      });
      tr.play();
      return tr;
    });
  }

  onMount(() => {
    const off = watchTheme((th) => (theme = th));
    return () => {
      off();
      trainers.forEach((tr) => tr.dispose());
    };
  });

  const layers = [new PlotLayers(), new PlotLayers(), new PlotLayers()];
  const paint = new FramePaint();
  $effect(() => () => paint.dispose());
  $effect(() => {
    if (!theme || !paint.ready()) return;
    canvases.forEach((c, i) => {
      if (!c) return;
      const { ctx, w, h } = prepare(c);
      if (!ctx || !theme) return;
      drawFit(
        ctx,
        {
          width: w,
          height: h,
          xDomain: domain,
          yDomain,
          bands,
          trainX: data.trainX,
          trainY: data.trainY,
          valX: [],
          valY: [],
          gridX: data.gridX,
          truth: data.clean,
          models: grids[i] ? [{ ys: grids[i] as Float32Array, color: i + 1 }] : [],
          regionLabels: null,
          handles: false,
          tags: {
            left: t(`act.${activations[i]}` as MessageKey),
            right: `d = [1, ${hidden.join(', ')}, 1]`,
          },
          compact: true,
          layers: layers[i],
        },
        theme,
      );
    });
  });

  const name = (i: number) => t(`act.${activations[i]}` as MessageKey);
</script>

<div class="not-prose my-6 flex flex-col gap-4">
  <div class="xp-card p-4 sm:p-5">
    <span
      class="inline-flex h-6 items-center rounded-full bg-accent-soft px-2.5 text-xs font-semibold text-accent"
      >{t('predict.badge')}</span
    >
    <p class="mt-2 mb-3 font-semibold">{question}</p>
    <div
      class="grid grid-cols-1 gap-2.5 sm:grid-cols-3"
      role="radiogroup"
      aria-label={t('predict.badge')}
    >
      {#each activations as act, i (act)}
        <button
          type="button"
          role="radio"
          aria-checked={pick === i}
          class="flex min-h-11 flex-col items-start gap-1 rounded-xl border-[1.5px] p-2.5 text-start {pick ===
          i
            ? 'border-accent bg-surface shadow-[0_0_0_3px_var(--xp-accent-soft)]'
            : 'border-line-strong bg-surface-2'}"
          onclick={() => (pick = i)}
        >
          <Swatch color={i + 1} />
          <b class="text-sm">{name(i)}</b>
        </button>
      {/each}
    </div>
    <div class="mt-3.5 flex flex-wrap items-center justify-between gap-3">
      <p class="text-[13px] text-muted" aria-live="polite">
        {#if status === 'done' && pick !== null && winner >= 0}
          {pick === winner
            ? t('predict.right', { choice: name(winner) })
            : t('predict.wrong', { choice: name(winner) })}
        {:else if pick !== null}
          {t('predict.picked', { choice: name(pick) })}
        {:else}
          {t('predict.pick')}
        {/if}
      </p>
      <button
        type="button"
        class="xp-btn xp-btn-primary min-h-11"
        disabled={status === 'running'}
        onclick={run}
      >
        <Icon name={status === 'done' ? 'reset' : 'play'} />{status === 'done'
          ? t('race.again')
          : t('race.play')}
      </button>
    </div>
  </div>

  <div class="xp-card">
    <div class="flex flex-wrap items-center gap-2 px-3.5 pt-3">
      <span class="font-mono text-sm font-semibold"
        >{t('pg.run.epoch')} {epoch} <span class="font-normal text-faint">/ {epochs}</span></span
      >
      <a class="xp-btn ms-auto min-h-9 text-[13px]" href={url(`playground/#preset=${preset}`)}
        ><Icon name="ext" size={16} />{t('race.open')}</a
      >
    </div>
    <div class="flex flex-col gap-1 p-2">
      {#each activations as act, i (act)}
        <div
          role="img"
          aria-label="{name(i)}: {metrics[i]
            ? `${t('pg.score.gap')} ${metrics[i]?.gap.toFixed(3)}`
            : ''}"
        >
          <canvas bind:this={canvases[i]} class="block h-40 w-full" aria-hidden="true"></canvas>
        </div>
      {/each}
    </div>
  </div>
</div>
