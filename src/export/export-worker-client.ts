import { zipSync } from 'fflate';
import { createPngBytesFromPixels } from '../export-image';
import { createAbortError, isAbortError, throwIfAborted } from '../lifecycle';
import ExportWorker from './export-worker.ts?worker&inline';
import type { ExportImagePixels } from './export-pixels';
import type { PngCompressionLevel } from '../types';

interface EncodePngWorkerRequest {
  id: number;
  type: 'encodePng';
  pixels: ExportImagePixels;
  compressionLevel?: PngCompressionLevel;
}

interface ZipFilesWorkerRequest {
  id: number;
  type: 'zipFiles';
  files: Record<string, Uint8Array>;
}

type ExportWorkerRequest = EncodePngWorkerRequest | ZipFilesWorkerRequest;
type ExportWorkerRequestBody =
  | Omit<EncodePngWorkerRequest, 'id'>
  | Omit<ZipFilesWorkerRequest, 'id'>;

type ExportWorkerResponse =
  | {
      id: number;
      ok: true;
      bytes: Uint8Array;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

interface ExportWorkerJob {
  id: number;
  request: ExportWorkerRequest;
  transferables: Transferable[];
  signal?: AbortSignal;
  abortListener?: () => void;
  resolve: (bytes: Uint8Array) => void;
  reject: (error: Error) => void;
}

interface ExportWorkerSlot {
  worker: Worker;
  active: ExportWorkerJob | null;
  onMessage: (event: MessageEvent<ExportWorkerResponse>) => void;
  onError: (event: ErrorEvent) => void;
  onMessageError: () => void;
}

export interface EncodePngOffMainThreadOptions {
  compressionLevel?: PngCompressionLevel;
  signal?: AbortSignal;
}

export interface ZipFilesOffMainThreadOptions {
  signal?: AbortSignal;
}

let nextRequestId = 1;
let workerSlot: ExportWorkerSlot | null = null;
let exportWorkerUnavailable = false;
const queuedJobs: ExportWorkerJob[] = [];

export async function encodePngOffMainThread(
  pixels: ExportImagePixels,
  options: EncodePngOffMainThreadOptions = {}
): Promise<Uint8Array> {
  throwIfSignalAborted(options.signal, 'PNG encoding was aborted.');

  if (typeof Worker === 'undefined' || exportWorkerUnavailable) {
    return encodePngOnMainThread(pixels, options);
  }

  try {
    ensureExportWorkerSlot();
  } catch {
    exportWorkerUnavailable = true;
    return encodePngOnMainThread(pixels, options);
  }

  const preparedPixels = prepareTransferablePixels(pixels);
  return enqueueExportWorkerJob({
    type: 'encodePng',
    pixels: preparedPixels.pixels,
    compressionLevel: options.compressionLevel
  }, preparedPixels.transferables, options.signal);
}

export async function zipFilesOffMainThread(
  files: Record<string, Uint8Array>,
  options: ZipFilesOffMainThreadOptions = {}
): Promise<Uint8Array> {
  throwIfSignalAborted(options.signal, 'ZIP packaging was aborted.');

  if (typeof Worker === 'undefined' || exportWorkerUnavailable) {
    return zipFilesOnMainThread(files, options.signal);
  }

  try {
    ensureExportWorkerSlot();
  } catch {
    exportWorkerUnavailable = true;
    return zipFilesOnMainThread(files, options.signal);
  }

  const preparedFiles = prepareTransferableFiles(files);
  return enqueueExportWorkerJob({
    type: 'zipFiles',
    files: preparedFiles.files
  }, preparedFiles.transferables, options.signal);
}

export function disposeExportWorker(error: Error = createAbortError('Export worker was terminated.')): void {
  for (const job of queuedJobs.splice(0)) {
    rejectExportWorkerJob(job, error);
  }

  if (workerSlot) {
    if (workerSlot.active) {
      const job = workerSlot.active;
      workerSlot.active = null;
      rejectExportWorkerJob(job, error);
    }
    terminateExportWorkerSlot(workerSlot);
  }

  exportWorkerUnavailable = false;
}

function enqueueExportWorkerJob(
  request: ExportWorkerRequestBody,
  transferables: Transferable[],
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (signal?.aborted) {
    return Promise.reject(getAbortReason(signal, 'Export worker task was aborted.'));
  }

  const id = nextRequestId++;
  return new Promise<Uint8Array>((resolve, reject) => {
    const job: ExportWorkerJob = {
      id,
      request: {
        id,
        ...request
      } as ExportWorkerRequest,
      transferables,
      signal,
      resolve,
      reject
    };

    attachAbortListener(job);
    queuedJobs.push(job);
    pumpExportWorkerQueue();
  });
}

function ensureExportWorkerSlot(): ExportWorkerSlot {
  if (workerSlot) {
    return workerSlot;
  }

  const worker = new ExportWorker();
  const slot: ExportWorkerSlot = {
    worker,
    active: null,
    onMessage: (event) => {
      handleWorkerMessage(slot, event.data);
    },
    onError: (event) => {
      handleWorkerFailure(slot, new Error(event.message || 'Export worker failed.'));
    },
    onMessageError: () => {
      handleWorkerFailure(slot, new Error('Export worker returned an unreadable response.'));
    }
  };

  worker.addEventListener('message', slot.onMessage);
  worker.addEventListener('error', slot.onError);
  worker.addEventListener('messageerror', slot.onMessageError);
  workerSlot = slot;
  return slot;
}

function pumpExportWorkerQueue(): void {
  if (queuedJobs.length === 0) {
    return;
  }

  let slot: ExportWorkerSlot;
  try {
    slot = ensureExportWorkerSlot();
  } catch {
    exportWorkerUnavailable = true;
    void drainQueuedJobsOnMainThread();
    return;
  }

  if (slot.active) {
    return;
  }

  const job = queuedJobs.shift();
  if (!job) {
    return;
  }

  if (job.signal?.aborted) {
    rejectExportWorkerJob(job, getAbortReason(job.signal, 'Export worker task was aborted.'));
    pumpExportWorkerQueue();
    return;
  }

  slot.active = job;
  try {
    slot.worker.postMessage(job.request, job.transferables);
  } catch (error) {
    slot.active = null;
    rejectExportWorkerJob(job, error instanceof Error ? error : new Error('Failed to start export worker task.'));
    pumpExportWorkerQueue();
  }
}

function handleWorkerMessage(slot: ExportWorkerSlot, response: ExportWorkerResponse): void {
  const job = slot.active;
  if (!job || job.id !== response.id) {
    return;
  }

  slot.active = null;
  cleanupExportWorkerJob(job);
  if (response.ok) {
    job.resolve(response.bytes);
  } else {
    job.reject(new Error(response.error || 'Export worker failed.'));
  }
  pumpExportWorkerQueue();
}

function handleWorkerFailure(slot: ExportWorkerSlot, error: Error): void {
  const job = slot.active;
  if (job) {
    slot.active = null;
    rejectExportWorkerJob(job, error);
  }

  terminateExportWorkerSlot(slot);
  pumpExportWorkerQueue();
}

function terminateExportWorkerSlot(slot: ExportWorkerSlot): void {
  if (workerSlot === slot) {
    workerSlot = null;
  }

  slot.worker.removeEventListener('message', slot.onMessage);
  slot.worker.removeEventListener('error', slot.onError);
  slot.worker.removeEventListener('messageerror', slot.onMessageError);
  slot.worker.terminate();
}

function attachAbortListener(job: ExportWorkerJob): void {
  const signal = job.signal;
  if (!signal) {
    return;
  }

  job.abortListener = () => {
    abortExportWorkerJob(job);
  };
  signal.addEventListener('abort', job.abortListener, { once: true });
}

function abortExportWorkerJob(job: ExportWorkerJob): void {
  const error = getAbortReason(job.signal, 'Export worker task was aborted.');
  if (workerSlot?.active === job) {
    workerSlot.active = null;
    rejectExportWorkerJob(job, error);
    terminateExportWorkerSlot(workerSlot);
    pumpExportWorkerQueue();
    return;
  }

  const queuedIndex = queuedJobs.indexOf(job);
  if (queuedIndex < 0) {
    return;
  }
  queuedJobs.splice(queuedIndex, 1);
  rejectExportWorkerJob(job, error);
}

function rejectExportWorkerJob(job: ExportWorkerJob, error: Error): void {
  cleanupExportWorkerJob(job);
  job.reject(error);
}

function cleanupExportWorkerJob(job: ExportWorkerJob): void {
  if (!job.signal || !job.abortListener) {
    return;
  }

  job.signal.removeEventListener('abort', job.abortListener);
  job.abortListener = undefined;
}

async function drainQueuedJobsOnMainThread(): Promise<void> {
  while (queuedJobs.length > 0) {
    const job = queuedJobs.shift();
    if (!job) {
      return;
    }

    try {
      if (job.signal?.aborted) {
        throw getAbortReason(job.signal, 'Export worker task was aborted.');
      }
      const bytes = job.request.type === 'encodePng'
        ? createPngBytesFromPixels(job.request.pixels, { compressionLevel: job.request.compressionLevel })
        : zipSync(job.request.files);
      throwIfSignalAborted(job.signal, 'Export worker task was aborted.');
      cleanupExportWorkerJob(job);
      job.resolve(bytes);
    } catch (error) {
      rejectExportWorkerJob(job, error instanceof Error ? error : new Error('Export worker task failed.'));
    }
  }
}

function encodePngOnMainThread(
  pixels: ExportImagePixels,
  options: EncodePngOffMainThreadOptions
): Uint8Array {
  try {
    throwIfSignalAborted(options.signal, 'PNG encoding was aborted.');
    const bytes = createPngBytesFromPixels(pixels, { compressionLevel: options.compressionLevel });
    throwIfSignalAborted(options.signal, 'PNG encoding was aborted.');
    return bytes;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('PNG encoding failed.');
  }
}

function zipFilesOnMainThread(files: Record<string, Uint8Array>, signal?: AbortSignal): Uint8Array {
  try {
    throwIfSignalAborted(signal, 'ZIP packaging was aborted.');
    const bytes = zipSync(files);
    throwIfSignalAborted(signal, 'ZIP packaging was aborted.');
    return bytes;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw error instanceof Error ? error : new Error('ZIP packaging failed.');
  }
}

function prepareTransferablePixels(pixels: ExportImagePixels): {
  pixels: ExportImagePixels;
  transferables: Transferable[];
} {
  const data = prepareTransferableUint8ClampedArray(pixels.data);
  return {
    pixels: {
      width: pixels.width,
      height: pixels.height,
      data: data.bytes
    },
    transferables: data.transferables
  };
}

function prepareTransferableFiles(files: Record<string, Uint8Array>): {
  files: Record<string, Uint8Array>;
  transferables: Transferable[];
} {
  const preparedFiles: Record<string, Uint8Array> = {};
  const transferables: Transferable[] = [];
  const transferredBuffers = new Set<ArrayBuffer>();

  for (const [filename, bytes] of Object.entries(files)) {
    const prepared = prepareTransferableUint8Array(bytes, transferredBuffers);
    preparedFiles[filename] = prepared.bytes;
    transferables.push(...prepared.transferables);
  }

  return {
    files: preparedFiles,
    transferables
  };
}

function prepareTransferableUint8ClampedArray(bytes: Uint8ClampedArray): {
  bytes: Uint8ClampedArray;
  transferables: Transferable[];
} {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return {
      bytes,
      transferables: [bytes.buffer]
    };
  }

  const copy = new Uint8ClampedArray(bytes);
  return {
    bytes: copy,
    transferables: [copy.buffer]
  };
}

function prepareTransferableUint8Array(
  bytes: Uint8Array,
  transferredBuffers: Set<ArrayBuffer>
): {
  bytes: Uint8Array;
  transferables: Transferable[];
} {
  const buffer = bytes.buffer;
  if (
    buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === buffer.byteLength &&
    !transferredBuffers.has(buffer)
  ) {
    transferredBuffers.add(buffer);
    return {
      bytes,
      transferables: [buffer]
    };
  }

  const copy = new Uint8Array(bytes);
  if (copy.buffer instanceof ArrayBuffer) {
    transferredBuffers.add(copy.buffer);
    return {
      bytes: copy,
      transferables: [copy.buffer]
    };
  }

  return {
    bytes: copy,
    transferables: []
  };
}

function getAbortReason(signal: AbortSignal | undefined, fallbackMessage: string): Error {
  return signal?.reason instanceof Error ? signal.reason : createAbortError(fallbackMessage);
}

function throwIfSignalAborted(signal: AbortSignal | undefined, message: string): void {
  if (!signal) {
    return;
  }

  throwIfAborted(signal, message);
}
