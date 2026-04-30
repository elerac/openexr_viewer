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
        loadedColormapId: intent.colormapId
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
    default:
      return state;
  }
}
