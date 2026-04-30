import { normalizeAutoExposurePercentile } from '../../auto-exposure';
import type { ViewerAppState, ViewerIntent } from '../viewer-app-types';
import type { ViewerReducerContext } from './shared';

export function uiPreferencesReducer(
  state: ViewerAppState,
  intent: ViewerIntent,
  _context: ViewerReducerContext
): ViewerAppState {
  switch (intent.type) {
    case 'autoFitImageOnSelectSet':
      return state.autoFitImageOnSelect === intent.enabled ? state : {
        ...state,
        autoFitImageOnSelect: intent.enabled
      };
    case 'autoExposureSet':
      return state.autoExposureEnabled === intent.enabled ? state : {
        ...state,
        autoExposureEnabled: intent.enabled,
        pendingAutoExposureRequestId: intent.enabled ? state.pendingAutoExposureRequestId : null,
        pendingAutoExposureRequestKey: intent.enabled ? state.pendingAutoExposureRequestKey : null
      };
    case 'autoExposurePercentileSet': {
      const percentile = normalizeAutoExposurePercentile(intent.percentile);
      return state.autoExposurePercentile === percentile ? state : {
        ...state,
        autoExposurePercentile: percentile,
        pendingAutoExposureRequestId: null,
        pendingAutoExposureRequestKey: null
      };
    }
    case 'rulersVisibleSet':
      return state.rulersVisible === intent.enabled ? state : {
        ...state,
        rulersVisible: intent.enabled
      };
    default:
      return state;
  }
}
