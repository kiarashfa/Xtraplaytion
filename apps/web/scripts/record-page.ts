// Runs inside headless Chrome for scripts/record.ts: trains every model of an
// experiment on WebGPU and returns the frames (plain arrays, for page.evaluate).
import { GpuRun, requestDevice } from '@xtraplaytion/engine';
import { datasetOf } from '../src/lib/experiment.ts';
import type { ExperimentState } from '../src/lib/share.ts';

export interface PageModel {
  trainLoss: number[];
  valLoss: number[];
  frameEpochs: number[];
  grids: number[][];
  diverged: boolean;
}

export async function record(
  state: ExperimentState,
  every: number,
): Promise<{ adapter: string; models: PageModel[] }> {
  const data = datasetOf(state);
  if (!data) throw new Error('invalid experiment');
  let adapterName = '';
  const models: PageModel[] = [];
  for (const m of state.models) {
    const { device, adapter } = await requestDevice();
    adapterName = adapter;
    const run = await GpuRun.create(device, m.model, data, m.seed);
    const frameEpochs: number[] = [];
    const grids: number[][] = [];
    const keep = async () => {
      const f = await run.frame();
      frameEpochs.push(f.epoch);
      grids.push(Array.from(f.grid));
    };
    await keep();
    while (run.epoch < state.epochs && !run.diverged) {
      await run.step(Math.min(every, state.epochs - run.epoch));
      await keep();
    }
    models.push({
      trainLoss: run.trainLoss.slice(),
      valLoss: run.valLoss.slice(),
      frameEpochs,
      grids,
      diverged: run.diverged,
    });
    run.dispose();
    device.destroy();
  }
  return { adapter: adapterName, models };
}
