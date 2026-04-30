export interface ViewerError {
  message: string;
  code?: string;
  cause?: unknown;
}

export type AsyncResource<T> =
  | { status: 'idle' }
  | { status: 'pending'; key: string; requestId: number }
  | { status: 'success'; key: string; value: T }
  | { status: 'error'; key: string; error: ViewerError }
  | { status: 'stale'; key: string; previous?: T };

export function idleResource<T>(): AsyncResource<T> {
  return { status: 'idle' };
}

export function pendingResource<T>(
  key: string,
  requestId: number
): AsyncResource<T> {
  return { status: 'pending', key, requestId };
}

export function startedResource<T>(
  key: string,
  requestId: number
): AsyncResource<T> {
  return pendingResource(key, requestId);
}

export function successResource<T>(key: string, value: T): AsyncResource<T> {
  return { status: 'success', key, value };
}

export function errorResource<T>(
  key: string,
  error: ViewerError | Error | string | unknown,
  fallback?: string,
  code?: string
): AsyncResource<T> {
  return {
    status: 'error',
    key,
    error: toViewerError(error, fallback, code)
  };
}

export function staleResource<T>(key: string, previous?: T): AsyncResource<T> {
  return previous === undefined
    ? { status: 'stale', key }
    : { status: 'stale', key, previous };
}

export function toViewerError(
  error: ViewerError | Error | string | unknown,
  fallback = 'Operation failed.',
  code?: string
): ViewerError {
  if (error instanceof Error) {
    return {
      message: error.message || fallback,
      ...(code ? { code } : {}),
      cause: error
    };
  }

  if (isViewerError(error)) {
    return code && !error.code ? { ...error, code } : error;
  }

  if (typeof error === 'string') {
    return {
      message: error || fallback,
      ...(code ? { code } : {})
    };
  }

  return {
    message: fallback,
    ...(code ? { code } : {}),
    ...(error === undefined ? {} : { cause: error })
  };
}

export function isPendingMatch<T>(
  resource: AsyncResource<T>,
  key: string,
  requestId: number | null
): boolean {
  if (requestId === null) {
    return false;
  }

  return resource.status === 'pending' && resource.key === key && resource.requestId === requestId;
}

export function isResourceForKey<T>(resource: AsyncResource<T>, key: string): boolean {
  return resource.status !== 'idle' && resource.key === key;
}

export function getSuccessValue<T>(resource: AsyncResource<T>): T | undefined {
  if (resource.status === 'success') {
    return resource.value;
  }

  if (resource.status === 'stale') {
    return resource.previous;
  }

  return undefined;
}

export function getResourceKey<T>(resource: AsyncResource<T>): string | null {
  return resource.status === 'idle' ? null : resource.key;
}

function isViewerError(error: unknown): error is ViewerError {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}
