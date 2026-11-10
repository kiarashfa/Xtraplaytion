// Types for the parts of gifenc (MIT, no bundled types) that the exporter uses.
declare module 'gifenc' {
  export type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette): Uint8Array;
  export interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Palette; delay?: number; repeat?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  }
  export function GIFEncoder(): Encoder;
}
