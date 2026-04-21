import { describe, expect, it } from 'vitest';
import { LoadQueueService } from '../src/services/load-queue';

describe('load queue service', () => {
  it('runs queued tasks strictly in enqueue order', async () => {
    const queue = new LoadQueueService();
    const events: string[] = [];

    const first = queue.enqueue(async () => {
      events.push('first:start');
      await Promise.resolve();
      events.push('first:end');
    });
    const second = queue.enqueue(async () => {
      events.push('second:start');
      events.push('second:end');
    });
    const third = queue.enqueue(async () => {
      events.push('third:start');
      events.push('third:end');
    });

    await Promise.all([first, second, third]);

    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
      'third:start',
      'third:end'
    ]);
  });

  it('continues with later tasks after an earlier task rejects', async () => {
    const queue = new LoadQueueService();
    const events: string[] = [];

    const first = queue.enqueue(async () => {
      events.push('first');
    });
    const second = queue.enqueue(async () => {
      events.push('second');
      throw new Error('boom');
    });
    const third = queue.enqueue(async () => {
      events.push('third');
    });

    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toThrow('boom');
    await expect(third).resolves.toBeUndefined();
    expect(events).toEqual(['first', 'second', 'third']);
  });
});
