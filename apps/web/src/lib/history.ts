// Per-model frame history for the replay scrubber (and, later, video export).
// Frames arrive in increasing epoch order. A frame is stored when its arrival
// index is a multiple of the current stride; when the store is full the stride
// doubles and the frames that no longer fit it are dropped. Spacing therefore
// stays even over the whole run and memory stays bounded. The latest frame is
// always kept separately, so "now" is never lost.
import type { RegionMetrics, StageInfo } from '@xtraplaytion/engine';

export interface StoredFrame {
  epoch: number;
  grid: Float32Array;
  metrics: RegionMetrics;
  trainLoss: number;
  valLoss: number;
  /** Posterior std on the grid (Gaussian process). */
  band?: Float32Array;
  /** Build-up of a classical model. */
  stage?: StageInfo;
}

interface Slot {
  k: number;
  frame: StoredFrame;
}

export class FrameHistory {
  private slots: Slot[] = [];
  private last: Slot | null = null;
  private count = 0;
  private stride = 1;
  readonly cap: number;

  constructor(cap = 600) {
    this.cap = Math.max(4, cap);
  }

  add(f: StoredFrame) {
    if (this.last && f.epoch <= this.last.frame.epoch) {
      // A reset or replayed run: drop everything at or after this epoch.
      this.slots = this.slots.filter((s) => s.frame.epoch < f.epoch);
      if (f.epoch === 0) this.clear();
    }
    const slot = { k: this.count++, frame: f };
    this.last = slot;
    if (slot.k % this.stride === 0) this.slots.push(slot);
    if (this.slots.length > this.cap) {
      this.stride *= 2;
      this.slots = this.slots.filter((s) => s.k % this.stride === 0);
    }
  }

  /** Stored frames in epoch order, including the latest one. */
  get frames(): StoredFrame[] {
    const out = this.slots.map((s) => s.frame);
    if (this.last && out[out.length - 1] !== this.last.frame) out.push(this.last.frame);
    return out;
  }

  /** The newest stored frame at or before `epoch`. */
  at(epoch: number): StoredFrame | null {
    if (this.last && epoch >= this.last.frame.epoch) return this.last.frame;
    const fs = this.slots;
    if (!fs.length) return this.last?.frame ?? null;
    if (epoch < fs[0].frame.epoch) return fs[0].frame;
    let lo = 0;
    let hi = fs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fs[mid].frame.epoch <= epoch) lo = mid;
      else hi = mid - 1;
    }
    return fs[lo].frame;
  }

  get latest(): StoredFrame | null {
    return this.last?.frame ?? null;
  }

  clear() {
    this.slots = [];
    this.last = null;
    this.count = 0;
    this.stride = 1;
  }

  /** Approximate memory use in bytes (grids dominate). */
  bytes(): number {
    return this.frames.reduce((s, f) => s + f.grid.byteLength + (f.band?.byteLength ?? 0) + 64, 0);
  }
}
