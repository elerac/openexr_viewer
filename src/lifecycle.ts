export interface Disposable {
  dispose(): void;
}

type Cleanup = () => void;

export class DisposableBag implements Disposable {
  private readonly cleanups: Cleanup[] = [];
  private disposed = false;

  add(cleanup: Cleanup): Cleanup {
    if (this.disposed) {
      cleanup();
      return cleanup;
    }

    this.cleanups.push(cleanup);
    return cleanup;
  }

  addDisposable(disposable: Disposable): Disposable {
    this.add(() => {
      disposable.dispose();
    });
    return disposable;
  }

  addEventListener<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, listener, options);
    this.add(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (let index = this.cleanups.length - 1; index >= 0; index -= 1) {
      this.cleanups[index]?.();
    }
    this.cleanups.length = 0;
  }
}

export function createAbortError(message = 'Operation aborted.'): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }

  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error ||
    (typeof DOMException !== 'undefined' && error instanceof DOMException)
  ) && error.name === 'AbortError';
}

export function throwIfAborted(signal: AbortSignal, message?: string): void {
  if (!signal.aborted) {
    return;
  }

  throw signal.reason instanceof Error ? signal.reason : createAbortError(message);
}

export interface AsyncOperationGuard {
  readonly signal: AbortSignal;
  readonly generation: number;
  isCurrent(): boolean;
  throwIfStale(message?: string): void;
}

export class AsyncOperationGate implements Disposable {
  private generation = 0;
  private controller = new AbortController();
  private disposed = false;

  begin(message = 'Operation was superseded.'): AsyncOperationGuard {
    this.invalidate(message);
    const generation = this.generation;
    const signal = this.controller.signal;

    return {
      signal,
      generation,
      isCurrent: () => !this.disposed && !signal.aborted && this.generation === generation,
      throwIfStale: (staleMessage = 'Operation became stale.') => {
        throwIfAborted(signal, staleMessage);
        if (this.disposed || this.generation !== generation) {
          throw createAbortError(staleMessage);
        }
      }
    };
  }

  invalidate(message = 'Operation was superseded.'): void {
    if (!this.controller.signal.aborted) {
      this.controller.abort(createAbortError(message));
    }
    this.controller = new AbortController();
    this.generation += 1;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    if (!this.controller.signal.aborted) {
      this.controller.abort(createAbortError('Operation gate has been disposed.'));
    }
  }
}

export function isAbortSignalAborted(signal: AbortSignal | null | undefined): boolean {
  return Boolean(signal?.aborted);
}
