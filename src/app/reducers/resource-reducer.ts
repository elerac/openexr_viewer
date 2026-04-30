import {
  errorResource,
  isPendingMatch,
  pendingResource,
  successResource,
  toViewerError
} from '../../async-resource';
import type { ViewerAppState, ViewerIntent } from '../viewer-app-types';
import { patchSessionState, type ViewerReducerContext } from './shared';

export function resourceReducer(
  state: ViewerAppState,
  intent: ViewerIntent,
  _context: ViewerReducerContext
): ViewerAppState {
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
        colormapLutResource: pendingResource(intent.colormapId, intent.requestId)
      };
    case 'colormapLoadResolved':
      if (intent.requestId !== null && !isPendingMatch(state.colormapLutResource, intent.colormapId, intent.requestId)) {
        return state;
      }
      return {
        ...state,
        colormapLutResource: successResource(intent.colormapId, intent.lut)
      };
    case 'colormapLoadFailed': {
      if (intent.requestId !== null && !isPendingMatch(state.colormapLutResource, intent.colormapId, intent.requestId)) {
        return state;
      }
      const error = toViewerError(intent.error, 'Failed to load colormap.');
      return {
        ...state,
        colormapLutResource: errorResource(intent.colormapId, error),
        errorMessage: error.message
      };
    }
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
    default:
      return state;
  }
}
