<script lang="ts">
  // Under a lesson's prediction question: the visitor's first guess on this race, if they made
  // one on an earlier visit (or another device, through the save).
  import { onMount } from 'svelte';
  import { useTranslations } from '../../i18n';
  import { pastGuess, type Guess } from '../../lib/account/learning.ts';

  const { raceKey }: { raceKey: string } = $props();
  const t = useTranslations();
  let guess = $state.raw<Guess | null>(null);
  onMount(() => {
    guess = pastGuess(raceKey);
  });
</script>

{#if guess}
  <p class="-mt-1 mb-3 text-[13px] text-muted" data-past-guess>
    {t(guess.right ? 'learn.pastRight' : 'learn.pastWrong', { guess: guess.guess })}
  </p>
{/if}
