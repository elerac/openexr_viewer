import { buildSelectedDisplayTexture } from '../state';
import { createOpenedImageThumbnailDataUrlFromDisplayTexture } from '../thumbnail';
import { DecodedLayer, OpenedImageSession, ViewerState } from '../types';

const THUMBNAIL_IDLE_TIMEOUT_MS = 250;
const THUMBNAIL_IDLE_FALLBACK_DELAY_MS = 64;

interface ThumbnailJob {
  sessionId: string;
  token: number;
}

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCallbackLike = (deadline: IdleDeadlineLike) => void;

export interface ThumbnailWindowLike {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  setTimeout: typeof window.setTimeout;
  requestIdleCallback?: (callback: IdleCallbackLike, options?: { timeout?: number }) => number;
}

export interface ThumbnailServiceDependencies {
  getSession: (sessionId: string) => OpenedImageSession | null;
  onThumbnailUpdated: () => void;
  windowLike?: ThumbnailWindowLike | null;
  createThumbnailDataUrl?: (args: {
    session: OpenedImageSession;
    layer: DecodedLayer;
    stateSnapshot: ViewerState;
    displayTexture: Float32Array;
  }) => string | null;
}

export class ThumbnailService {
  private readonly getSession: ThumbnailServiceDependencies['getSession'];
  private readonly onThumbnailUpdated: ThumbnailServiceDependencies['onThumbnailUpdated'];
  private readonly windowLike: ThumbnailWindowLike | null;
  private readonly createThumbnailDataUrl: NonNullable<ThumbnailServiceDependencies['createThumbnailDataUrl']>;
  private readonly jobs: ThumbnailJob[] = [];
  private processingPromise: Promise<void> | null = null;

  constructor(dependencies: ThumbnailServiceDependencies) {
    this.getSession = dependencies.getSession;
    this.onThumbnailUpdated = dependencies.onThumbnailUpdated;
    this.windowLike = dependencies.windowLike ?? resolveWindowLike();
    this.createThumbnailDataUrl =
      dependencies.createThumbnailDataUrl ?? defaultCreateThumbnailDataUrl;
  }

  enqueue(sessionId: string, stateSnapshot: ViewerState): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      return Promise.resolve();
    }

    session.thumbnailGenerationToken += 1;
    session.thumbnailStateSnapshot = cloneViewerState(stateSnapshot);
    this.jobs.push({
      sessionId,
      token: session.thumbnailGenerationToken
    });

    return this.processJobs();
  }

  discard(sessionId: string): void {
    for (let index = this.jobs.length - 1; index >= 0; index -= 1) {
      if (this.jobs[index]?.sessionId === sessionId) {
        this.jobs.splice(index, 1);
      }
    }
  }

  clear(): void {
    this.jobs.length = 0;
  }

  private processJobs(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
      try {
        while (this.jobs.length > 0) {
          const job = this.jobs.shift();
          if (!job) {
            continue;
          }

          await this.runNonCriticalTask(async () => {
            const thumbnailDataUrl = this.createThumbnailDataUrlForJob(job);
            if (!thumbnailDataUrl) {
              return;
            }

            const session = this.getSession(job.sessionId);
            if (!session || session.thumbnailGenerationToken !== job.token) {
              return;
            }

            session.thumbnailDataUrl = thumbnailDataUrl;
            this.onThumbnailUpdated();
          });
        }
      } finally {
        this.processingPromise = null;
        if (this.jobs.length > 0) {
          void this.processJobs();
        }
      }
    })();

    return this.processingPromise;
  }

  private createThumbnailDataUrlForJob(job: ThumbnailJob): string | null {
    const session = this.getSession(job.sessionId);
    if (!session || session.thumbnailGenerationToken !== job.token) {
      return null;
    }

    const stateSnapshot = session.thumbnailStateSnapshot;
    const layer = getSelectedLayer(session, stateSnapshot.activeLayer);
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return null;
    }

    try {
      const thumbnailTextureRevisionKey = buildTextureRevisionKey(stateSnapshot);
      const displayTexture = session.displayTexture && session.textureRevisionKey === thumbnailTextureRevisionKey
        ? session.displayTexture
        : buildSelectedDisplayTexture(
            layer,
            session.decoded.width,
            session.decoded.height,
            stateSnapshot
          );

      return this.createThumbnailDataUrl({
        session,
        layer,
        stateSnapshot,
        displayTexture
      });
    } catch {
      return null;
    }
  }

  private async runNonCriticalTask(task: () => void | Promise<void>): Promise<void> {
    await this.waitForNextPaint();
    await this.waitForIdleSlot(THUMBNAIL_IDLE_TIMEOUT_MS);
    await task();
  }

  private waitForNextPaint(): Promise<void> {
    const windowLike = this.windowLike;
    if (!windowLike?.requestAnimationFrame) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      windowLike.requestAnimationFrame?.(() => {
        windowLike.requestAnimationFrame?.(() => {
          resolve();
        });
      });
    });
  }

  private waitForIdleSlot(timeoutMs: number): Promise<void> {
    const windowLike = this.windowLike;
    if (!windowLike) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (typeof windowLike.requestIdleCallback !== 'function') {
        windowLike.setTimeout(resolve, Math.max(0, Math.min(timeoutMs, THUMBNAIL_IDLE_FALLBACK_DELAY_MS)));
        return;
      }

      windowLike.requestIdleCallback(() => {
        resolve();
      }, { timeout: timeoutMs });
    });
  }
}

function defaultCreateThumbnailDataUrl({
  session,
  stateSnapshot,
  displayTexture
}: {
  session: OpenedImageSession;
  layer: DecodedLayer;
  stateSnapshot: ViewerState;
  displayTexture: Float32Array;
}): string | null {
  return createOpenedImageThumbnailDataUrlFromDisplayTexture(
    displayTexture,
    session.decoded.width,
    session.decoded.height,
    stateSnapshot
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

function buildTextureRevisionKey(state: ViewerState): string {
  return [
    state.activeLayer,
    state.displaySource,
    state.stokesParameter ?? '',
    state.displayR,
    state.displayG,
    state.displayB,
    state.displayA ?? ''
  ].join(':');
}

function cloneDisplayLuminanceRange(range: ViewerState['colormapRange']): ViewerState['colormapRange'] {
  return range ? { min: range.min, max: range.max } : null;
}

function cloneViewerState(state: ViewerState): ViewerState {
  return {
    ...state,
    colormapRange: cloneDisplayLuminanceRange(state.colormapRange),
    stokesDegreeModulation: { ...state.stokesDegreeModulation },
    hoveredPixel: state.hoveredPixel ? { ...state.hoveredPixel } : null,
    lockedPixel: state.lockedPixel ? { ...state.lockedPixel } : null
  };
}
