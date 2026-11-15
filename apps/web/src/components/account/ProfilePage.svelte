<script lang="ts">
  // /user/: the visitor's profile. With nothing in this browser yet it welcomes them: set up a
  // profile, or bring a save (the "login" of a site without accounts). Otherwise it shows the
  // picture, name and numbers, cloud save, the save file, recent experiments and signing out.
  import { onMount } from 'svelte';
  import { useTranslations } from '../../i18n';
  import { finishDropbox, isDropboxReturn, startAutoSave } from '../../lib/account/cloud.ts';
  import { onLocalChange, PROVIDERS } from '../../lib/account/local.ts';
  import { cloudErrorText, describeMerge } from '../../lib/account/messages.ts';
  import {
    exportSave,
    importSave,
    MAX_SAVE,
    nothingNew,
    parseSave,
    refreshMirror,
    SAVE_FILE_NAME,
    type MergeSummary,
    type Profile,
  } from '../../lib/account/save.ts';
  import {
    emptyLearning,
    getLearning,
    hasLearning,
    learningMirror,
    mirrorLearning,
    type Learning,
  } from '../../lib/account/learning.ts';
  import { visitor } from '../../lib/account/visitor.svelte.ts';
  import { downloadText } from '../../lib/file.ts';
  import { listEntries, type LibraryEntry } from '../../lib/library.ts';
  import { url } from '../../lib/url.ts';
  import Icon from '../Icon.svelte';
  import Avatar from './Avatar.svelte';
  import CloudSave from './CloudSave.svelte';
  import LearningCard from './LearningCard.svelte';
  import type ProfileDialog from './ProfileDialog.svelte';

  const t = useTranslations();
  let profile = $state.raw<Profile | null>(null);
  let entries = $state.raw<LibraryEntry[]>([]);
  let learning = $state.raw<Learning>(emptyLearning());
  let loaded = $state(false);
  let blocked = $state(false);
  let notice = $state('');
  let noticeError = $state(false);
  let editing = $state(false);
  let Dialog = $state.raw<typeof ProfileDialog | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let confirming = $state(false);
  let leaving = $state(false);
  // Object URLs of thumbnails (not reactive state: revoked when the page goes away).
  const thumbs: Record<string, string> = {};

  const welcome = $derived(loaded && !profile && entries.length === 0 && !hasLearning(learning));
  const trained = $derived(entries.filter((e) => e.epoch > 0));
  const models = $derived(trained.reduce((n, e) => n + e.models.length, 0));
  const epochs = $derived(trained.reduce((n, e) => n + e.epoch, 0));
  const since = $derived(
    profile?.createdAt ??
      entries.reduce<string | undefined>(
        (min, e) => (!min || e.created < min ? e.created : min),
        undefined,
      ),
  );
  const recent = $derived(entries.slice(0, 4));
  const number = new Intl.NumberFormat('en');
  const month = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' });

  const describe = (s: MergeSummary) => describeMerge(t, s);

  function say(message: string, error = false) {
    notice = message;
    noticeError = error;
  }

  async function reload() {
    try {
      [profile, entries, learning] = await Promise.all([
        refreshMirror(),
        listEntries(),
        getLearning().catch(() => learningMirror()),
      ]);
      mirrorLearning(learning);
      blocked = false;
    } catch {
      blocked = true;
    }
    loaded = true;
  }

  function thumbUrl(e: LibraryEntry): string | null {
    if (!e.thumb) return null;
    const key = `${e.id}:${e.updated}`;
    thumbs[key] ??= URL.createObjectURL(
      new Blob([e.thumb as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
    );
    return thumbs[key];
  }

  async function openEditor() {
    Dialog ??= (await import('./ProfileDialog.svelte')).default;
    editing = true;
  }

  async function openFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_SAVE) return say(t('user.file.error.tooBig'), true);
    const text = await file.text().catch(() => null);
    const parsed = text === null ? 'notJson' : parseSave(text);
    if (typeof parsed === 'string') return say(t(`user.file.error.${parsed}`), true);
    try {
      const summary = await importSave(parsed.save);
      const skipped = parsed.skipped
        ? ` ${t('user.merge.skipped', { count: parsed.skipped })}`
        : '';
      say(
        (nothingNew(summary)
          ? t('user.merge.nothing', { file: file.name })
          : t('user.merge.done', { file: file.name, what: describe(summary) })) + skipped,
      );
      await reload();
    } catch {
      say(t('user.storageError'), true);
    }
  }

  async function download() {
    try {
      const { text } = await exportSave();
      downloadText(text, SAVE_FILE_NAME);
    } catch {
      say(t('user.storageError'), true);
    }
  }

  /** Experiments kept only here get a warning first; with a cloud save, signing out is direct. */
  function askSignOut() {
    if (visitor.cloud || entries.length === 0) void signOut();
    else confirming = true;
  }

  async function signOut() {
    leaving = true;
    const cloud = visitor.cloud;
    try {
      await (await import('../../lib/account/signout.ts')).signOut();
      confirming = false;
      await reload();
      say(t('me.signedOut'));
    } catch (error) {
      say(
        cloud
          ? t('user.signOutCloud', {
              where: PROVIDERS[cloud.provider],
              reason: cloudErrorText(t, error),
            })
          : t('me.signOutFailed'),
        true,
      );
    } finally {
      leaving = false;
      visitor.read();
    }
  }

  onMount(() => {
    visitor.start();
    const off = onLocalChange(() => void reload());
    void reload();
    if (isDropboxReturn()) {
      say(t('cloud.finishing'));
      finishDropbox().then(
        (r) =>
          say(
            r.imported
              ? t('cloud.result.brought', { what: describe(r.imported), where: 'Dropbox' })
              : t('cloud.result.saved', { where: 'Dropbox' }),
          ),
        (error: unknown) => say(cloudErrorText(t, error), true),
      );
    } else if (visitor.cloud) {
      startAutoSave();
      void import('../../lib/account/signout.ts').then((m) => m.warmUp());
    }
    return () => {
      off();
      for (const u of Object.values(thumbs)) URL.revokeObjectURL(u);
    };
  });
</script>

<input
  bind:this={fileInput}
  type="file"
  accept=".json,application/json"
  class="hidden"
  onchange={openFile}
  data-user-file
/>

{#if notice}
  <p
    class="mb-4 flex gap-2 rounded-xl border px-3 py-2.5 text-sm {noticeError
      ? 'border-bad/40 bg-surface text-ink'
      : 'border-line bg-accent-soft'}"
    role="status"
    data-user-notice
  >
    <Icon name={noticeError ? 'alert' : 'info'} />{notice}
  </p>
{/if}

{#if !loaded}
  <p class="text-muted">{t('user.loading')}</p>
{:else if blocked}
  <p class="flex gap-2 rounded-xl border border-line bg-accent-soft px-3 py-2 text-sm" role="alert">
    <Icon name="alert" />{t('user.blocked')}
  </p>
{:else if welcome}
  <!-- One panel: start a profile here, or bring a save (the "login"). -->
  <section
    class="xp-card mx-auto mt-2 flex w-full max-w-xl flex-col items-center px-5 py-9 text-center sm:px-10"
    aria-labelledby="welcome-title"
    data-user-welcome
  >
    <Avatar profile={null} size={104} />
    <h1 id="welcome-title" class="mt-4 text-3xl font-bold tracking-tight">{t('user.title')}</h1>
    <p class="mt-2 text-[15px] text-muted">{t('user.welcome.lead')}</p>
    <button
      type="button"
      class="xp-btn xp-btn-primary mt-6 min-h-11 px-5"
      onclick={openEditor}
      data-user-start>{t('user.welcome.start')}</button
    >
    <p
      class="my-6 flex w-full items-center gap-3 text-xs font-semibold tracking-[0.12em] text-muted uppercase before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line"
    >
      {t('user.welcome.or')}
    </p>
    <CloudSave compact onresult={say} {describe}>
      {#snippet extra()}
        <button type="button" class="xp-btn min-h-11" onclick={() => fileInput?.click()}
          ><Icon name="folder" />{t('user.openFile')}</button
        >
      {/snippet}
    </CloudSave>
    <p class="mt-5 text-[13px] text-muted">{t('user.welcome.hint')}</p>
  </section>
{:else}
  <div class="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]" data-user-profile>
    <div class="flex flex-col gap-4">
      <section class="xp-card flex flex-col items-center p-6 text-center" aria-labelledby="who">
        <button
          type="button"
          class="group relative rounded-full"
          aria-label={t('user.editPicture')}
          title={t('user.editPicture')}
          onclick={openEditor}
        >
          <Avatar profile={visitor.profile} size={112} />
          <span
            class="absolute end-0 bottom-0 grid size-9 place-items-center rounded-full border border-line-strong bg-surface text-ink shadow-[var(--xp-shadow)] group-hover:text-accent"
            ><Icon name="edit" size={16} /></span
          >
        </button>
        <h1
          id="who"
          class="mt-4 text-2xl font-bold tracking-tight [overflow-wrap:anywhere]"
          data-user-name
        >
          {profile?.name || t('user.title')}
        </h1>
        <button
          type="button"
          class="mt-1 min-h-10 text-sm font-medium text-accent underline underline-offset-2"
          onclick={openEditor}
          data-user-edit>{profile?.name ? t('user.edit') : t('user.addName')}</button
        >
        <dl
          class="mt-4 grid w-full grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line"
        >
          {#each [[t('user.stat.experiments'), number.format(entries.length)], [t('user.stat.models'), number.format(models)], [t('user.stat.epochs'), number.format(epochs)], [t('user.stat.since'), since ? month.format(new Date(since)) : '-']] as [label, value] (label)}
            <div class="flex flex-col-reverse bg-surface px-3 py-2.5">
              <dt class="text-xs text-muted">{label}</dt>
              <dd class="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          {/each}
        </dl>
      </section>

      <section class="xp-card p-5" aria-labelledby="browser-title">
        <h2 id="browser-title" class="mb-1.5 font-bold">{t('user.browser.title')}</h2>
        {#if confirming}
          <p class="text-sm" role="alert">{t('me.signOutConfirm', { count: entries.length })}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="xp-btn min-h-11" onclick={download}
              >{t('me.download')}</button
            >
            <button
              type="button"
              class="xp-btn min-h-11 border-bad! text-bad"
              disabled={leaving}
              onclick={signOut}
              data-user-signout-anyway
              >{leaving ? t('me.signingOut') : t('me.signOutAnyway')}</button
            >
            <button type="button" class="xp-btn min-h-11" onclick={() => (confirming = false)}
              >{t('user.cancel')}</button
            >
          </div>
        {:else}
          <p class="text-sm text-muted">
            {visitor.cloud
              ? t('user.browser.bodyCloud', { where: PROVIDERS[visitor.cloud.provider] })
              : t('user.browser.body')}
          </p>
          <button
            type="button"
            class="xp-btn mt-3 min-h-11 border-bad! text-bad"
            disabled={leaving}
            onclick={askSignOut}
            data-user-signout>{leaving ? t('me.signingOut') : t('me.signOut')}</button
          >
        {/if}
      </section>
    </div>

    <div class="flex min-w-0 flex-col gap-4">
      <div class="grid gap-4 md:grid-cols-2">
        <section class="xp-card p-5" aria-labelledby="cloud-title">
          <h2 id="cloud-title" class="mb-3 font-bold">{t('cloud.title')}</h2>
          <CloudSave onresult={say} {describe} />
        </section>

        <section class="xp-card flex flex-col p-5" aria-labelledby="file-title">
          <h2 id="file-title" class="mb-1.5 font-bold">{t('user.file.title')}</h2>
          <p class="text-sm text-muted">{t('user.file.body')}</p>
          <div class="mt-auto flex flex-wrap gap-2 pt-3">
            <button type="button" class="xp-btn min-h-11" onclick={download} data-user-download
              ><Icon name="download" />{t('user.file.download')}</button
            >
            <button type="button" class="xp-btn min-h-11" onclick={() => fileInput?.click()}
              ><Icon name="folder" />{t('user.file.open')}</button
            >
          </div>
        </section>
      </div>

      <LearningCard {learning} />

      <section class="xp-card p-5" aria-labelledby="recent-title">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="recent-title" class="flex-1 font-bold">{t('user.recent.title')}</h2>
          {#if entries.length}
            <a
              class="text-sm font-medium text-accent underline underline-offset-2"
              href={url('library/')}>{t('user.recent.all')}</a
            >
          {/if}
        </div>
        {#if recent.length}
          <ul class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {#each recent as e (e.id)}
              {@const thumb = thumbUrl(e)}
              <li>
                <a
                  href={url(`playground/#lib=${e.id}`)}
                  class="group flex flex-col gap-1.5"
                  data-user-recent
                >
                  <span
                    class="block aspect-video overflow-hidden rounded-lg border border-line bg-surface-2"
                  >
                    {#if thumb}<img src={thumb} alt="" class="size-full object-cover" />{:else}<span
                        class="grid size-full place-items-center text-faint"
                        ><Icon name="wave" size={28} /></span
                      >{/if}
                  </span>
                  <span class="truncate text-sm font-medium group-hover:text-accent">{e.name}</span>
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-muted">{t('user.recent.empty')}</p>
          <a class="xp-btn xp-btn-primary mt-3 min-h-11" href={url('playground/')}
            >{t('user.recent.toPlayground')}</a
          >
        {/if}
      </section>
    </div>
  </div>
{/if}

{#if editing && Dialog}
  <Dialog {profile} onclose={() => (editing = false)} onsaved={() => void reload()} />
{/if}
