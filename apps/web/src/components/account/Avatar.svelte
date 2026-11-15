<script lang="ts">
  // The profile circle as Svelte draws it; same markup and styles (global.css) as the header's
  // (paintAvatar in lib/account/local.ts).
  import { TINTS, type ProfileMirror } from '../../lib/account/local.ts';

  let {
    profile,
    size = 36,
    dot = null,
  }: { profile: ProfileMirror | null; size?: number; dot?: string | null } = $props();

  const kind = $derived(profile?.picture ? 'picture' : profile?.letters ? 'letters' : '');
</script>

<span class="relative inline-grid" aria-hidden="true">
  <span
    class="xp-avatar"
    style:--xp-av={`${size}px`}
    style:--xp-av-tint={kind === 'letters' && profile ? TINTS[profile.tint] : undefined}
    data-kind={kind}
  >
    <svg class="xp-avatar-icon" viewBox="0 0 24 24" aria-hidden="true"
      ><circle cx="12" cy="9" r="4"></circle><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"></path></svg
    >
    {#if kind === 'picture'}
      <img class="xp-avatar-img" src={profile?.picture} alt="" width={size} height={size} />
    {:else if kind}
      <span class="xp-avatar-glyph" data-letters={profile?.letters}></span>
    {/if}
  </span>
  {#if dot}<span class="xp-avatar-dot" data-dot={dot}></span>{/if}
</span>
