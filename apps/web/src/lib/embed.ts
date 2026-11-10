// Embeds: the /embed/ page reads its experiment from the URL fragment (never sent to a
// server) or from postMessage, and reports its height to the embedding page.

import { SITE } from '../site.config.ts';
import { presetState, trainingIdentity } from './experiment.ts';
import { PRESETS, type Preset } from './presets.ts';
import type { ExperimentState } from './share.ts';

export interface EmbedParams {
  preset?: string;
  /** Share code (the #s= value). */
  code?: string;
  title?: string;
  theme?: 'light' | 'dark';
  autoplay: boolean;
}

/** Messages the embed sends to the page around it. */
export const HEIGHT_MESSAGE = 'xtraplaytion:height';
/** Messages the embed accepts: load an experiment (a #s= or #preset= fragment), play, pause. */
export const LOAD_MESSAGE = 'xtraplaytion:load';
export const PLAY_MESSAGE = 'xtraplaytion:play';
export const PAUSE_MESSAGE = 'xtraplaytion:pause';

export const MAX_TITLE = 120;

export function parseEmbedHash(hash: string): EmbedParams {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const theme = p.get('theme');
  const title = p.get('title')?.trim().slice(0, MAX_TITLE);
  return {
    ...(p.get('preset') ? { preset: p.get('preset') as string } : {}),
    ...(p.get('s') ? { code: p.get('s') as string } : {}),
    ...(title ? { title } : {}),
    ...(theme === 'light' || theme === 'dark' ? { theme } : {}),
    autoplay: p.get('autoplay') === '1',
  };
}

/** The fragment that opens the same experiment in the playground. */
export function playgroundHash(p: Pick<EmbedParams, 'preset' | 'code'>): string {
  if (p.code) return `#s=${p.code}`;
  if (p.preset) return `#preset=${encodeURIComponent(p.preset)}`;
  return '';
}

export interface EmbedOptions {
  title?: string;
  theme?: 'light' | 'dark';
  autoplay?: boolean;
}

/** Absolute address of an embed for a share code. */
export function embedUrl(code: string, o: EmbedOptions = {}): string {
  const p = new URLSearchParams();
  p.set('s', code);
  if (o.title?.trim()) p.set('title', o.title.trim().slice(0, MAX_TITLE));
  if (o.theme) p.set('theme', o.theme);
  if (o.autoplay) p.set('autoplay', '1');
  return `${SITE.url}${SITE.basePath}embed/#${p.toString()}`;
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML to paste into a page. With `resize`, a small script follows the embed's height. */
export function embedSnippet(src: string, title: string, height: number, resize: boolean): string {
  const frame =
    `<iframe src="${escapeAttr(src)}" title="${escapeAttr(title || SITE.name)}" ` +
    `width="100%" height="${Math.round(height)}" loading="lazy" ` +
    `style="border:0;border-radius:12px;max-width:100%"></iframe>`;
  if (!resize) return frame;
  const origin = SITE.url;
  const script =
    `<script>addEventListener("message",function(e){` +
    `if(e.origin!=="${origin}"||!e.data||e.data.type!=="${HEIGHT_MESSAGE}")return;` +
    `document.querySelectorAll("iframe").forEach(function(f){` +
    `if(f.contentWindow===e.source)f.style.height=e.data.height+"px"})})</script>`;
  return `${frame}\n${script}`;
}

/** A preset with a recording that is exactly this experiment (so the embed plays it). */
export function recordedPresetFor(state: ExperimentState): Preset | null {
  const key = trainingIdentity(state);
  return PRESETS.find((p) => p.recorded && trainingIdentity(presetState(p)) === key) ?? null;
}
