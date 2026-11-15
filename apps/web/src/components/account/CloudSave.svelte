<script lang="ts">
  // Cloud save on the profile page: connect Google Drive or Dropbox, see when it last saved, save
  // now or disconnect. `compact` is the first-visit version: just the connect buttons.
  import type { Snippet } from 'svelte';
  import { useTranslations } from '../../i18n';
  import {
    AVAILABLE,
    connectDropbox,
    connectGoogle,
    disconnect,
    loadGoogle,
    sync,
  } from '../../lib/account/cloud.ts';
  import { ago, PROVIDERS, type Provider } from '../../lib/account/local.ts';
  import { cloudErrorText } from '../../lib/account/messages.ts';
  import type { MergeSummary } from '../../lib/account/save.ts';
  import { visitor } from '../../lib/account/visitor.svelte.ts';
  import { url } from '../../lib/url.ts';

  let {
    compact = false,
    onresult,
    describe,
    extra,
  }: {
    compact?: boolean;
    onresult: (message: string, error?: boolean) => void;
    /** "2 new experiments and your profile". */
    describe: (s: MergeSummary) => string;
    /** More buttons for the compact row (the first-visit panel adds "Open a save file"). */
    extra?: Snippet;
  } = $props();

  const t = useTranslations();
  let busy = $state<Provider | null>(null);
  const order = (['google', 'dropbox'] as const).filter((p) => AVAILABLE[p]);

  const errorText = (error: unknown) => cloudErrorText(t, error);

  async function run(provider: Provider, task: () => Promise<{ imported: MergeSummary | null }>) {
    busy = provider;
    try {
      const result = await task();
      const where = PROVIDERS[visitor.cloud?.provider ?? provider];
      onresult(
        result.imported
          ? t('cloud.result.brought', { what: describe(result.imported), where })
          : t('cloud.result.saved', { where }),
      );
    } catch (error) {
      onresult(errorText(error), true);
    } finally {
      busy = null;
      visitor.read();
    }
  }

  function connect(provider: Provider) {
    if (provider === 'google') {
      void run('google', connectGoogle);
      return;
    }
    busy = 'dropbox';
    onresult(t('cloud.opening'));
    connectDropbox().catch((error: unknown) => {
      busy = null;
      onresult(errorText(error), true);
    });
  }

  async function unlink() {
    const where = visitor.cloud ? PROVIDERS[visitor.cloud.provider] : '';
    await disconnect();
    visitor.read();
    onresult(t('cloud.result.disconnected', { where }));
  }

  // Google's sign-in window must open straight from a click, so its script loads on approach.
  const warm = () => {
    if (AVAILABLE.google) loadGoogle().catch(() => {});
  };

  const status = $derived.by(() => {
    const s = visitor.cloud;
    if (!s) return '';
    const where = PROVIDERS[s.provider];
    if (visitor.sync === 'saving' || busy) return t('cloud.status.saving', { where });
    if (visitor.dot === 'auth') return t('cloud.status.auth', { where });
    if (visitor.dot === 'pending') return t('cloud.status.pending');
    return s.savedAt
      ? t('cloud.status.saved', { where, ago: ago(s.savedAt, visitor.now) })
      : t('cloud.status.connected', { where });
  });
</script>

{#snippet logo(provider: Provider, size: number)}
  {#if provider === 'google'}
    <svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden="true" class="flex-none"
      ><path
        fill="#0066da"
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z"
      ></path><path
        fill="#00ac47"
        d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9 9 0 0 0 0 53h27.5z"
      ></path><path
        fill="#ea4335"
        d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z"
      ></path><path
        fill="#00832d"
        d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"
      ></path><path
        fill="#2684fc"
        d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
      ></path><path
        fill="#ffba00"
        d="M73.4 26.5 60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z"
      ></path></svg
    >
  {:else}
    <svg width={size} height={size} viewBox="0 0 43 40" aria-hidden="true" class="flex-none"
      ><path
        fill="#0061fe"
        d="M12.5 0 0 8.1l8.7 6.9 12.6-7.8zM0 21.9l12.5 8.2 8.8-7.4-12.6-7.7zm21.3.8 8.8 7.4 12.4-8.2-8.6-6.9zm21.2-14.6L30.1 0l-8.8 7.2 12.6 7.8zM21.4 24.3l-8.9 7.3-3.8-2.4v2.7l12.7 7.6 12.6-7.6v-2.7l-3.8 2.4z"
      ></path></svg
    >
  {/if}
{/snippet}

{#if compact}
  <div class="flex flex-wrap justify-center gap-2">
    {#each order as p (p)}
      <button
        type="button"
        class="xp-btn min-h-11"
        disabled={busy !== null}
        onpointerenter={warm}
        onfocus={warm}
        onclick={() => connect(p)}
        data-cloud-connect={p}
        >{@render logo(p, 18)}{busy === p ? t('cloud.connecting') : PROVIDERS[p]}</button
      >
    {/each}
    {@render extra?.()}
  </div>
{:else if order.length === 0}
  <p class="text-sm text-muted" data-cloud-unavailable>{t('cloud.unavailable')}</p>
{:else}
  <div class="flex flex-col gap-2">
    {#each order as p (p)}
      {@const on = visitor.cloud?.provider === p}
      <div
        class="flex items-center gap-3 rounded-xl border px-3 py-2.5 {on
          ? 'border-accent bg-accent-soft'
          : 'border-line bg-surface'}"
        title={t(`cloud.home.${p}`)}
        data-cloud-provider={p}
      >
        {@render logo(p, 24)}
        <div class="flex min-w-0 flex-1 flex-col">
          <b class="text-[15px]">{PROVIDERS[p]}</b>
          <small class="text-[13px] [overflow-wrap:anywhere] text-muted">
            {#if on}
              {visitor.cloud?.account?.email
                ? t('cloud.connectedAs', { email: visitor.cloud.account.email })
                : t('cloud.connected')}
            {:else}
              {t('cloud.notConnected')}
            {/if}
          </small>
        </div>
        {#if !on}
          <button
            type="button"
            class="xp-btn min-h-11"
            disabled={busy !== null}
            onpointerenter={warm}
            onfocus={warm}
            onclick={() => connect(p)}
            data-cloud-connect={p}>{busy === p ? t('cloud.connecting') : t('cloud.connect')}</button
          >
        {/if}
      </div>
    {/each}
  </div>
  {#if visitor.cloud}
    {@const s = visitor.cloud}
    <p
      class="mt-3 flex items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2.5 text-sm"
      data-cloud-status
    >
      <span class="xp-avatar-dot static! size-2.5! flex-none border-0!" data-dot={visitor.dot}
      ></span>
      <span>{status}</span>
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="xp-btn min-h-11"
        disabled={busy !== null || visitor.sync === 'saving'}
        onpointerenter={warm}
        onclick={() => run(s.provider, () => sync({ interactive: true }))}
        >{visitor.dot === 'auth' ? t('cloud.signInAgain') : t('cloud.saveNow')}</button
      >
      <button type="button" class="xp-btn min-h-11" disabled={busy !== null} onclick={unlink}
        >{t('cloud.disconnect')}</button
      >
    </div>
    <p class="mt-2.5 text-[13px] text-muted">
      {s.provider === 'google' ? t('cloud.autoGoogle') : t('cloud.auto')}
    </p>
  {:else}
    <p class="mt-2.5 text-[13px] text-muted">{t('cloud.pitch')}</p>
  {/if}
  <p class="mt-1.5 text-[13px]">
    <a class="text-accent underline underline-offset-2" href={url('about/#privacy')}
      >{t('cloud.privacy')}</a
    >
  </p>
{/if}
