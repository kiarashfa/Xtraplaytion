// CPU speed baseline: ms per epoch (full batch, ReLU, Adam, N = 200).
// Usage: pnpm --filter @xtraplaytion/engine bench
import { sin } from '@xtraplaytion/dmath';
import { buildDataset, createRun, mlp } from '../src/index.ts';

const data = buildDataset((x) => sin(x), {
  domain: [-3, 3],
  n: 200,
  bands: [],
  noise: { kind: 'none' },
  valFraction: 0,
  seed: 1,
  gridSize: 2,
});

// Naive scalar JS reference measured on the same kind of machine (i7-12700H, Node 24).
const configs: [number[], number, number][] = [
  [[10, 10], 2000, 0.23],
  [[500], 300, 3.4],
  [[100, 100], 300, 10],
  [[1000, 1000], 3, 3600],
];

for (const [hidden, epochs, naiveMs] of configs) {
  for (const act of ['relu', 'tanh'] as const) {
    const run = createRun(mlp({ hidden, activations: hidden.map(() => act) }), data, 1);
    run.step(Math.max(1, Math.round(epochs / 10))); // warm up the JIT
    const t0 = performance.now();
    run.step(epochs);
    const ms = (performance.now() - t0) / epochs;
    const dims = `[1, ${hidden.join(', ')}, 1]`.padEnd(18);
    const vs = act === 'relu' ? `naive ${naiveMs} ms -> ${(naiveMs / ms).toFixed(2)}x` : '';
    console.log(
      `${dims} ${act.padEnd(5)} ${ms.toFixed(3).padStart(9)} ms/epoch ${String(Math.round(1000 / ms)).padStart(6)} epochs/s   ${vs}`,
    );
  }
}
