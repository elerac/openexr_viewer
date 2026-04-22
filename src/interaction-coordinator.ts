import type { Disposable } from './lifecycle';
import type { ViewerInteractionState, ViewerSessionState, ViewerViewState } from './types';
import { createInteractionState, pickViewState, samePixel, sameRoi, sameViewState } from './view-state';

interface SessionSyncOptions {
  clearHover?: boolean;
}

export interface ViewerInteractionCoordinatorDependencies {
  initialSessionState: ViewerSessionState;
  getSessionState: () => ViewerSessionState;
  commitViewState: (view: ViewerViewState) => void;
  onInteractionChange: (state: ViewerInteractionState, previous: ViewerInteractionState) => void;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
}

export interface SessionInteractionSyncResult {
  state: ViewerInteractionState;
  previous: ViewerInteractionState;
  changed: boolean;
}

export class ViewerInteractionCoordinator implements Disposable {
  private state: ViewerInteractionState;
  private publishedState: ViewerInteractionState;
  private pendingPreviousState: ViewerInteractionState | null = null;
  private frameId: number | null = null;
  private disposed = false;

  private readonly getSessionState: ViewerInteractionCoordinatorDependencies['getSessionState'];
  private readonly commitViewState: ViewerInteractionCoordinatorDependencies['commitViewState'];
  private readonly onInteractionChange: ViewerInteractionCoordinatorDependencies['onInteractionChange'];
  private readonly scheduleFrame: NonNullable<ViewerInteractionCoordinatorDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<ViewerInteractionCoordinatorDependencies['cancelFrame']>;

  constructor(dependencies: ViewerInteractionCoordinatorDependencies) {
    const initialState = createInteractionState(dependencies.initialSessionState);
    this.state = initialState;
    this.publishedState = initialState;
    this.getSessionState = dependencies.getSessionState;
    this.commitViewState = dependencies.commitViewState;
    this.onInteractionChange = dependencies.onInteractionChange;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  }

  getState(): ViewerInteractionState {
    return this.state;
  }

  enqueueViewPatch(patch: Partial<ViewerViewState>): void {
    if (this.disposed) {
      return;
    }

    const nextView = {
      ...this.state.view,
      ...patch
    };

    if (sameViewState(this.state.view, nextView)) {
      return;
    }

    this.state = {
      ...this.state,
      view: nextView
    };
    this.scheduleFlush();
  }

  enqueueHoverPixel(pixel: ViewerInteractionState['hoveredPixel']): void {
    if (this.disposed || samePixel(this.state.hoveredPixel, pixel)) {
      return;
    }

    this.state = {
      ...this.state,
      hoveredPixel: pixel
    };
    this.scheduleFlush();
  }

  enqueueDraftRoi(roi: ViewerInteractionState['draftRoi']): void {
    if (this.disposed || sameRoi(this.state.draftRoi, roi)) {
      return;
    }

    this.state = {
      ...this.state,
      draftRoi: roi
    };
    this.scheduleFlush();
  }

  syncSessionState(
    sessionState: ViewerSessionState,
    options: SessionSyncOptions = {}
  ): SessionInteractionSyncResult {
    const previous = this.publishedState;
    const next: ViewerInteractionState = {
      view: pickViewState(sessionState),
      hoveredPixel: options.clearHover ? null : this.state.hoveredPixel,
      draftRoi: null
    };

    this.cancelScheduledFlush();
    this.pendingPreviousState = null;
    this.state = next;
    this.publishedState = next;

    return {
      state: next,
      previous,
      changed: !sameInteractionState(previous, next)
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.cancelScheduledFlush();
    this.pendingPreviousState = null;
  }

  private scheduleFlush(): void {
    if (this.frameId !== null) {
      return;
    }

    this.pendingPreviousState = this.publishedState;
    this.frameId = this.scheduleFrame(() => {
      this.frameId = null;
      this.flush();
    });
  }

  private flush(): void {
    if (this.disposed) {
      return;
    }

    const previous = this.pendingPreviousState ?? this.publishedState;
    this.pendingPreviousState = null;
    const next = this.state;

    if (!sameInteractionState(previous, next)) {
      this.onInteractionChange(next, previous);
      this.publishedState = next;
    }

    const sessionView = pickViewState(this.getSessionState());
    if (!sameViewState(sessionView, next.view)) {
      this.commitViewState(next.view);
    }
  }

  private cancelScheduledFlush(): void {
    if (this.frameId === null) {
      return;
    }

    this.cancelFrame(this.frameId);
    this.frameId = null;
  }
}

function sameInteractionState(a: ViewerInteractionState, b: ViewerInteractionState): boolean {
  return (
    sameViewState(a.view, b.view) &&
    samePixel(a.hoveredPixel, b.hoveredPixel) &&
    sameRoi(a.draftRoi, b.draftRoi)
  );
}
