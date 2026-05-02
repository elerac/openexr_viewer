import { AUTO_EXPOSURE_PERCENTILE } from '../analysis/auto-exposure';
import { idleResource } from '../async-resource';
import { DEFAULT_COLORMAP_ID } from '../colormaps';
import { createDefaultStokesColormapDefaultSettings } from '../stokes';
import { createInteractionState } from '../view-state';
import { createInitialState } from '../viewer-store';
import { analysisReducer } from './reducers/analysis-reducer';
import { displayReducer } from './reducers/display-reducer';
import { resourceReducer } from './reducers/resource-reducer';
import { sessionReducer } from './reducers/session-reducer';
import type { ViewerDomainReducer, ViewerReducerContext } from './reducers/shared';
import { stokesReducer } from './reducers/stokes-reducer';
import { thumbnailReducer } from './reducers/thumbnail-reducer';
import { uiPreferencesReducer } from './reducers/ui-preferences-reducer';
import type {
  ViewerAppState,
  ViewerIntent
} from './viewer-app-types';

const DOMAIN_REDUCERS: ViewerDomainReducer[] = [
  uiPreferencesReducer,
  resourceReducer,
  stokesReducer,
  displayReducer,
  analysisReducer,
  thumbnailReducer,
  sessionReducer
];

export function createInitialViewerAppState(): ViewerAppState {
  const sessionState = createInitialState();
  return {
    sessionState,
    interactionState: createInteractionState(sessionState),
    sessions: [],
    pendingOpenedImages: [],
    activeSessionId: null,
    errorMessage: null,
    isLoading: false,
    colormapRegistry: null,
    defaultColormapId: DEFAULT_COLORMAP_ID,
    colormapLutResource: idleResource(),
    displayRangeResource: idleResource(),
    imageStatsResource: idleResource(),
    autoExposureResource: idleResource(),
    pendingColormapActivation: null,
    pendingSelectionTransitionRequestId: null,
    thumbnailsBySessionId: {},
    channelThumbnailsByRequestKey: {},
    channelThumbnailLatestRequestKeyByContextKey: {},
    stokesDisplayRestoreStates: {},
    stokesColormapDefaults: createDefaultStokesColormapDefaultSettings(),
    autoFitImageOnSelect: false,
    autoExposureEnabled: false,
    autoExposurePercentile: AUTO_EXPOSURE_PERCENTILE,
    rulersVisible: false
  };
}

export function reduceViewerAppState(state: ViewerAppState, intent: ViewerIntent): ViewerAppState {
  const context: ViewerReducerContext = { initialState: state };
  return DOMAIN_REDUCERS.reduce(
    (nextState, reducer) => reducer(nextState, intent, context),
    state
  );
}
