import { AUTO_EXPOSURE_SOURCE } from '../analysis/auto-exposure';
import { DEFAULT_DISPLAY_GAMMA } from '../color';
import {
  buildDisplayAutoExposureRevisionKey,
  buildDisplayImageStatsRevisionKey,
  buildDisplayLuminanceRevisionKey
} from '../display/revision-keys';
import { sameDisplayLuminanceRange } from '../colormap-range';
import { sameDisplaySelection } from '../display-model';
import {
  createEmptyRoiInteractionState,
  mergeRenderState,
  samePixel,
  sameRoi,
  sameRoiInteractionState,
  sameViewState
} from '../view-state';
import {
  collectViewerPaneLeaves,
  samePanePath,
  sameViewerPaneLayout
} from '../viewer-pane-layout';
import { sameStokesColormapDefaultSettings } from '../stokes-colormap-settings';
import type { DisplayLuminanceRange, OpenedImageSession, ViewerRenderState } from '../types';
import { buildProbeReadoutModel } from './probe-presentation';
import { buildRoiReadoutModel } from './roi-presentation';
import { buildSpectralPlotReadoutModel } from './spectral-presentation';
import {
  sameDisplayRangeRequest,
  sameImageStatsReadout,
  sameProbeReadout,
  sameRoiReadout,
  sameResourceTarget,
  sameSpectralPlotReadout,
  sameViewerStateReadout
} from './viewer-app-equality';
import {
  selectActiveColormapLut,
  selectActiveDisplayLuminanceRange,
  selectActiveImageStats,
  selectActiveSession,
  selectColormapLutById
} from './viewer-app-selectors';
import type {
  ViewerAppState,
  ViewerDisplayRangeRequest,
  ViewerImageStatsRequest,
  ViewerPaneRenderSource,
  ViewerRenderSnapshot,
  ViewerResourceTarget
} from './viewer-app-types';

export const enum ViewerRenderInvalidationFlags {
  None = 0,
  ColormapTexture = 1 << 0,
  ProbeReadout = 1 << 1,
  RoiReadout = 1 << 2,
  ResourcePrepare = 1 << 3,
  ResourceRequestDisplayRange = 1 << 4,
  ResourceClearImage = 1 << 5,
  RenderImage = 1 << 6,
  RenderValueOverlay = 1 << 7,
  RenderProbeOverlay = 1 << 8,
  ResourceRequestAutoExposure = 1 << 9,
  RenderRulerOverlay = 1 << 10,
  ImageStatsReadout = 1 << 11,
  ResourceRequestImageStats = 1 << 12,
  ViewerStateReadout = 1 << 13,
  ViewerPaneLayout = 1 << 14,
  SpectralReadout = 1 << 15
}

export function createViewerRenderSnapshotSelector(): (state: ViewerAppState) => ViewerRenderSnapshot {
  const selectRenderState = createRenderStateSelector();
  const selectProbeReadout = createProbeReadoutSelector();
  const selectSpectralPlotReadout = createSpectralPlotReadoutSelector();
  const selectRoiReadout = createRoiReadoutSelector();
  const selectImageStatsReadout = createImageStatsReadoutSelector();
  const selectResourceTarget = createResourceTargetSelector();
  const selectDisplayRangeRequest = createDisplayRangeRequestSelector();
  const selectImageStatsRequest = createImageStatsRequestSelector();
  const selectAutoExposureRequest = createAutoExposureRequestSelector();

  let previousSnapshot: ViewerRenderSnapshot | null = null;
  return (state) => {
    const activeSession = selectActiveSession(state);
    const activeLayer = activeSession?.decoded.layers[state.sessionState.activeLayer] ?? null;
    const activeColormapLut = selectActiveColormapLut(state);
    const imageStatsRequest = selectImageStatsRequest(state, activeSession, activeLayer);
    const renderState = selectRenderState(state);

    const nextSnapshot: ViewerRenderSnapshot = {
      activeSession,
      activeLayer,
      renderState,
      paneRenderSources: selectPaneRenderSources(state, activeSession, renderState),
      activeColormapLut,
      probeReadout: selectProbeReadout(state, activeSession, activeLayer),
      spectralPlotReadout: selectSpectralPlotReadout(state, activeSession, activeLayer),
      roiReadout: selectRoiReadout(state, activeSession, activeLayer),
      viewerStateReadout: buildViewerStateReadout(state, activeSession),
      imageStatsReadout: selectImageStatsReadout(state, activeSession, activeLayer, imageStatsRequest),
      resourceTarget: selectResourceTarget(state, activeSession),
      displayRangeRequest: selectDisplayRangeRequest(state, activeSession, activeLayer),
      imageStatsRequest,
      autoExposureRequest: selectAutoExposureRequest(state, activeSession, activeLayer),
      rulersVisible: state.rulersVisible,
      viewerPaneLayout: state.viewerPaneLayout
    };

    if (previousSnapshot && sameViewerRenderSnapshot(previousSnapshot, nextSnapshot)) {
      return previousSnapshot;
    }

    previousSnapshot = nextSnapshot;
    return nextSnapshot;
  };
}

export function computeViewerRenderInvalidation(
  previous: ViewerRenderSnapshot,
  next: ViewerRenderSnapshot
): ViewerRenderInvalidationFlags {
  if (previous === next) {
    return ViewerRenderInvalidationFlags.None;
  }

  let flags = ViewerRenderInvalidationFlags.None;

  if (previous.activeColormapLut !== next.activeColormapLut) {
    flags |= ViewerRenderInvalidationFlags.ColormapTexture;
  }

  if (!sameProbeReadout(previous.probeReadout, next.probeReadout)) {
    flags |= ViewerRenderInvalidationFlags.ProbeReadout;
  }

  if (!sameSpectralPlotReadout(previous.spectralPlotReadout, next.spectralPlotReadout)) {
    flags |= ViewerRenderInvalidationFlags.SpectralReadout;
  }

  if (!sameRoiReadout(previous.roiReadout, next.roiReadout)) {
    flags |= ViewerRenderInvalidationFlags.RoiReadout;
  }

  if (!sameImageStatsReadout(previous.imageStatsReadout, next.imageStatsReadout)) {
    flags |= ViewerRenderInvalidationFlags.ImageStatsReadout;
  }

  if (!sameViewerStateReadout(previous.viewerStateReadout, next.viewerStateReadout)) {
    flags |= ViewerRenderInvalidationFlags.ViewerStateReadout;
  }

  if (!sameViewerPaneLayout(previous.viewerPaneLayout, next.viewerPaneLayout)) {
    flags |= ViewerRenderInvalidationFlags.ViewerPaneLayout;
  }

  if (
    (!sameResourceTarget(previous.resourceTarget, next.resourceTarget) && next.resourceTarget) ||
    !samePaneResourceInputs(previous.paneRenderSources, next.paneRenderSources)
  ) {
    flags |= ViewerRenderInvalidationFlags.ResourcePrepare;
  }

  if (!sameDisplayRangeRequest(previous.displayRangeRequest, next.displayRangeRequest) && next.displayRangeRequest) {
    flags |= ViewerRenderInvalidationFlags.ResourceRequestDisplayRange;
  }

  if (!sameImageStatsRequest(previous.imageStatsRequest, next.imageStatsRequest) && next.imageStatsRequest) {
    flags |= ViewerRenderInvalidationFlags.ResourceRequestImageStats;
  }

  if (!sameAutoExposureRequest(previous.autoExposureRequest, next.autoExposureRequest) && next.autoExposureRequest) {
    flags |= ViewerRenderInvalidationFlags.ResourceRequestAutoExposure;
  }

  if (previous.paneRenderSources.length > 0 && next.paneRenderSources.length === 0) {
    flags |= ViewerRenderInvalidationFlags.ResourceClearImage;
  }

  if (next.paneRenderSources.length > 0 && !sameRenderImageInputs(previous, next)) {
    flags |= ViewerRenderInvalidationFlags.RenderImage;
  }

  if (next.paneRenderSources.length > 0 && !sameRenderValueOverlayInputs(previous, next)) {
    flags |= ViewerRenderInvalidationFlags.RenderValueOverlay;
  }

  if (next.paneRenderSources.length > 0 && !sameRenderProbeOverlayInputs(previous, next)) {
    flags |= ViewerRenderInvalidationFlags.RenderProbeOverlay;
  }

  if (!sameRenderRulerOverlayInputs(previous, next)) {
    flags |= ViewerRenderInvalidationFlags.RenderRulerOverlay;
  }

  if (flags & ViewerRenderInvalidationFlags.ViewerPaneLayout) {
    if (next.paneRenderSources.length > 0) {
      flags |=
        ViewerRenderInvalidationFlags.RenderImage |
        ViewerRenderInvalidationFlags.RenderValueOverlay |
        ViewerRenderInvalidationFlags.RenderProbeOverlay;
    }
    flags |= ViewerRenderInvalidationFlags.RenderRulerOverlay;
  }

  return flags;
}

function createRenderStateSelector(): (state: ViewerAppState) => ViewerRenderSnapshot['renderState'] {
  let previousResult: ViewerRenderSnapshot['renderState'] | null = null;
  return (state) => {
    const nextResult = mergeRenderState(state.sessionState, state.interactionState);
    if (previousResult && sameViewerRenderState(previousResult, nextResult)) {
      return previousResult;
    }

    previousResult = nextResult;
    return previousResult;
  };
}

function selectPaneRenderSources(
  state: ViewerAppState,
  activeSession: OpenedImageSession | null,
  activeRenderState: ViewerRenderState
): ViewerPaneRenderSource[] {
  const sessionsById = new Map(state.sessions.map((session) => [session.id, session]));
  const sources: ViewerPaneRenderSource[] = [];

  for (const pane of collectViewerPaneLeaves(state.viewerPaneLayout)) {
    const session = pane.active
      ? activeSession ?? (pane.sessionId ? sessionsById.get(pane.sessionId) ?? null : null)
      : pane.sessionId
        ? sessionsById.get(pane.sessionId) ?? null
        : null;
    if (!session) {
      continue;
    }

    const usesLiveState = session.id === state.activeSessionId;
    const renderState = usesLiveState
      ? activeRenderState
      : createStoredPaneRenderState(session.state);
    const layer = session.decoded.layers[renderState.activeLayer] ?? null;
    if (!layer) {
      continue;
    }

    sources.push({
      path: [...pane.path],
      active: pane.active,
      session,
      activeLayer: renderState.activeLayer,
      layer,
      renderState,
      colormapLut: selectColormapLutById(state, renderState.activeColormapId)
    });
  }

  return sources;
}

function createStoredPaneRenderState(sessionState: ViewerAppState['sessionState']): ViewerRenderState {
  return {
    ...sessionState,
    hoveredPixel: null,
    draftRoi: null,
    roiInteraction: createEmptyRoiInteractionState()
  };
}

function createProbeReadoutSelector(): (
  state: ViewerAppState,
  activeSession: OpenedImageSession | null,
  activeLayer: ViewerRenderSnapshot['activeLayer']
) => ViewerRenderSnapshot['probeReadout'] {
  let previousSessionId: string | null = null;
  let previousLayer: ViewerRenderSnapshot['activeLayer'] = null;
  let previousWidth = 0;
  let previousHeight = 0;
  let previousLockedPixel: ViewerAppState['sessionState']['lockedPixel'] = null;
  let previousHoveredPixel: ViewerAppState['interactionState']['hoveredPixel'] = null;
  let previousDisplaySelection: ViewerAppState['sessionState']['displaySelection'] = null;
  let previousExposureEv = 0;
  let previousDisplayGamma = DEFAULT_DISPLAY_GAMMA;
  let previousVisualizationMode: ViewerAppState['sessionState']['visualizationMode'] = 'rgb';
  let previousColormapRange: ViewerAppState['sessionState']['colormapRange'] = null;
  let previousActiveDisplayLuminanceRange: DisplayLuminanceRange | null = null;
  let previousActiveColormapLut: ViewerRenderSnapshot['activeColormapLut'] = null;
  let previousStokesDegreeModulation = { aolp: false, cop: false, top: false };
  let previousStokesAolpDegreeModulationMode: ViewerAppState['sessionState']['stokesAolpDegreeModulationMode'] = 'value';
  let previousResult = buildProbeReadoutModel({
    activeSession: null,
    activeLayer: null,
    sessionState: stateLikeSessionState(),
    interactionState: stateLikeInteractionState(),
    activeColormapLut: null,
    activeDisplayLuminanceRange: null
  });

  return (state, activeSession, activeLayer) => {
    const sessionId = activeSession?.id ?? null;
    const width = activeSession?.decoded.width ?? 0;
    const height = activeSession?.decoded.height ?? 0;
    const nextStokesDegreeModulation = state.sessionState.stokesDegreeModulation;
    const usesColormap = state.sessionState.visualizationMode === 'colormap';
    const activeDisplayLuminanceRange = selectActiveDisplayLuminanceRange(state);
    const activeColormapLut = selectActiveColormapLut(state);
    const depsMatch =
      sessionId === previousSessionId &&
      activeLayer === previousLayer &&
      width === previousWidth &&
      height === previousHeight &&
      samePixel(state.sessionState.lockedPixel, previousLockedPixel) &&
      samePixel(state.interactionState.hoveredPixel, previousHoveredPixel) &&
      sameDisplaySelection(state.sessionState.displaySelection, previousDisplaySelection) &&
      state.sessionState.exposureEv === previousExposureEv &&
      state.sessionState.displayGamma === previousDisplayGamma &&
      state.sessionState.visualizationMode === previousVisualizationMode &&
      (
        !usesColormap || (
          sameDisplayLuminanceRange(state.sessionState.colormapRange, previousColormapRange) &&
          sameDisplayLuminanceRange(activeDisplayLuminanceRange, previousActiveDisplayLuminanceRange) &&
          activeColormapLut === previousActiveColormapLut &&
          nextStokesDegreeModulation.aolp === previousStokesDegreeModulation.aolp &&
          nextStokesDegreeModulation.cop === previousStokesDegreeModulation.cop &&
          nextStokesDegreeModulation.top === previousStokesDegreeModulation.top &&
          state.sessionState.stokesAolpDegreeModulationMode === previousStokesAolpDegreeModulationMode
        )
      );

    if (depsMatch) {
      return previousResult;
    }

    previousSessionId = sessionId;
    previousLayer = activeLayer;
    previousWidth = width;
    previousHeight = height;
    previousLockedPixel = state.sessionState.lockedPixel;
    previousHoveredPixel = state.interactionState.hoveredPixel;
    previousDisplaySelection = state.sessionState.displaySelection;
    previousExposureEv = state.sessionState.exposureEv;
    previousDisplayGamma = state.sessionState.displayGamma;
    previousVisualizationMode = state.sessionState.visualizationMode;
    previousColormapRange = state.sessionState.colormapRange;
    previousActiveDisplayLuminanceRange = activeDisplayLuminanceRange;
    previousActiveColormapLut = activeColormapLut;
    previousStokesDegreeModulation = nextStokesDegreeModulation;
    previousStokesAolpDegreeModulationMode = state.sessionState.stokesAolpDegreeModulationMode;
    previousResult = buildProbeReadoutModel({
      activeSession,
      activeLayer,
      sessionState: state.sessionState,
      interactionState: state.interactionState,
      activeColormapLut,
      activeDisplayLuminanceRange
    });
    return previousResult;
  };
}

function createSpectralPlotReadoutSelector(): (
  state: ViewerAppState,
  activeSession: OpenedImageSession | null,
  activeLayer: ViewerRenderSnapshot['activeLayer']
) => ViewerRenderSnapshot['spectralPlotReadout'] {
  let previousSessionId: string | null = null;
  let previousLayer: ViewerRenderSnapshot['activeLayer'] = null;
  let previousWidth = 0;
  let previousHeight = 0;
  let previousLockedPixel: ViewerAppState['sessionState']['lockedPixel'] = null;
  let previousHoveredPixel: ViewerAppState['interactionState']['hoveredPixel'] = null;
  let previousDisplaySelection: ViewerAppState['sessionState']['displaySelection'] = null;
  let previousStokesColormapDefaults: ViewerAppState['stokesColormapDefaults'] | null = null;
  let previousResult = buildSpectralPlotReadoutModel({
    activeSession: null,
    activeLayer: null,
    sessionState: stateLikeSessionState(),
    interactionState: stateLikeInteractionState()
  });

  return (state, activeSession, activeLayer) => {
    const sessionId = activeSession?.id ?? null;
    const width = activeSession?.decoded.width ?? 0;
    const height = activeSession?.decoded.height ?? 0;
    if (
      sessionId === previousSessionId &&
      activeLayer === previousLayer &&
      width === previousWidth &&
      height === previousHeight &&
      samePixel(state.sessionState.lockedPixel, previousLockedPixel) &&
      samePixel(state.interactionState.hoveredPixel, previousHoveredPixel) &&
      sameDisplaySelection(state.sessionState.displaySelection, previousDisplaySelection) &&
      previousStokesColormapDefaults !== null &&
      sameStokesColormapDefaultSettings(state.stokesColormapDefaults, previousStokesColormapDefaults)
    ) {
      return previousResult;
    }

    previousSessionId = sessionId;
    previousLayer = activeLayer;
    previousWidth = width;
    previousHeight = height;
    previousLockedPixel = state.sessionState.lockedPixel;
    previousHoveredPixel = state.interactionState.hoveredPixel;
    previousDisplaySelection = state.sessionState.displaySelection;
    previousStokesColormapDefaults = state.stokesColormapDefaults;
    previousResult = buildSpectralPlotReadoutModel({
      activeSession,
      activeLayer,
      sessionState: state.sessionState,
      interactionState: state.interactionState,
      stokesColormapDefaults: state.stokesColormapDefaults
    });
    return previousResult;
  };
}

function createResourceTargetSelector(): (
  state: ViewerAppState,
  activeSession: OpenedImageSession | null
) => ViewerResourceTarget | null {
  let previousResult: ViewerResourceTarget | null = null;
  return (state, activeSession) => {
    const nextResult = activeSession
      ? {
          sessionId: activeSession.id,
          activeLayer: state.sessionState.activeLayer,
          visualizationMode: state.sessionState.visualizationMode,
          displaySelection: state.sessionState.displaySelection,
          decodedRef: activeSession.decoded
        }
      : null;
    if (sameResourceTarget(previousResult, nextResult)) {
      return previousResult;
    }

    previousResult = nextResult;
    return previousResult;
  };
}

function createRoiReadoutSelector(): (
  state: ViewerAppState,
  activeSession: OpenedImageSession | null,
  activeLayer: ViewerRenderSnapshot['activeLayer']
) => ViewerRenderSnapshot['roiReadout'] {
  let previousSessionId: string | null = null;
  let previousLayer: ViewerRenderSnapshot['activeLayer'] = null;
  let previousRoi: ViewerAppState['sessionState']['roi'] = null;
  let previousDisplaySelection: ViewerAppState['sessionState']['displaySelection'] = null;
  let previousVisualizationMode: ViewerAppState['sessionState']['visualizationMode'] = 'rgb';
  let previousResult = buildRoiReadoutModel({
    activeSession: null,
    activeLayer: null,
    sessionState: stateLikeSessionState()
  });

  return (state, activeSession, activeLayer) => {
    const sessionId = activeSession?.id ?? null;
    if (
      sessionId === previousSessionId &&
      activeLayer === previousLayer &&
      sameRoi(state.sessionState.roi, previousRoi) &&
      state.sessionState.visualizationMode === previousVisualizationMode &&
      sameDisplaySelection(state.sessionState.displaySelection, previousDisplaySelection)
    ) {
      return previousResult;
    }

    previousSessionId = sessionId;
    previousLayer = activeLayer;
    previousRoi = state.sessionState.roi;
    previousVisualizationMode = state.sessionState.visualizationMode;
    previousDisplaySelection = state.sessionState.displaySelection;
    previousResult = buildRoiReadoutModel({
      activeSession,
      activeLayer,
      sessionState: state.sessionState
    });
    return previousResult;
  };
}

function createImageStatsReadoutSelector(): (
  state: ViewerAppState,
  activeSession: OpenedImageSession | null,
  activeLayer: ViewerRenderSnapshot['activeLayer'],
  imageStatsRequest: ViewerImageStatsRequest | null
) => ViewerRenderSnapshot['imageStatsReadout'] {
  let previousSessionId: string | null = null;
  let previousLayer: ViewerRenderSnapshot['activeLayer'] = null;
  let previousStats: ViewerRenderSnapshot['imageStatsReadout']['stats'] = null;
  let previousLoading = false;
  let previousResult: ViewerRenderSnapshot['imageStatsReadout'] = {
    hasActiveImage: false,
    isLoading: false,
    stats: null
  };

  return (state, activeSession, activeLayer, imageStatsRequest) => {
    const sessionId = activeSession?.id ?? null;
    const hasActiveImage = Boolean(activeSession && activeLayer);
    const isLoading = Boolean(imageStatsRequest);
    const activeImageStats = selectActiveImageStats(state);
    if (
      sessionId === previousSessionId &&
      activeLayer === previousLayer &&
      activeImageStats === previousStats &&
      isLoading === previousLoading
    ) {
      return previousResult;
    }

    previousSessionId = sessionId;
    previousLayer = activeLayer;
    previousStats = activeImageStats;
    previousLoading = isLoading;
    previousResult = {
      hasActiveImage,
      isLoading,
      stats: hasActiveImage ? activeImageStats : null
    };
    return previousResult;
  };
}

function createDisplayRangeRequestSelector(): (
  state: ViewerAppState,
  activeSession: OpenedImageSession | null,
  activeLayer: ViewerRenderSnapshot['activeLayer']
) => ViewerDisplayRangeRequest | null {
  let previousResult: ViewerDisplayRangeRequest | null = null;
  return (state, activeSession, activeLayer) => {
    const shouldRequest = state.pendingColormapActivation
      || (state.sessionState.visualizationMode === 'colormap' && state.sessionState.colormapRangeMode === 'alwaysAuto');
    const effectiveVisualizationMode = state.pendingColormapActivation
      ? 'colormap'
      : state.sessionState.visualizationMode;
    const nextResult = activeSession && activeLayer && shouldRequest
      ? {
          sessionId: activeSession.id,
          activeLayer: state.sessionState.activeLayer,
          visualizationMode: effectiveVisualizationMode,
          displaySelection: state.sessionState.displaySelection,
          decodedRef: activeSession.decoded,
          requestKey: `${activeSession.id}:${buildDisplayLuminanceRevisionKey({
            activeLayer: state.sessionState.activeLayer,
            displaySelection: state.sessionState.displaySelection,
            visualizationMode: effectiveVisualizationMode
          })}`
        }
      : null;
    if (sameDisplayRangeRequest(previousResult, nextResult)) {
      return previousResult;
    }

    previousResult = nextResult;
    return previousResult;
  };
}

function createImageStatsRequestSelector(): (
  state: ViewerAppState,
  activeSession: OpenedImageSession | null,
  activeLayer: ViewerRenderSnapshot['activeLayer']
) => ViewerImageStatsRequest | null {
  let previousResult: ViewerImageStatsRequest | null = null;
  return (state, activeSession, activeLayer) => {
    const nextResult = activeSession && activeLayer && !selectActiveImageStats(state)
      ? {
          sessionId: activeSession.id,
          activeLayer: state.sessionState.activeLayer,
          visualizationMode: state.sessionState.visualizationMode,
          displaySelection: state.sessionState.displaySelection,
          decodedRef: activeSession.decoded,
          requestKey: `${activeSession.id}:${buildDisplayImageStatsRevisionKey({
            activeLayer: state.sessionState.activeLayer,
            displaySelection: state.sessionState.displaySelection,
            visualizationMode: state.sessionState.visualizationMode
          })}`
        }
      : null;
    if (sameImageStatsRequest(previousResult, nextResult)) {
      return previousResult;
    }

    previousResult = nextResult;
    return previousResult;
  };
}

function createAutoExposureRequestSelector(): (
  state: ViewerAppState,
  activeSession: OpenedImageSession | null,
  activeLayer: ViewerRenderSnapshot['activeLayer']
) => ViewerRenderSnapshot['autoExposureRequest'] {
  let previousResult: ViewerRenderSnapshot['autoExposureRequest'] = null;
  return (state, activeSession, activeLayer) => {
    const shouldRequest = state.autoExposureEnabled && state.sessionState.visualizationMode === 'rgb';
    const nextResult = activeSession && activeLayer && shouldRequest
      ? {
          sessionId: activeSession.id,
          activeLayer: state.sessionState.activeLayer,
          visualizationMode: 'rgb' as const,
          displaySelection: state.sessionState.displaySelection,
          decodedRef: activeSession.decoded,
          percentile: state.autoExposurePercentile,
          source: AUTO_EXPOSURE_SOURCE,
          requestKey: `${activeSession.id}:${buildDisplayAutoExposureRevisionKey({
            activeLayer: state.sessionState.activeLayer,
            displaySelection: state.sessionState.displaySelection,
            visualizationMode: 'rgb'
          }, state.autoExposurePercentile)}`
        }
      : null;
    if (sameAutoExposureRequest(previousResult, nextResult)) {
      return previousResult;
    }

    previousResult = nextResult;
    return previousResult;
  };
}

function sameViewerRenderSnapshot(a: ViewerRenderSnapshot, b: ViewerRenderSnapshot): boolean {
  return (
    a.activeSession?.id === b.activeSession?.id &&
    a.activeLayer === b.activeLayer &&
    sameViewerRenderState(a.renderState, b.renderState) &&
    samePaneRenderSources(a.paneRenderSources, b.paneRenderSources) &&
    a.activeColormapLut === b.activeColormapLut &&
    sameProbeReadout(a.probeReadout, b.probeReadout) &&
    sameSpectralPlotReadout(a.spectralPlotReadout, b.spectralPlotReadout) &&
    sameRoiReadout(a.roiReadout, b.roiReadout) &&
    sameViewerStateReadout(a.viewerStateReadout, b.viewerStateReadout) &&
    sameImageStatsReadout(a.imageStatsReadout, b.imageStatsReadout) &&
    sameResourceTarget(a.resourceTarget, b.resourceTarget) &&
    sameDisplayRangeRequest(a.displayRangeRequest, b.displayRangeRequest) &&
    sameImageStatsRequest(a.imageStatsRequest, b.imageStatsRequest) &&
    sameAutoExposureRequest(a.autoExposureRequest, b.autoExposureRequest) &&
    a.rulersVisible === b.rulersVisible &&
    sameViewerPaneLayout(a.viewerPaneLayout, b.viewerPaneLayout)
  );
}

function buildViewerStateReadout(
  state: ViewerAppState,
  activeSession: OpenedImageSession | null
): ViewerRenderSnapshot['viewerStateReadout'] {
  const renderState = mergeRenderState(state.sessionState, state.interactionState);
  return {
    hasActiveImage: Boolean(activeSession),
    viewerMode: renderState.viewerMode,
    view: {
      zoom: renderState.zoom,
      panX: renderState.panX,
      panY: renderState.panY,
      panoramaYawDeg: renderState.panoramaYawDeg,
      panoramaPitchDeg: renderState.panoramaPitchDeg,
      panoramaHfovDeg: renderState.panoramaHfovDeg
    }
  };
}

function sameImageStatsRequest(
  a: ViewerRenderSnapshot['imageStatsRequest'],
  b: ViewerRenderSnapshot['imageStatsRequest']
): boolean {
  return (
    a?.requestKey === b?.requestKey &&
    a?.sessionId === b?.sessionId &&
    a?.activeLayer === b?.activeLayer &&
    a?.visualizationMode === b?.visualizationMode &&
    a?.decodedRef === b?.decodedRef &&
    sameDisplaySelection(a?.displaySelection ?? null, b?.displaySelection ?? null)
  );
}

function sameAutoExposureRequest(
  a: ViewerRenderSnapshot['autoExposureRequest'],
  b: ViewerRenderSnapshot['autoExposureRequest']
): boolean {
  return (
    a?.requestKey === b?.requestKey &&
    a?.sessionId === b?.sessionId &&
    a?.activeLayer === b?.activeLayer &&
    a?.visualizationMode === b?.visualizationMode &&
    a?.decodedRef === b?.decodedRef &&
    a?.percentile === b?.percentile &&
    a?.source === b?.source &&
    sameDisplaySelection(a?.displaySelection ?? null, b?.displaySelection ?? null)
  );
}

function sameRenderImageInputs(a: ViewerRenderSnapshot, b: ViewerRenderSnapshot): boolean {
  return samePaneRenderSourcesBy(a.paneRenderSources, b.paneRenderSources, samePaneImageInput);
}

function sameRenderValueOverlayInputs(a: ViewerRenderSnapshot, b: ViewerRenderSnapshot): boolean {
  return samePaneRenderSourcesBy(a.paneRenderSources, b.paneRenderSources, samePaneValueOverlayInput);
}

function sameRenderProbeOverlayInputs(a: ViewerRenderSnapshot, b: ViewerRenderSnapshot): boolean {
  return samePaneRenderSourcesBy(a.paneRenderSources, b.paneRenderSources, samePaneProbeOverlayInput);
}

function sameRenderRulerOverlayInputs(a: ViewerRenderSnapshot, b: ViewerRenderSnapshot): boolean {
  if (!a.rulersVisible && !b.rulersVisible) {
    return true;
  }

  return (
    a.rulersVisible === b.rulersVisible &&
    samePaneRenderSourcesBy(a.paneRenderSources, b.paneRenderSources, samePaneRulerOverlayInput)
  );
}

function samePaneRenderSources(a: readonly ViewerPaneRenderSource[], b: readonly ViewerPaneRenderSource[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((source, index) => {
    const other = b[index];
    return Boolean(other) &&
      samePanePath(source.path, other.path) &&
      source.active === other.active &&
      source.session.id === other.session.id &&
      source.session.decoded === other.session.decoded &&
      source.activeLayer === other.activeLayer &&
      source.layer === other.layer &&
      sameViewerRenderState(source.renderState, other.renderState) &&
      source.colormapLut === other.colormapLut;
  });
}

function samePaneResourceInputs(
  a: readonly ViewerPaneRenderSource[],
  b: readonly ViewerPaneRenderSource[]
): boolean {
  return samePaneRenderSourcesBy(a, b, (source, other) => (
    source.renderState.visualizationMode === other.renderState.visualizationMode &&
    sameDisplaySelection(source.renderState.displaySelection, other.renderState.displaySelection)
  ));
}

function samePaneRenderSourcesBy(
  a: readonly ViewerPaneRenderSource[],
  b: readonly ViewerPaneRenderSource[],
  compareInput: (a: ViewerPaneRenderSource, b: ViewerPaneRenderSource) => boolean
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((source, index) => {
    const other = b[index];
    return Boolean(other) && samePaneRenderSourceShell(source, other) && compareInput(source, other);
  });
}

function samePaneRenderSourceShell(a: ViewerPaneRenderSource, b: ViewerPaneRenderSource): boolean {
  return (
    samePanePath(a.path, b.path) &&
    a.session.id === b.session.id &&
    a.session.decoded === b.session.decoded &&
    a.activeLayer === b.activeLayer &&
    a.layer === b.layer
  );
}

function samePaneImageInput(a: ViewerPaneRenderSource, b: ViewerPaneRenderSource): boolean {
  const previous = a.renderState;
  const next = b.renderState;
  const sharesCommonInputs = (
    previous.viewerMode === next.viewerMode &&
    previous.exposureEv === next.exposureEv &&
    previous.displayGamma === next.displayGamma &&
    sameDisplaySelection(previous.displaySelection, next.displaySelection) &&
    previous.visualizationMode === next.visualizationMode &&
    sameViewState(previous, next)
  );
  if (!sharesCommonInputs) {
    return false;
  }

  if (next.visualizationMode !== 'colormap') {
    return true;
  }

  return (
    previous.activeColormapId === next.activeColormapId &&
    sameDisplayLuminanceRange(previous.colormapRange, next.colormapRange) &&
    previous.colormapRangeMode === next.colormapRangeMode &&
    previous.colormapZeroCentered === next.colormapZeroCentered &&
    previous.stokesDegreeModulation.aolp === next.stokesDegreeModulation.aolp &&
    previous.stokesDegreeModulation.cop === next.stokesDegreeModulation.cop &&
    previous.stokesDegreeModulation.top === next.stokesDegreeModulation.top &&
    previous.stokesAolpDegreeModulationMode === next.stokesAolpDegreeModulationMode &&
    a.colormapLut === b.colormapLut
  );
}

function samePaneValueOverlayInput(a: ViewerPaneRenderSource, b: ViewerPaneRenderSource): boolean {
  const previous = a.renderState;
  const next = b.renderState;
  return (
    previous.viewerMode === next.viewerMode &&
    sameDisplaySelection(previous.displaySelection, next.displaySelection) &&
    sameViewState(previous, next)
  );
}

function samePaneProbeOverlayInput(a: ViewerPaneRenderSource, b: ViewerPaneRenderSource): boolean {
  const previous = a.renderState;
  const next = b.renderState;
  return (
    previous.viewerMode === next.viewerMode &&
    samePixel(previous.lockedPixel, next.lockedPixel) &&
    samePixel(previous.hoveredPixel, next.hoveredPixel) &&
    sameRoi(previous.roi, next.roi) &&
    sameRoi(previous.draftRoi, next.draftRoi) &&
    sameRoiInteractionState(previous.roiInteraction, next.roiInteraction) &&
    sameViewState(previous, next)
  );
}

function samePaneRulerOverlayInput(a: ViewerPaneRenderSource, b: ViewerPaneRenderSource): boolean {
  return a.renderState.viewerMode === b.renderState.viewerMode && sameViewState(a.renderState, b.renderState);
}

function sameViewerRenderState(a: ViewerRenderState, b: ViewerRenderState): boolean {
  return (
    a.exposureEv === b.exposureEv &&
    a.displayGamma === b.displayGamma &&
    a.viewerMode === b.viewerMode &&
    a.visualizationMode === b.visualizationMode &&
    a.activeColormapId === b.activeColormapId &&
    sameDisplayLuminanceRange(a.colormapRange, b.colormapRange) &&
    a.colormapRangeMode === b.colormapRangeMode &&
    a.colormapZeroCentered === b.colormapZeroCentered &&
    a.stokesDegreeModulation.aolp === b.stokesDegreeModulation.aolp &&
    a.stokesDegreeModulation.cop === b.stokesDegreeModulation.cop &&
    a.stokesDegreeModulation.top === b.stokesDegreeModulation.top &&
    a.stokesAolpDegreeModulationMode === b.stokesAolpDegreeModulationMode &&
    a.activeLayer === b.activeLayer &&
    sameDisplaySelection(a.displaySelection, b.displaySelection) &&
    samePixel(a.lockedPixel, b.lockedPixel) &&
    sameViewState(a, b) &&
    samePixel(a.hoveredPixel, b.hoveredPixel) &&
    sameRoi(a.roi, b.roi) &&
    sameRoi(a.draftRoi, b.draftRoi) &&
    sameRoiInteractionState(a.roiInteraction, b.roiInteraction)
  );
}

function stateLikeSessionState(): ViewerAppState['sessionState'] {
  return {
    exposureEv: 0,
    channelThumbnailExposureEv: 0,
    displayGamma: DEFAULT_DISPLAY_GAMMA,
    channelThumbnailDisplayGamma: DEFAULT_DISPLAY_GAMMA,
    viewerMode: 'image',
    visualizationMode: 'rgb',
    activeColormapId: '0',
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    colormapZeroCentered: false,
    stokesDegreeModulation: { aolp: false, cop: false, top: false },
    stokesAolpDegreeModulationMode: 'value',
    zoom: 1,
    panX: 0,
    panY: 0,
    panoramaYawDeg: 0,
    panoramaPitchDeg: 0,
    panoramaHfovDeg: 100,
    activeLayer: 0,
    displaySelection: null,
    lockedPixel: null,
    roi: null
  };
}

function stateLikeInteractionState(): ViewerAppState['interactionState'] {
  return {
    view: {
      zoom: 1,
      panX: 0,
      panY: 0,
      panoramaYawDeg: 0,
    panoramaPitchDeg: 0,
    panoramaHfovDeg: 100
    },
    hoveredPixel: null,
    draftRoi: null,
    roiInteraction: createEmptyRoiInteractionState()
  };
}
