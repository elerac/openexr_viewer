import { buildDisplayLuminanceRevisionKey } from '../display-texture';
import { sameDisplayLuminanceRange } from '../colormap-range';
import { sameDisplaySelection } from '../display-model';
import { mergeRenderState, samePixel, sameRoi, sameViewState } from '../view-state';
import type { OpenedImageSession, ViewerRenderState } from '../types';
import { buildProbeReadoutModel } from './probe-presentation';
import { buildRoiReadoutModel } from './roi-presentation';
import {
  sameDisplayRangeRequest,
  sameProbeReadout,
  sameRoiReadout,
  sameResourceTarget
} from './viewer-app-equality';
import { selectActiveSession } from './viewer-app-selectors';
import type {
  ViewerAppState,
  ViewerDisplayRangeRequest,
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
  RenderProbeOverlay = 1 << 8
}

export function createViewerRenderSnapshotSelector(): (state: ViewerAppState) => ViewerRenderSnapshot {
  const selectRenderState = createRenderStateSelector();
  const selectProbeReadout = createProbeReadoutSelector();
  const selectRoiReadout = createRoiReadoutSelector();
  const selectResourceTarget = createResourceTargetSelector();
  const selectDisplayRangeRequest = createDisplayRangeRequestSelector();

  let previousSnapshot: ViewerRenderSnapshot | null = null;
  return (state) => {
    const activeSession = selectActiveSession(state);
    const activeLayer = activeSession?.decoded.layers[state.sessionState.activeLayer] ?? null;

    const nextSnapshot: ViewerRenderSnapshot = {
      activeSession,
      activeLayer,
      renderState: selectRenderState(state),
      activeColormapLut: state.activeColormapLut,
      probeReadout: selectProbeReadout(state, activeSession, activeLayer),
      roiReadout: selectRoiReadout(state, activeSession, activeLayer),
      resourceTarget: selectResourceTarget(state, activeSession),
      displayRangeRequest: selectDisplayRangeRequest(state, activeSession, activeLayer)
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

  if (previous.activeColormapLut !== next.activeColormapLut && next.activeColormapLut) {
    flags |= ViewerRenderInvalidationFlags.ColormapTexture;
  }

  if (!sameProbeReadout(previous.probeReadout, next.probeReadout)) {
    flags |= ViewerRenderInvalidationFlags.ProbeReadout;
  }

  if (!sameRoiReadout(previous.roiReadout, next.roiReadout)) {
    flags |= ViewerRenderInvalidationFlags.RoiReadout;
  }

  if (!sameResourceTarget(previous.resourceTarget, next.resourceTarget) && next.resourceTarget) {
    flags |= ViewerRenderInvalidationFlags.ResourcePrepare;
  }

  if (!sameDisplayRangeRequest(previous.displayRangeRequest, next.displayRangeRequest) && next.displayRangeRequest) {
    flags |= ViewerRenderInvalidationFlags.ResourceRequestDisplayRange;
  }

  if (previous.activeSession && !next.activeSession) {
    flags |= ViewerRenderInvalidationFlags.ResourceClearImage;
  }

  if (next.activeSession && next.activeLayer && !sameRenderImageInputs(previous, next)) {
    flags |= ViewerRenderInvalidationFlags.RenderImage;
  }

  if (next.activeSession && next.activeLayer && !sameRenderValueOverlayInputs(previous, next)) {
    flags |= ViewerRenderInvalidationFlags.RenderValueOverlay;
  }

  if (next.activeSession && next.activeLayer && !sameRenderProbeOverlayInputs(previous, next)) {
    flags |= ViewerRenderInvalidationFlags.RenderProbeOverlay;
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
  let previousVisualizationMode: ViewerAppState['sessionState']['visualizationMode'] = 'rgb';
  let previousColormapRange: ViewerAppState['sessionState']['colormapRange'] = null;
  let previousActiveDisplayLuminanceRange: ViewerAppState['activeDisplayLuminanceRange'] = null;
  let previousActiveColormapLut: ViewerAppState['activeColormapLut'] = null;
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
    const depsMatch =
      sessionId === previousSessionId &&
      activeLayer === previousLayer &&
      width === previousWidth &&
      height === previousHeight &&
      samePixel(state.sessionState.lockedPixel, previousLockedPixel) &&
      samePixel(state.interactionState.hoveredPixel, previousHoveredPixel) &&
      sameDisplaySelection(state.sessionState.displaySelection, previousDisplaySelection) &&
      state.sessionState.exposureEv === previousExposureEv &&
      state.sessionState.visualizationMode === previousVisualizationMode &&
      (
        !usesColormap || (
          sameDisplayLuminanceRange(state.sessionState.colormapRange, previousColormapRange) &&
          sameDisplayLuminanceRange(state.activeDisplayLuminanceRange, previousActiveDisplayLuminanceRange) &&
          state.activeColormapLut === previousActiveColormapLut &&
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
    previousVisualizationMode = state.sessionState.visualizationMode;
    previousColormapRange = state.sessionState.colormapRange;
    previousActiveDisplayLuminanceRange = state.activeDisplayLuminanceRange;
    previousActiveColormapLut = state.activeColormapLut;
    previousStokesDegreeModulation = nextStokesDegreeModulation;
    previousStokesAolpDegreeModulationMode = state.sessionState.stokesAolpDegreeModulationMode;
    previousResult = buildProbeReadoutModel({
      activeSession,
      activeLayer,
      sessionState: state.sessionState,
      interactionState: state.interactionState,
      activeColormapLut: state.activeColormapLut,
      activeDisplayLuminanceRange: state.activeDisplayLuminanceRange
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

function sameViewerRenderSnapshot(a: ViewerRenderSnapshot, b: ViewerRenderSnapshot): boolean {
  return (
    a.activeSession?.id === b.activeSession?.id &&
    a.activeLayer === b.activeLayer &&
    sameViewerRenderState(a.renderState, b.renderState) &&
    a.activeColormapLut === b.activeColormapLut &&
    sameProbeReadout(a.probeReadout, b.probeReadout) &&
    sameRoiReadout(a.roiReadout, b.roiReadout) &&
    sameResourceTarget(a.resourceTarget, b.resourceTarget) &&
    sameDisplayRangeRequest(a.displayRangeRequest, b.displayRangeRequest)
  );
}

function sameRenderImageInputs(a: ViewerRenderSnapshot, b: ViewerRenderSnapshot): boolean {
  const previous = a.renderState;
  const next = b.renderState;
  const sharesCommonInputs = (
    a.activeSession?.id === b.activeSession?.id &&
    a.activeSession?.decoded === b.activeSession?.decoded &&
    previous.viewerMode === next.viewerMode &&
    previous.exposureEv === next.exposureEv &&
    previous.activeLayer === next.activeLayer &&
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
    a.activeColormapLut === b.activeColormapLut
  );
}

function sameRenderValueOverlayInputs(a: ViewerRenderSnapshot, b: ViewerRenderSnapshot): boolean {
  const previous = a.renderState;
  const next = b.renderState;
  return (
    a.activeSession?.id === b.activeSession?.id &&
    a.activeSession?.decoded === b.activeSession?.decoded &&
    previous.viewerMode === next.viewerMode &&
    previous.activeLayer === next.activeLayer &&
    sameDisplaySelection(previous.displaySelection, next.displaySelection) &&
    sameViewState(previous, next)
  );
}

function sameRenderProbeOverlayInputs(a: ViewerRenderSnapshot, b: ViewerRenderSnapshot): boolean {
  const previous = a.renderState;
  const next = b.renderState;
  return (
    a.activeSession?.id === b.activeSession?.id &&
    a.activeSession?.decoded === b.activeSession?.decoded &&
    previous.viewerMode === next.viewerMode &&
    previous.activeLayer === next.activeLayer &&
    samePixel(previous.lockedPixel, next.lockedPixel) &&
    samePixel(previous.hoveredPixel, next.hoveredPixel) &&
    sameRoi(previous.roi, next.roi) &&
    sameRoi(previous.draftRoi, next.draftRoi) &&
    sameViewState(previous, next)
  );
}

function sameViewerRenderState(a: ViewerRenderState, b: ViewerRenderState): boolean {
  return (
    a.exposureEv === b.exposureEv &&
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
    sameRoi(a.draftRoi, b.draftRoi)
  );
}

function stateLikeSessionState(): ViewerAppState['sessionState'] {
  return {
    exposureEv: 0,
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
    draftRoi: null
  };
}
