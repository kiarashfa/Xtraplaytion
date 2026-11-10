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
  import {
    deleteEntry,
    duplicateEntry,
    LibraryFailure,
    listEntries,
    renameEntry,
    saveEntry,
    storageEstimate,
    type LibraryEntry,
  } from '../../lib/library.ts';
  import { LETTER } from '../../lib/models.ts';
  import { url } from '../../lib/url.ts';
  import Icon from '../Icon.svelte';

  const t = useTranslations();
  let entries = $state.raw<LibraryEntry[]>([]);
  let loading = $state(true);
  let problem = $state('');
  let notice = $state('');
  let usage = $state<{ usage: number; quota: number } | null>(null);
  let renaming = $state<string | null>(null);
  let renameText = $state('');
  let confirming = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement>();
  // Object URLs of thumbnails (not reactive state: revoked when the page goes away).
  const thumbs: Record<string, string> = {};

  const fail = (e: unknown) =>
    (problem = t(`lib.error.${e instanceof LibraryFailure ? e.code : 'failed'}`));

  async function refresh() {
    try {
      entries = await listEntries();
      problem = '';
    } catch (e) {
      fail(e);
    }
    loading = false;
    usage = await storageEstimate();
  }

  function thumbUrl(e: LibraryEntry): string | null {
    if (!e.thumb) return null;
    const key = `${e.id}:${e.updated}`;
    thumbs[key] ??= URL.createObjectURL(
      new Blob([e.thumb as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
    );
    return thumbs[key];
  }

  onMount(() => {
    void refresh();
    return () => {
      for (const u of Object.values(thumbs)) URL.revokeObjectURL(u);
    };
  });

  const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
  const size = (b: number) =>
    b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
  const target = (e: LibraryEntry) =>
    e.state.source?.kind === 'drawn'
      ? t('lib.target.drawn')
      : e.state.source?.kind === 'points'
        ? t('lib.target.points', { count: e.state.source.xs.length })
        : e.state.expr;
  const models = (e: LibraryEntry) =>
    e.models.length
      ? e.models.join(', ')
      : e.state.models
          .map((m, i) => `${LETTER[m.model.kind === 'mlp' ? 'mlp' : m.model.kind]}${i + 1}`)
          .join(', ');

  async function rename(id: string) {
    try {
      await renameEntry(id, renameText);
      renaming = null;
      await refresh();
    } catch (e) {
      fail(e);
    }
  }

  async function duplicate(e: LibraryEntry) {
    try {
      await duplicateEntry(e.id, t('lib.copyName', { name: e.name }));
      await refresh();
    } catch (err) {
      fail(err);
    }
  }

  async function remove(id: string) {
    try {
      await deleteEntry(id);
      confirming = null;
      await refresh();
    } catch (e) {
      fail(e);
    }
  }

  async function addFile(file: File): Promise<void> {
    notice = '';
    if (file.size > MAX_FILE) {
      notice = t('pg.file.error.tooBig');
      return;
    }
    const text = await file.text().catch(() => null);
    const r = text === null ? 'notJson' : readExperimentFile(text);
    if (typeof r === 'string') {
      notice = t(`pg.file.error.${r}`);
      return;
    }
    try {
      await saveEntry({
        name: r.name || file.name.replace(/\.json$/i, ''),
        state: r.state,
        results: null,
        thumb: null,
        models: [],
      });
      notice = t('lib.added', { name: r.name || file.name });
      await refresh();
    } catch (e) {
      fail(e);
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-3">
    <p class="min-w-0 flex-1 text-sm text-muted">{t('lib.intro')}</p>
    <button type="button" class="xp-btn min-h-11" onclick={() => fileInput?.click()}
      ><Icon name="folder" />{t('lib.openFile')}</button
    >
    <input
      bind:this={fileInput}
      type="file"
      accept=".json,application/json"
      class="hidden"
      data-lib-file
      onchange={(e) => {
        const f = e.currentTarget.files?.[0];
        if (f) void addFile(f);
        e.currentTarget.value = '';
      }}
    />
  </div>

  {#if notice}<p class="text-sm" role="status" data-lib-notice>{notice}</p>{/if}
  {#if problem}
    <p
      class="flex gap-2 rounded-xl border border-line bg-accent-soft px-3 py-2 text-sm"
      role="alert"
    >
      <Icon name="alert" />{problem}
    </p>
  {/if}

  {#if loading}
    <p class="text-muted">{t('lib.loading')}</p>
  {:else if !entries.length && !problem}
    <div class="xp-card flex flex-col items-start gap-3 p-5" data-lib-empty>
      <p class="font-semibold">{t('lib.empty')}</p>
      <p class="text-sm text-muted">{t('lib.emptyHint')}</p>
      <a class="xp-btn xp-btn-primary min-h-11" href={url('playground/')}>{t('lib.toPlayground')}</a
      >
    </div>
  {:else}
    <ul class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3" data-lib-list>
      {#each entries as e (e.id)}
        {@const thumb = thumbUrl(e)}
        <li class="xp-card flex flex-col overflow-hidden" data-lib-entry={e.id}>
          <a
            href={url(`playground/#lib=${e.id}`)}
            class="block aspect-video bg-surface-2"
            aria-label={t('lib.open', { name: e.name })}
          >
            {#if thumb}<img src={thumb} alt="" class="size-full object-cover" />{:else}<span
                class="grid size-full place-items-center text-faint"
                ><Icon name="wave" size={32} /></span
              >{/if}
          </a>
          <div class="flex flex-1 flex-col gap-1.5 p-3">
            {#if renaming === e.id}
              <form
                class="flex gap-2"
                onsubmit={(ev) => {
                  ev.preventDefault();
                  void rename(e.id);
                }}
              >
                <input
                  class="xp-input min-w-0 flex-1"
                  bind:value={renameText}
                  maxlength="120"
                  aria-label={t('lib.name')}
                />
                <button type="submit" class="xp-btn min-h-10">{t('lib.renameSave')}</button>
              </form>
            {:else}
              <h2 class="truncate font-semibold" title={e.name}>{e.name}</h2>
            {/if}
            <p class="truncate font-mono text-xs text-muted" title={target(e)}>{target(e)}</p>
            <p class="text-xs text-muted">
              {models(e)} · {e.epoch
                ? t('lib.trained', { epoch: e.epoch.toLocaleString('en') })
                : t('lib.settingsOnly')}
            </p>
            <p class="text-xs text-faint">
              {[dateFmt.format(new Date(e.updated)), e.resultBytes ? size(e.resultBytes) : '']
                .filter(Boolean)
                .join(' · ')}
            </p>
            {#if confirming === e.id}
              <div class="mt-1 flex flex-wrap items-center gap-2 text-sm" role="alert">
                <span class="w-full">{t('lib.confirmDelete', { name: e.name })}</span>
                <button
                  type="button"
                  class="xp-btn min-h-10 border-bad! text-bad"
                  onclick={() => remove(e.id)}
                  data-lib-confirm-delete>{t('lib.delete')}</button
                >
                <button type="button" class="xp-btn min-h-10" onclick={() => (confirming = null)}
                  >{t('lib.cancel')}</button
                >
              </div>
            {:else}
              <div class="mt-auto flex flex-wrap gap-1 pt-1">
                <a class="xp-btn min-h-10 px-3" href={url(`playground/#lib=${e.id}`)} data-lib-open
                  >{t('lib.openShort')}</a
                >
                <button
                  type="button"
                  class="grid size-10 place-items-center rounded-lg text-muted hover:text-ink"
                  title={t('lib.rename')}
                  aria-label={t('lib.rename')}
                  onclick={() => {
                    renaming = e.id;
                    renameText = e.name;
                  }}><Icon name="edit" /></button
                >
                <button
                  type="button"
                  class="grid size-10 place-items-center rounded-lg text-muted hover:text-ink"
                  title={t('lib.duplicate')}
                  aria-label={t('lib.duplicate')}
                  onclick={() => duplicate(e)}
                  data-lib-duplicate><Icon name="copy" /></button
                >
                <button
                  type="button"
                  class="grid size-10 place-items-center rounded-lg text-muted hover:text-ink"
                  title={t('lib.download')}
                  aria-label={t('lib.download')}
                  onclick={() => downloadText(experimentFile(e.state, e.name), fileNameFor(e.name))}
                  ><Icon name="download" /></button
                >
                <button
                  type="button"
                  class="grid size-10 place-items-center rounded-lg text-muted hover:text-bad"
                  title={t('lib.delete')}
                  aria-label={t('lib.delete')}
                  onclick={() => (confirming = e.id)}
                  data-lib-delete><Icon name="trash" /></button
                >
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <p class="text-xs text-muted">
    {t('lib.local')}
    {#if usage}{t('lib.usage', { used: size(usage.usage) })}{/if}
  </p>
</div>
