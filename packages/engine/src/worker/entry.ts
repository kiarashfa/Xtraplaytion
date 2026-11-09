// Entry point of a training worker. The loop yields through a MessageChannel
// (not timers or rAF) so pause and ack messages are handled between frames.
import { createHost } from './host.ts';
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

const handle = createHost({
  post: (msg, transfer) => self.postMessage(msg, transfer),
  schedule: (cb) => {
    pending = cb;
    channel.port2.postMessage(0);
  },
  now: () => performance.now(),
});

self.onmessage = (e: MessageEvent<ToWorker>) => handle(e.data);
