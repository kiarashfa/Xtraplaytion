// Offline render of a stored race to a file: MP4 (H.264) or WebM (VP9) through WebCodecs
// and Mediabunny, GIF through gifenc, or a single PNG. Runs on the page; between frames
// it yields through a MessageChannel, which background tabs do not throttle.

import {
  ASPECTS,
  drawExportFrame,
  timeline,
  type ExportMoment,
  type ExportStatic,
} from './frame.ts';

export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'png';

export interface RenderJob {
  format: ExportFormat;
  st: ExportStatic;
  /** Output size in pixels (GIFs are capped, see GIF_MAX_WIDTH). */
  width: number;
  height: number;
  fps: number;
  /** Total length including the hold at the end. */
  seconds: number;
  holdSeconds: number;
  /** Last epoch of the video, or the epoch of the PNG. */
  endEpoch: number;
  moment: (epoch: number) => ExportMoment;
  signal?: AbortSignal;
  onProgress?: (done: number) => void;
}

export const GIF_MAX_WIDTH = 540;
export const GIF_FPS = 15;
export const MAX_SECONDS = 60;

export class Cancelled extends Error {}

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(
  w: number,
  h: number,
): { canvas: Canvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (ctx) return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  return { canvas, ctx };
}

const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const waiting: (() => void)[] = [];
if (channel) channel.port1.onmessage = () => waiting.shift()?.();
const yieldNow = () =>
  new Promise<void>((resolve) => {
    if (!channel) return void setTimeout(resolve, 0);
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });

/** Makes sure the fonts used on the canvas are ready (canvas text does not wait). */
export async function fontsReady(st: ExportStatic) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const fams = [st.theme.sans, st.theme.mono];
  await Promise.all(
    fams.flatMap((f) => ['400', '500', '700'].map((w) => document.fonts.load(`${w} 16px ${f}`))),
  ).catch(() => {});
}

/** What this browser can write. */
export async function videoSupport(w: number, h: number): Promise<{ mp4: boolean; webm: boolean }> {
  if (typeof VideoEncoder === 'undefined') return { mp4: false, webm: false };
  const { canEncodeVideo } = await import('mediabunny');
  const [mp4, webm] = await Promise.all([
    canEncodeVideo('avc', { width: w, height: h }).catch(() => false),
    canEncodeVideo('vp9', { width: w, height: h }).catch(() => false),
  ]);
  return { mp4, webm };
}

export const MIME: Record<ExportFormat, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  gif: 'image/gif',
  png: 'image/png',
};

/** Sizes of the GIF for a chosen output size. */
export function gifSize(w: number, h: number): [number, number] {
  if (w <= GIF_MAX_WIDTH) return [w, h];
  const s = GIF_MAX_WIDTH / w;
  return [GIF_MAX_WIDTH, Math.round((h * s) / 2) * 2];
}

/** Number of frames a job draws (for progress). */
export function frameCount(job: Pick<RenderJob, 'format' | 'fps' | 'seconds'>): number {
  if (job.format === 'png') return 1;
  const fps = job.format === 'gif' ? Math.min(job.fps, GIF_FPS) : job.fps;
  return Math.max(2, Math.round(Math.min(MAX_SECONDS, job.seconds) * fps));
}

export async function render(job: RenderJob): Promise<Blob> {
  await fontsReady(job.st);
  if (job.format === 'png') return renderPng(job);
  if (job.format === 'gif') return renderGif(job);
  return renderVideo(job);
}

function check(job: RenderJob) {
  if (job.signal?.aborted) throw new Cancelled('cancelled');
}

async function renderPng(job: RenderJob): Promise<Blob> {
  const { canvas, ctx } = makeCanvas(job.width, job.height);
  drawExportFrame(ctx, job.st, job.moment(job.endEpoch), job.width / ASPECTS[job.st.aspect].w);
  job.onProgress?.(1);
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'),
  );
}

function epochsOf(job: RenderJob, fps: number) {
  const frames = frameCount({ ...job, fps });
  const hold = Math.round(Math.min(job.holdSeconds, job.seconds / 2) * fps);
  return timeline(job.endEpoch, frames, hold);
}

async function renderVideo(job: RenderJob): Promise<Blob> {
  const mb = await import('mediabunny');
  const { canvas, ctx } = makeCanvas(job.width, job.height);
  const scale = job.width / ASPECTS[job.st.aspect].w;
  const codec = job.format === 'mp4' ? 'avc' : 'vp9';
  const output = new mb.Output({
    format:
      job.format === 'mp4'
        ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' })
        : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const source = new mb.CanvasSource(canvas, {
    codec,
    bitrate: new mb.Quality('high'),
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: job.fps });
  await output.start();
  const epochs = epochsOf(job, job.fps);
  try {
    for (let k = 0; k < epochs.length; k++) {
      check(job);
      drawExportFrame(ctx, job.st, job.moment(epochs[k]), scale);
      await source.add(k / job.fps, 1 / job.fps);
      job.onProgress?.((k + 1) / epochs.length);
      if (k % 4 === 3) await yieldNow();
    }
    check(job);
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  const buf = output.target.buffer;
  if (!buf) throw new Error('empty');
  return new Blob([buf], { type: MIME[job.format] });
}

async function renderGif(job: RenderJob): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const [w, h] = gifSize(job.width, job.height);
  const fps = Math.min(job.fps, GIF_FPS);
  const { ctx } = makeCanvas(w, h);
  const scale = w / ASPECTS[job.st.aspect].w;
  const epochs = epochsOf(job, fps);
  // One palette for the whole GIF, from a few frames (steady colors, faster).
  const sample = [0, Math.floor(epochs.length / 2), epochs.length - 1];
  const parts: Uint8ClampedArray[] = [];
  for (const k of sample) {
    drawExportFrame(ctx, job.st, job.moment(epochs[k]), scale);
    parts.push(ctx.getImageData(0, 0, w, h).data);
  }
  const all = new Uint8ClampedArray(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  const palette = quantize(all, 256);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (let k = 0; k < epochs.length; k++) {
    check(job);
    drawExportFrame(ctx, job.st, job.moment(epochs[k]), scale);
    const { data } = ctx.getImageData(0, 0, w, h);
    gif.writeFrame(applyPalette(data, palette), w, h, k ? { delay } : { palette, delay });
    job.onProgress?.((k + 1) / epochs.length);
    await yieldNow();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: MIME.gif });
}
