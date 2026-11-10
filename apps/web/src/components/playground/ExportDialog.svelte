<script lang="ts">
  // Export dialog: a live preview of the frame plus the options, then an offline render
  // of the stored race to MP4, WebM, GIF or PNG on this device.
  import { onMount, untrack } from 'svelte';
  import { useTranslations, type MessageKey } from '../../i18n';
  import {
    ASPECTS,
    drawExportFrame,
    timeline,
    type Aspect,
    type ExportShow,
    type ExportStatic,
  } from '../../lib/export/frame.ts';
  import {
    defaultTitle,
    endEpochOf,
    exportStatic,
    hasRegions,
    momentOf,
  } from '../../lib/export/scene.ts';
  import { prepareTitle, splitTitle, type TitleBlock } from '../../lib/export/title.ts';
  import type { ExportFormat } from '../../lib/export/render.ts';
  import type { Playground } from '../../lib/playground.svelte.ts';
  import { readTheme } from '../../lib/scene/draw.ts';
  import Icon from '../Icon.svelte';

  const { pg, onclose }: { pg: Playground; onclose: () => void } = $props();
  const t = useTranslations();

  const ASPECT_LIST: Aspect[] = ['9:16', '1:1', '4:5', '16:9'];
  const FORMATS: ExportFormat[] = ['mp4', 'webm', 'gif', 'png'];
  const LABEL: Record<ExportFormat, string> = { mp4: 'MP4', webm: 'WebM', gif: 'GIF', png: 'PNG' };

  let dialog = $state<HTMLDialogElement>();
  let themeEl = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();

  // The race is frozen while the dialog is open (opening it pauses the race).
  const initial = untrack(() => ({
    runs: pg.visibleRuns,
    end: endEpochOf(pg),
    view: pg.viewEpoch,
    title: defaultTitle(pg, t),
    layout: pg.layout,
    regions: hasRegions(pg),
  }));
  const { runs, end } = initial;
  const pngEpoch = Math.min(end, initial.view);

  let aspect = $state<Aspect>('9:16');
  let sizeIndex = $state(0);
  let format = $state<ExportFormat>('mp4');
  let theme = $state<'light' | 'dark'>(
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  let title = $state(initial.title);
  let subtitle = $state('');
  let signature = $state('');
  let seconds = $state(12);
  let hold = $state(true);
  let layout = $state(initial.layout);
  let show = $state<ExportShow>({
    epoch: true,
    config: true,
    loss: true,
    legend: true,
    glow: true,
    regions: initial.regions,
    credit: true,
  });
  let support = $state<{ mp4: boolean; webm: boolean } | null>(null);

  let titleBlock = $state.raw<TitleBlock>({ pieces: [] });
  let subBlock = $state.raw<TitleBlock>({ pieces: [] });
  let badTex = $state(false);

  let phase = $state<'edit' | 'rendering' | 'done' | 'error'>('edit');
  let progress = $state(0);
  let result = $state<{ url: string; size: number; format: ExportFormat; name: string } | null>(
    null,
  );
  let abort: AbortController | null = null;
  let previewPlaying = $state(false);
  let previewEpoch = $state(end);

  const size = $derived(
    ASPECTS[aspect].sizes[Math.min(sizeIndex, ASPECTS[aspect].sizes.length - 1)],
  );
  const canVideo = $derived(support ? support.mp4 || support.webm : true);
  const usable = (f: ExportFormat) =>
    f === 'gif' || f === 'png' || !support || (f === 'mp4' ? support.mp4 : support.webm);

  // Formulas in the title are typeset (MathJax loads only when there is one).
  $effect(() => {
    const src = title;
    const sub = subtitle;
    let live = true;
    const timer = setTimeout(async () => {
      const [a, b] = await Promise.all([prepareTitle(src), prepareTitle(sub)]);
      if (!live) return;
      titleBlock = a;
      subBlock = b;
      badTex = [...a.pieces, ...b.pieces].some((p) => p.kind === 'math' && !p.dl);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });

  const st = $derived.by((): ExportStatic | null => {
    void theme;
    if (!themeEl) return null;
    return exportStatic(
      pg,
      { aspect, layout, show: { ...show }, signature },
      readTheme(themeEl),
      titleBlock,
      subBlock,
      t,
    );
  });

  // Preview: the frame at the preview epoch, drawn at the preview's own size.
  $effect(() => {
    if (!canvas || !st) return;
    const epoch = previewEpoch;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) drawExportFrame(ctx, st, momentOf(runs, epoch), (w * dpr) / ASPECTS[aspect].w);
  });

  function playPreview() {
    if (previewPlaying) {
      previewPlaying = false;
      return;
    }
    previewPlaying = true;
    const fps = 30;
    const frames = Math.round(seconds * fps);
    const epochs = timeline(end, frames, hold ? Math.round(Math.min(2, seconds / 2) * fps) : 0);
    const t0 = performance.now();
    const tick = (now: number) => {
      if (!previewPlaying) return;
      const k = Math.floor(((now - t0) / 1000) * fps);
      if (k >= epochs.length) {
        previewPlaying = false;
        previewEpoch = end;
        return;
      }
      previewEpoch = epochs[k];
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  onMount(() => {
    dialog?.showModal();
    import('../../lib/export/render.ts')
      .then(({ videoSupport }) => videoSupport(size[0], size[1]))
      .then((s) => {
        support = s;
        if (!usable(format)) format = s.webm ? 'webm' : 'gif';
      })
      .catch(() => (support = { mp4: false, webm: false }));
    return () => {
      previewPlaying = false;
      abort?.abort();
      if (result) URL.revokeObjectURL(result.url);
    };
  });

  function fileName(ext: string) {
    const words = splitTitle(title)
      .filter((p) => p.kind === 'text')
      .map((p) => (p.kind === 'text' ? p.text : ''))
      .join(' ')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return `${words || 'xtraplaytion'}.${ext}`;
  }

  async function render() {
    if (!st) return;
    previewPlaying = false;
    phase = 'rendering';
    progress = 0;
    abort = new AbortController();
    try {
      const { render: run, Cancelled } = await import('../../lib/export/render.ts');
      try {
        const blob = await run({
          format,
          st,
          width: size[0],
          height: size[1],
          fps: 30,
          seconds,
          holdSeconds: hold ? 2 : 0,
          endEpoch: format === 'png' ? pngEpoch : end,
          moment: (e) => momentOf(runs, e),
          signal: abort.signal,
          onProgress: (p) => (progress = p),
        });
        if (result) URL.revokeObjectURL(result.url);
        result = {
          url: URL.createObjectURL(blob),
          size: blob.size,
          format,
          name: fileName(format),
        };
        phase = 'done';
      } catch (e) {
        phase = e instanceof Cancelled ? 'edit' : 'error';
      }
    } catch {
      phase = 'error';
    }
    abort = null;
  }

  function cancel() {
    if (phase === 'rendering') abort?.abort();
    else dialog?.close();
  }

  const mb = (n: number) =>
    n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
  const SHOW_KEYS: (keyof ExportShow)[] = [
    'epoch',
    'config',
    'loss',
    'legend',
    'glow',
    'regions',
    'credit',
  ];
  const previewRatio = $derived(`${ASPECTS[aspect].w} / ${ASPECTS[aspect].h}`);
</script>

<dialog
  bind:this={dialog}
  class="m-auto max-h-[calc(100dvh-1.5rem)] w-[min(1100px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line-strong bg-surface p-0 text-ink shadow-[var(--xp-shadow)] backdrop:bg-black/45"
  aria-labelledby="export-heading"
  onclose={() => {
    abort?.abort();
    onclose();
  }}
  data-export-dialog
>
  <div hidden data-scene-theme={theme} bind:this={themeEl}></div>
  <div
    class="grid max-h-[calc(100dvh-1.5rem)] grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
  >
    <div class="flex items-center justify-center bg-surface-2 p-4 md:p-6">
      <div
        class="relative w-full max-w-[min(100%,calc((100dvh-8rem)*0.5625))] {aspect === '16:9'
          ? 'md:max-w-none'
          : ''}"
        style:aspect-ratio={previewRatio}
      >
        {#if phase === 'done' && result && (result.format === 'mp4' || result.format === 'webm')}
          <video
            class="size-full rounded-xl border border-line shadow-[var(--xp-shadow)]"
            src={result.url}
            controls
            muted
            loop
            playsinline
            data-export-video
          ></video>
        {:else if phase === 'done' && result}
          <img
            class="size-full rounded-xl border border-line object-contain shadow-[var(--xp-shadow)]"
            src={result.url}
            alt={t('export.preview')}
          />
        {:else}
          <div class="size-full" role="img" aria-label={t('export.preview')}>
            <canvas
              bind:this={canvas}
              class="size-full rounded-xl border border-line shadow-[var(--xp-shadow)]"
              aria-hidden="true"
              data-export-preview
            ></canvas>
          </div>
          {#if format !== 'png' && end > 0}
            <button
              type="button"
              class="absolute end-3 bottom-3 grid size-11 place-items-center rounded-full bg-accent text-accent-ink shadow-[var(--xp-shadow)]"
              aria-label={previewPlaying ? t('export.preview.pause') : t('export.preview.play')}
              onclick={playPreview}
              disabled={phase === 'rendering'}
            >
              <Icon name={previewPlaying ? 'pause' : 'play'} />
            </button>
          {/if}
        {/if}
      </div>
    </div>

    <div class="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <div class="flex items-center justify-between gap-3">
        <h2 id="export-heading" class="text-xl font-bold tracking-tight">{t('export.heading')}</h2>
        <button
          type="button"
          class="grid size-11 place-items-center rounded-lg text-muted hover:text-ink"
          aria-label={t('export.close')}
          onclick={() => dialog?.close()}><Icon name="x" /></button
        >
      </div>

      {#if end === 0}
        <p class="rounded-lg bg-accent-soft p-3 text-[13px]">{t('export.empty')}</p>
      {/if}

      <fieldset class="flex flex-col gap-1.5" disabled={phase === 'rendering'}>
        <legend class="xp-label mb-1.5">{t('export.format')}</legend>
        <div class="grid grid-cols-4 gap-2">
          {#each ASPECT_LIST as a (a)}
            <button
              type="button"
              class="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] p-1.5 text-[12.5px] font-semibold {aspect ===
              a
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line-strong bg-surface hover:border-accent'}"
              aria-pressed={aspect === a}
              onclick={() => {
                aspect = a;
                sizeIndex = 0;
              }}
              data-aspect={a}
            >
              <span
                class="block rounded-[3px] border-[1.5px] border-current"
                style:width="{a === '16:9' ? 30 : a === '1:1' ? 20 : a === '4:5' ? 18 : 14}px"
                style:height="{a === '16:9' ? 17 : a === '1:1' ? 20 : a === '4:5' ? 22.5 : 25}px"
              ></span>
              <span>{a} · {t(`export.aspect.${a}` as MessageKey)}</span>
            </button>
          {/each}
        </div>
      </fieldset>

      <label class="flex flex-col gap-1">
        <span class="xp-label">{t('export.titleField')}</span>
        <input
          class="xp-input font-mono"
          bind:value={title}
          maxlength="200"
          disabled={phase === 'rendering'}
          data-export-title
        />
      </label>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="xp-label">{t('export.subtitle')}</span>
          <input
            class="xp-input"
            bind:value={subtitle}
            maxlength="160"
            disabled={phase === 'rendering'}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="xp-label">{t('export.signature')}</span>
          <input
            class="xp-input"
            bind:value={signature}
            maxlength="60"
            disabled={phase === 'rendering'}
          />
        </label>
      </div>
      {#if badTex}<p class="text-xs text-bad">{t('export.badTex')}</p>{/if}

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <span class="xp-label">{t('export.file')}</span>
          <div
            class="flex rounded-lg border border-line bg-surface-2 p-0.5 text-[13px]"
            role="group"
            aria-label={t('export.file')}
          >
            {#each FORMATS as f (f)}
              <button
                type="button"
                class="h-9 flex-1 rounded-md px-2 font-semibold {format === f
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-muted hover:text-ink'}"
                aria-pressed={format === f}
                disabled={!usable(f) || phase === 'rendering'}
                onclick={() => (format = f)}
                data-format={f}>{LABEL[f]}</button
              >
            {/each}
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <span class="xp-label">{t('export.theme')}</span>
          <div
            class="flex rounded-lg border border-line bg-surface-2 p-0.5 text-[13px]"
            role="group"
            aria-label={t('export.theme')}
          >
            {#each ['light', 'dark'] as const as th (th)}
              <button
                type="button"
                class="h-9 flex-1 rounded-md px-2 font-semibold {theme === th
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-muted hover:text-ink'}"
                aria-pressed={theme === th}
                disabled={phase === 'rendering'}
                onclick={() => (theme = th)}>{t(`theme.${th}`)}</button
              >
            {/each}
          </div>
        </div>
        <label class="flex flex-col gap-1">
          <span class="xp-label">{t('export.size')}</span>
          <select class="xp-input" bind:value={sizeIndex} disabled={phase === 'rendering'}>
            {#each ASPECTS[aspect].sizes as [w, h], i (i)}
              <option value={i}>{t('export.sizeValue', { w, h })}</option>
            {/each}
          </select>
        </label>
        {#if format !== 'png'}
          <label class="flex flex-col gap-1">
            <span class="xp-label flex justify-between"
              >{t('export.length')}<span class="font-mono text-ink"
                >{t('export.seconds', { n: seconds })}</span
              ></span
            >
            <input
              type="range"
              min="4"
              max="30"
              step="1"
              bind:value={seconds}
              class="h-9 accent-[var(--xp-accent)]"
              disabled={phase === 'rendering'}
            />
          </label>
        {/if}
        {#if pg.visibleRuns.length > 1}
          <div class="flex flex-col gap-1">
            <span class="xp-label">{t('export.layout')}</span>
            <div
              class="flex rounded-lg border border-line bg-surface-2 p-0.5 text-[13px]"
              role="group"
              aria-label={t('export.layout')}
            >
              {#each ['overlay', 'stacked'] as const as l (l)}
                <button
                  type="button"
                  class="h-9 flex-1 rounded-md px-2 font-semibold {layout === l
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-muted hover:text-ink'}"
                  aria-pressed={layout === l}
                  disabled={phase === 'rendering'}
                  onclick={() => (layout = l)}>{t(`pg.layout.${l}`)}</button
                >
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <fieldset class="flex flex-col gap-1" disabled={phase === 'rendering'}>
        <legend class="xp-label mb-1">{t('export.show')}</legend>
        <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {#each SHOW_KEYS as k (k)}
            <label class="flex min-h-9 items-center gap-2.5 text-[13.5px]">
              <input
                type="checkbox"
                class="size-4 accent-[var(--xp-accent)]"
                bind:checked={show[k]}
              />
              {t(`export.show.${k}` as MessageKey)}
            </label>
          {/each}
          {#if format !== 'png'}
            <label class="flex min-h-9 items-center gap-2.5 text-[13.5px]">
              <input type="checkbox" class="size-4 accent-[var(--xp-accent)]" bind:checked={hold} />
              {t('export.show.hold')}
            </label>
          {/if}
        </div>
      </fieldset>

      <div class="mt-auto flex flex-col gap-3 border-t border-line pt-4">
        {#if phase === 'rendering'}
          <div
            class="h-2 overflow-hidden rounded bg-line"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label={t('export.rendering', { pct: Math.round(progress * 100) })}
          >
            <i class="block h-full bg-accent" style:width="{Math.round(progress * 100)}%"></i>
          </div>
        {/if}
        <div class="flex flex-wrap items-center gap-3">
          <p
            class="me-auto min-w-48 flex-1 text-xs text-muted"
            aria-live="polite"
            data-export-status
          >
            {#if phase === 'rendering'}
              {t('export.rendering', { pct: Math.round(progress * 100) })}
            {:else if phase === 'done' && result}
              {t('export.done', { format: LABEL[result.format], size: mb(result.size) })}
            {:else if phase === 'error'}
              <span class="text-bad">{t('export.failed')}</span>
            {:else if format === 'png'}
              {t('export.notePng', { epoch: pngEpoch })}
            {:else if format === 'gif'}
              {t('export.noteGif')}
            {:else if !canVideo}
              {t('export.noVideo')}
            {:else if support && !support.mp4}
              {t('export.noMp4')}
            {:else}
              {t('export.note')}
            {/if}
          </p>
          {#if phase === 'done' && result}
            <button type="button" class="xp-btn min-h-11" onclick={() => (phase = 'edit')}
              >{t('export.again')}</button
            >
            <a
              class="xp-btn xp-btn-primary min-h-11"
              href={result.url}
              download={result.name}
              data-export-download><Icon name="download" />{t('export.download')}</a
            >
          {:else}
            <button type="button" class="xp-btn min-h-11" onclick={cancel}
              >{t('export.cancel')}</button
            >
            <button
              type="button"
              class="xp-btn xp-btn-primary min-h-11"
              disabled={phase === 'rendering' || end === 0 || !st || !usable(format)}
              onclick={render}
              data-export-render
              ><Icon name="download" />{t('export.render', { format: LABEL[format] })}</button
            >
          {/if}
        </div>
      </div>
    </div>
  </div>
</dialog>
