import { loadExr } from './exr';
import { createAbortError } from './lifecycle';
import type { DecodedExrImage } from './types';

interface DecodeWorkerRequest {
  id: number;
  bytes: Uint8Array;
}

type DecodeWorkerResponse =
  | {
      id: number;
      ok: true;
      image: DecodedExrImage;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

interface PendingDecode {
  resolve: (image: DecodedExrImage) => void;
  reject: (error: Error) => void;
}

let decodeWorker: Worker | null = null;
let nextRequestId = 1;
const pendingDecodes = new Map<number, PendingDecode>();
let onWorkerMessage: ((event: MessageEvent<DecodeWorkerResponse>) => void) | null = null;
let onWorkerError: ((event: ErrorEvent) => void) | null = null;
let onWorkerMessageError: (() => void) | null = null;

export async function loadExrOffMainThread(bytes: Uint8Array): Promise<DecodedExrImage> {
  if (typeof Worker === 'undefined') {
    return await loadExr(bytes);
  }

  let worker: Worker;
  try {
    worker = getDecodeWorker();
  } catch {
    return await loadExr(bytes);
  }
  const id = nextRequestId++;

  return await new Promise<DecodedExrImage>((resolve, reject) => {
    pendingDecodes.set(id, { resolve, reject });

    try {
      const transferableBytes = prepareTransferableBytes(bytes);
      worker.postMessage(
        {
          id,
          bytes: transferableBytes.bytes
        } satisfies DecodeWorkerRequest,
        transferableBytes.transferables
      );
    } catch (error) {
      pendingDecodes.delete(id);
      reject(error instanceof Error ? error : new Error('Failed to start EXR decode worker.'));
    }
  });
}

function getDecodeWorker(): Worker {
  if (decodeWorker) {
    return decodeWorker;
  }

  decodeWorker = new Worker(new URL('./exr-worker.ts', import.meta.url), { type: 'module' });
  onWorkerMessage = (event: MessageEvent<DecodeWorkerResponse>) => {
    const response = event.data;
    const pending = pendingDecodes.get(response.id);
    if (!pending) {
      return;
    }

    pendingDecodes.delete(response.id);
    if (response.ok) {
      pending.resolve(response.image);
      return;
    }

    pending.reject(new Error(response.error));
  };
  onWorkerError = (event: ErrorEvent) => {
    disposeDecodeWorker(new Error(event.message || 'EXR decode worker failed.'));
  };
  onWorkerMessageError = () => {
    disposeDecodeWorker(new Error('EXR decode worker returned an unreadable response.'));
  };
  decodeWorker.addEventListener('message', onWorkerMessage);
  decodeWorker.addEventListener('error', onWorkerError);
  decodeWorker.addEventListener('messageerror', onWorkerMessageError);

  return decodeWorker;
}

export function disposeDecodeWorker(error: Error = createAbortError('EXR decode worker was terminated.')): void {
  rejectPendingDecodes(error);

  if (!decodeWorker) {
    return;
  }

  if (onWorkerMessage) {
    decodeWorker.removeEventListener('message', onWorkerMessage);
  }
  if (onWorkerError) {
    decodeWorker.removeEventListener('error', onWorkerError);
  }
  if (onWorkerMessageError) {
    decodeWorker.removeEventListener('messageerror', onWorkerMessageError);
  }

  decodeWorker.terminate();
  decodeWorker = null;
  onWorkerMessage = null;
  onWorkerError = null;
  onWorkerMessageError = null;
}

function rejectPendingDecodes(error: Error): void {
  for (const pending of pendingDecodes.values()) {
    pending.reject(error);
  }
  pendingDecodes.clear();
}

function prepareTransferableBytes(bytes: Uint8Array): { bytes: Uint8Array; transferables: Transferable[] } {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return {
      bytes,
      transferables: [bytes.buffer]
    };
  }

  const copy = new Uint8Array(bytes);
  return {
    bytes: copy,
    transferables: [copy.buffer]
  };
}
