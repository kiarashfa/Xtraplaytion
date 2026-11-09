// URLs of the recorded runs shipped with the site (hashed file names, so a new
// recording never meets a stale cache).
const urls = import.meta.glob('../recordings/*.xpr', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function recordingUrl(presetId: string): string | null {
  return urls[`../recordings/${presetId}.xpr`] ?? null;
}
