import {
  buildZeroCenteredColormapRange,
  cloneDisplayLuminanceRange,
  resolveColormapAutoRange,
  sameDisplayLuminanceRange
} from '../../colormap-range';
import {
  cloneDisplaySelection,
  sameDisplaySelection
} from '../../display-model';
import { computeFitView } from '../../interaction/image-geometry';
import { cloneImageRoi } from '../../roi';
import { samePixel } from '../../view-state';
import { buildViewerStateForLayer } from '../../viewer-store';
import { selectActiveSession } from '../viewer-app-selectors';
import type {
  ViewerAppState,
  ViewerIntent
} from '../viewer-app-types';
import {
  cloneInteractionState,
  isActiveSessionIntent,
  isValidActiveSessionSwitch,
  normalizeViewerViewPatch,
  patchSessionState,
  sameInteractionState,
  sameViewCommit,
  updateActiveSessionStoredState,
  type ViewerReducerContext
} from './shared';

const COLORMAP_ZERO_CENTER_MANUAL_MIN_MAGNITUDE = 1e-16;

export function displayReducer(
  state: ViewerAppState,
  intent: ViewerIntent,
  context: ViewerReducerContext
): ViewerAppState {
  switch (intent.type) {
    case 'sessionLoaded':
    case 'allSessionsClosed':
      return clearPendingColormapActivation(state);
    case 'sessionReloaded':
      return isActiveSessionIntent(context.initialState, intent.sessionId)
        ? clearPendingColormapActivation(state)
        : state;
    case 'activeSessionSwitched':
      return isValidActiveSessionSwitch(context.initialState, intent.sessionId)
        ? clearPendingColormapActivation(state)
        : state;
    case 'sessionClosed':
      return isActiveSessionIntent(context.initialState, intent.sessionId)
        ? clearPendingColormapActivation(state)
        : state;
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
      return patchSessionState(state, {
        activeColormapId: intent.colormapId
      });
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
    case 'lockedPixelToggled': {
      const current = state.sessionState.lockedPixel;
      return patchSessionState(state, {
        lockedPixel: samePixel(current, intent.pixel) ? null : intent.pixel
      });
    }
    case 'roiSet':
      return patchSessionState(state, {
        roi: cloneImageRoi(intent.roi)
      });
    case 'viewerStateEdited': {
      if (!selectActiveSession(state)) {
        return state;
      }
      const patch = normalizeViewerViewPatch(intent.patch);
      return patch ? patchSessionState(state, patch, {
        syncInteractionView: true,
        clearHover: true
      }) : state;
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
    case 'activeSessionFitToViewport': {
      const activeSession = selectActiveSession(state);
      if (!activeSession || state.sessionState.viewerMode !== 'image') {
        return state;
      }

      return patchSessionState(
        state,
        computeFitView(intent.viewport, activeSession.decoded.width, activeSession.decoded.height, intent.fitInsets),
        {
          syncInteractionView: true,
          clearHover: true
        }
      );
    }
    default:
      return state;
  }
}

function clearPendingColormapActivation(state: ViewerAppState): ViewerAppState {
  return state.pendingColormapActivation === null ? state : {
    ...state,
    pendingColormapActivation: null
  };
}
