import { loadExr } from './exr';
import ExrDecodeWorker from './exr-worker.ts?worker&inline';
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
import {
  getDefaultImageLoadWorkers,
  normalizeImageLoadWorkers
} from './image-load-workers';
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

interface DecodeWorkerSlot {
  id: number;
  worker: Worker;
  active: DecodeRequest | null;
  retireWhenIdle: boolean;
  onMessage: (event: MessageEvent<DecodeWorkerResponse>) => void;
  onError: (event: ErrorEvent) => void;
  onMessageError: () => void;
}

let nextRequestId = 1;
let nextWorkerSlotId = 1;
let maxDecodeWorkers = getDefaultImageLoadWorkers();
let decodeWorkersUnavailable = false;
const decodeWorkersSupported = import.meta.env.MODE !== 'vscode';
const queuedDecodes: DecodeRequest[] = [];
const workerSlots: DecodeWorkerSlot[] = [];

export async function loadExrOffMainThread(
  bytes: Uint8Array,
  options: DecodeBytesOptions = {}
): Promise<DecodedExrImage> {
  const context = createDecodeErrorContext(bytes, options.filename);
  if (options.signal) {
    throwIfAborted(options.signal, 'EXR decode was aborted.');
  }

  if (!decodeWorkersSupported || typeof Worker === 'undefined' || decodeWorkersUnavailable) {
    return await decodeOnMainThread(bytes, options.signal, context);
  }

  try {
    ensureInitialDecodeWorkerSlot();
  } catch {
    decodeWorkersUnavailable = true;
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

export function setMaxDecodeWorkers(workerCount: number): void {
  const normalized = normalizeImageLoadWorkers(workerCount);
  if (maxDecodeWorkers === normalized) {
    return;
  }

  maxDecodeWorkers = normalized;
  enforceDecodeWorkerLimit();
  pumpDecodeQueue();
}

export function disposeDecodeWorker(error: Error = createAbortError('EXR decode worker was terminated.')): void {
  for (const request of queuedDecodes.splice(0)) {
    rejectDecodeRequest(request, error);
  }

  for (const slot of [...workerSlots]) {
    if (slot.active) {
      const request = slot.active;
      slot.active = null;
      rejectDecodeRequest(request, error);
    }
    terminateDecodeWorkerSlot(slot);
  }

  decodeWorkersUnavailable = false;
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

function ensureInitialDecodeWorkerSlot(): void {
  if (workerSlots.length > 0) {
    return;
  }

  workerSlots.push(createDecodeWorkerSlot());
}

function createDecodeWorkerSlot(): DecodeWorkerSlot {
  const worker = new ExrDecodeWorker();
  const slot: DecodeWorkerSlot = {
    id: nextWorkerSlotId++,
    worker,
    active: null,
    retireWhenIdle: false,
    onMessage: (event) => {
      handleWorkerMessage(slot, event.data);
    },
    onError: (event) => {
      handleWorkerFailure(
        slot,
        createDecodeErrorPayload(
          new Error(event.message || 'EXR decode worker failed.'),
          slot.active?.context ?? createEmptyDecodeContext()
        )
      );
    },
    onMessageError: () => {
      handleWorkerFailure(
        slot,
        createDecodeErrorPayload(
          new Error('EXR decode worker returned an unreadable response.'),
          slot.active?.context ?? createEmptyDecodeContext()
        )
      );
    }
  };

  worker.addEventListener('message', slot.onMessage);
  worker.addEventListener('error', slot.onError);
  worker.addEventListener('messageerror', slot.onMessageError);
  return slot;
}

function handleWorkerMessage(slot: DecodeWorkerSlot, response: DecodeWorkerResponse): void {
  const request = slot.active;
  if (!request || request.id !== response.id) {
    return;
  }

  slot.active = null;
  if (response.ok) {
    request.resource = successResource(request.key, response.image);
    cleanupDecodeRequest(request);
    request.resolve(response.image);
  } else {
    rejectDecodeRequest(
      request,
      createDecodeErrorFromPayload(normalizeWorkerErrorPayload(response.error, request.context))
    );
  }

  releaseDecodeWorkerSlot(slot);
  pumpDecodeQueue();
}

function handleWorkerFailure(slot: DecodeWorkerSlot, payload: DecodeErrorPayload): void {
  const request = slot.active;
  if (request) {
    slot.active = null;
    rejectDecodeRequest(request, createDecodeErrorFromPayload(payload));
  }

  terminateDecodeWorkerSlot(slot);
  pumpDecodeQueue();
}

function terminateDecodeWorkerSlot(slot: DecodeWorkerSlot): void {
  const index = workerSlots.indexOf(slot);
  if (index >= 0) {
    workerSlots.splice(index, 1);
  }

  slot.worker.removeEventListener('message', slot.onMessage);
  slot.worker.removeEventListener('error', slot.onError);
  slot.worker.removeEventListener('messageerror', slot.onMessageError);
  slot.worker.terminate();
}

function releaseDecodeWorkerSlot(slot: DecodeWorkerSlot): void {
  if (slot.retireWhenIdle || workerSlots.length > maxDecodeWorkers) {
    terminateDecodeWorkerSlot(slot);
  }
}

function enforceDecodeWorkerLimit(): void {
  for (const slot of [...workerSlots]) {
    if (workerSlots.length <= maxDecodeWorkers) {
      break;
    }
    if (!slot.active) {
      terminateDecodeWorkerSlot(slot);
    }
  }

  let excessActiveWorkers = Math.max(0, workerSlots.length - maxDecodeWorkers);
  for (let index = workerSlots.length - 1; index >= 0 && excessActiveWorkers > 0; index -= 1) {
    const slot = workerSlots[index];
    if (!slot || !slot.active) {
      continue;
    }

    slot.retireWhenIdle = true;
    excessActiveWorkers -= 1;
  }
}

function pumpDecodeQueue(): void {
  if (queuedDecodes.length === 0) {
    return;
  }

  while (queuedDecodes.length > 0 && getActiveDecodeCount() < maxDecodeWorkers) {
    const request = queuedDecodes.shift();
    if (!request) {
      return;
    }

    if (request.signal?.aborted) {
      rejectDecodeRequest(request, getAbortReason(request.signal));
      continue;
    }

    const slot = takeDecodeWorkerSlot();
    if (!slot) {
      queuedDecodes.unshift(request);
      return;
    }

    startDecodeRequest(slot, request);
  }
}

function takeDecodeWorkerSlot(): DecodeWorkerSlot | null {
  const idleSlot = workerSlots.find((slot) => !slot.active && !slot.retireWhenIdle);
  if (idleSlot) {
    return idleSlot;
  }

  if (workerSlots.length >= maxDecodeWorkers) {
    return null;
  }

  try {
    const slot = createDecodeWorkerSlot();
    workerSlots.push(slot);
    return slot;
  } catch {
    return null;
  }
}

function getActiveDecodeCount(): number {
  return workerSlots.reduce((count, slot) => count + (slot.active ? 1 : 0), 0);
}

function startDecodeRequest(slot: DecodeWorkerSlot, request: DecodeRequest): void {
  slot.active = request;
  try {
    const transferableBytes = prepareTransferableBytes(request.bytes);
    slot.worker.postMessage(
      {
        id: request.id,
        bytes: transferableBytes.bytes,
        filename: request.filename,
        context: request.context
      } satisfies DecodeWorkerRequest,
      transferableBytes.transferables
    );
  } catch (error) {
    slot.active = null;
    rejectDecodeRequest(
      request,
      createDecodeErrorFromPayload(createDecodeErrorPayload(
        error instanceof Error ? error : new Error('Failed to start EXR decode worker.'),
        request.context
      ))
    );
    releaseDecodeWorkerSlot(slot);
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
  const activeSlot = workerSlots.find((slot) => slot.active === request);
  if (activeSlot) {
    activeSlot.active = null;
    rejectDecodeRequest(request, error);
    terminateDecodeWorkerSlot(activeSlot);
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
