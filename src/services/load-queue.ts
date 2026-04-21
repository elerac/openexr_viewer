import { createAbortError, throwIfAborted, type Disposable } from '../lifecycle';

export class LoadQueueService implements Disposable {
  private queue: Promise<void> = Promise.resolve();
  private readonly abortController = new AbortController();
  private disposed = false;

  enqueue<T>(task: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
    if (this.disposed) {
      return Promise.reject(createAbortError('Load queue has been disposed.'));
    }

    const next = this.queue.catch(() => undefined).then(async () => {
      throwIfAborted(this.abortController.signal, 'Load queue has been disposed.');
      return await task(this.abortController.signal);
    });
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.abortController.abort(createAbortError('Load queue has been disposed.'));
  }
}
