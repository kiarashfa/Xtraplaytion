<script lang="ts">
  import { onMount } from 'svelte';

  type Pref = 'system' | 'light' | 'dark';

  interface Props {
    storageKey: string;
    labels: { label: string; system: string; light: string; dark: string };
  }
  const { storageKey, labels }: Props = $props();

  const options: Pref[] = ['system', 'light', 'dark'];
  let pref = $state<Pref>('system');

  function read(): Pref {
    try {
      const v = localStorage.getItem(storageKey);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system';
    }
  }

  function apply(p: Pref) {
    const dark =
      p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  function choose(p: Pref) {
    pref = p;
    try {
      if (p === 'system') localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, p);
    } catch {
      // Storage can be unavailable (private mode, blocked site data). The choice still applies now.
    }
    apply(p);
  }

  onMount(() => {
    pref = read();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (pref === 'system') apply('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });
</script>

{#snippet icon(option: Pref)}
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if option === 'system'}
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    {:else if option === 'light'}
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
      />
    {:else}
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    {/if}
  </svg>
{/snippet}

<!-- Phones: one button that steps through the three choices (the header is narrow). -->
<button
  type="button"
  class="grid size-11 place-items-center rounded-full border border-line bg-surface text-ink sm:hidden"
  aria-label="{labels.label}: {labels[pref]}"
  title="{labels.label}: {labels[pref]}"
  onclick={() => choose(options[(options.indexOf(pref) + 1) % options.length])}
  data-theme-cycle
>
  {@render icon(pref)}
</button>

<fieldset class="flex rounded-full border border-line bg-surface p-0.5 max-sm:hidden">
  <legend class="sr-only">{labels.label}</legend>
  {#each options as option (option)}
    <label
      class="relative grid size-11 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:text-ink has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
      title={labels[option]}
    >
      <input
        type="radio"
        name="xp-theme"
        value={option}
        checked={pref === option}
        onchange={() => choose(option)}
        class="peer sr-only"
      />
      <span class="sr-only">{labels[option]}</span>
      {@render icon(option)}
    </label>
  {/each}
</fieldset>
