import { cloneDisplayLuminanceRange } from '../colormap-range';
import {
  findColormapIdByLabel,
  loadColormapLut,
  type ColormapLut,
  type ColormapRegistry
} from '../colormaps';
import { cloneDisplaySelection, type DisplaySelection } from '../display-model';
import { createAbortError, isAbortError, throwIfAborted, type Disposable } from '../lifecycle';
import {
  createChannelViewThumbnailDataUrl,
  type ThumbnailPreviewOptions
} from '../thumbnail';
import { getStokesDisplayColormapDefault } from '../stokes';
import type { DecodedLayer, OpenedImageSession, ViewerSessionState } from '../types';
import type { ThumbnailWindowLike } from './thumbnail-service';

const THUMBNAIL_IDLE_TIMEOUT_MS = 250;
const THUMBNAIL_IDLE_FALLBACK_DELAY_MS = 64;

interface ChannelThumbnailJob {
  sessionId: string;
  requestKey: string;
  contextKey: string;
  token: number;
  stateSnapshot: ViewerSessionState;
  selection: DisplaySelection;
}

type MaybePromise<T> = T | Promise<T>;

export interface ChannelThumbnailServiceDependencies {
  getSession: (sessionId: string) => OpenedImageSession | null;
  getColormapRegistry?: () => ColormapRegistry | null;
  onThumbnailReady: (event: {
    sessionId: string;
    requestKey: string;
    contextKey: string;
    token: number;
    thumbnailDataUrl: string | null;
  }) => void;
  windowLike?: ThumbnailWindowLike | null;
  createThumbnailDataUrl?: (args: {
    session: OpenedImageSession;
    layer: DecodedLayer;
    stateSnapshot: ViewerSessionState;
    selection: DisplaySelection;
    colormapRegistry: ColormapRegistry | null;
    abortSignal: AbortSignal;
  }) => MaybePromise<string | null>;
  findColormapIdByLabel?: typeof findColormapIdByLabel;
  loadColormapLut?: typeof loadColormapLut;
}

export class ChannelThumbnailService implements Disposable {
  private readonly getSession: ChannelThumbnailServiceDependencies['getSession'];
  private readonly getColormapRegistry: () => ColormapRegistry | null;
  private readonly onThumbnailReady: ChannelThumbnailServiceDependencies['onThumbnailReady'];
  private readonly windowLike: ThumbnailWindowLike | null;
  private readonly createThumbnailDataUrl: NonNullable<ChannelThumbnailServiceDependencies['createThumbnailDataUrl']>;
  private readonly jobs: ChannelThumbnailJob[] = [];
  private readonly requestState = new Map<string, ChannelThumbnailJob>();
  private readonly abortController = new AbortController();
  private processingPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(dependencies: ChannelThumbnailServiceDependencies) {
    this.getSession = dependencies.getSession;
    this.getColormapRegistry = dependencies.getColormapRegistry ?? (() => null);
    this.onThumbnailReady = dependencies.onThumbnailReady;
    this.windowLike = dependencies.windowLike ?? resolveWindowLike();
    this.createThumbnailDataUrl = dependencies.createThumbnailDataUrl ?? ((args) => defaultCreateThumbnailDataUrl({
      ...args,
      findColormapIdByLabel: dependencies.findColormapIdByLabel ?? findColormapIdByLabel,
      loadColormapLut: dependencies.loadColormapLut ?? loadColormapLut
    }));
  }

  enqueue(job: ChannelThumbnailJob): Promise<void> {
    if (this.abortController.signal.aborted) {
      return Promise.reject(this.abortController.signal.reason ?? createAbortError('Channel thumbnail service has been disposed.'));
    }

    const session = this.getSession(job.sessionId);
    if (!session) {
      return Promise.resolve();
    }

    const clonedJob = cloneJob(job);
    this.requestState.set(clonedJob.requestKey, clonedJob);
    this.jobs.push(clonedJob);
    return this.processJobs();
  }

  discardSession(sessionId: string): void {
    for (let index = this.jobs.length - 1; index >= 0; index -= 1) {
      if (this.jobs[index]?.sessionId === sessionId) {
        this.jobs.splice(index, 1);
      }
    }

    for (const [requestKey, job] of this.requestState.entries()) {
      if (job.sessionId === sessionId) {
        this.requestState.delete(requestKey);
      }
    }
  }

  clear(): void {
    if (this.disposed) {
      return;
    }

    this.jobs.length = 0;
    this.requestState.clear();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.abortController.abort(createAbortError('Channel thumbnail service has been disposed.'));
    this.jobs.length = 0;
    this.requestState.clear();
  }

  private processJobs(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
      try {
        while (this.jobs.length > 0) {
          throwIfAborted(this.abortController.signal, 'Channel thumbnail service has been disposed.');

          const job = this.jobs.shift();
          if (!job) {
            continue;
          }

          await this.runNonCriticalTask(async () => {
            const request = this.requestState.get(job.requestKey);
            if (!request || request.token !== job.token) {
              return;
            }

            const thumbnailDataUrl = await this.createThumbnailDataUrlForJob(job);
            if (thumbnailDataUrl === null) {
              return;
            }

            const session = this.getSession(job.sessionId);
            const latestRequest = this.requestState.get(job.requestKey);
            if (this.disposed || !session || !latestRequest || latestRequest.token !== job.token) {
              return;
            }

            this.onThumbnailReady({
              sessionId: job.sessionId,
              requestKey: job.requestKey,
              contextKey: job.contextKey,
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

  private async createThumbnailDataUrlForJob(job: ChannelThumbnailJob): Promise<string | null> {
    if (this.disposed) {
      return null;
    }

    const session = this.getSession(job.sessionId);
    const latestRequest = this.requestState.get(job.requestKey);
    if (!session || !latestRequest || latestRequest.token !== job.token) {
      return null;
    }

    const layer = getSelectedLayer(session, job.stateSnapshot.activeLayer);
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return null;
    }

    try {
      return await this.createThumbnailDataUrl({
        session,
        layer,
        stateSnapshot: job.stateSnapshot,
        selection: job.selection,
        colormapRegistry: this.getColormapRegistry(),
        abortSignal: this.abortController.signal
      });
    } catch {
      return null;
    }
  }

  private async runNonCriticalTask(task: () => void | Promise<void>): Promise<void> {
    await this.waitForNextPaint();
    throwIfAborted(this.abortController.signal, 'Channel thumbnail service has been disposed.');
    await this.waitForIdleSlot(THUMBNAIL_IDLE_TIMEOUT_MS);
    throwIfAborted(this.abortController.signal, 'Channel thumbnail service has been disposed.');
    await task();
  }

  private waitForNextPaint(): Promise<void> {
    throwIfAborted(this.abortController.signal, 'Channel thumbnail service has been disposed.');

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
    throwIfAborted(this.abortController.signal, 'Channel thumbnail service has been disposed.');

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
  stateSnapshot,
  selection,
  colormapRegistry,
  abortSignal,
  findColormapIdByLabel: resolveColormapId,
  loadColormapLut: resolveColormapLut
}: {
  session: OpenedImageSession;
  layer: DecodedLayer;
  stateSnapshot: ViewerSessionState;
  selection: DisplaySelection;
  colormapRegistry: ColormapRegistry | null;
  abortSignal: AbortSignal;
  findColormapIdByLabel: typeof findColormapIdByLabel;
  loadColormapLut: typeof loadColormapLut;
}): MaybePromise<string | null> {
  return createChannelViewThumbnailDataUrlWithPreview({
    session,
    stateSnapshot,
    selection,
    colormapRegistry,
    abortSignal,
    findColormapIdByLabel: resolveColormapId,
    loadColormapLut: resolveColormapLut
  });
}

async function createChannelViewThumbnailDataUrlWithPreview({
  session,
  stateSnapshot,
  selection,
  colormapRegistry,
  abortSignal,
  findColormapIdByLabel: resolveColormapId,
  loadColormapLut: resolveColormapLut
}: {
  session: OpenedImageSession;
  stateSnapshot: ViewerSessionState;
  selection: DisplaySelection;
  colormapRegistry: ColormapRegistry | null;
  abortSignal: AbortSignal;
  findColormapIdByLabel: typeof findColormapIdByLabel;
  loadColormapLut: typeof loadColormapLut;
}): Promise<string | null> {
  const preview = await resolveChannelThumbnailPreview({
    selection,
    stateSnapshot,
    colormapRegistry,
    abortSignal,
    findColormapIdByLabel: resolveColormapId,
    loadColormapLut: resolveColormapLut
  });
  return createChannelViewThumbnailDataUrl(
    session.decoded,
    stateSnapshot,
    selection,
    preview
  );
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

function cloneJob(job: ChannelThumbnailJob): ChannelThumbnailJob {
  return {
    ...job,
    stateSnapshot: cloneViewerState(job.stateSnapshot),
    selection: cloneDisplaySelection(job.selection) ?? job.selection
  };
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

async function resolveChannelThumbnailPreview(args: {
  selection: DisplaySelection;
  stateSnapshot: ViewerSessionState;
  colormapRegistry: ColormapRegistry | null;
  abortSignal: AbortSignal;
  findColormapIdByLabel: typeof findColormapIdByLabel;
  loadColormapLut: typeof loadColormapLut;
}): Promise<ThumbnailPreviewOptions | null> {
  const stokesDefaults = getStokesDisplayColormapDefault(args.selection);
  if (!stokesDefaults || !args.colormapRegistry) {
    return null;
  }

  const colormapId = args.findColormapIdByLabel(args.colormapRegistry, stokesDefaults.colormapLabel);
  if (!colormapId) {
    return null;
  }

  let colormapLut: ColormapLut | null = null;
  try {
    colormapLut = await args.loadColormapLut(args.colormapRegistry, colormapId, args.abortSignal);
  } catch {
    return null;
  }

  return {
    visualizationMode: 'colormap',
    colormapRange: cloneDisplayLuminanceRange(stokesDefaults.range),
    colormapLut,
    stokesDegreeModulation: { ...args.stateSnapshot.stokesDegreeModulation }
  };
}
