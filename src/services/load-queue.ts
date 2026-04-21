export class LoadQueueService {
  private queue: Promise<void> = Promise.resolve();

  enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.catch(() => undefined).then(task);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
