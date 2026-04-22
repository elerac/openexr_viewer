import { cloneDisplayLuminanceRange } from '../colormap-range';
import { cloneDisplaySelection } from '../display-model';
import { createAbortError, isAbortError, throwIfAborted, type Disposable } from '../lifecycle';
import { createOpenedImageThumbnailDataUrl } from '../thumbnail';
import { DecodedLayer, OpenedImageSession, ViewerSessionState } from '../types';

const THUMBNAIL_IDLE_TIMEOUT_MS = 250;
const THUMBNAIL_IDLE_FALLBACK_DELAY_MS = 64;

interface ThumbnailJob {
  sessionId: string;
  token: number;
  stateSnapshot: ViewerSessionState;
}

interface ThumbnailSessionState {
  token: number;
  stateSnapshot: ViewerSessionState;
}

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCallbackLike = (deadline: IdleDeadlineLike) => void;

export interface ThumbnailWindowLike {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout: typeof window.setTimeout;
  clearTimeout?: typeof window.clearTimeout;
  requestIdleCallback?: (callback: IdleCallbackLike, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

export interface ThumbnailServiceDependencies {
  getSession: (sessionId: string) => OpenedImageSession | null;
  onThumbnailReady: (event: { sessionId: string; token: number; thumbnailDataUrl: string | null }) => void;
  windowLike?: ThumbnailWindowLike | null;
  createThumbnailDataUrl?: (args: {
    session: OpenedImageSession;
    layer: DecodedLayer;
    stateSnapshot: ViewerSessionState;
  }) => string | null;
}

export class ThumbnailService implements Disposable {
  private readonly getSession: ThumbnailServiceDependencies['getSession'];
  private readonly onThumbnailReady: ThumbnailServiceDependencies['onThumbnailReady'];
  private readonly windowLike: ThumbnailWindowLike | null;
  private readonly createThumbnailDataUrl: NonNullable<ThumbnailServiceDependencies['createThumbnailDataUrl']>;
  private readonly jobs: ThumbnailJob[] = [];
  private readonly sessionState = new Map<string, ThumbnailSessionState>();
  private readonly abortController = new AbortController();
  private processingPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(dependencies: ThumbnailServiceDependencies) {
    this.getSession = dependencies.getSession;
    this.onThumbnailReady = dependencies.onThumbnailReady;
    this.windowLike = dependencies.windowLike ?? resolveWindowLike();
    this.createThumbnailDataUrl =
      dependencies.createThumbnailDataUrl ?? defaultCreateThumbnailDataUrl;
  }

  enqueue(sessionId: string, stateSnapshot: ViewerSessionState, token: number): Promise<void> {
    if (this.abortController.signal.aborted) {
      return Promise.reject(this.abortController.signal.reason ?? createAbortError('Thumbnail service has been disposed.'));
    }

    const session = this.getSession(sessionId);
    if (!session) {
      return Promise.resolve();
    }

    const entry = this.getOrCreateSessionState(sessionId, stateSnapshot);
    entry.token = token;
    entry.stateSnapshot = cloneViewerState(stateSnapshot);
    this.jobs.push({
      sessionId,
      token,
      stateSnapshot: cloneViewerState(stateSnapshot)
    });

    return this.processJobs();
  }

  discard(sessionId: string): void {
    for (let index = this.jobs.length - 1; index >= 0; index -= 1) {
      if (this.jobs[index]?.sessionId === sessionId) {
        this.jobs.splice(index, 1);
      }
    }

    this.sessionState.delete(sessionId);
  }

  clear(): void {
    if (this.disposed) {
      return;
    }

    this.jobs.length = 0;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.abortController.abort(createAbortError('Thumbnail service has been disposed.'));
    this.jobs.length = 0;
    this.sessionState.clear();
  }

  private processJobs(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
      try {
        while (this.jobs.length > 0) {
          throwIfAborted(this.abortController.signal, 'Thumbnail service has been disposed.');

          const job = this.jobs.shift();
          if (!job) {
            continue;
          }

          await this.runNonCriticalTask(async () => {
            const thumbnailDataUrl = this.createThumbnailDataUrlForJob(job);
            if (thumbnailDataUrl === null) {
              return;
            }

            const session = this.getSession(job.sessionId);
            const entry = this.sessionState.get(job.sessionId);
            if (this.disposed || !session || !entry || entry.token !== job.token) {
              return;
            }

            this.onThumbnailReady({
              sessionId: job.sessionId,
              token: job.token,
              thumbnailDataUrl
            });
          });
        }
      } catch (error) {
        if (!isAbortError(error)) {
          throw error;
        }
      } finally {
        this.processingPromise = null;
        if (!this.disposed && this.jobs.length > 0) {
          void this.processJobs();
        }
      }
    })();

    return this.processingPromise;
  }

  private createThumbnailDataUrlForJob(job: ThumbnailJob): string | null {
    if (this.disposed) {
      return null;
    }

    const session = this.getSession(job.sessionId);
    const entry = this.sessionState.get(job.sessionId);
    if (!session || !entry || entry.token !== job.token) {
      return null;
    }

    const stateSnapshot = job.stateSnapshot;
    const layer = getSelectedLayer(session, stateSnapshot.activeLayer);
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return null;
    }

    try {
      return this.createThumbnailDataUrl({
        session,
        layer,
        stateSnapshot
      });
    } catch {
      return null;
    }
  }

  private async runNonCriticalTask(task: () => void | Promise<void>): Promise<void> {
    await this.waitForNextPaint();
    throwIfAborted(this.abortController.signal, 'Thumbnail service has been disposed.');
    await this.waitForIdleSlot(THUMBNAIL_IDLE_TIMEOUT_MS);
    throwIfAborted(this.abortController.signal, 'Thumbnail service has been disposed.');
    await task();
  }

  private waitForNextPaint(): Promise<void> {
    throwIfAborted(this.abortController.signal, 'Thumbnail service has been disposed.');

    const windowLike = this.windowLike;
    if (!windowLike?.requestAnimationFrame) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let firstHandle = 0;
      let secondHandle = 0;
      const cleanupAbort = this.bindAbortRejection(() => {
        if (firstHandle && typeof windowLike.cancelAnimationFrame === 'function') {
          windowLike.cancelAnimationFrame(firstHandle);
        }
        if (secondHandle && typeof windowLike.cancelAnimationFrame === 'function') {
          windowLike.cancelAnimationFrame(secondHandle);
        }
      }, () => {
        resolve();
      });

      firstHandle = windowLike.requestAnimationFrame?.(() => {
        firstHandle = 0;
        secondHandle = windowLike.requestAnimationFrame?.(() => {
          secondHandle = 0;
          cleanupAbort();
          resolve();
        }) ?? 0;
      }) ?? 0;
    });
  }

  private waitForIdleSlot(timeoutMs: number): Promise<void> {
    throwIfAborted(this.abortController.signal, 'Thumbnail service has been disposed.');

    const windowLike = this.windowLike;
    if (!windowLike) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (typeof windowLike.requestIdleCallback !== 'function') {
        const handle = windowLike.setTimeout(
          () => {
            cleanupAbort();
            resolve();
          },
          Math.max(0, Math.min(timeoutMs, THUMBNAIL_IDLE_FALLBACK_DELAY_MS))
        );
        const cleanupAbort = this.bindAbortRejection(() => {
          windowLike.clearTimeout?.(handle);
        }, () => {
          resolve();
        });
        return;
      }

      const handle = windowLike.requestIdleCallback(() => {
        cleanupAbort();
        resolve();
      }, { timeout: timeoutMs });
      const cleanupAbort = this.bindAbortRejection(() => {
        windowLike.cancelIdleCallback?.(handle);
      }, () => {
        resolve();
      });
    });
  }

  private getOrCreateSessionState(sessionId: string, stateSnapshot: ViewerSessionState): ThumbnailSessionState {
    const existing = this.sessionState.get(sessionId);
    if (existing) {
      return existing;
    }

    const entry: ThumbnailSessionState = {
      token: 0,
      stateSnapshot: cloneViewerState(stateSnapshot)
    };
    this.sessionState.set(sessionId, entry);
    return entry;
  }

  private bindAbortRejection(cancel: () => void, complete: () => void): () => void {
    const signal = this.abortController.signal;
    const onAbort = () => {
      cancel();
      complete();
    };

    signal.addEventListener('abort', onAbort, { once: true });
    return () => {
      signal.removeEventListener('abort', onAbort);
    };
  }
}

function defaultCreateThumbnailDataUrl({
  session,
  stateSnapshot
}: {
  session: OpenedImageSession;
  layer: DecodedLayer;
  stateSnapshot: ViewerSessionState;
}): string | null {
  return createOpenedImageThumbnailDataUrl(session.decoded, stateSnapshot);
}

function resolveWindowLike(): ThumbnailWindowLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window;
}

function getSelectedLayer(session: OpenedImageSession, layerIndex: number): DecodedLayer | null {
  return session.decoded.layers[layerIndex] ?? null;
}

function cloneViewerState(state: ViewerSessionState): ViewerSessionState {
  return {
    ...state,
    displaySelection: cloneDisplaySelection(state.displaySelection),
    colormapRange: cloneDisplayLuminanceRange(state.colormapRange),
    stokesDegreeModulation: { ...state.stokesDegreeModulation },
    lockedPixel: state.lockedPixel ? { ...state.lockedPixel } : null
  };
}
