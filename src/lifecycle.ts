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
  return error instanceof Error && error.name === 'AbortError';
}

export function throwIfAborted(signal: AbortSignal, message?: string): void {
  if (!signal.aborted) {
    return;
  }

  throw signal.reason instanceof Error ? signal.reason : createAbortError(message);
}
