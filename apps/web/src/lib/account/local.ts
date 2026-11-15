// What every page needs to know about the visitor without opening the library: a copy of the
// name and picture (so the header can draw the profile circle at once), when this browser last
// changed anything that goes into the save file, and the cloud connection. All of it lives in
// this browser's localStorage; the real profile and the experiments are in IndexedDB.

export const PROFILE_KEY = 'xp-profile';
export const CHANGED_KEY = 'xp-changed';
export const CLOUD_KEY = 'xp-cloud';
/** Fired on window in this tab; other tabs see the localStorage write as a `storage` event. */
export const CHANGED_EVENT = 'xp:changed';
export const CLOUD_EVENT = 'xp:cloud';

export const PROVIDERS = { google: 'Google Drive', dropbox: 'Dropbox' } as const;
export type Provider = keyof typeof PROVIDERS;

/** Background colors for initials (white letters reach 4.5:1 on each). */
export const TINTS = {
  blue: '#1d5fd6',
  teal: '#0f6e6e',
  green: '#2f6b2a',
  amber: '#94540a',
  rose: '#b4233d',
  plum: '#8a3a7c',
  violet: '#5b45b8',
  slate: '#475569',
} as const;
export type Tint = keyof typeof TINTS;
export const isTint = (v: unknown): v is Tint => typeof v === 'string' && v in TINTS;

/** The header's copy of the profile: what the circle shows. */
export interface ProfileMirror {
  name: string;
  /** Photo as a data: URL (a small WebP or JPEG), or null. */
  picture: string | null;
  /** Letters to show without a photo ('' falls back to the person icon). */
  letters: string;
  tint: Tint;
}

export interface CloudState {
  provider: Provider;
  account: { name: string; email: string } | null;
  /** When the data last uploaded was gathered (ISO), or null before the first save. */
  savedAt: string | null;
  /** The cloud file's version as last seen here. */
  rev: string | null;
  /** Google Drive file id. */
  file: string | null;
  token: { access: string; expires: number } | null;
  /** Dropbox refresh token. */
  refresh: string | null;
  /** The last save failed: 'auth' needs a click to sign in again; 'error' will be retried. */
  problem?: 'auth' | 'error' | null;
}

export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked; the header then simply shows the empty circle.
  }
}

/** Initials from a name: first letters of the first and last word ("Ada Lovelace" -> "AL"). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = [...(words[0] ?? '')][0] ?? '';
  const last = words.length > 1 ? ([...(words.at(-1) ?? '')][0] ?? '') : '';
  return (first + last).toLocaleUpperCase();
}

export function profileMirror(): ProfileMirror | null {
  const p = readJson<ProfileMirror>(PROFILE_KEY);
  return p && typeof p === 'object' && typeof p.name === 'string'
    ? {
        name: p.name,
        picture: typeof p.picture === 'string' ? p.picture : null,
        letters: typeof p.letters === 'string' ? p.letters : '',
        tint: isTint(p.tint) ? p.tint : 'blue',
      }
    : null;
}

export function cloudState(): CloudState | null {
  const s = readJson<CloudState>(CLOUD_KEY);
  return s && typeof s === 'object' && s.provider in PROVIDERS ? s : null;
}

export function changedAt(): number {
  return Date.parse(readJson<string>(CHANGED_KEY) ?? '') || 0;
}

/** Records that the save file's content changed in this browser, and tells pages and tabs. */
export function markChanged(): void {
  writeJson(CHANGED_KEY, new Date().toISOString());
  dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

/** True when this browser holds changes that are not in the cloud save yet. */
export function unsaved(s: CloudState | null = cloudState()): boolean {
  return !!s && changedAt() > (s.savedAt ? Date.parse(s.savedAt) : 0);
}

/** 'saved', 'pending' (changes waiting), 'auth' (needs a click) or null without a cloud. */
export function cloudDot(s: CloudState | null = cloudState()): 'saved' | 'pending' | 'auth' | null {
  if (!s) return null;
  if (s.problem === 'auth') return 'auth';
  return unsaved(s) || s.problem === 'error' ? 'pending' : 'saved';
}

/** "now", "4 minutes ago", "yesterday"... in the page's language. */
export function ago(iso: string | null, now = Date.now(), locale = 'en'): string {
  if (!iso) return '';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const sec = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(sec / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(sec / 86_400), 'day');
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/** Calls `fn` whenever the profile, the save or the cloud state changes, here or in another tab. */
export function onLocalChange(fn: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || [PROFILE_KEY, CHANGED_KEY, CLOUD_KEY].includes(event.key)) fn();
  };
  addEventListener(CHANGED_EVENT, fn);
  addEventListener(CLOUD_EVENT, fn);
  addEventListener('storage', onStorage);
  return () => {
    removeEventListener(CHANGED_EVENT, fn);
    removeEventListener(CLOUD_EVENT, fn);
    removeEventListener('storage', onStorage);
  };
}

/**
 * Draws a profile circle into an `.xp-avatar` element: the photo, the initials on their tint,
 * or (left in place) the person icon. Avatar.svelte produces the same markup.
 */
export function paintAvatar(element: HTMLElement, p: ProfileMirror | null): void {
  element.querySelector('.xp-avatar-img, .xp-avatar-glyph')?.remove();
  const kind = p?.picture ? 'picture' : p?.letters ? 'letters' : '';
  element.dataset['kind'] = kind;
  element.style.setProperty('--xp-av-tint', p && kind === 'letters' ? TINTS[p.tint] : '');
  if (p?.picture) {
    const img = document.createElement('img');
    img.className = 'xp-avatar-img';
    img.alt = '';
    img.src = p.picture;
    element.append(img);
  } else if (p?.letters) {
    const glyph = document.createElement('span');
    glyph.className = 'xp-avatar-glyph';
    glyph.dataset['letters'] = p.letters;
    element.append(glyph);
  }
}

/**
 * Inline script placed right after the header's profile circles: paints the photo or initials
 * before first paint, so pages do not flash the empty circle. Kept as a single string so
 * astro.config.ts can hash exactly these bytes for the CSP. Same result as paintAvatar().
 */
export const AVATAR_INIT_SCRIPT =
  "(function(){try{var p=JSON.parse(localStorage.getItem('" +
  PROFILE_KEY +
  "')||'null');if(!p)return;var t=" +
  JSON.stringify(TINTS) +
  ";document.querySelectorAll('[data-avatar]').forEach(function(e){if(p.picture){var i=document.createElement('img');i.className='xp-avatar-img';i.alt='';i.src=p.picture;e.dataset.kind='picture';e.append(i)}else if(p.letters){var g=document.createElement('span');g.className='xp-avatar-glyph';g.dataset.letters=p.letters;e.dataset.kind='letters';e.style.setProperty('--xp-av-tint',t[p.tint]||t.blue);e.append(g)}})}catch(e){}})();";
