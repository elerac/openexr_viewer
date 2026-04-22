import { createViewerRenderSnapshotSelector, computeViewerRenderInvalidation, ViewerRenderInvalidationFlags } from './viewer-app-render';
import { createInitialViewerAppState, reduceViewerAppState } from './viewer-app-reducer';
import { createViewerUiSnapshotSelector, computeViewerUiInvalidation, ViewerUiInvalidationFlags } from './viewer-app-ui';
import type {
  ViewerAppState,
  ViewerIntent,
  ViewerRenderTransition,
  ViewerStateTransition,
  ViewerUiTransition
} from './viewer-app-types';

export class ViewerAppCore {
  private state: ViewerAppState = createInitialViewerAppState();
  private readonly stateListeners = new Set<(transition: ViewerStateTransition) => void>();
  private readonly uiListeners = new Set<(transition: ViewerUiTransition) => void>();
  private readonly renderListeners = new Set<(transition: ViewerRenderTransition) => void>();
  private readonly selectUiSnapshot = createViewerUiSnapshotSelector();
  private readonly selectRenderSnapshot = createViewerRenderSnapshotSelector();
  private nextRequestId = 1;
  private nextSessionId = 1;

  getState(): ViewerAppState {
    return this.state;
  }

  issueRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }

  issueSessionId(): string {
    const sessionId = `session-${this.nextSessionId}`;
    this.nextSessionId += 1;
    return sessionId;
  }

  subscribeState(listener: (transition: ViewerStateTransition) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeUi(listener: (transition: ViewerUiTransition) => void): () => void {
    this.uiListeners.add(listener);
    return () => this.uiListeners.delete(listener);
  }

  subscribeRender(listener: (transition: ViewerRenderTransition) => void): () => void {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  }

  dispatch(intent: ViewerIntent): void {
    const previousState = this.state;
    const nextState = reduceViewerAppState(previousState, intent);
    if (nextState === previousState) {
      return;
    }

    this.state = nextState;
    const stateTransition: ViewerStateTransition = {
      previousState,
      state: nextState,
      intent
    };

    for (const listener of this.stateListeners) {
      listener(stateTransition);
    }

    if (this.uiListeners.size > 0) {
      const previousSnapshot = this.selectUiSnapshot(previousState);
      const snapshot = this.selectUiSnapshot(nextState);
      const invalidation = computeViewerUiInvalidation(previousSnapshot, snapshot);
      if (invalidation !== ViewerUiInvalidationFlags.None) {
        const transition: ViewerUiTransition = {
          ...stateTransition,
          previousSnapshot,
          snapshot,
          invalidation
        };
        for (const listener of this.uiListeners) {
          listener(transition);
        }
      }
    }

    if (this.renderListeners.size > 0) {
      const previousSnapshot = this.selectRenderSnapshot(previousState);
      const snapshot = this.selectRenderSnapshot(nextState);
      const invalidation = computeViewerRenderInvalidation(previousSnapshot, snapshot);
      if (invalidation !== ViewerRenderInvalidationFlags.None) {
        const transition: ViewerRenderTransition = {
          ...stateTransition,
          previousSnapshot,
          snapshot,
          invalidation
        };
        for (const listener of this.renderListeners) {
          listener(transition);
        }
      }
    }
  }
}

export { createInitialViewerAppState } from './viewer-app-reducer';
