// Entry point of a training worker. The loop yields through a MessageChannel
// (not timers or rAF) so pause and ack messages are handled between frames.
import { GpuRun, requestDevice } from '../gpu/run.ts';
import { createHost, type GpuHandle, type HostEnv } from './host.ts';
import type { ToWorker } from './protocol.ts';

// Only the parts of the worker global scope used here (keeps the DOM/WebWorker libs optional).
declare const self: {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

const channel = new MessageChannel();
let pending: (() => void) | null = null;
channel.port1.onmessage = () => {
  const cb = pending;
  pending = null;
  cb?.();
};

/** One device per run: disposing the run destroys its device (that loss is ignored). */
const gpu: HostEnv['gpu'] = async (config, data, seed, from) => {
  const { device, adapter } = await requestDevice();
  let ours = false;
  // Never settles for a loss we caused (dispose) or a deliberate destroy.
  const lost = device.lost.then((info): Promise<void> | void =>
    ours || info.reason === 'destroyed' ? new Promise<void>(() => {}) : undefined,
  );
  try {
    const run = await GpuRun.create(device, config, data, seed, from);
    const dispose = run.dispose.bind(run);
    run.dispose = () => {
      ours = true;
      dispose();
      device.destroy();
    };
    return { run, adapter, lost } satisfies GpuHandle;
  } catch (e) {
    ours = true;
    device.destroy();
    throw e;
  }
};

const hasGpu = typeof (globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu === 'object';

const handle = createHost({
  post: (msg, transfer) => self.postMessage(msg, transfer),
  schedule: (cb) => {
    pending = cb;
    channel.port2.postMessage(0);
  },
  now: () => performance.now(),
  ...(hasGpu ? { gpu } : {}),
});

self.onmessage = (e: MessageEvent<ToWorker>) => handle(e.data);
