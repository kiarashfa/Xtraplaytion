<script lang="ts">
  // The embeddable race: play, title, epoch, plot and legend, with a link to the full
  // playground. Stateless: everything comes from the URL fragment or postMessage.
  import { onMount } from 'svelte';
  import { useTranslations } from '../../i18n';
  import {
    HEIGHT_MESSAGE,
    LOAD_MESSAGE,
    parseEmbedHash,
    PAUSE_MESSAGE,
    PLAY_MESSAGE,
    playgroundHash,
    recordedPresetFor,
    type EmbedParams,
  } from '../../lib/embed.ts';
  import { defaultTitle } from '../../lib/export/scene.ts';
  import { splitTitle } from '../../lib/export/title.ts';
  import { modelName, Playground } from '../../lib/playground.svelte.ts';
  import { PRESETS } from '../../lib/presets.ts';
  import { decodeState } from '../../lib/share.ts';
  import { url } from '../../lib/url.ts';
  import Icon from '../Icon.svelte';
  import Tex from '../Tex.svelte';
  import FitPlot from '../playground/FitPlot.svelte';
  import Swatch from '../playground/Swatch.svelte';

  const t = useTranslations();
  const pg = new Playground();
  pg.alwaysRecorded = true;
  pg.kinksOnPlot = false;
  let params = $state<EmbedParams>({ autoplay: false });
  let problem = $state<'bad' | 'empty' | null>(null);
  let root = $state<HTMLDivElement>();
  let narrow = $state(false);

  const running = $derived(pg.status === 'running');
  const done = $derived(pg.status === 'done' || pg.status === 'diverged');
  const failed = $derived(pg.status === 'error');
  const title = $derived(params.title ?? (pg.runs.length ? defaultTitle(pg, t) : ''));
  const stacked = $derived(pg.layout === 'stacked' && pg.visibleRuns.length > 1);
  const nf = new Intl.NumberFormat('en');
  const openHref = $derived(url('playground/') + playgroundHash(params));

  async function load(hash: string) {
    const p = parseEmbedHash(hash);
    params = p;
    problem = null;
    pg.pause();
    const preset = p.preset ? PRESETS.find((x) => x.id === p.preset) : undefined;
    if (preset) pg.applyPreset(preset);
    else if (p.code) {
      const s = await decodeState(p.code);
      if (!s) {
        problem = 'bad';
        pg.dispose();
        pg.runs = [];
        return;
      }
      // An experiment that is a recorded preset plays its recording (same everywhere).
      const rec = recordedPresetFor(s);
      if (rec) {
        pg.applyPreset(rec);
        pg.layout = s.layout;
      } else pg.loadState(s);
    } else {
      problem = 'empty';
      return;
    }
    pg.restart();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (p.autoplay && !still) pg.play();
  }

  function applyTheme() {
    const dark = params.theme
      ? params.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  $effect(() => {
    void params.theme;
    applyTheme();
  });

  onMount(() => {
    void load(location.hash);
    const onHash = () => void load(location.hash);
    addEventListener('hashchange', onHash);
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', applyTheme);

    // Commands from the embedding page. The state is validated like any shared link.
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; link?: unknown } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === LOAD_MESSAGE && typeof d.link === 'string' && d.link.length < 20000)
        void load(d.link.startsWith('#') ? d.link : `#${d.link}`);
      else if (d.type === PLAY_MESSAGE) pg.play();
      else if (d.type === PAUSE_MESSAGE) pg.pause();
    };
    addEventListener('message', onMessage);

    // Tell the embedding page how tall the content is (only the height).
    let last = 0;
    const ro = new ResizeObserver(() => {
      if (!root) return;
      narrow = root.clientWidth < 520;
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h !== last && window.parent !== window) {
        last = h;
        window.parent.postMessage({ type: HEIGHT_MESSAGE, height: h }, '*');
      }
    });
    if (root) ro.observe(root);

    const onVis = () => {
      if (document.hidden && pg.status === 'running') pg.pause();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      removeEventListener('hashchange', onHash);
      removeEventListener('message', onMessage);
      scheme.removeEventListener('change', applyTheme);
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      pg.dispose();
    };
  });
</script>

<div bind:this={root} class="xp-card overflow-hidden" data-embed>
  <div class="flex items-center gap-2.5 border-b border-line px-3 py-2">
    <button
      type="button"
      class="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink disabled:opacity-50"
      aria-label={running ? t('pg.run.pause') : done ? t('race.again') : t('pg.run.play')}
      disabled={!pg.runs.length || failed}
      onclick={() => pg.toggle()}
      data-embed-play
    >
      <Icon name={running ? 'pause' : done ? 'reset' : 'play'} size={20} />
    </button>
    <h1 class="min-w-0 flex-1 truncate text-[15px] font-semibold" data-embed-title>
      {#each splitTitle(title) as piece, i (i)}
        {#if piece.kind === 'math'}<Tex tex={piece.tex} />{:else}{piece.text}{/if}
      {/each}
    </h1>
    {#if pg.runs.length}
      <span
        class="hidden h-7 items-center rounded-md border border-line-strong px-2 font-mono text-[12.5px] whitespace-nowrap sm:inline-flex"
        data-epoch
        >{t('pg.run.epoch')}
        {nf.format(pg.viewEpoch)}<span class="text-faint">/{nf.format(pg.epochs)}</span></span
      >
    {/if}
    <a
      class="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold whitespace-nowrap hover:text-accent"
      href={openHref}
      target="_blank"
      rel="noopener"
      data-embed-open
      ><Icon name="ext" size={16} /><span class="embed-open {narrow ? 'sr-only' : ''}"
        >{t('embed.open')}</span
      ></a
    >
  </div>

  {#if problem}
    <p class="p-6 text-center text-muted" data-embed-problem>
      {t(problem === 'bad' ? 'embed.bad' : 'embed.empty')}
    </p>
  {:else if failed}
    <p class="p-6 text-center text-muted" data-embed-problem>{t('embed.failed')}</p>
  {:else}
    <div class="px-1.5 pt-1 sm:px-2">
      {#if stacked}
        {#each pg.visibleRuns as r (r.spec.id)}
          <FitPlot {pg} runs={[r]} compact short fixed tag={modelName(r.spec)} />
        {/each}
      {:else}
        <FitPlot {pg} runs={pg.visibleRuns} compact={narrow} fixed />
      {/if}
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-1.5 px-3 pt-1 pb-3 text-[12.5px]">
    {#each pg.models.filter((m) => m.visible) as m (m.id)}
      <span
        class="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 font-semibold"
        ><Swatch color={m.color} />{modelName(m)}</span
      >
    {/each}
    <span class="ms-auto text-xs text-muted">{t('embed.runs')}</span>
    <img src={url('favicon.svg')} alt="" width="18" height="18" />
  </div>
</div>
