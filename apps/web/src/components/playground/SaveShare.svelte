<script lang="ts">
  import { onMount } from 'svelte';
  import { useTranslations } from '../../i18n';
  import {
    downloadText,
    experimentFile,
    fileNameFor,
    MAX_FILE,
    readExperimentFile,
  } from '../../lib/file.ts';
  import { LibraryFailure, saveEntry } from '../../lib/library.ts';
  import { modelName, type Playground } from '../../lib/playground.svelte.ts';
  import { encodeState, MAX_LINK_CODE } from '../../lib/share.ts';
  import { thumbnail } from '../../lib/thumbnail.ts';
  import { url } from '../../lib/url.ts';
  import Icon from '../Icon.svelte';
  import EmbedCode from './EmbedCode.svelte';

  const {
    pg,
    compact = false,
    say,
  }: { pg: Playground; compact?: boolean; say: (text: string) => void } = $props();
  const t = useTranslations();

  let open = $state<'save' | 'share' | null>(null);
  let name = $state('');
  let busy = $state(false);
  let savedNote = $state('');
  let saveError = $state('');
  let linkTooBig = $state(false);
  let embedding = $state(false);
  let root = $state<HTMLDivElement>();
  let fileInput = $state<HTMLInputElement>();

  function defaultName(): string {
    const target =
      pg.targetKind === 'drawn'
        ? t('pg.fit.drawn')
        : pg.targetKind === 'points'
          ? pg.importedName || t('pg.fit.points')
          : pg.expr.length > 40
            ? `${pg.expr.slice(0, 39)}…`
            : pg.expr;
    return `${target} · ${pg.models.map(modelName).join(', ')}`;
  }

  function toggle(which: 'save' | 'share') {
    savedNote = '';
    saveError = '';
    linkTooBig = false;
    embedding = false;
    if (open === which) {
      open = null;
      return;
    }
    open = which;
    if (which === 'save') name = pg.saved?.name ?? defaultName();
  }

  async function save(asNew: boolean) {
    busy = true;
    saveError = '';
    try {
      const results = pg.recordingOfRace();
      const entry = await saveEntry({
        ...(pg.saved && !asNew ? { id: pg.saved.id } : {}),
        name,
        state: pg.snapshotState(),
        results,
        thumb: await thumbnail(pg).catch(() => null),
        models: pg.models.map(modelName),
      });
      // Remember the entry for later updates (its results are on screen already).
      pg.saved = { id: entry.id, name: entry.name, rec: null };
      savedNote = results ? t('pg.save.done') : t('pg.save.doneSettings');
    } catch (e) {
      saveError = t(`pg.save.error.${e instanceof LibraryFailure ? e.code : 'failed'}`);
    } finally {
      busy = false;
    }
  }

  async function copyLink() {
    const code = await encodeState(pg.snapshotState());
    if (code.length > MAX_LINK_CODE) {
      linkTooBig = true;
      return;
    }
    history.replaceState(null, '', `#s=${code}`);
    open = null;
    try {
      await navigator.clipboard.writeText(location.href);
      say(t('pg.share.copied'));
    } catch {
      say(t('pg.share.failed'));
    }
  }

  function download() {
    const n = pg.saved?.name ?? defaultName();
    downloadText(experimentFile(pg.snapshotState(), n), fileNameFor(n));
    open = null;
  }

  const hasNets = $derived(pg.models.some((m) => m.kind === 'mlp'));

  async function copyCode(flavor: 'pytorch' | 'jax') {
    open = null;
    const data = pg.data;
    if (!data) return say(t('pg.code.noData'));
    const { generateCode } = await import('../../lib/codegen.ts');
    const code = generateCode(flavor, {
      state: pg.snapshotState(),
      data,
      names: pg.models.map(modelName),
    });
    try {
      await navigator.clipboard.writeText(code);
      say(t('pg.code.copied'));
    } catch {
      downloadText(code, 'xtraplaytion_experiment.py', 'text/x-python');
      say(t('pg.code.downloaded'));
    }
  }

  async function openFile(file: File) {
    open = null;
    if (file.size > MAX_FILE) return say(t('pg.file.error.tooBig'));
    let text: string;
    try {
      text = await file.text();
    } catch {
      return say(t('pg.file.error.notJson'));
    }
    const r = readExperimentFile(text);
    if (typeof r === 'string') return say(t(`pg.file.error.${r}`));
    pg.loadState(r.state);
    say(t('pg.file.opened', { name: r.name || file.name }));
  }

  onMount(() => {
    const onDown = (e: PointerEvent) => {
      if (open && root && !root.contains(e.target as Node)) open = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) open = null;
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="relative flex items-center gap-2" bind:this={root}>
  <button
    type="button"
    class="xp-btn min-h-11"
    aria-expanded={open === 'save'}
    aria-controls="save-panel"
    onclick={() => toggle('save')}
    data-save
    ><Icon name="save" />{#if !compact}{t('pg.save')}{/if}<span class="sr-only"
      >{compact ? t('pg.save') : ''}</span
    ></button
  >
  <button
    type="button"
    class="xp-btn min-h-11"
    aria-expanded={open === 'share'}
    aria-controls="share-panel"
    onclick={() => toggle('share')}
    data-share
    ><Icon name="share" />{#if !compact}{t('pg.share')}{/if}<span class="sr-only"
      >{compact ? t('pg.share') : ''}</span
    ></button
  >

  {#if open === 'save'}
    <div
      id="save-panel"
      class="absolute end-0 top-full z-30 mt-2 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2.5 rounded-xl border border-line-strong bg-surface p-3 text-[13px] shadow-[var(--xp-shadow)]"
      role="dialog"
      aria-label={t('pg.save.title')}
    >
      <p class="font-semibold">{t('pg.save.title')}</p>
      <label class="flex flex-col gap-1">
        <span class="xp-label">{t('pg.save.name')}</span>
        <input class="xp-input" bind:value={name} maxlength="120" data-save-name />
      </label>
      <p class="text-xs text-muted">
        {pg.maxEpoch > 0 ? t('pg.save.hint') : t('pg.save.hintSettings')}
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="xp-btn xp-btn-primary min-h-10 px-3"
          disabled={busy}
          onclick={() => save(false)}
          data-save-confirm>{pg.saved ? t('pg.save.update') : t('pg.save.confirm')}</button
        >
        {#if pg.saved}
          <button
            type="button"
            class="xp-btn min-h-10 px-3"
            disabled={busy}
            onclick={() => save(true)}>{t('pg.save.asNew')}</button
          >
        {/if}
      </div>
      {#if savedNote}
        <p class="flex flex-wrap items-center gap-x-2 text-good" role="status" data-save-done>
          <Icon name="check" size={16} />{savedNote}
          <a class="font-semibold text-accent underline" href={url('library/')}
            >{t('pg.save.openLibrary')}</a
          >
        </p>
      {/if}
      {#if saveError}
        <p class="flex gap-2 text-bad" role="alert"><Icon name="alert" size={16} />{saveError}</p>
      {/if}
    </div>
  {/if}

  {#if open === 'share'}
    <div
      id="share-panel"
      class="absolute end-0 top-full z-30 mt-2 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-1 rounded-xl border border-line-strong bg-surface p-2 text-[13px] shadow-[var(--xp-shadow)]"
      role="dialog"
      aria-label={t('pg.share')}
    >
      {#if embedding}
        <EmbedCode {pg} {say} onback={() => (embedding = false)} />
      {:else}
        <button type="button" class="xp-menuitem" onclick={copyLink} data-share-link>
          <Icon name="link" size={16} /><span class="flex flex-col items-start"
            ><span class="font-semibold">{t('pg.share.link')}</span><span class="text-xs text-muted"
              >{t('pg.share.linkHint')}</span
            ></span
          >
        </button>
        {#if linkTooBig}
          <p class="px-2.5 pb-1 text-xs text-bad" role="alert" data-link-too-big>
            {t('pg.share.tooBig')}
          </p>
        {/if}
        <button
          type="button"
          class="xp-menuitem"
          onclick={() => (embedding = true)}
          data-share-embed
        >
          <Icon name="code" size={16} /><span class="flex flex-col items-start"
            ><span class="font-semibold">{t('embed.code.heading')}</span><span
              class="text-xs text-muted">{t('embed.code.menuHint')}</span
            ></span
          >
        </button>
        <button type="button" class="xp-menuitem" onclick={download} data-share-download>
          <Icon name="download" size={16} /><span class="flex flex-col items-start"
            ><span class="font-semibold">{t('pg.share.download')}</span><span
              class="text-xs text-muted">{t('pg.share.downloadHint')}</span
            ></span
          >
        </button>
        <button type="button" class="xp-menuitem" onclick={() => fileInput?.click()}>
          <Icon name="folder" size={16} /><span class="font-semibold">{t('pg.share.open')}</span>
        </button>
        <hr class="my-1 border-line" />
        {#if hasNets}
          <button
            type="button"
            class="xp-menuitem"
            onclick={() => copyCode('pytorch')}
            data-code="pytorch"
          >
            <Icon name="code" size={16} /><span class="flex flex-col items-start"
              ><span class="font-semibold">{t('pg.code.pytorch')}</span><span
                class="text-xs text-muted">{t('pg.code.hint')}</span
              ></span
            >
          </button>
          <button type="button" class="xp-menuitem" onclick={() => copyCode('jax')} data-code="jax">
            <Icon name="code" size={16} /><span class="font-semibold">{t('pg.code.jax')}</span>
          </button>
        {:else}
          <button
            type="button"
            class="xp-menuitem"
            onclick={() => copyCode('pytorch')}
            data-code="python"
          >
            <Icon name="code" size={16} /><span class="flex flex-col items-start"
              ><span class="font-semibold">{t('pg.code.python')}</span><span
                class="text-xs text-muted">{t('pg.code.hint')}</span
              ></span
            >
          </button>
        {/if}
      {/if}
    </div>
  {/if}
  <input
    bind:this={fileInput}
    type="file"
    accept=".json,application/json"
    class="hidden"
    data-open-file
    onchange={(e) => {
      const f = e.currentTarget.files?.[0];
      if (f) void openFile(f);
      e.currentTarget.value = '';
    }}
  />
</div>
