<script lang="ts">
  // The profile dialog: name, and a picture that is either initials on a color or a photo. A
  // photo goes through a round cropper (drag to place; slider, wheel or +/- to zoom; arrow keys
  // to move) and is stored as one small square image, so the save file grows by a few KB.
  import { onMount, untrack } from 'svelte';
  import { useTranslations } from '../../i18n';
  import { initialsOf, TINTS, type ProfileMirror, type Tint } from '../../lib/account/local.ts';
  import {
    cleanLetters,
    LETTERS_MAX,
    NAME_MAX,
    PICTURE_MAX,
    updateProfile,
    type Profile,
  } from '../../lib/account/save.ts';
  import Icon from '../Icon.svelte';
  import Avatar from './Avatar.svelte';

  let {
    profile,
    onclose,
    onsaved,
  }: { profile: Profile | null; onclose: () => void; onsaved?: () => void } = $props();
  const t = useTranslations();
  const initial = untrack(() => profile);

  const CROP = 200;
  const SIZE = 192;
  const MAX_ZOOM = 4;
  const tints = Object.keys(TINTS) as Tint[];

  type Tab = 'initials' | 'photo';
  let dialog: HTMLDialogElement | undefined = $state();
  let name = $state(initial?.name ?? '');
  let tab = $state<Tab>(initial?.picture ? 'photo' : 'initials');
  let letters = $state(initial?.letters ?? '');
  let tint = $state<Tint>(initial?.tint ?? 'blue');
  let error = $state('');
  let saving = $state(false);

  // Cropper: the image, its cover scale, zoom and offset in CSS px.
  let src = $state('');
  let img: HTMLImageElement | undefined = $state();
  let natural = $state<{ w: number; h: number } | null>(null);
  let zoom = $state(1);
  let x = $state(0);
  let y = $state(0);
  let photo = $state<string | null>(initial?.picture ?? null);
  let kb = $state(initial?.picture ? Math.round((initial.picture.length * 3) / 4 / 1024) : 0);
  let fileInput: HTMLInputElement | undefined = $state();
  let dragOver = $state(false);

  const base = $derived(natural ? Math.max(CROP / natural.w, CROP / natural.h) : 1);
  const transform = $derived(
    natural
      ? `translate(${x - (natural.w * base * zoom) / 2}px, ${y - (natural.h * base * zoom) / 2}px) scale(${base * zoom})`
      : '',
  );

  function clamp() {
    if (!natural) return;
    const k = base * zoom;
    const mx = Math.max(0, (natural.w * k - CROP) / 2);
    const my = Math.max(0, (natural.h * k - CROP) / 2);
    x = Math.min(mx, Math.max(-mx, x));
    y = Math.min(my, Math.max(-my, y));
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      error = t('pic.notImage');
      return;
    }
    error = '';
    if (src) URL.revokeObjectURL(src);
    natural = null;
    zoom = 1;
    x = y = 0;
    src = URL.createObjectURL(file);
  }

  function onLoad() {
    if (!img) return;
    natural = { w: img.naturalWidth, h: img.naturalHeight };
    clamp();
    schedule();
  }

  let drag: { x: number; y: number } | null = null;
  function down(e: PointerEvent) {
    if (!natural) return;
    drag = { x: e.clientX - x, y: e.clientY - y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    x = e.clientX - drag.x;
    y = e.clientY - drag.y;
    clamp();
  }
  function up() {
    if (!drag) return;
    drag = null;
    schedule();
  }
  function setZoom(z: number) {
    zoom = Math.min(MAX_ZOOM, Math.max(1, z));
    clamp();
    schedule();
  }
  function wheel(e: WheelEvent) {
    if (!natural) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.08 : 0.93));
  }
  function key(e: KeyboardEvent) {
    if (!natural) return;
    const step = e.shiftKey ? 20 : 6;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      x += m[0];
      y += m[1];
      clamp();
      schedule();
    } else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.1);
    else if (e.key === '-') setZoom(zoom / 1.1);
  }

  // The stored image: what the circle shows, at SIZE px, as WebP where the browser can (else JPEG).
  function render(): string | null {
    if (!img || !natural) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const g = canvas.getContext('2d');
    if (!g) return null;
    const r = SIZE / CROP;
    const k = base * zoom * r;
    g.imageSmoothingQuality = 'high';
    g.drawImage(
      img,
      SIZE / 2 + x * r - (natural.w * k) / 2,
      SIZE / 2 + y * r - (natural.h * k) / 2,
      natural.w * k,
      natural.h * k,
    );
    for (const quality of [0.85, 0.7, 0.5]) {
      const webp = canvas.toDataURL('image/webp', quality);
      const url = webp.startsWith('data:image/webp')
        ? webp
        : canvas.toDataURL('image/jpeg', quality);
      if (url.length <= PICTURE_MAX) return url;
    }
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      photo = render();
      kb = photo ? Math.max(1, Math.round((photo.length * 3) / 4 / 1024)) : 0;
    }, 100);
  }

  const shownLetters = $derived(cleanLetters(letters) || initialsOf(name));
  const preview = $derived<ProfileMirror>({
    name,
    picture: tab === 'photo' ? photo : null,
    letters: shownLetters,
    tint,
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    try {
      await updateProfile({
        name: name.trim().slice(0, NAME_MAX),
        picture: tab === 'photo' ? photo : null,
        letters: cleanLetters(letters),
        tint,
      });
      onsaved?.();
      dialog?.close();
    } catch {
      error = t('user.storageError');
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    dialog?.showModal();
    return () => {
      clearTimeout(timer);
      if (src) URL.revokeObjectURL(src);
    };
  });
</script>

<dialog
  bind:this={dialog}
  class="m-auto max-h-[calc(100dvh-1.5rem)] w-[min(640px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line-strong bg-surface p-0 text-ink shadow-[var(--xp-shadow)] backdrop:bg-black/45"
  aria-labelledby="profile-dialog-title"
  {onclose}
  data-profile-dialog
>
  <form class="flex max-h-[calc(100dvh-1.5rem)] flex-col" onsubmit={save}>
    <header class="flex items-center gap-3 border-b border-line px-5 py-3">
      <h2 id="profile-dialog-title" class="flex-1 text-lg font-bold">
        {initial ? t('pic.title') : t('pic.titleNew')}
      </h2>
      <button
        type="button"
        class="grid size-11 place-items-center rounded-full text-muted hover:text-ink"
        aria-label={t('pic.cancel')}
        title={t('pic.cancel')}
        onclick={() => dialog?.close()}><Icon name="x" /></button
      >
    </header>

    <div class="grid gap-5 overflow-y-auto p-5 sm:grid-cols-[220px_minmax(0,1fr)]">
      <!-- The circle as it will look, or the cropper while placing a photo. -->
      <div class="flex flex-col items-center gap-3">
        {#if tab === 'photo' && src}
          <div
            class="relative size-[200px] cursor-grab touch-none overflow-hidden rounded-full bg-surface-2 outline-offset-4 select-none active:cursor-grabbing"
            role="slider"
            tabindex="0"
            aria-label={t('pic.cropLabel')}
            aria-valuemin={1}
            aria-valuemax={MAX_ZOOM}
            aria-valuenow={Math.round(zoom * 100) / 100}
            onpointerdown={down}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={up}
            onwheel={wheel}
            onkeydown={key}
            data-profile-crop
          >
            {#key src}<img
                bind:this={img}
                {src}
                alt=""
                class="absolute top-1/2 left-1/2 max-w-none origin-top-left"
                style:transform
                onload={onLoad}
                onerror={() => (error = t('pic.notImage'))}
                draggable="false"
              />{/key}
          </div>
          <label class="flex w-full items-center gap-2 text-sm text-muted">
            <span>{t('pic.zoom')}</span>
            <input
              type="range"
              class="min-w-0 flex-1 accent-[var(--xp-accent)]"
              min="1"
              max={MAX_ZOOM}
              step="0.01"
              value={zoom}
              disabled={!natural}
              oninput={(e) => setZoom(Number(e.currentTarget.value))}
            />
          </label>
          <p class="text-center text-xs text-muted">{t('pic.cropHelp')}</p>
        {:else}
          <Avatar profile={preview} size={160} />
        {/if}
        <div class="flex items-center gap-2" aria-hidden="true">
          <Avatar profile={preview} size={44} />
          <Avatar profile={preview} size={32} />
          <Avatar profile={preview} size={24} />
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-4">
        <label class="flex flex-col gap-1.5">
          <span class="xp-label">{t('pic.name')}</span>
          <input
            class="xp-input min-h-11 text-[15px]!"
            bind:value={name}
            maxlength={NAME_MAX}
            autocomplete="name"
            placeholder={t('pic.namePlaceholder')}
            data-profile-name-input
          />
          <span class="text-xs text-muted">{t('pic.nameHint')}</span>
        </label>

        <fieldset class="flex flex-col gap-3">
          <legend class="xp-label mb-1.5">{t('pic.picture')}</legend>
          <div class="flex rounded-full border border-line bg-surface-2 p-0.5" role="radiogroup">
            {#each [['initials', t('pic.initials')], ['photo', t('pic.photo')]] as [id, label] (id)}
              <label
                class="flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-full text-sm font-medium text-muted has-checked:bg-surface has-checked:text-ink has-checked:shadow-[var(--xp-shadow)] has-focus-visible:outline-2 has-focus-visible:outline-accent"
              >
                <input
                  type="radio"
                  name="profile-kind"
                  class="sr-only"
                  value={id}
                  checked={tab === id}
                  onchange={() => {
                    tab = id as Tab;
                    error = '';
                  }}
                  data-profile-kind={id}
                />{label}
              </label>
            {/each}
          </div>

          {#if tab === 'initials'}
            <label class="flex flex-col gap-1.5">
              <span class="xp-label">{t('pic.letters')}</span>
              <input
                class="xp-input min-h-11 w-28! text-[15px]! font-semibold uppercase"
                bind:value={letters}
                maxlength={LETTERS_MAX + 2}
                autocomplete="off"
                spellcheck="false"
                placeholder={initialsOf(name)}
                data-profile-letters
              />
              <span class="text-xs text-muted">{t('pic.lettersHint')}</span>
            </label>
            <div class="flex flex-col gap-1.5">
              <span class="xp-label" id="profile-tint-label">{t('pic.color')}</span>
              <div
                class="flex flex-wrap gap-1.5"
                role="radiogroup"
                aria-labelledby="profile-tint-label"
              >
                {#each tints as c (c)}
                  <label
                    class="grid size-9 cursor-pointer place-items-center rounded-full has-checked:ring-2 has-checked:ring-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
                    title={t(`pic.tint.${c}`)}
                  >
                    <input
                      type="radio"
                      name="profile-tint"
                      class="sr-only"
                      value={c}
                      checked={tint === c}
                      onchange={() => (tint = c)}
                    />
                    <span class="sr-only">{t(`pic.tint.${c}`)}</span>
                    <span class="size-7 rounded-full" style:background={TINTS[c]}></span>
                  </label>
                {/each}
              </div>
            </div>
          {:else}
            <button
              type="button"
              class="flex min-h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-4 text-center text-sm {dragOver
                ? 'border-accent bg-accent-soft'
                : 'border-line-strong bg-surface-2'}"
              ondragover={(e) => {
                e.preventDefault();
                dragOver = true;
              }}
              ondragleave={() => (dragOver = false)}
              ondrop={(e) => {
                e.preventDefault();
                dragOver = false;
                onFile(e.dataTransfer?.files?.[0]);
              }}
              onclick={() => fileInput?.click()}
            >
              <span class="flex items-center gap-2 font-semibold"
                ><Icon name="upload" />{src || photo ? t('pic.another') : t('pic.choose')}</span
              >
              <span class="text-muted">{t('pic.drop')}</span>
            </button>
            <input
              bind:this={fileInput}
              type="file"
              accept="image/*"
              class="hidden"
              onchange={(e) => {
                onFile(e.currentTarget.files?.[0]);
                e.currentTarget.value = '';
              }}
              data-profile-photo-file
            />
            {#if photo}
              <p class="text-xs text-muted" data-profile-photo-size>
                {t('pic.size', { kb })}
              </p>
            {/if}
          {/if}
          {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
        </fieldset>
      </div>
    </div>

    <footer class="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
      {#if tab === 'photo' && photo}
        <button
          type="button"
          class="xp-btn min-h-11"
          onclick={() => {
            photo = null;
            src = '';
            natural = null;
            tab = 'initials';
          }}>{t('pic.remove')}</button
        >
      {/if}
      <span class="flex-1"></span>
      <button type="button" class="xp-btn min-h-11" onclick={() => dialog?.close()}
        >{t('pic.cancel')}</button
      >
      <button
        type="submit"
        class="xp-btn xp-btn-primary min-h-11"
        disabled={saving || (tab === 'photo' && !photo)}
        data-profile-save>{t('pic.save')}</button
      >
    </footer>
  </form>
</dialog>
