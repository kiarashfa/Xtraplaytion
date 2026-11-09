<script lang="ts">
  // KaTeX builds DOM nodes and sets styles through CSSOM, which the CSP allows
  // (renderToString would produce style attributes, which it blocks).
  import katex from 'katex';
  import 'katex/dist/katex.min.css';

  const { tex, display = false }: { tex: string; display?: boolean } = $props();
  let el = $state<HTMLSpanElement>();

  $effect(() => {
    if (!el) return;
    katex.render(tex, el, { throwOnError: false, displayMode: display, output: 'htmlAndMathml' });
  });
</script>

<span bind:this={el} class="tex"></span>
