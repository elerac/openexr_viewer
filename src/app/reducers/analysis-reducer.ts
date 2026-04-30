import {
  resolveColormapAutoRange,
  sameDisplayLuminanceRange
} from '../../colormap-range';
import { sameDisplaySelection } from '../../display-model';
import {
  selectActiveSession,
  shouldAutoEnterColormapMode
} from '../viewer-app-selectors';
import type {
  ViewerAppState,
  ViewerIntent
} from '../viewer-app-types';
import {
  clearAnalysisContext,
  isActiveSessionIntent,
  isValidActiveSessionSwitch,
  patchSessionState,
  type ViewerReducerContext
} from './shared';

export function analysisReducer(
  state: ViewerAppState,
  intent: ViewerIntent,
  context: ViewerReducerContext
): ViewerAppState {
  switch (intent.type) {
    case 'sessionLoaded':
    case 'allSessionsClosed':
      return clearAnalysisContext(state);
    case 'sessionReloaded':
      return isActiveSessionIntent(context.initialState, intent.sessionId)
        ? clearAnalysisContext(state)
        : state;
    case 'activeSessionSwitched':
      return isValidActiveSessionSwitch(context.initialState, intent.sessionId)
        ? clearAnalysisContext(state)
        : state;
    case 'sessionClosed':
      return isActiveSessionIntent(context.initialState, intent.sessionId)
        ? clearAnalysisContext(state)
        : state;
    case 'displayRangeRequestStarted':
      return {
        ...state,
        pendingDisplayRangeRequestId: intent.requestId,
        pendingDisplayRangeRequestKey: intent.requestKey
      };
    case 'imageStatsRequestStarted':
      return {
        ...state,
        pendingImageStatsRequestId: intent.requestId,
        pendingImageStatsRequestKey: intent.requestKey
      };
    case 'autoExposureRequestStarted':
      return {
        ...state,
        pendingAutoExposureRequestId: intent.requestId,
        pendingAutoExposureRequestKey: intent.requestKey
      };
    case 'displayLuminanceRangeResolved':
      return reduceDisplayLuminanceRangeResolved(state, intent);
    case 'imageStatsResolved':
      return reduceImageStatsResolved(state, intent);
    case 'autoExposureResolved':
      return reduceAutoExposureResolved(state, intent);
    default:
      return state;
  }
}

function reduceDisplayLuminanceRangeResolved(
  state: ViewerAppState,
  intent: Extract<ViewerIntent, { type: 'displayLuminanceRangeResolved' }>
): ViewerAppState {
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

function reduceImageStatsResolved(
  state: ViewerAppState,
  intent: Extract<ViewerIntent, { type: 'imageStatsResolved' }>
): ViewerAppState {
  if (intent.requestId !== null && state.pendingImageStatsRequestId !== intent.requestId) {
    return state;
  }

  const requestMatchesPending = intent.requestId === state.pendingImageStatsRequestId;
  const activeSession = selectActiveSession(state);
  if (
    !activeSession ||
    activeSession.id !== intent.sessionId ||
    state.sessionState.activeLayer !== intent.activeLayer ||
    state.sessionState.visualizationMode !== intent.visualizationMode ||
    !sameDisplaySelection(state.sessionState.displaySelection, intent.displaySelection)
  ) {
    return {
      ...state,
      pendingImageStatsRequestId: requestMatchesPending ? null : state.pendingImageStatsRequestId,
      pendingImageStatsRequestKey: requestMatchesPending ? null : state.pendingImageStatsRequestKey
    };
  }

  return {
    ...state,
    activeImageStats: intent.imageStats,
    pendingImageStatsRequestId: requestMatchesPending ? null : state.pendingImageStatsRequestId,
    pendingImageStatsRequestKey: requestMatchesPending ? null : state.pendingImageStatsRequestKey
  };
}

function reduceAutoExposureResolved(
  state: ViewerAppState,
  intent: Extract<ViewerIntent, { type: 'autoExposureResolved' }>
): ViewerAppState {
  if (intent.requestId !== null && state.pendingAutoExposureRequestId !== intent.requestId) {
    return state;
  }

  const requestMatchesPending = intent.requestId === state.pendingAutoExposureRequestId;
  const nextState: ViewerAppState = {
    ...state,
    pendingAutoExposureRequestId: requestMatchesPending ? null : state.pendingAutoExposureRequestId,
    pendingAutoExposureRequestKey: requestMatchesPending ? null : state.pendingAutoExposureRequestKey
  };

  const activeSession = selectActiveSession(nextState);
  if (
    !nextState.autoExposureEnabled ||
    !activeSession ||
    activeSession.id !== intent.sessionId ||
    nextState.sessionState.activeLayer !== intent.activeLayer ||
    nextState.sessionState.visualizationMode !== 'rgb' ||
    intent.visualizationMode !== 'rgb' ||
    !sameDisplaySelection(nextState.sessionState.displaySelection, intent.displaySelection)
  ) {
    return nextState;
  }

  return patchSessionState(nextState, {
    exposureEv: intent.autoExposure?.exposureEv ?? 0
  });
}
