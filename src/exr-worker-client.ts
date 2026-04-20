import { loadExr } from './exr';
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
  decodeWorker.addEventListener('message', (event: MessageEvent<DecodeWorkerResponse>) => {
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
  });
  decodeWorker.addEventListener('error', (event) => {
    rejectPendingDecodes(new Error(event.message || 'EXR decode worker failed.'));
    decodeWorker?.terminate();
    decodeWorker = null;
  });
  decodeWorker.addEventListener('messageerror', () => {
    rejectPendingDecodes(new Error('EXR decode worker returned an unreadable response.'));
    decodeWorker?.terminate();
    decodeWorker = null;
  });

  return decodeWorker;
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
