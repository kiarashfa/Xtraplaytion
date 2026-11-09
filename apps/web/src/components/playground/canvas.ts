// Small helpers for HiDPI canvases that follow their CSS size and the theme.
import { readTheme, type SceneTheme } from '../../lib/scene/draw.ts';

/** Sizes the canvas backing store to its CSS box; returns the context and CSS size. */
export function prepare(canvas: HTMLCanvasElement) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Calls `onChange` with the current theme now and whenever it changes. */
export function watchTheme(onChange: (t: SceneTheme) => void): () => void {
  onChange(readTheme());
  const obs = new MutationObserver(() => onChange(readTheme()));
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}

/** Calls `onResize` when the element changes size. */
export function watchSize(el: Element, onResize: () => void): () => void {
  const ro = new ResizeObserver(() => onResize());
  ro.observe(el);
  return () => ro.disconnect();
}
