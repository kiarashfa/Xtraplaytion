<script lang="ts" module>
  /** Same dash patterns as the canvas plots (lib/scene/draw.ts). */
  export const DASH_ATTR = ['', '9 5', '2 5', '12 4 2 4', '16 6', '6 3 2 3 2 3'];
  /** Static class names so Tailwind generates them. */
  export const COLOR_CLASS = ['text-c1', 'text-c2', 'text-c3', 'text-c4', 'text-c5', 'text-c6'];
</script>

<script lang="ts">
  const { color, width = 28 }: { color: number; width?: number } = $props();
</script>

<svg
  {width}
  height="10"
  viewBox="0 0 {width} 10"
  aria-hidden="true"
  class="shrink-0 {COLOR_CLASS[(color - 1) % 6]}"
>
  <line
    x1="2"
    x2={width - 2}
    y1="5"
    y2="5"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    stroke-dasharray={DASH_ATTR[(color - 1) % 6]}
  />
</svg>
