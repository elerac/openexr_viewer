import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disposeDecodeWorker, loadExrOffMainThread, setMaxDecodeWorkers } from '../src/exr-worker-client';
import { getDefaultImageLoadWorkers } from '../src/image-load-workers';
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
  setMaxDecodeWorkers(getDefaultImageLoadWorkers());
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

    const request = workers[1]?.postMessage.mock.calls[0]?.[0] as PostedDecodeRequest;
    expect(request.wasmUrl).toMatch(/exrs_raw_wasm_bindgen_bg\.wasm$/u);
    expect(() => new URL(request.wasmUrl)).not.toThrow();
    workers[1]?.emitMessage({
      id: request.id,
      ok: true,
      image: decoded
    });

    await expect(next).resolves.toEqual(decoded);
  });

  it('runs worker decodes concurrently up to the configured limit', async () => {
    setMaxDecodeWorkers(2);
    const workers = installWorkerMock();
    const first = loadExrOffMainThread(new Uint8Array([1, 2, 3]), { filename: 'first.exr' });
    const second = loadExrOffMainThread(new Uint8Array([4, 5, 6]), { filename: 'second.exr' });

    expect(workers).toHaveLength(2);
    expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1);
    expect(workers[1]?.postMessage).toHaveBeenCalledTimes(1);

    const firstDecoded = createDecodedImage(1);
    const secondDecoded = createDecodedImage(2);
    const firstRequest = workers[0]?.postMessage.mock.calls[0]?.[0] as { id: number };
    const secondRequest = workers[1]?.postMessage.mock.calls[0]?.[0] as { id: number };

    workers[1]?.emitMessage({
      id: secondRequest.id,
      ok: true,
      image: secondDecoded
    });
    await expect(second).resolves.toEqual(secondDecoded);

    workers[0]?.emitMessage({
      id: firstRequest.id,
      ok: true,
      image: firstDecoded
    });
    await expect(first).resolves.toEqual(firstDecoded);
  });

  it('keeps overflow decodes queued until a worker slot is available', async () => {
    setMaxDecodeWorkers(2);
    const workers = installWorkerMock();
    const first = loadExrOffMainThread(new Uint8Array([1]), { filename: 'first.exr' });
    const second = loadExrOffMainThread(new Uint8Array([2]), { filename: 'second.exr' });
    const third = loadExrOffMainThread(new Uint8Array([3]), { filename: 'third.exr' });

    expect(workers).toHaveLength(2);
    expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1);
    expect(workers[1]?.postMessage).toHaveBeenCalledTimes(1);

    const firstRequest = workers[0]?.postMessage.mock.calls[0]?.[0] as { id: number };
    const firstDecoded = createDecodedImage(1);
    workers[0]?.emitMessage({
      id: firstRequest.id,
      ok: true,
      image: firstDecoded
    });

    await expect(first).resolves.toEqual(firstDecoded);
    expect(workers[0]?.postMessage).toHaveBeenCalledTimes(2);
    const thirdRequest = workers[0]?.postMessage.mock.calls[1]?.[0] as { id: number };
    const thirdDecoded = createDecodedImage(3);
    workers[0]?.emitMessage({
      id: thirdRequest.id,
      ok: true,
      image: thirdDecoded
    });
    await expect(third).resolves.toEqual(thirdDecoded);

    const secondRequest = workers[1]?.postMessage.mock.calls[0]?.[0] as { id: number };
    const secondDecoded = createDecodedImage(2);
    workers[1]?.emitMessage({
      id: secondRequest.id,
      ok: true,
      image: secondDecoded
    });
    await expect(second).resolves.toEqual(secondDecoded);
  });

  it('removes queued decodes when their signal aborts before worker start', async () => {
    setMaxDecodeWorkers(1);
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
    setMaxDecodeWorkers(1);
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

  it('aborts only the active worker slot for the cancelled request', async () => {
    setMaxDecodeWorkers(2);
    const workers = installWorkerMock();
    const abortController = new AbortController();
    const first = loadExrOffMainThread(new Uint8Array([1]), {
      signal: abortController.signal,
      filename: 'first.exr'
    });
    const second = loadExrOffMainThread(new Uint8Array([2]), { filename: 'second.exr' });

    expect(workers).toHaveLength(2);
    abortController.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(workers[1]?.terminate).not.toHaveBeenCalled();

    const decoded = createDecodedImage(2);
    const request = workers[1]?.postMessage.mock.calls[0]?.[0] as { id: number };
    workers[1]?.emitMessage({
      id: request.id,
      ok: true,
      image: decoded
    });
    await expect(second).resolves.toEqual(decoded);
  });

  it('retires excess workers after the decode limit is lowered', async () => {
    setMaxDecodeWorkers(2);
    const workers = installWorkerMock();
    const first = loadExrOffMainThread(new Uint8Array([1]), { filename: 'first.exr' });
    const second = loadExrOffMainThread(new Uint8Array([2]), { filename: 'second.exr' });

    expect(workers).toHaveLength(2);
    setMaxDecodeWorkers(1);

    const firstRequest = workers[0]?.postMessage.mock.calls[0]?.[0] as { id: number };
    const secondRequest = workers[1]?.postMessage.mock.calls[0]?.[0] as { id: number };
    const firstDecoded = createDecodedImage(1);
    const secondDecoded = createDecodedImage(2);

    workers[1]?.emitMessage({
      id: secondRequest.id,
      ok: true,
      image: secondDecoded
    });
    await expect(second).resolves.toEqual(secondDecoded);
    expect(workers[1]?.terminate).toHaveBeenCalledTimes(1);

    workers[0]?.emitMessage({
      id: firstRequest.id,
      ok: true,
      image: firstDecoded
    });
    await expect(first).resolves.toEqual(firstDecoded);
    expect(workers[0]?.terminate).not.toHaveBeenCalled();
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

function createDecodedImage(width = 1): DecodedExrImage {
  return {
    width,
    height: 1,
    layers: []
  };
}

interface PostedDecodeRequest {
  id: number;
  wasmUrl: string;
}
