import { afterEach, describe, expect, it, vi } from 'vitest';
import { disposeDecodeWorker, loadExrOffMainThread } from '../src/exr-worker-client';
import type { DecodedExrImage } from '../src/types';

type WorkerEventMap = {
  message: Array<(event: MessageEvent) => void>;
  error: Array<(event: ErrorEvent) => void>;
  messageerror: Array<() => void>;
};

class WorkerMock {
  readonly listeners: WorkerEventMap = {
    message: [],
    error: [],
    messageerror: []
  };
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();

  addEventListener(type: keyof WorkerEventMap, listener: WorkerEventMap[keyof WorkerEventMap][number]): void {
    this.listeners[type].push(listener as never);
  }

  removeEventListener(type: keyof WorkerEventMap, listener: WorkerEventMap[keyof WorkerEventMap][number]): void {
    this.listeners[type] = this.listeners[type].filter((entry) => entry !== listener) as never;
  }

  emitMessage(data: unknown): void {
    for (const listener of this.listeners.message) {
      listener({ data } as MessageEvent);
    }
  }
}

afterEach(() => {
  disposeDecodeWorker();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('exr worker client', () => {
  it('rejects pending decodes on dispose and recreates the worker lazily', async () => {
    const workers: WorkerMock[] = [];
    vi.stubGlobal(
      'Worker',
      class extends WorkerMock {
        constructor(...args: unknown[]) {
          super();
          workers.push(this);
        }
      } as unknown as typeof Worker
    );

    const pending = loadExrOffMainThread(new Uint8Array([1, 2, 3]));
    expect(workers).toHaveLength(1);

    disposeDecodeWorker();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);

    const decoded: DecodedExrImage = {
      width: 1,
      height: 1,
      layers: []
    };
    const next = loadExrOffMainThread(new Uint8Array([4, 5, 6]));
    expect(workers).toHaveLength(2);

    const request = workers[1]?.postMessage.mock.calls[0]?.[0] as { id: number };
    workers[1]?.emitMessage({
      id: request.id,
      ok: true,
      image: decoded
    });

    await expect(next).resolves.toEqual(decoded);
  });
});
