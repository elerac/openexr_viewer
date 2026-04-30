import {
  cloneDisplayLuminanceRange,
  shouldPreserveStokesColormapState
} from '../../colormap-range';
import {
  cloneDisplaySelection,
  isChannelSelection,
  isStokesSelection
} from '../../display-model';
import {
  cloneStokesColormapDefaultSetting,
  cloneStokesColormapDefaultSettings,
  createDefaultStokesColormapDefaultSettings,
  getStokesDisplayColormapDefault,
  isStokesDegreeModulationParameter,
  type StokesColormapDefaultSetting
} from '../../stokes';
import { sameStokesColormapDefaultSettings } from '../../stokes-colormap-settings';
import type { ViewerSessionState } from '../../types';
import { selectActiveSession } from '../viewer-app-selectors';
import type {
  RestorableVisualizationState,
  ViewerAppState,
  ViewerIntent
} from '../viewer-app-types';
import {
  cloneRestorableVisualizationState,
  patchSessionState,
  sessionExists,
  type ViewerReducerContext
} from './shared';

export function stokesReducer(
  state: ViewerAppState,
  intent: ViewerIntent,
  context: ViewerReducerContext
): ViewerAppState {
  switch (intent.type) {
    case 'displaySelectionSet':
      return reduceDisplaySelectionSet(state, intent);
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
    case 'stokesAolpDegreeModulationModeSet': {
      const selection = state.sessionState.displaySelection;
      if (!isStokesSelection(selection) || selection.parameter !== 'aolp') {
        return state;
      }

      if (state.sessionState.stokesAolpDegreeModulationMode === intent.mode) {
        return state;
      }

      return patchSessionState(state, {
        stokesAolpDegreeModulationMode: intent.mode
      });
    }
    case 'stokesColormapDefaultsSet':
      return sameStokesColormapDefaultSettings(state.stokesColormapDefaults, intent.settings)
        ? state
        : {
            ...state,
            stokesColormapDefaults: cloneStokesColormapDefaultSettings(intent.settings)
          };
    case 'stokesColormapDefaultSettingSet': {
      if (sameStokesColormapDefaultSettings(state.stokesColormapDefaults, {
        ...state.stokesColormapDefaults,
        [intent.group]: intent.setting
      })) {
        return state;
      }

      return {
        ...state,
        stokesColormapDefaults: {
          ...cloneStokesColormapDefaultSettings(state.stokesColormapDefaults),
          [intent.group]: cloneStokesColormapDefaultSetting(intent.setting)
        }
      };
    }
    case 'stokesActiveColormapDefaultApplied':
      return patchSessionState(state, {
        colormapRange: cloneDisplayLuminanceRange(intent.setting.range),
        colormapRangeMode: 'oneTime',
        colormapZeroCentered: intent.setting.zeroCentered,
        ...buildStokesDefaultModulationPatch(
          state.sessionState.displaySelection,
          intent.setting,
          state.sessionState
        )
      }, {
        resetDisplayRangeContext: true
      });
    case 'stokesColormapDefaultsReset': {
      const defaults = createDefaultStokesColormapDefaultSettings();
      return sameStokesColormapDefaultSettings(state.stokesColormapDefaults, defaults)
        ? state
        : {
            ...state,
            stokesColormapDefaults: defaults
          };
    }
    case 'sessionClosed':
      return sessionExists(context.initialState, intent.sessionId)
        ? removeStokesRestoreState(state, intent.sessionId)
        : state;
    case 'allSessionsClosed':
      return Object.keys(state.stokesDisplayRestoreStates).length === 0
        ? state
        : {
            ...state,
            stokesDisplayRestoreStates: {}
          };
    default:
      return state;
  }
}

function reduceDisplaySelectionSet(
  state: ViewerAppState,
  intent: Extract<ViewerIntent, { type: 'displaySelectionSet' }>
): ViewerAppState {
  const activeSession = selectActiveSession(state);
  const currentState = state.sessionState;
  const selection = cloneDisplaySelection(intent.displaySelection);
  const stokesDefaults = getStokesDisplayColormapDefault(selection, state.stokesColormapDefaults);
  let patch: Partial<ViewerSessionState> = {
    displaySelection: selection
  };
  let nextState = state;

  if (activeSession && !isStokesSelection(currentState.displaySelection)) {
    const capture = intent.restoreState
      ? cloneRestorableVisualizationState(intent.restoreState)
      : captureRestorableVisualizationState(currentState);
    nextState = {
      ...nextState,
      stokesDisplayRestoreStates: {
        ...nextState.stokesDisplayRestoreStates,
        [activeSession.id]: capture
      }
    };
  }

  if (!stokesDefaults) {
    if (isChannelSelection(selection) && isStokesSelection(currentState.displaySelection)) {
      patch = {
        ...patch,
        ...resolveStokesDisplayRestoreState(nextState, activeSession?.id ?? null)
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
      colormapZeroCentered: stokesDefaults.zeroCentered,
      ...buildStokesDefaultModulationPatch(selection, stokesDefaults, currentState, {
        preserveAolpMode: isStokesSelection(currentState.displaySelection)
      })
    };
  }

  return patchSessionState(nextState, patch, {
    resetDisplayRangeContext: true
  });
}

function buildStokesDefaultModulationPatch(
  selection: ViewerSessionState['displaySelection'],
  setting: StokesColormapDefaultSetting,
  currentState: ViewerSessionState,
  options: { preserveAolpMode?: boolean } = {}
): Partial<ViewerSessionState> {
  if (!isStokesSelection(selection) || !isStokesDegreeModulationParameter(selection.parameter) || !setting.modulation) {
    return {};
  }

  const aolpMode = options.preserveAolpMode
    ? currentState.stokesAolpDegreeModulationMode
    : setting.modulation.aolpMode ?? 'value';

  return {
    stokesDegreeModulation: {
      ...currentState.stokesDegreeModulation,
      [selection.parameter]: setting.modulation.enabled
    },
    ...(selection.parameter === 'aolp'
      ? { stokesAolpDegreeModulationMode: aolpMode }
      : {})
  };
}

function resolveStokesDisplayRestoreState(
  state: ViewerAppState,
  sessionId: string | null
): RestorableVisualizationState {
  if (sessionId) {
    const restoreState = state.stokesDisplayRestoreStates[sessionId];
    if (restoreState) {
      return cloneRestorableVisualizationState(restoreState);
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

function removeStokesRestoreState(state: ViewerAppState, sessionId: string): ViewerAppState {
  if (!Object.prototype.hasOwnProperty.call(state.stokesDisplayRestoreStates, sessionId)) {
    return state;
  }

  const {
    [sessionId]: _removedRestore,
    ...stokesDisplayRestoreStates
  } = state.stokesDisplayRestoreStates;

  return {
    ...state,
    stokesDisplayRestoreStates
  };
}
