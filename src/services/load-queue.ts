import { createAbortError, throwIfAborted, type Disposable } from '../lifecycle';

export type LoadQueuePriority = 'foreground' | 'background';

export interface LoadQueueEntryInfo {
  priority: LoadQueuePriority;
  category: string | null;
  sessionId: string | null;
  groupId: string | null;
}

export interface LoadQueueOptions {
  priority?: LoadQueuePriority;
  category?: string;
  sessionId?: string;
  groupId?: string;
}

interface LoadQueueEntry<T> extends LoadQueueEntryInfo {
  id: number;
  task: (signal: AbortSignal) => Promise<T> | T;
  controller: AbortController;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class LoadQueueService implements Disposable {
  private readonly queue: Array<LoadQueueEntry<unknown>> = [];
  private readonly abortController = new AbortController();
  private active: LoadQueueEntry<unknown> | null = null;
  private nextId = 1;
  private disposed = false;

  enqueue<T>(task: (signal: AbortSignal) => Promise<T> | T, options: LoadQueueOptions = {}): Promise<T> {
    if (this.disposed) {
      return Promise.reject(createAbortError('Load queue has been disposed.'));
    }

    const controller = new AbortController();
    const entry = {
      id: this.nextId++,
      task,
      controller,
      priority: options.priority ?? 'foreground',
      category: options.category ?? null,
      sessionId: options.sessionId ?? null,
      groupId: options.groupId ?? null
    } as LoadQueueEntry<T>;

    const promise = new Promise<T>((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });

    this.queue.push(entry as LoadQueueEntry<unknown>);
    this.pump();
    return promise;
  }

  cancelWhere(predicate: (entry: LoadQueueEntryInfo) => boolean, message = 'Load task was cancelled.'): void {
    const error = createAbortError(message);
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const entry = this.queue[index];
      if (!entry || !predicate(entry)) {
        continue;
      }

      this.queue.splice(index, 1);
      entry.controller.abort(error);
      entry.reject(error);
    }

    if (this.active && predicate(this.active)) {
      this.active.controller.abort(error);
    }
  }

  cancelAll(message = 'Load tasks were cancelled.'): void {
    this.cancelWhere(() => true, message);
  }

  promoteWhere(predicate: (entry: LoadQueueEntryInfo) => boolean): void {
    const foreground = this.queue.filter((entry) => entry.priority === 'foreground');
    const promotedBackground = this.queue.filter((entry) => entry.priority === 'background' && predicate(entry));
    const remainingBackground = this.queue.filter((entry) => entry.priority === 'background' && !predicate(entry));

    this.queue.length = 0;
    this.queue.push(...foreground, ...promotedBackground, ...remainingBackground);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.abortController.abort(createAbortError('Load queue has been disposed.'));
    this.cancelAll('Load queue has been disposed.');
  }

  private pump(): void {
    if (this.disposed || this.active) {
      return;
    }

    const entry = this.takeNextEntry();
    if (!entry) {
      return;
    }

    this.active = entry;
    void this.runEntry(entry);
  }

  private takeNextEntry(): LoadQueueEntry<unknown> | null {
    const foregroundIndex = this.queue.findIndex((entry) => entry.priority === 'foreground');
    const index = foregroundIndex >= 0 ? foregroundIndex : 0;
    const [entry] = this.queue.splice(index, 1);
    return entry ?? null;
  }

  private async runEntry(entry: LoadQueueEntry<unknown>): Promise<void> {
    try {
      throwIfAborted(this.abortController.signal, 'Load queue has been disposed.');
      throwIfAborted(entry.controller.signal, 'Load task was cancelled.');
      const value = await entry.task(entry.controller.signal);
      throwIfAborted(entry.controller.signal, 'Load task was cancelled.');
      entry.resolve(value);
    } catch (error) {
      entry.reject(error instanceof Error ? error : new Error('Load task failed.'));
    } finally {
      if (this.active === entry) {
        this.active = null;
      }
      this.pump();
    }
  }
}
