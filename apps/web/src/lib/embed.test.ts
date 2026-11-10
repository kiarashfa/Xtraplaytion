import { describe, expect, it } from 'vitest';
import {
  embedSnippet,
  embedUrl,
  parseEmbedHash,
  playgroundHash,
  recordedPresetFor,
} from './embed.ts';
import { presetState } from './experiment.ts';
import { PRESETS } from './presets.ts';

describe('embed links', () => {
  it('reads the fragment', () => {
    expect(parseEmbedHash('#s=abc&title=Hello%20there&theme=dark&autoplay=1')).toEqual({
      code: 'abc',
      title: 'Hello there',
      theme: 'dark',
      autoplay: true,
    });
    expect(parseEmbedHash('#preset=sine-gap&theme=pink')).toEqual({
      preset: 'sine-gap',
      autoplay: false,
    });
    expect(parseEmbedHash('').autoplay).toBe(false);
    expect(parseEmbedHash(`#s=x&title=${'a'.repeat(500)}`).title).toHaveLength(120);
  });

  it('round-trips through the snippet', () => {
    const src = embedUrl('CODE', { title: 'A "quoted" <title>', theme: 'light' });
    expect(src).toBe(
      'https://kiarashfa.github.io/Xtraplaytion/embed/#s=CODE&title=A+%22quoted%22+%3Ctitle%3E&theme=light',
    );
    expect(parseEmbedHash(new URL(src).hash).title).toBe('A "quoted" <title>');
    const html = embedSnippet(src, 'A "quoted" <title>', 470, false);
    expect(html).toContain('title="A &quot;quoted&quot; &lt;title&gt;"');
    expect(html).not.toContain('<script');
    expect(embedSnippet(src, 'x', 470, true)).toContain('e.origin!=="https://kiarashfa.github.io"');
    expect(playgroundHash({ code: 'CODE' })).toBe('#s=CODE');
    expect(playgroundHash({ preset: 'race-width' })).toBe('#preset=race-width');
  });

  it('finds the recording of an unchanged recorded preset', () => {
    const p = PRESETS.find((x) => x.recorded);
    if (!p) throw new Error('no recorded preset');
    expect(recordedPresetFor(presetState(p))?.id).toBe(p.id);
    expect(recordedPresetFor({ ...presetState(p), epochs: 99 })).toBeNull();
  });
});
