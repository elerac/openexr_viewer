import { loadExr } from './exr';
import {
  createAbortError,
  isAbortError,
  throwIfAborted
} from './lifecycle';
import {
  createDecodeErrorContext,
  createDecodeErrorFromPayload,
  createDecodeErrorPayload,
  type DecodeBytesOptions,
  type DecodeErrorContext,
  type DecodeErrorPayload
} from './exr-decode-context';
import {
  errorResource,
  isPendingMatch,
  pendingResource,
  successResource,
  type AsyncResource
} from './async-resource';
import type { DecodedExrImage } from './types';

interface DecodeWorkerRequest {
  id: number;
  bytes: Uint8Array;
  filename: string | null;
  context: DecodeErrorContext;
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
      error: DecodeErrorPayload | string;
    };

type DecodeWorkerErrorPayload = Extract<DecodeWorkerResponse, { ok: false }>['error'];

interface DecodeRequest {
  id: number;
  key: string;
  resource: AsyncResource<DecodedExrImage>;
  bytes: Uint8Array;
  filename: string | null;
  context: DecodeErrorContext;
  resolve: (image: DecodedExrImage) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
}

let decodeWorker: Worker | null = null;
let nextRequestId = 1;
const queuedDecodes: DecodeRequest[] = [];
let activeDecode: DecodeRequest | null = null;
let onWorkerMessage: ((event: MessageEvent<DecodeWorkerResponse>) => void) | null = null;
let onWorkerError: ((event: ErrorEvent) => void) | null = null;
let onWorkerMessageError: (() => void) | null = null;

export async function loadExrOffMainThread(
  bytes: Uint8Array,
  options: DecodeBytesOptions = {}
): Promise<DecodedExrImage> {
  const context = createDecodeErrorContext(bytes, options.filename);
  if (options.signal) {
    throwIfAborted(options.signal, 'EXR decode was aborted.');
  }

  if (typeof Worker === 'undefined') {
    return await decodeOnMainThread(bytes, options.signal, context);
  }

  try {
    getDecodeWorker();
  } catch {
    return await decodeOnMainThread(bytes, options.signal, context);
  }

  const id = nextRequestId++;

  return await new Promise<DecodedExrImage>((resolve, reject) => {
    const request: DecodeRequest = {
      id,
      key: buildDecodeResourceKey(id),
      resource: pendingResource(buildDecodeResourceKey(id), id),
      bytes,
      filename: context.filename,
      context,
      resolve,
      reject,
      signal: options.signal
    };

    attachAbortListener(request);
    queuedDecodes.push(request);
    pumpDecodeQueue();
  });
}

function getDecodeWorker(): Worker {
  if (decodeWorker) {
    return decodeWorker;
  }

  decodeWorker = new Worker(new URL('./exr-worker.ts', import.meta.url), { type: 'module' });
  onWorkerMessage = (event: MessageEvent<DecodeWorkerResponse>) => {
    const response = event.data;
    const request = activeDecode;
    if (!request || request.id !== response.id) {
      return;
    }

    activeDecode = null;
    if (response.ok) {
      request.resource = successResource(request.key, response.image);
      cleanupDecodeRequest(request);
      request.resolve(response.image);
      pumpDecodeQueue();
      return;
    }

    request.reject(createDecodeErrorFromPayload(normalizeWorkerErrorPayload(response.error, request.context)));
    pumpDecodeQueue();
  };
  onWorkerError = (event: ErrorEvent) => {
    rejectActiveDecodeWithPayload(createDecodeErrorPayload(
      new Error(event.message || 'EXR decode worker failed.'),
      activeDecode?.context ?? createEmptyDecodeContext()
    ));
    terminateDecodeWorkerInstance();
    pumpDecodeQueue();
  };
  onWorkerMessageError = () => {
    rejectActiveDecodeWithPayload(createDecodeErrorPayload(
      new Error('EXR decode worker returned an unreadable response.'),
      activeDecode?.context ?? createEmptyDecodeContext()
    ));
    terminateDecodeWorkerInstance();
    pumpDecodeQueue();
  };
  decodeWorker.addEventListener('message', onWorkerMessage);
  decodeWorker.addEventListener('error', onWorkerError);
  decodeWorker.addEventListener('messageerror', onWorkerMessageError);

  return decodeWorker;
}

export function disposeDecodeWorker(error: Error = createAbortError('EXR decode worker was terminated.')): void {
  for (const request of queuedDecodes.splice(0)) {
    rejectDecodeRequest(request, error);
  }
  if (activeDecode) {
    const request = activeDecode;
    activeDecode = null;
    rejectDecodeRequest(request, error);
  }

  terminateDecodeWorkerInstance();
}

function terminateDecodeWorkerInstance(): void {
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

async function decodeOnMainThread(
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
  context: DecodeErrorContext
): Promise<DecodedExrImage> {
  try {
    if (signal) {
      throwIfAborted(signal, 'EXR decode was aborted.');
    }
    const image = await loadExr(bytes);
    if (signal) {
      throwIfAborted(signal, 'EXR decode was aborted.');
    }
    return image;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw createDecodeErrorFromPayload(createDecodeErrorPayload(error, context));
  }
}

function pumpDecodeQueue(): void {
  if (activeDecode || queuedDecodes.length === 0) {
    return;
  }

  const request = queuedDecodes.shift();
  if (!request) {
    return;
  }

  if (request.signal?.aborted) {
    rejectDecodeRequest(request, getAbortReason(request.signal));
    pumpDecodeQueue();
    return;
  }

  activeDecode = request;
  try {
    const worker = getDecodeWorker();
    const transferableBytes = prepareTransferableBytes(request.bytes);
    worker.postMessage(
      {
        id: request.id,
        bytes: transferableBytes.bytes,
        filename: request.filename,
        context: request.context
      } satisfies DecodeWorkerRequest,
      transferableBytes.transferables
    );
  } catch (error) {
    activeDecode = null;
    rejectDecodeRequest(
      request,
      createDecodeErrorFromPayload(createDecodeErrorPayload(
        error instanceof Error ? error : new Error('Failed to start EXR decode worker.'),
        request.context
      ))
    );
    pumpDecodeQueue();
  }
}

function attachAbortListener(request: DecodeRequest): void {
  const signal = request.signal;
  if (!signal) {
    return;
  }

  request.abortListener = () => {
    abortDecodeRequest(request);
  };
  signal.addEventListener('abort', request.abortListener, { once: true });
}

function abortDecodeRequest(request: DecodeRequest): void {
  const error = getAbortReason(request.signal);
  if (activeDecode === request) {
    activeDecode = null;
    rejectDecodeRequest(request, error);
    terminateDecodeWorkerInstance();
    pumpDecodeQueue();
    return;
  }

  const queuedIndex = queuedDecodes.indexOf(request);
  if (queuedIndex < 0) {
    return;
  }
  queuedDecodes.splice(queuedIndex, 1);
  rejectDecodeRequest(request, error);
}

function rejectActiveDecodeWithPayload(payload: DecodeErrorPayload): void {
  const request = activeDecode;
  if (!request) {
    return;
  }

  activeDecode = null;
  rejectDecodeRequest(request, createDecodeErrorFromPayload(payload));
}

function rejectDecodeRequest(request: DecodeRequest, error: Error): void {
  if (isPendingMatch(request.resource, request.key, request.id)) {
    request.resource = errorResource(request.key, error);
  }
  cleanupDecodeRequest(request);
  request.reject(error);
}

function cleanupDecodeRequest(request: DecodeRequest): void {
  if (!request.signal || !request.abortListener) {
    return;
  }

  request.signal.removeEventListener('abort', request.abortListener);
  request.abortListener = undefined;
}

function normalizeWorkerErrorPayload(
  error: DecodeWorkerErrorPayload,
  context: DecodeErrorContext
): DecodeErrorPayload {
  return typeof error === 'string'
    ? createDecodeErrorPayload(new Error(error), context)
    : error;
}

function getAbortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : createAbortError('EXR decode was aborted.');
}

function createEmptyDecodeContext(): DecodeErrorContext {
  return {
    filename: null,
    byteSize: 0,
    headerSummary: null,
    unsupportedFeatureReason: null
  };
}

function buildDecodeResourceKey(id: number): string {
  return `decode:${id}`;
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
