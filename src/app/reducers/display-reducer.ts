import {
  getColormapAsset,
  type ColormapAsset
} from '../../colormaps';
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
import { resolveDisplayImageSize } from '../../display-size';
import { getSuccessValue } from '../../async-resource';
import { DEFAULT_DISPLAY_GAMMA, normalizeDisplayGamma } from '../../color';
import {
  DEFAULT_DEPTH_ZOOM,
  normalizeDepthFocalLengthPx,
  normalizeDepthPointSize,
  resolveDepthChannelForLayer
} from '../../depth';
import { computeFitView } from '../../interaction/image-geometry';
import { DEFAULT_PANORAMA_HFOV_DEG } from '../../interaction/panorama-geometry';
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
const COLORMAP_GAMMA_MIN = 0.2;
const COLORMAP_GAMMA_MAX = 5.0;

export function displayReducer(
  state: ViewerAppState,
  intent: ViewerIntent,
  context: ViewerReducerContext
): ViewerAppState {
  switch (intent.type) {
    case 'sessionLoaded':
      return shouldActivateLoadedSession(context.initialState, intent.activate)
        ? clearPendingColormapActivation(state)
        : state;
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
    case 'exposureCommitted':
      return patchSessionState(state, { channelThumbnailExposureEv: state.sessionState.exposureEv });
    case 'displayGammaSet':
      return patchSessionState(state, { displayGamma: normalizeDisplayGamma(intent.displayGamma) });
    case 'displayGammaCommitted':
      return patchSessionState(state, { channelThumbnailDisplayGamma: state.sessionState.displayGamma });
    case 'colormapExposureSet':
      return patchSessionState(state, { colormapExposureEv: clampFinite(intent.exposureEv, -10, 10, 0) });
    case 'colormapGammaSet':
      return patchSessionState(state, { colormapGamma: clampFinite(intent.gamma, COLORMAP_GAMMA_MIN, COLORMAP_GAMMA_MAX, 1) });
    case 'activeSessionDisplayReset': {
      if (!selectActiveSession(state)) {
        return state;
      }

      const nextRange = resolveColormapAutoRange(
        state.sessionState.displaySelection,
        getSuccessValue(state.displayRangeResource) ?? null,
        false
      );
      const nextState = patchSessionState(state, {
        ...state.interactionState.view,
        exposureEv: 0,
        channelThumbnailExposureEv: 0,
        displayGamma: DEFAULT_DISPLAY_GAMMA,
        channelThumbnailDisplayGamma: DEFAULT_DISPLAY_GAMMA,
        visualizationMode: 'rgb',
        activeColormapId: null,
        colormapExposureEv: 0,
        colormapGamma: 1,
        colormapRange: nextRange,
        colormapRangeMode: 'alwaysAuto',
        colormapZeroCentered: false,
        colormapReversed: false
      });
      return nextState === state
        ? state
        : {
            ...nextState,
            pendingColormapActivation: null
          };
    }
    case 'viewerModeSet': {
      if (!selectActiveSession(state) || state.sessionState.viewerMode === intent.viewerMode) {
        return state;
      }
      const depthPatch = intent.viewerMode === 'depth'
        ? resolveDepthModeActivationPatch(state)
        : {};
      if (intent.viewerMode === 'depth' && !depthPatch.depthChannel) {
        return state;
      }
      return patchSessionState(state, {
        viewerMode: intent.viewerMode,
        ...depthPatch
      }, {
        syncInteractionView: true,
        clearHover: true
      });
    }
    case 'activeLayerSet': {
      const activeSession = selectActiveSession(state);
      if (!activeSession) {
        return state;
      }
      const nextSessionState = buildViewerStateForLayer(
        state.sessionState,
        activeSession.decoded,
        intent.activeLayer,
        {
          stokesParameterVisibility: state.stokesParameterVisibility,
          spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled,
          channelRecognitionSettings: state.channelRecognitionSettings,
          channelRecognitionNameRules: state.channelRecognitionNameRules
        }
      );
      const nextLayer = activeSession.decoded.layers[nextSessionState.activeLayer] ?? null;
      if (nextLayer && state.sessionState.viewerMode === 'depth') {
        nextSessionState.depthChannel = resolveDepthChannelForLayer(
          nextLayer.channelNames,
          state.sessionState.depthChannel,
          {
            allowArbitraryZSuffix: true,
            channelRecognitionSettings: state.channelRecognitionSettings,
            channelRecognitionNameRules: state.channelRecognitionNameRules
          }
        );
        if (!nextSessionState.depthChannel) {
          nextSessionState.viewerMode = 'image';
        }
      }
      if (
        nextSessionState.activeLayer === state.sessionState.activeLayer &&
        nextSessionState.viewerMode === state.sessionState.viewerMode &&
        sameDisplaySelection(nextSessionState.displaySelection, state.sessionState.displaySelection) &&
        nextSessionState.depthChannel === state.sessionState.depthChannel
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
          ...patchSessionState(state, { visualizationMode: 'rgb', activeColormapId: null }),
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
            visualizationMode: 'colormap',
            activeColormapId: state.sessionState.activeColormapId ?? state.defaultColormapId
          },
          sessions: updateActiveSessionStoredState(state.sessions, state.activeSessionId, {
            ...state.sessionState,
            visualizationMode: 'colormap',
            activeColormapId: state.sessionState.activeColormapId ?? state.defaultColormapId
          })
        };
      }

      const activeDisplayLuminanceRange = getSuccessValue(state.displayRangeResource) ?? null;
      if (activeDisplayLuminanceRange) {
        const nextRange = resolveColormapAutoRange(
          state.sessionState.displaySelection,
          activeDisplayLuminanceRange,
          state.sessionState.colormapZeroCentered
        );
        return patchSessionState(state, {
          visualizationMode: 'colormap',
          activeColormapId: state.sessionState.activeColormapId ?? state.defaultColormapId,
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
    case 'activeColormapSet': {
      const nextState = patchSessionState(state, buildActiveColormapPatch(state, intent));
      return intent.colormapId === null
        ? {
            ...nextState,
            pendingColormapActivation: null
          }
        : nextState;
    }
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
        getSuccessValue(state.displayRangeResource) ?? null,
        state.sessionState.colormapZeroCentered
      );
      return patchSessionState(state, {
        colormapRange: nextRange ?? cloneDisplayLuminanceRange(state.sessionState.colormapRange),
        colormapRangeMode: 'alwaysAuto'
      });
    }
    case 'colormapRangeReset': {
      const activeSession = selectActiveSession(state);
      if (!activeSession) {
        return state;
      }

      const nextRange = resolveColormapAutoRange(
        state.sessionState.displaySelection,
        getSuccessValue(state.displayRangeResource) ?? null,
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
            getSuccessValue(state.displayRangeResource) ?? null,
            nextZeroCentered
          ) ?? cloneDisplayLuminanceRange(state.sessionState.colormapRange)
        : nextZeroCentered
          ? buildZeroCenteredColormapRange(
              state.sessionState.colormapRange ?? getSuccessValue(state.displayRangeResource) ?? null
            )
          : cloneDisplayLuminanceRange(state.sessionState.colormapRange);

      return patchSessionState(state, {
        colormapRange: nextRange,
        colormapZeroCentered: nextZeroCentered
      });
    }
    case 'colormapReverseToggled': {
      const activeSession = selectActiveSession(state);
      if (!activeSession) {
        return state;
      }

      return patchSessionState(state, {
        colormapReversed: !state.sessionState.colormapReversed
      });
    }
    case 'lockedPixelSet':
      return patchSessionState(state, {
        lockedPixel: intent.pixel ? { ...intent.pixel } : null
      });
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
    case 'depthSettingsEdited': {
      const activeSession = selectActiveSession(state);
      const activeLayer = activeSession?.decoded.layers[state.sessionState.activeLayer] ?? null;
      if (!activeSession || !activeLayer) {
        return state;
      }

      const patch: Partial<ViewerAppState['sessionState']> = {};
      if (intent.patch.depthChannel !== undefined) {
        patch.depthChannel = resolveDepthChannelForLayer(
          activeLayer.channelNames,
          intent.patch.depthChannel,
          {
            allowArbitraryZSuffix: true,
            channelRecognitionSettings: state.channelRecognitionSettings,
            channelRecognitionNameRules: state.channelRecognitionNameRules
          }
        );
      }
      if (intent.patch.depthFocalLengthPx !== undefined) {
        patch.depthFocalLengthPx = normalizeDepthFocalLengthPx(intent.patch.depthFocalLengthPx);
      }
      if (intent.patch.depthPointSizePx !== undefined) {
        patch.depthPointSizePx = normalizeDepthPointSize(intent.patch.depthPointSizePx);
      }

      return patchSessionState(state, patch, {
        syncInteractionView: false,
        clearHover: true
      });
    }
    case 'interactionStatePublished':
      return sameInteractionState(state.interactionState, intent.interactionState) ? state : {
        ...state,
        interactionState: cloneInteractionState(intent.interactionState)
      };
    case 'viewStateCommitted': {
      const patch = normalizeViewerViewPatch(intent.view);
      if (!patch || sameViewCommit(state.sessionState, { ...state.sessionState, ...patch })) {
        return state;
      }
      return patchSessionState(state, patch);
    }
    case 'activeSessionFitToViewport': {
      const activeSession = selectActiveSession(state);
      if (!activeSession || state.sessionState.viewerMode !== 'image') {
        return state;
      }

      const displaySize = resolveDisplayImageSize(
        activeSession.decoded.width,
        activeSession.decoded.height,
        state.sessionState.displaySelection
      );
      return patchSessionState(
        state,
        computeFitView(intent.viewport, displaySize.width, displaySize.height, intent.fitInsets),
        {
          syncInteractionView: true,
          clearHover: true
        }
      );
    }
    case 'activeSessionViewReset': {
      const activeSession = selectActiveSession(state);
      if (!activeSession) {
        return state;
      }

      const displaySize = resolveDisplayImageSize(
        activeSession.decoded.width,
        activeSession.decoded.height,
        state.sessionState.displaySelection
      );
      return patchSessionState(
        state,
        {
          ...computeFitView(intent.viewport, displaySize.width, displaySize.height, intent.fitInsets),
          panoramaYawDeg: 0,
          panoramaPitchDeg: 0,
          panoramaHfovDeg: DEFAULT_PANORAMA_HFOV_DEG,
          depthYawDeg: 0,
          depthPitchDeg: 0,
          depthZoom: DEFAULT_DEPTH_ZOOM
        },
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

function resolveDepthModeActivationPatch(state: ViewerAppState): Partial<ViewerAppState['sessionState']> {
  const activeSession = selectActiveSession(state);
  const activeLayer = activeSession?.decoded.layers[state.sessionState.activeLayer] ?? null;
  if (!activeLayer) {
    return {};
  }

  return {
    depthChannel: resolveDepthChannelForLayer(
      activeLayer.channelNames,
      state.sessionState.depthChannel,
      {
        allowArbitraryZSuffix: true,
        channelRecognitionSettings: state.channelRecognitionSettings,
        channelRecognitionNameRules: state.channelRecognitionNameRules
      }
    )
  };
}

function shouldActivateLoadedSession(state: ViewerAppState, activate: boolean | undefined): boolean {
  return activate !== false || !selectActiveSession(state);
}

function clearPendingColormapActivation(state: ViewerAppState): ViewerAppState {
  return state.pendingColormapActivation === null ? state : {
    ...state,
    pendingColormapActivation: null
  };
}

function buildActiveColormapPatch(
  state: ViewerAppState,
  intent: Extract<ViewerIntent, { type: 'activeColormapSet' }>
): Partial<ViewerAppState['sessionState']> {
  if (intent.colormapId === null) {
    return {
      activeColormapId: null,
      visualizationMode: 'rgb'
    };
  }

  const patch: Partial<ViewerAppState['sessionState']> = {
    activeColormapId: intent.colormapId,
    visualizationMode: 'colormap'
  };
  const asset = getActiveColormapAssetForDefault(state, intent);
  if (!asset) {
    return patch;
  }

  if (!asset.diverging) {
    patch.colormapZeroCentered = false;
    patch.colormapRange = state.sessionState.colormapRangeMode === 'alwaysAuto'
      ? resolveColormapAutoRange(
          state.sessionState.displaySelection,
          getSuccessValue(state.displayRangeResource) ?? null,
          false
        ) ?? cloneDisplayLuminanceRange(state.sessionState.colormapRange)
      : cloneDisplayLuminanceRange(state.sessionState.colormapRange);

    return patch;
  }

  patch.colormapZeroCentered = true;
  patch.colormapRange = state.sessionState.colormapRangeMode === 'alwaysAuto'
    ? resolveColormapAutoRange(
        state.sessionState.displaySelection,
        getSuccessValue(state.displayRangeResource) ?? null,
        true
      ) ?? buildZeroCenteredColormapRange(state.sessionState.colormapRange)
    : buildZeroCenteredColormapRange(
        state.sessionState.colormapRange ?? getSuccessValue(state.displayRangeResource) ?? null
      );

  return patch;
}

function getActiveColormapAssetForDefault(
  state: ViewerAppState,
  intent: Extract<ViewerIntent, { type: 'activeColormapSet' }>
): ColormapAsset | null {
  if (intent.applyDivergingDefault === false || !state.colormapRegistry || intent.colormapId === null) {
    return null;
  }

  return getColormapAsset(state.colormapRegistry, intent.colormapId);
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}
