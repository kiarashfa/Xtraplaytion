import { describe, expect, it } from 'vitest';
import { FrameHistory, type StoredFrame } from './history.ts';

const frame = (epoch: number): StoredFrame => ({
  epoch,
  grid: Float32Array.of(epoch, epoch / 2),
  metrics: { inside: epoch, gap: 0, beyond: 0 },
  trainLoss: 1 / (epoch + 1),
  valLoss: NaN,
});

describe('FrameHistory', () => {
  it('finds the frame shown at any epoch', () => {
    const h = new FrameHistory();
    for (let e = 0; e <= 100; e += 10) h.add(frame(e));
    expect(h.at(0)?.epoch).toBe(0);
    expect(h.at(35)?.epoch).toBe(30);
    expect(h.at(40)?.epoch).toBe(40);
    expect(h.at(1000)?.epoch).toBe(100);
    expect(h.at(-5)?.epoch).toBe(0);
  });

  it('stays within its cap, keeps the first and latest frames, and covers the run evenly', () => {
    const h = new FrameHistory(100);
    for (let e = 0; e <= 5000; e += 5) h.add(frame(e));
    expect(h.frames.length).toBeLessThanOrEqual(101);
    expect(h.frames[0].epoch).toBe(0);
    expect(h.latest?.epoch).toBe(5000);
    const gaps = h.frames.slice(1).map((f, i) => f.epoch - h.frames[i].epoch);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(4 * Math.min(...gaps));
    // replay returns the stored frame object itself: exactly what was shown
    const mid = h.frames[40];
    // (frames is a fresh array each call; compare the frame objects themselves)
    expect(h.at(mid.epoch)).toBe(mid);
  });

  it('starts over when a run restarts from epoch 0', () => {
    const h = new FrameHistory();
    for (let e = 0; e <= 50; e += 10) h.add(frame(e));
    h.add(frame(0));
    expect(h.frames.map((f) => f.epoch)).toEqual([0]);
  });
});
