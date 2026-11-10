<script lang="ts">
  // Snippet generator: HTML that embeds the current experiment in another page.
  import { onMount } from 'svelte';
  import { useTranslations } from '../../i18n';
  import { embedSnippet, embedUrl } from '../../lib/embed.ts';
  import type { Playground } from '../../lib/playground.svelte.ts';
  import { encodeState, MAX_LINK_CODE } from '../../lib/share.ts';
  import { url } from '../../lib/url.ts';
  import Icon from '../Icon.svelte';

  const { pg, say, onback }: { pg: Playground; say: (text: string) => void; onback: () => void } =
    $props();
  const t = useTranslations();

  let code = $state<string | null>(null);
  let tooBig = $state(false);
  let title = $state('');
  let theme = $state<'' | 'light' | 'dark'>('');
  let autoplay = $state(false);
  let resize = $state(true);

  onMount(async () => {
    const c = await encodeState(pg.snapshotState());
    if (c.length > MAX_LINK_CODE) tooBig = true;
    else code = c;
  });

  const height = $derived(
    pg.layout === 'stacked' && pg.visibleRuns.length > 1 ? 110 + 220 * pg.visibleRuns.length : 470,
  );
  const src = $derived(
    code ? embedUrl(code, { title, ...(theme ? { theme } : {}), autoplay }) : '',
  );
  // The preview opens on this site (the snippet always points at the public address).
  const preview = $derived(src ? url('embed/') + new URL(src).hash : '');
  const html = $derived(src ? embedSnippet(src, title || t('embed.title'), height, resize) : '');

  async function copy() {
    try {
      await navigator.clipboard.writeText(html);
      say(t('embed.code.copied'));
    } catch {
      say(t('embed.code.failed'));
    }
  }
</script>

<div class="flex flex-col gap-2.5 p-1" data-embed-code>
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="grid size-9 place-items-center rounded-lg text-muted hover:text-ink"
      aria-label={t('embed.code.back')}
      onclick={onback}><Icon name="x" size={16} /></button
    >
    <p class="font-semibold">{t('embed.code.heading')}</p>
  </div>
  {#if tooBig}
    <p class="text-xs text-bad" role="alert">{t('pg.share.tooBig')}</p>
  {:else}
    <p class="text-xs text-muted">{t('embed.code.hint')}</p>
    <label class="flex flex-col gap-1">
      <span class="xp-label">{t('embed.code.title')}</span>
      <input
        class="xp-input"
        bind:value={title}
        maxlength="120"
        placeholder={t('embed.code.titleAuto')}
      />
    </label>
    <div class="grid grid-cols-2 gap-2">
      <label class="flex flex-col gap-1">
        <span class="xp-label">{t('export.theme')}</span>
        <select class="xp-input" bind:value={theme}>
          <option value="">{t('theme.system')}</option>
          <option value="light">{t('theme.light')}</option>
          <option value="dark">{t('theme.dark')}</option>
        </select>
      </label>
      <div class="flex flex-col justify-end gap-1 text-[13px]">
        <label class="flex min-h-7 items-center gap-2"
          ><input
            type="checkbox"
            class="size-4 accent-[var(--xp-accent)]"
            bind:checked={autoplay}
          />{t('embed.code.autoplay')}</label
        >
        <label class="flex min-h-7 items-center gap-2"
          ><input
            type="checkbox"
            class="size-4 accent-[var(--xp-accent)]"
            bind:checked={resize}
          />{t('embed.code.resize')}</label
        >
      </div>
    </div>
    <textarea
      class="xp-input h-28 resize-none py-2 font-mono text-[11.5px] leading-snug"
      readonly
      aria-label={t('embed.code.label')}
      value={html}
      onfocus={(e) => e.currentTarget.select()}
      data-embed-snippet></textarea>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="xp-btn xp-btn-primary min-h-10 px-3"
        disabled={!html}
        onclick={copy}><Icon name="copy" size={16} />{t('embed.code.copy')}</button
      >
      {#if src}
        <a class="xp-btn min-h-10 px-3" href={preview} target="_blank" rel="noopener"
          ><Icon name="ext" size={16} />{t('embed.code.preview')}</a
        >
      {/if}
    </div>
  {/if}
</div>
