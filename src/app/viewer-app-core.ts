import { DEFAULT_COLORMAP_ID } from '../colormaps';
import {
  buildZeroCenteredColormapRange,
  cloneDisplayLuminanceRange,
  resolveColormapAutoRange,
  sameDisplayLuminanceRange,
  shouldPreserveStokesColormapState
} from '../colormap-range';
import {
  cloneDisplaySelection,
  isChannelSelection,
  isStokesSelection,
  sameDisplaySelection
} from '../display-model';
import { cloneViewerSessionState } from '../session-state';
import { createInteractionState } from '../view-state';
import {
  getStokesDisplayColormapDefault,
  isStokesDegreeModulationParameter
} from '../stokes';
import { buildViewerStateForLayer, createInitialState } from '../viewer-store';
import {
  buildResetSessionState,
  buildSwitchedSessionState,
  createClearedViewerState
} from './session-resource';
import { createViewerAppSnapshot, selectActiveSession, shouldAutoEnterColormapMode } from './viewer-app-selectors';
import {
  computeInvalidationFlags
} from './viewer-app-invalidation';
import type {
  RestorableVisualizationState,
  ViewerAppState,
  ViewerAppTransition,
  ViewerIntent
} from './viewer-app-types';
import type { DisplayLuminanceRange, OpenedImageSession, ViewportInfo, ViewerSessionState } from '../types';

const COLORMAP_ZERO_CENTER_MANUAL_MIN_MAGNITUDE = 1e-16;

export class ViewerAppCore {
  private state: ViewerAppState = createInitialViewerAppState();
  private readonly listeners = new Set<(transition: ViewerAppTransition) => void>();
  private nextRequestId = 1;
  private nextSessionId = 1;

  getState(): ViewerAppState {
    return this.state;
  }

  getSnapshot() {
    return createViewerAppSnapshot(this.state);
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

  subscribe(listener: (transition: ViewerAppTransition) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(intent: ViewerIntent): void {
    const previousState = this.state;
    const previousSnapshot = createViewerAppSnapshot(previousState);
    const nextState = reduceViewerAppState(previousState, intent);
    if (nextState === previousState) {
      return;
    }

    this.state = nextState;
    const snapshot = createViewerAppSnapshot(nextState);
    const invalidation = computeInvalidationFlags(previousSnapshot, snapshot);

    const transition: ViewerAppTransition = {
      previousState,
      state: nextState,
      previousSnapshot,
      snapshot,
      intent,
      invalidation
    };

    for (const listener of this.listeners) {
      listener(transition);
    }
  }
}

export function createInitialViewerAppState(): ViewerAppState {
  const sessionState = createInitialState();
  return {
    sessionState,
    interactionState: createInteractionState(sessionState),
    sessions: [],
    activeSessionId: null,
    errorMessage: null,
    isLoading: false,
    colormapRegistry: null,
    defaultColormapId: DEFAULT_COLORMAP_ID,
    activeColormapLut: null,
    loadedColormapId: null,
    activeDisplayLuminanceRange: null,
    pendingColormapActivation: null,
    pendingColormapRequestId: null,
    pendingSelectionTransitionRequestId: null,
    pendingDisplayRangeRequestId: null,
    pendingDisplayRangeRequestKey: null,
    pendingThumbnailTokensBySessionId: {},
    thumbnailsBySessionId: {},
    stokesDisplayRestoreStates: {}
  };
}

function reduceViewerAppState(state: ViewerAppState, intent: ViewerIntent): ViewerAppState {
  switch (intent.type) {
    case 'errorSet':
      return state.errorMessage === intent.message ? state : {
        ...state,
        errorMessage: intent.message
      };
    case 'loadingSet':
      return state.isLoading === intent.loading ? state : {
        ...state,
        isLoading: intent.loading
      };
    case 'colormapRegistryResolved': {
      const nextState = patchSessionState(state, {
        activeColormapId: intent.registry.defaultId
      });
      return {
        ...nextState,
        colormapRegistry: intent.registry,
        defaultColormapId: intent.registry.defaultId
      };
    }
    case 'colormapLoadStarted':
      return {
        ...state,
        pendingColormapRequestId: intent.requestId
      };
    case 'colormapLoadResolved':
      if (intent.requestId !== null && state.pendingColormapRequestId !== intent.requestId) {
        return state;
      }
      return {
        ...state,
        pendingColormapRequestId: null,
        activeColormapLut: intent.lut,
        loadedColormapId: intent.colormapId,
        sessionState: {
          ...state.sessionState,
          activeColormapId: intent.colormapId
        },
        sessions: updateActiveSessionStoredState(state.sessions, state.activeSessionId, {
          ...state.sessionState,
          activeColormapId: intent.colormapId
        })
      };
    case 'colormapLoadFailed':
      if (intent.requestId !== null && state.pendingColormapRequestId !== intent.requestId) {
        return state;
      }
      return {
        ...state,
        pendingColormapRequestId: null,
        errorMessage: intent.message
      };
    case 'displaySelectionTransitionStarted':
      return {
        ...state,
        pendingSelectionTransitionRequestId: intent.requestId
      };
    case 'displaySelectionTransitionFinished':
      if (state.pendingSelectionTransitionRequestId !== intent.requestId) {
        return state;
      }
      return {
        ...state,
        pendingSelectionTransitionRequestId: null
      };
    case 'exposureSet':
      return patchSessionState(state, { exposureEv: intent.exposureEv });
    case 'viewerModeSet':
      if (!selectActiveSession(state) || state.sessionState.viewerMode === intent.viewerMode) {
        return state;
      }
      return patchSessionState(state, { viewerMode: intent.viewerMode }, {
        syncInteractionView: true,
        clearHover: true
      });
    case 'activeLayerSet': {
      const activeSession = selectActiveSession(state);
      if (!activeSession) {
        return state;
      }
      const nextSessionState = buildViewerStateForLayer(state.sessionState, activeSession.decoded, intent.activeLayer);
      if (
        nextSessionState.activeLayer === state.sessionState.activeLayer &&
        sameDisplaySelection(nextSessionState.displaySelection, state.sessionState.displaySelection)
      ) {
        return state;
      }

      const nextState = patchSessionState(state, nextSessionState, {
        syncInteractionView: true,
        clearHover: true,
        resetDisplayRangeContext: true
      });
      return {
        ...nextState,
        pendingColormapActivation: state.pendingColormapActivation
          ? {
              sessionId: activeSession.id,
              activeLayer: nextSessionState.activeLayer,
              displaySelection: cloneDisplaySelection(nextSessionState.displaySelection)
            }
          : null
      };
    }
    case 'displaySelectionSet': {
      const activeSession = selectActiveSession(state);
      const currentState = state.sessionState;
      const selection = cloneDisplaySelection(intent.displaySelection);
      const stokesDefaults = getStokesDisplayColormapDefault(selection);
      let patch: Partial<ViewerSessionState> = {
        displaySelection: selection
      };

      if (activeSession && !isStokesSelection(currentState.displaySelection)) {
        const capture = intent.restoreState
          ? {
              ...intent.restoreState,
              colormapRange: cloneDisplayLuminanceRange(intent.restoreState.colormapRange)
            }
          : captureRestorableVisualizationState(currentState);
        state = {
          ...state,
          stokesDisplayRestoreStates: {
            ...state.stokesDisplayRestoreStates,
            [activeSession.id]: capture
          }
        };
      }

      if (!stokesDefaults) {
        if (isChannelSelection(selection) && isStokesSelection(currentState.displaySelection)) {
          patch = {
            ...patch,
            ...resolveStokesDisplayRestoreState(state, activeSession?.id ?? null)
          };
        }
      } else if (shouldPreserveStokesColormapState(currentState.displaySelection, selection)) {
        patch = {
          ...patch,
          visualizationMode: 'colormap'
        };
      } else {
        patch = {
          ...patch,
          visualizationMode: 'colormap',
          colormapRange: stokesDefaults.range,
          colormapRangeMode: 'oneTime',
          colormapZeroCentered: stokesDefaults.zeroCentered
        };
      }

      return patchSessionState(state, patch, {
        resetDisplayRangeContext: true
      });
    }
    case 'visualizationModeRequested': {
      const activeSession = selectActiveSession(state);
      if (!activeSession) {
        return state;
      }

      if (intent.visualizationMode === 'rgb') {
        return {
          ...patchSessionState(state, { visualizationMode: 'rgb' }),
          pendingColormapActivation: null
        };
      }

      if (state.sessionState.visualizationMode === 'colormap' && !state.pendingColormapActivation) {
        return state;
      }

      if (state.sessionState.colormapRangeMode !== 'alwaysAuto') {
        return {
          ...state,
          pendingColormapActivation: null,
          sessionState: {
            ...state.sessionState,
            visualizationMode: 'colormap'
          },
          sessions: updateActiveSessionStoredState(state.sessions, state.activeSessionId, {
            ...state.sessionState,
            visualizationMode: 'colormap'
          })
        };
      }

      if (state.activeDisplayLuminanceRange) {
        const nextRange = resolveColormapAutoRange(
          state.sessionState.displaySelection,
          state.activeDisplayLuminanceRange,
          state.sessionState.colormapZeroCentered
        );
        return patchSessionState(state, {
          visualizationMode: 'colormap',
          colormapRange: nextRange
        });
      }

      return {
        ...state,
        pendingColormapActivation: {
          sessionId: activeSession.id,
          activeLayer: state.sessionState.activeLayer,
          displaySelection: cloneDisplaySelection(state.sessionState.displaySelection)
        }
      };
    }
    case 'activeColormapSet':
      return state.sessionState.activeColormapId === intent.colormapId ? state : state;
    case 'colormapRangeSet': {
      const activeSession = selectActiveSession(state);
      if (!activeSession || !Number.isFinite(intent.range.min) || !Number.isFinite(intent.range.max)) {
        return state;
      }

      const orderedRange = intent.range.min <= intent.range.max
        ? { min: intent.range.min, max: intent.range.max }
        : { min: intent.range.max, max: intent.range.min };
      const nextRange = state.sessionState.colormapZeroCentered
        ? buildZeroCenteredColormapRange(orderedRange, COLORMAP_ZERO_CENTER_MANUAL_MIN_MAGNITUDE)
        : orderedRange;
      if (
        state.sessionState.colormapRangeMode === 'oneTime' &&
        sameDisplayLuminanceRange(state.sessionState.colormapRange, nextRange)
      ) {
        return state;
      }

      return patchSessionState(state, {
        colormapRange: nextRange,
        colormapRangeMode: 'oneTime'
      });
    }
    case 'colormapAutoRangeToggled': {
      const activeSession = selectActiveSession(state);
      if (!activeSession) {
        return state;
      }

      if (state.sessionState.colormapRangeMode === 'alwaysAuto') {
        return patchSessionState(state, { colormapRangeMode: 'oneTime' });
      }

      const nextRange = resolveColormapAutoRange(
        state.sessionState.displaySelection,
        state.activeDisplayLuminanceRange,
        state.sessionState.colormapZeroCentered
      );
      return patchSessionState(state, {
        colormapRange: nextRange ?? cloneDisplayLuminanceRange(state.sessionState.colormapRange),
        colormapRangeMode: 'alwaysAuto'
      });
    }
    case 'colormapZeroCenteredToggled': {
      const activeSession = selectActiveSession(state);
      if (!activeSession) {
        return state;
      }

      const nextZeroCentered = !state.sessionState.colormapZeroCentered;
      const nextRange = state.sessionState.colormapRangeMode === 'alwaysAuto'
        ? resolveColormapAutoRange(
            state.sessionState.displaySelection,
            state.activeDisplayLuminanceRange,
            nextZeroCentered
          ) ?? cloneDisplayLuminanceRange(state.sessionState.colormapRange)
        : nextZeroCentered
          ? buildZeroCenteredColormapRange(state.sessionState.colormapRange ?? state.activeDisplayLuminanceRange)
          : cloneDisplayLuminanceRange(state.sessionState.colormapRange);

      return patchSessionState(state, {
        colormapRange: nextRange,
        colormapZeroCentered: nextZeroCentered
      });
    }
    case 'stokesDegreeModulationToggled': {
      const selection = state.sessionState.displaySelection;
      if (!isStokesSelection(selection) || !isStokesDegreeModulationParameter(selection.parameter)) {
        return state;
      }

      const parameter = selection.parameter;
      return patchSessionState(state, {
        stokesDegreeModulation: {
          ...state.sessionState.stokesDegreeModulation,
          [parameter]: !state.sessionState.stokesDegreeModulation[parameter]
        }
      });
    }
    case 'lockedPixelToggled': {
      const current = state.sessionState.lockedPixel;
      const same = current && intent.pixel && current.ix === intent.pixel.ix && current.iy === intent.pixel.iy;
      return patchSessionState(state, {
        lockedPixel: same ? null : intent.pixel
      });
    }
    case 'interactionStatePublished':
      return sameInteractionState(state.interactionState, intent.interactionState) ? state : {
        ...state,
        interactionState: cloneInteractionState(intent.interactionState)
      };
    case 'viewStateCommitted':
      if (sameViewCommit(state.sessionState, intent.view)) {
        return state;
      }
      return patchSessionState(state, intent.view);
    case 'sessionLoaded':
      return {
        ...state,
        sessions: [...state.sessions, intent.session],
        activeSessionId: intent.session.id,
        sessionState: cloneViewerSessionState(intent.session.state),
        interactionState: createInteractionState(intent.session.state),
        activeDisplayLuminanceRange: null,
        pendingColormapActivation: null,
        pendingDisplayRangeRequestId: null,
        pendingDisplayRangeRequestKey: null
      };
    case 'sessionReloaded': {
      const exists = state.sessions.find((session) => session.id === intent.sessionId);
      if (!exists) {
        return state;
      }

      const sessions = state.sessions.map((session) => (session.id === intent.sessionId ? intent.session : session));
      if (state.activeSessionId !== intent.sessionId) {
        return {
          ...state,
          sessions
        };
      }

      return {
        ...state,
        sessions,
        sessionState: cloneViewerSessionState(intent.session.state),
        interactionState: createInteractionState(intent.session.state),
        activeDisplayLuminanceRange: null,
        pendingColormapActivation: null,
        pendingDisplayRangeRequestId: null,
        pendingDisplayRangeRequestKey: null
      };
    }
    case 'activeSessionSwitched': {
      const nextSession = state.sessions.find((session) => session.id === intent.sessionId);
      if (!nextSession || state.activeSessionId === nextSession.id) {
        return state;
      }

      const nextSessionState = buildSwitchedSessionState(
        nextSession,
        state.sessionState,
        selectActiveSession(state)?.decoded ?? null
      );
      return {
        ...state,
        activeSessionId: nextSession.id,
        sessionState: nextSessionState,
        interactionState: createInteractionState(nextSessionState),
        activeDisplayLuminanceRange: null,
        pendingColormapActivation: null,
        pendingDisplayRangeRequestId: null,
        pendingDisplayRangeRequestKey: null
      };
    }
    case 'sessionsReordered': {
      if (state.sessions.length <= 1) {
        return state;
      }

      const draggedIndex = state.sessions.findIndex((session) => session.id === intent.draggedSessionId);
      if (draggedIndex < 0) {
        return state;
      }

      const remaining = [...state.sessions];
      const [draggedSession] = remaining.splice(draggedIndex, 1);
      if (!draggedSession) {
        return state;
      }

      const targetIndex = remaining.findIndex((session) => session.id === intent.targetSessionId);
      if (targetIndex < 0) {
        return state;
      }

      const insertionIndex = intent.placement === 'before' ? targetIndex : targetIndex + 1;
      const reordered = [...remaining];
      reordered.splice(insertionIndex, 0, draggedSession);
      return {
        ...state,
        sessions: reordered
      };
    }
    case 'sessionClosed': {
      const removeIndex = state.sessions.findIndex((session) => session.id === intent.sessionId);
      if (removeIndex < 0) {
        return state;
      }

      const removingActive = state.activeSessionId === intent.sessionId;
      const removedSession = state.sessions[removeIndex] ?? null;
      const remainingSessions = state.sessions.filter((session) => session.id !== intent.sessionId);
      const {
        [intent.sessionId]: _removedThumb,
        ...thumbnailsBySessionId
      } = state.thumbnailsBySessionId;
      const {
        [intent.sessionId]: _removedToken,
        ...pendingThumbnailTokensBySessionId
      } = state.pendingThumbnailTokensBySessionId;
      const {
        [intent.sessionId]: _removedRestore,
        ...stokesDisplayRestoreStates
      } = state.stokesDisplayRestoreStates;

      if (!removingActive) {
        return {
          ...state,
          sessions: remainingSessions,
          thumbnailsBySessionId,
          pendingThumbnailTokensBySessionId,
          stokesDisplayRestoreStates
        };
      }

      if (remainingSessions.length === 0) {
        const cleared = createClearedViewerState(state.defaultColormapId);
        return {
          ...state,
          sessions: [],
          activeSessionId: null,
          sessionState: cleared,
          interactionState: createInteractionState(cleared),
          activeDisplayLuminanceRange: null,
          pendingColormapActivation: null,
          pendingDisplayRangeRequestId: null,
          pendingDisplayRangeRequestKey: null,
          thumbnailsBySessionId,
          pendingThumbnailTokensBySessionId,
          stokesDisplayRestoreStates
        };
      }

      const nextIndex = Math.min(removeIndex, remainingSessions.length - 1);
      const nextSession = remainingSessions[nextIndex];
      if (!nextSession) {
        return state;
      }

      const nextSessionState = buildSwitchedSessionState(
        nextSession,
        state.sessionState,
        removedSession?.decoded ?? null
      );
      return {
        ...state,
        sessions: remainingSessions,
        activeSessionId: nextSession.id,
        sessionState: nextSessionState,
        interactionState: createInteractionState(nextSessionState),
        activeDisplayLuminanceRange: null,
        pendingColormapActivation: null,
        pendingDisplayRangeRequestId: null,
        pendingDisplayRangeRequestKey: null,
        thumbnailsBySessionId,
        pendingThumbnailTokensBySessionId,
        stokesDisplayRestoreStates
      };
    }
    case 'allSessionsClosed': {
      const cleared = createClearedViewerState(state.defaultColormapId);
      return {
        ...state,
        sessions: [],
        activeSessionId: null,
        sessionState: cleared,
        interactionState: createInteractionState(cleared),
        activeDisplayLuminanceRange: null,
        pendingColormapActivation: null,
        pendingDisplayRangeRequestId: null,
        pendingDisplayRangeRequestKey: null,
        pendingThumbnailTokensBySessionId: {},
        thumbnailsBySessionId: {},
        stokesDisplayRestoreStates: {}
      };
    }
    case 'activeSessionReset': {
      const nextSessionState = buildResetSessionState(
        selectActiveSession(state),
        state.sessionState,
        state.defaultColormapId,
        intent.viewport
      );
      return patchSessionState(state, nextSessionState, {
        syncInteractionView: true,
        clearHover: true,
        resetDisplayRangeContext: true
      });
    }
    case 'thumbnailRequested':
      return {
        ...state,
        pendingThumbnailTokensBySessionId: {
          ...state.pendingThumbnailTokensBySessionId,
          [intent.sessionId]: intent.token
        }
      };
    case 'thumbnailReady':
      if (state.pendingThumbnailTokensBySessionId[intent.sessionId] !== intent.token) {
        return state;
      }
      return {
        ...state,
        thumbnailsBySessionId: {
          ...state.thumbnailsBySessionId,
          [intent.sessionId]: intent.thumbnailDataUrl
        }
      };
    case 'displayRangeRequestStarted':
      return {
        ...state,
        pendingDisplayRangeRequestId: intent.requestId,
        pendingDisplayRangeRequestKey: intent.requestKey
      };
    case 'displayLuminanceRangeResolved': {
      if (intent.requestId !== null && state.pendingDisplayRangeRequestId !== intent.requestId) {
        return state;
      }

      const activeSession = selectActiveSession(state);
      if (
        !activeSession ||
        activeSession.id !== intent.sessionId ||
        state.sessionState.activeLayer !== intent.activeLayer ||
        !sameDisplaySelection(state.sessionState.displaySelection, intent.displaySelection)
      ) {
        return {
          ...state,
          pendingDisplayRangeRequestId: intent.requestId === state.pendingDisplayRangeRequestId
            ? null
            : state.pendingDisplayRangeRequestId,
          pendingDisplayRangeRequestKey: intent.requestId === state.pendingDisplayRangeRequestId
            ? null
            : state.pendingDisplayRangeRequestKey
        };
      }

      let nextState: ViewerAppState = {
        ...state,
        activeDisplayLuminanceRange: intent.displayLuminanceRange,
        pendingDisplayRangeRequestId: intent.requestId === state.pendingDisplayRangeRequestId
          ? null
          : state.pendingDisplayRangeRequestId,
        pendingDisplayRangeRequestKey: intent.requestId === state.pendingDisplayRangeRequestId
          ? null
          : state.pendingDisplayRangeRequestKey
      };

      if (shouldAutoEnterColormapMode(nextState, intent.displayLuminanceRange)) {
        const nextRange = resolveColormapAutoRange(
          nextState.sessionState.displaySelection,
          intent.displayLuminanceRange,
          nextState.sessionState.colormapZeroCentered
        );
        nextState = {
          ...patchSessionState(nextState, {
            visualizationMode: 'colormap',
            colormapRange: nextRange
          }),
          pendingColormapActivation: null
        };
      } else if (
        nextState.sessionState.visualizationMode === 'colormap' &&
        nextState.sessionState.colormapRangeMode === 'alwaysAuto'
      ) {
        const nextRange = resolveColormapAutoRange(
          nextState.sessionState.displaySelection,
          intent.displayLuminanceRange,
          nextState.sessionState.colormapZeroCentered
        );
        if (!sameDisplayLuminanceRange(nextState.sessionState.colormapRange, nextRange)) {
          nextState = patchSessionState(nextState, {
            colormapRange: nextRange
          });
        }
      }

      return nextState;
    }
  }
}

function patchSessionState(
  state: ViewerAppState,
  patch: Partial<ViewerSessionState>,
  options: {
    syncInteractionView?: boolean;
    clearHover?: boolean;
    resetDisplayRangeContext?: boolean;
  } = {}
): ViewerAppState {
  const nextSessionState = {
    ...state.sessionState,
    ...patch
  };
  if (sameSessionState(state.sessionState, nextSessionState)) {
    return state;
  }

  let interactionState = state.interactionState;
  if (options.syncInteractionView || options.clearHover) {
    interactionState = {
      view: options.syncInteractionView ? createInteractionState(nextSessionState).view : state.interactionState.view,
      hoveredPixel: options.clearHover ? null : state.interactionState.hoveredPixel
    };
  }

  return {
    ...state,
    sessionState: nextSessionState,
    interactionState,
    sessions: updateActiveSessionStoredState(state.sessions, state.activeSessionId, nextSessionState),
    activeDisplayLuminanceRange: options.resetDisplayRangeContext ? null : state.activeDisplayLuminanceRange,
    pendingDisplayRangeRequestId: options.resetDisplayRangeContext ? null : state.pendingDisplayRangeRequestId,
    pendingDisplayRangeRequestKey: options.resetDisplayRangeContext ? null : state.pendingDisplayRangeRequestKey
  };
}

function updateActiveSessionStoredState(
  sessions: OpenedImageSession[],
  activeSessionId: string | null,
  state: ViewerSessionState
): OpenedImageSession[] {
  if (!activeSessionId) {
    return sessions;
  }

  let changed = false;
  const nextSessions = sessions.map((session) => {
    if (session.id !== activeSessionId) {
      return session;
    }

    changed = true;
    return {
      ...session,
      state: cloneViewerSessionState(state)
    };
  });

  return changed ? nextSessions : sessions;
}

function resolveStokesDisplayRestoreState(
  state: ViewerAppState,
  sessionId: string | null
): RestorableVisualizationState {
  if (sessionId) {
    const restoreState = state.stokesDisplayRestoreStates[sessionId];
    if (restoreState) {
      return {
        ...restoreState,
        colormapRange: cloneDisplayLuminanceRange(restoreState.colormapRange)
      };
    }
  }

  return {
    visualizationMode: 'rgb',
    activeColormapId: state.defaultColormapId,
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    colormapZeroCentered: false
  };
}

function captureRestorableVisualizationState(state: ViewerSessionState): RestorableVisualizationState {
  return {
    visualizationMode: state.visualizationMode,
    activeColormapId: state.activeColormapId,
    colormapRange: cloneDisplayLuminanceRange(state.colormapRange),
    colormapRangeMode: state.colormapRangeMode,
    colormapZeroCentered: state.colormapZeroCentered
  };
}

function cloneInteractionState(state: ViewerAppState['interactionState']): ViewerAppState['interactionState'] {
  return {
    view: { ...state.view },
    hoveredPixel: state.hoveredPixel ? { ...state.hoveredPixel } : null
  };
}

function sameInteractionState(
  a: ViewerAppState['interactionState'],
  b: ViewerAppState['interactionState']
): boolean {
  return sameViewCommit(a.view, b.view) && samePixel(a.hoveredPixel, b.hoveredPixel);
}

function sameViewCommit(
  sessionState: Pick<ViewerSessionState, 'zoom' | 'panX' | 'panY' | 'panoramaYawDeg' | 'panoramaPitchDeg' | 'panoramaHfovDeg'>,
  view: Pick<ViewerSessionState, 'zoom' | 'panX' | 'panY' | 'panoramaYawDeg' | 'panoramaPitchDeg' | 'panoramaHfovDeg'>
): boolean {
  return (
    sessionState.zoom === view.zoom &&
    sessionState.panX === view.panX &&
    sessionState.panY === view.panY &&
    sessionState.panoramaYawDeg === view.panoramaYawDeg &&
    sessionState.panoramaPitchDeg === view.panoramaPitchDeg &&
    sessionState.panoramaHfovDeg === view.panoramaHfovDeg
  );
}

function samePixel(
  a: ViewerSessionState['lockedPixel'] | null | undefined,
  b: ViewerSessionState['lockedPixel'] | null | undefined
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return a.ix === b.ix && a.iy === b.iy;
}

function sameSessionState(a: ViewerSessionState, b: ViewerSessionState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
