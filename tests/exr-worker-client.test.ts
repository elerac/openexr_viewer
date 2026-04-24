import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disposeDecodeWorker, loadExrOffMainThread } from '../src/exr-worker-client';
import type { DecodeErrorPayload } from '../src/exr-decode-context';
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
        constructor(..._args: unknown[]) {
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

  it('removes queued decodes when their signal aborts before worker start', async () => {
    const workers = installWorkerMock();
    const first = loadExrOffMainThread(new Uint8Array([1, 2, 3]), { filename: 'first.exr' });
    const abortController = new AbortController();
    const second = loadExrOffMainThread(new Uint8Array([4, 5, 6]), {
      signal: abortController.signal,
      filename: 'second.exr'
    });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1);

    abortController.abort();

    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1);

    const decoded = createDecodedImage();
    const request = workers[0]?.postMessage.mock.calls[0]?.[0] as { id: number };
    workers[0]?.emitMessage({
      id: request.id,
      ok: true,
      image: decoded
    });
    await expect(first).resolves.toEqual(decoded);
  });

  it('terminates the active worker decode on abort and recreates it for the next request', async () => {
    const workers = installWorkerMock();
    const abortController = new AbortController();
    const first = loadExrOffMainThread(new Uint8Array([1, 2, 3]), {
      signal: abortController.signal,
      filename: 'active.exr'
    });
    const second = loadExrOffMainThread(new Uint8Array([4, 5, 6]), { filename: 'next.exr' });
    expect(workers).toHaveLength(1);

    abortController.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.postMessage).toHaveBeenCalledTimes(1);

    const decoded = createDecodedImage();
    const request = workers[1]?.postMessage.mock.calls[0]?.[0] as { id: number };
    workers[1]?.emitMessage({
      id: request.id,
      ok: true,
      image: decoded
    });
    await expect(second).resolves.toEqual(decoded);
  });

  it('attaches structured context to worker decode failures', async () => {
    const workers = installWorkerMock();
    const bytes = new Uint8Array(readFileSync(new URL('../public/cbox_rgb.exr', import.meta.url)));
    const pending = loadExrOffMainThread(bytes, { filename: 'broken.exr' });
    const request = workers[0]?.postMessage.mock.calls[0]?.[0] as {
      id: number;
      context: DecodeErrorPayload['context'];
    };
    const error: DecodeErrorPayload = {
      message: 'unsupported tiled image',
      context: {
        ...request.context,
        unsupportedFeatureReason: 'unsupported tiled image'
      }
    };

    workers[0]?.emitMessage({
      id: request.id,
      ok: false,
      error
    });

    await expect(pending).rejects.toMatchObject({
      name: 'ExrDecodeError',
      message: 'unsupported tiled image',
      decodeContext: {
        filename: 'broken.exr',
        byteSize: bytes.byteLength,
        headerSummary: expect.objectContaining({
          partCount: 1,
          parts: [
            expect.objectContaining({
              compression: 'PIZ',
              channels: '3 (R, G, B)'
            })
          ]
        }),
        unsupportedFeatureReason: 'unsupported tiled image'
      }
    });
  });
});

function installWorkerMock(): WorkerMock[] {
  const workers: WorkerMock[] = [];
  vi.stubGlobal(
    'Worker',
    class extends WorkerMock {
      constructor(..._args: unknown[]) {
        super();
        workers.push(this);
      }
    } as unknown as typeof Worker
  );
  return workers;
}

function createDecodedImage(): DecodedExrImage {
  return {
    width: 1,
    height: 1,
    layers: []
  };
}
