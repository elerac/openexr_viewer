import { throwIfAborted } from '../lifecycle';

export interface CooperativeComputeOptions {
  signal?: AbortSignal;
  chunkSize?: number;
  yieldControl?: () => Promise<void>;
}

const DEFAULT_COOPERATIVE_COMPUTE_CHUNK_SIZE = 32_768;

export function maybeYieldCooperativeCompute(
  processedCount: number,
  totalCount: number,
  options: CooperativeComputeOptions
): Promise<void> | null {
  throwIfCooperativeComputeAborted(options);

  const chunkSize = normalizeComputeChunkSize(options.chunkSize);
  if (processedCount >= totalCount || processedCount % chunkSize !== 0) {
    return null;
  }

  return (async () => {
    await (options.yieldControl ?? yieldToEventLoop)();
    throwIfCooperativeComputeAborted(options);
  })();
}

export function throwIfCooperativeComputeAborted(options: CooperativeComputeOptions): void {
  if (options.signal) {
    throwIfAborted(options.signal, 'Display computation was aborted.');
  }
}

export function selectKthFloat32(values: Float32Array, count: number, kth: number): number {
  if (count <= 0) {
    return 1;
  }

  let left = 0;
  let right = count - 1;
  const target = Math.min(right, Math.max(0, kth));

  while (left < right) {
    const pivotIndex = partitionFloat32(values, left, right, Math.floor((left + right) / 2));
    if (target === pivotIndex) {
      return values[pivotIndex] ?? 1;
    }
    if (target < pivotIndex) {
      right = pivotIndex - 1;
    } else {
      left = pivotIndex + 1;
    }
  }

  return values[left] ?? 1;
}

export async function selectKthFloat32Async(
  values: Float32Array,
  count: number,
  kth: number,
  options: CooperativeComputeOptions
): Promise<number> {
  if (count <= 0) {
    return 1;
  }

  let left = 0;
  let right = count - 1;
  const target = Math.min(right, Math.max(0, kth));

  while (left < right) {
    throwIfCooperativeComputeAborted(options);

    const pivotIndex = await partitionFloat32Async(
      values,
      left,
      right,
      Math.floor((left + right) / 2),
      options
    );
    if (target === pivotIndex) {
      return values[pivotIndex] ?? 1;
    }
    if (target < pivotIndex) {
      right = pivotIndex - 1;
    } else {
      left = pivotIndex + 1;
    }
  }

  throwIfCooperativeComputeAborted(options);
  return values[left] ?? 1;
}

function normalizeComputeChunkSize(value: number | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_COOPERATIVE_COMPUTE_CHUNK_SIZE;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function partitionFloat32(values: Float32Array, left: number, right: number, pivotIndex: number): number {
  const pivotValue = values[pivotIndex] ?? 0;
  swapFloat32(values, pivotIndex, right);
  let storeIndex = left;

  for (let index = left; index < right; index += 1) {
    if ((values[index] ?? 0) < pivotValue) {
      swapFloat32(values, storeIndex, index);
      storeIndex += 1;
    }
  }

  swapFloat32(values, right, storeIndex);
  return storeIndex;
}

async function partitionFloat32Async(
  values: Float32Array,
  left: number,
  right: number,
  pivotIndex: number,
  options: CooperativeComputeOptions
): Promise<number> {
  const pivotValue = values[pivotIndex] ?? 0;
  swapFloat32(values, pivotIndex, right);
  let storeIndex = left;
  const totalCount = right - left;

  for (let index = left; index < right; index += 1) {
    if ((values[index] ?? 0) < pivotValue) {
      swapFloat32(values, storeIndex, index);
      storeIndex += 1;
    }

    const yieldPromise = maybeYieldCooperativeCompute(index - left + 1, totalCount, options);
    if (yieldPromise) {
      await yieldPromise;
    }
  }

  swapFloat32(values, right, storeIndex);
  return storeIndex;
}

function swapFloat32(values: Float32Array, a: number, b: number): void {
  if (a === b) {
    return;
  }

  const tmp = values[a] ?? 0;
  values[a] = values[b] ?? 0;
  values[b] = tmp;
}
