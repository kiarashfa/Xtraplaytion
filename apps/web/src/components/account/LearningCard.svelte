<script lang="ts">
  // The profile's learning card: lessons learned (ring, checklist, continue), first guesses in
  // the lesson races, the drawing challenge record and favorite gallery races.
  import { useTranslations } from '../../i18n';
  import {
    challengeStats,
    favoriteIds,
    guessStats,
    isLearned,
    type Learning,
  } from '../../lib/account/learning.ts';
  import { GALLERY } from '../../lib/gallery.ts';
  import { LESSONS } from '../../lib/lessons.ts';
  import { url } from '../../lib/url.ts';
  import Icon from '../Icon.svelte';

  const { learning }: { learning: Learning } = $props();
  const t = useTranslations();

  const total = LESSONS.length;
  const learned = $derived(LESSONS.filter((l) => isLearned(learning, l.slug)).length);
  const next = $derived(LESSONS.find((l) => !isLearned(learning, l.slug)) ?? null);
  const guesses = $derived(guessStats(learning));
  const challenge = $derived(challengeStats(learning));
  const favorites = $derived(
    favoriteIds(learning).flatMap((id) => GALLERY.filter((g) => g.id === id)),
  );
  const opened = $derived(GALLERY.filter((g) => learning.opened[g.id]).length);
  // Progress ring: r 26 -> circumference about 163.4.
  const C = 2 * Math.PI * 26;
  const num = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '-');
</script>

<section class="xp-card p-5" aria-labelledby="learning-title" data-user-learning>
  <h2 id="learning-title" class="mb-4 font-bold">{t('learn.title')}</h2>
  <div class="flex flex-wrap items-center gap-4">
    <svg viewBox="0 0 64 64" width="72" height="72" class="flex-none -rotate-90" aria-hidden="true">
      <circle cx="32" cy="32" r="26" fill="none" stroke="var(--xp-line)" stroke-width="7" />
      <circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke="var(--xp-good)"
        stroke-width="7"
        stroke-linecap="round"
        stroke-dasharray={`${(C * learned) / total} ${C}`}
      />
    </svg>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <p class="text-lg font-semibold" data-learning-count>
        {t('learn.progress', { count: learned, total })}
      </p>
      {#if guesses.total}
        <p class="text-sm text-muted" data-learning-guesses>
          {t('learn.guesses', { right: guesses.right, total: guesses.total })}
        </p>
      {/if}
    </div>
    {#if next}
      <a
        class="xp-btn xp-btn-primary min-h-11"
        href={url(`lessons/${next.slug}/`)}
        data-learning-continue
        >{learned ? t('learn.continueShort', { n: next.n }) : t('learn.start')}</a
      >
    {:else}
      <p class="text-sm font-semibold text-good">{t('learn.allDone')}</p>
    {/if}
  </div>

  <ol class="mt-4 grid gap-1 sm:grid-cols-2">
    {#each LESSONS as l (l.slug)}
      {@const done = isLearned(learning, l.slug)}
      <li>
        <a
          href={url(`lessons/${l.slug}/`)}
          class="flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-surface-2"
          data-learning-lesson={l.slug}
          data-done={done ? '' : undefined}
        >
          <span
            class="grid size-5 flex-none place-items-center rounded-full border {done
              ? 'border-good bg-good text-surface'
              : 'border-line-strong'}"
            >{#if done}<Icon name="check" size={13} />{/if}</span
          >
          <span class="text-muted">{l.n}.</span>
          <span class="truncate {done ? '' : 'text-muted'}">{l.title}</span>
          <span class="sr-only">{done ? t('learn.learned') : t('learn.notYet')}</span>
        </a>
      </li>
    {/each}
  </ol>

  {#if challenge.rounds}
    <div class="mt-5 border-t border-line pt-4" data-learning-challenge>
      <h3 class="font-semibold">{t('learn.challenge.title')}</h3>
      <p class="mt-1 text-sm text-muted">
        {t('learn.challenge.summary', {
          rounds: challenge.rounds,
          right: challenge.right,
          guessed: challenge.guessed,
        })}
      </p>
      <div class="mt-2 overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-start text-xs text-muted">
              <th class="py-1.5 pe-3 text-start font-medium">{t('learn.challenge.model')}</th>
              <th class="py-1.5 pe-3 text-end font-medium">{t('learn.challenge.wins')}</th>
              <th class="py-1.5 text-end font-medium">{t('learn.challenge.best')}</th>
            </tr>
          </thead>
          <tbody>
            {#each challenge.models as m (m.name)}
              <tr class="border-t border-line">
                <td class="py-1.5 pe-3 font-mono text-[13px]">{m.name}</td>
                <td class="py-1.5 pe-3 text-end tabular-nums">{m.wins}</td>
                <td class="py-1.5 text-end font-mono text-[13px] tabular-nums">{num(m.best)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <div class="mt-5 border-t border-line pt-4" data-learning-favorites>
    <h3 class="font-semibold">{t('learn.favorites.title')}</h3>
    {#if favorites.length}
      <ul class="mt-2 flex flex-col gap-1">
        {#each favorites as g (g.id)}
          <li>
            <a
              class="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-2"
              href={url(`playground/#preset=${g.id}`)}
              ><span class="text-[#a16207] dark:text-[#f5b83d]" aria-hidden="true">★</span
              >{g.title}</a
            >
          </li>
        {/each}
      </ul>
    {:else}
      <p class="mt-1 text-sm text-muted">{t('learn.favorites.empty')}</p>
    {/if}
    <p class="mt-2 text-[13px] text-muted">
      {t('learn.favorites.opened', { count: opened, total: GALLERY.length })}
      <a class="text-accent underline underline-offset-2" href={url('gallery/')}
        >{t('learn.favorites.gallery')}</a
      >
    </p>
  </div>
</section>
