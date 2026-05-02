import {
  resolveColormapAutoRange,
  sameDisplayLuminanceRange
} from '../../colormap-range';
import { sameDisplaySelection } from '../../display-model';
import {
  idleResource,
  isPendingMatch,
  pendingResource,
  successResource
} from '../../async-resource';
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
      return shouldActivateLoadedSession(context.initialState, intent.activate)
        ? clearAnalysisContext(state)
        : state;
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
        displayRangeResource: pendingResource(intent.requestKey, intent.requestId)
      };
    case 'imageStatsRequestStarted':
      return {
        ...state,
        imageStatsResource: pendingResource(intent.requestKey, intent.requestId)
      };
    case 'autoExposureRequestStarted':
      return {
        ...state,
        autoExposureResource: pendingResource(intent.requestKey, intent.requestId)
      };
    case 'displayLuminanceRangeResolved':
      return reduceDisplayLuminanceRangeResolved(state, intent);
    case 'imageStatsResolved':
      return reduceImageStatsResolved(state, intent);
    case 'autoExposurePreviewResolved':
      return reduceAutoExposurePreviewResolved(state, intent);
    case 'autoExposureResolved':
      return reduceAutoExposureResolved(state, intent);
    default:
      return state;
  }
}

function shouldActivateLoadedSession(state: ViewerAppState, activate: boolean | undefined): boolean {
  return activate !== false || !selectActiveSession(state);
}

function reduceDisplayLuminanceRangeResolved(
  state: ViewerAppState,
  intent: Extract<ViewerIntent, { type: 'displayLuminanceRangeResolved' }>
): ViewerAppState {
  if (intent.requestId !== null && !isPendingMatch(state.displayRangeResource, intent.requestKey, intent.requestId)) {
    return state;
  }

  const requestMatchesPending = intent.requestId !== null &&
    isPendingMatch(state.displayRangeResource, intent.requestKey, intent.requestId);
  const activeSession = selectActiveSession(state);
  if (
    !activeSession ||
    activeSession.id !== intent.sessionId ||
    state.sessionState.activeLayer !== intent.activeLayer ||
    !sameDisplaySelection(state.sessionState.displaySelection, intent.displaySelection)
  ) {
    return {
      ...state,
      displayRangeResource: requestMatchesPending ? idleResource() : state.displayRangeResource
    };
  }

  let nextState: ViewerAppState = {
    ...state,
    displayRangeResource: successResource(intent.requestKey, intent.displayLuminanceRange)
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
  if (intent.requestId !== null && !isPendingMatch(state.imageStatsResource, intent.requestKey, intent.requestId)) {
    return state;
  }

  const requestMatchesPending = intent.requestId !== null &&
    isPendingMatch(state.imageStatsResource, intent.requestKey, intent.requestId);
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
      imageStatsResource: requestMatchesPending ? idleResource() : state.imageStatsResource
    };
  }

  return {
    ...state,
    imageStatsResource: successResource(intent.requestKey, intent.imageStats)
  };
}

function reduceAutoExposureResolved(
  state: ViewerAppState,
  intent: Extract<ViewerIntent, { type: 'autoExposureResolved' }>
): ViewerAppState {
  if (intent.requestId !== null && !isPendingMatch(state.autoExposureResource, intent.requestKey, intent.requestId)) {
    return state;
  }

  const requestMatchesPending = intent.requestId !== null &&
    isPendingMatch(state.autoExposureResource, intent.requestKey, intent.requestId);
  const nextState: ViewerAppState = {
    ...state,
    autoExposureResource: requestMatchesPending
      ? idleResource()
      : state.autoExposureResource
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

  return patchSessionState({
    ...nextState,
    autoExposureResource: successResource(intent.requestKey, intent.autoExposure)
  }, {
    exposureEv: intent.autoExposure?.exposureEv ?? 0
  });
}

function reduceAutoExposurePreviewResolved(
  state: ViewerAppState,
  intent: Extract<ViewerIntent, { type: 'autoExposurePreviewResolved' }>
): ViewerAppState {
  if (!isPendingMatch(state.autoExposureResource, intent.requestKey, intent.requestId)) {
    return state;
  }

  const activeSession = selectActiveSession(state);
  if (
    !state.autoExposureEnabled ||
    !activeSession ||
    activeSession.id !== intent.sessionId ||
    state.sessionState.activeLayer !== intent.activeLayer ||
    state.sessionState.visualizationMode !== 'rgb' ||
    intent.visualizationMode !== 'rgb' ||
    !sameDisplaySelection(state.sessionState.displaySelection, intent.displaySelection)
  ) {
    return state;
  }

  return patchSessionState(state, {
    exposureEv: intent.autoExposure?.exposureEv ?? 0
  });
}
