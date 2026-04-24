import type { Page } from '@playwright/test';

export async function installIdleCallbackController(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;

    const pendingIds: number[] = [];
    const callbacks = new Map<number, IdleCallback>();
    let nextId = 1;

    const target = window as Window & {
      __thumbnailIdleTestController?: {
        pendingCount: () => number;
        flush: (count?: number) => number;
      };
      requestIdleCallback?: (callback: IdleCallback, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    target.__thumbnailIdleTestController = {
      pendingCount: () => pendingIds.length,
      flush: (count?: number) => {
        let completed = 0;
        const maxRuns = typeof count === 'number' ? count : Number.POSITIVE_INFINITY;

        while (pendingIds.length > 0 && completed < maxRuns) {
          const id = pendingIds.shift();
          if (id === undefined) {
            break;
          }

          const callback = callbacks.get(id);
          if (!callback) {
            continue;
          }

          callbacks.delete(id);
          callback({
            didTimeout: false,
            timeRemaining: () => 50
          });
          completed += 1;
        }

        return completed;
      }
    };

    target.requestIdleCallback = (callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      pendingIds.push(id);
      return id;
    };

    target.cancelIdleCallback = (handle) => {
      callbacks.delete(handle);
      const pendingIndex = pendingIds.indexOf(handle);
      if (pendingIndex >= 0) {
        pendingIds.splice(pendingIndex, 1);
      }
    };
  });
}

export async function getPendingIdleCallbackCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const target = window as Window & {
      __thumbnailIdleTestController?: {
        pendingCount: () => number;
      };
    };

    return target.__thumbnailIdleTestController?.pendingCount() ?? 0;
  });
}

export async function flushIdleCallbacks(page: Page, count?: number): Promise<number> {
  return await page.evaluate((maxRuns) => {
    const target = window as Window & {
      __thumbnailIdleTestController?: {
        flush: (nextCount?: number) => number;
      };
    };

    return target.__thumbnailIdleTestController?.flush(maxRuns) ?? 0;
  }, count);
}

export async function flushAllIdleCallbacks(page: Page): Promise<void> {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const pending = await getPendingIdleCallbackCount(page);
    if (pending === 0) {
      await page.waitForTimeout(50);
      if ((await getPendingIdleCallbackCount(page)) === 0) {
        return;
      }
      continue;
    }

    await flushIdleCallbacks(page, pending);
    await page.waitForTimeout(50);
  }
}
