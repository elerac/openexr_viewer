import { DEFAULT_PANORAMA_HFOV_DEG, clampZoom } from '../interaction';
import { cloneDisplayLuminanceRange } from '../colormap-range';
import { cloneDisplaySelection } from '../display-model';
import {
  buildSessionDisplayName,
  cloneViewerSessionState
} from '../session-state';
import { createDefaultStokesDegreeModulation } from '../stokes';
import type {
  DecodedExrImage,
  ImagePixel,
  OpenedImageSession,
  SessionSource,
  ViewerSessionState,
  ViewportInfo
} from '../types';
import { buildViewerStateForLayer } from '../viewer-store';

export interface BuildLoadedSessionArgs {
  sessionId: string;
  decoded: DecodedExrImage;
  filename: string;
  fileSizeBytes: number | null;
  source: SessionSource;
  existingSessions: OpenedImageSession[];
  defaultColormapId: string;
  viewport: ViewportInfo;
  currentSessionState: ViewerSessionState;
  hasActiveSession: boolean;
  previousImage: DecodedExrImage | null;
}

export function buildLoadedSession(args: BuildLoadedSessionArgs): OpenedImageSession {
  const fitView = computeFitView(args.viewport, args.decoded.width, args.decoded.height);
  const displayName = buildSessionDisplayName(
    args.filename,
    args.existingSessions.map((session) => session.filename)
  );
  const defaultSessionState = buildViewerStateForLayer(
    {
      ...createClearedViewerState(args.defaultColormapId),
      zoom: fitView.zoom,
      panX: fitView.panX,
      panY: fitView.panY
    },
    args.decoded,
    0
  );
  const baseSession: OpenedImageSession = {
    id: args.sessionId,
    filename: args.filename,
    displayName,
    fileSizeBytes: args.fileSizeBytes,
    source: args.source,
    decoded: args.decoded,
    state: defaultSessionState
  };
  const sessionState = args.hasActiveSession
    ? buildSwitchedSessionState(baseSession, args.currentSessionState, args.previousImage)
    : defaultSessionState;

  return {
    ...baseSession,
    state: sessionState
  };
}

export function buildReloadedSession(
  session: OpenedImageSession,
  decoded: DecodedExrImage,
  baseState: ViewerSessionState
): OpenedImageSession {
  return {
    ...session,
    decoded,
    state: buildReloadedSessionState(baseState, session.decoded, decoded)
  };
}

export function createClearedViewerState(defaultColormapId: string): ViewerSessionState {
  return {
    exposureEv: 0,
    viewerMode: 'image',
    visualizationMode: 'rgb',
    activeColormapId: defaultColormapId,
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    colormapZeroCentered: false,
    stokesDegreeModulation: createDefaultStokesDegreeModulation(),
    zoom: 1,
    panX: 0,
    panY: 0,
    panoramaYawDeg: 0,
    panoramaPitchDeg: 0,
    panoramaHfovDeg: DEFAULT_PANORAMA_HFOV_DEG,
    activeLayer: 0,
    displaySelection: null,
    lockedPixel: null
  };
}

export function buildReloadedSessionState(
  currentState: ViewerSessionState,
  previousImage: DecodedExrImage,
  decoded: DecodedExrImage
): ViewerSessionState {
  const lockedPixel = currentState.lockedPixel
    ? clampPixelToImageBounds(currentState.lockedPixel, decoded.width, decoded.height)
    : null;
  const nextImageCamera = currentState.viewerMode === 'image'
    ? {
        zoom: currentState.zoom,
        ...remapPanToImageCenterAnchor(
          currentState.panX,
          currentState.panY,
          previousImage,
          decoded
        )
      }
    : {
        zoom: currentState.zoom,
        panX: currentState.panX,
        panY: currentState.panY
      };

  return buildViewerStateForLayer(
    {
      ...currentState,
      ...nextImageCamera,
      lockedPixel
    },
    decoded,
    currentState.activeLayer
  );
}

export function buildSwitchedSessionState(
  nextSession: OpenedImageSession,
  currentState: ViewerSessionState,
  previousImage: DecodedExrImage | null
): ViewerSessionState {
  const lockedPixel = currentState.lockedPixel
    ? clampPixelToImageBounds(currentState.lockedPixel, nextSession.decoded.width, nextSession.decoded.height)
    : null;
  const nextImageCamera = currentState.viewerMode === 'image'
    ? {
        zoom: currentState.zoom,
        ...remapPanToImageCenterAnchor(
          currentState.panX,
          currentState.panY,
          previousImage,
          nextSession.decoded
        )
      }
    : {
        zoom: nextSession.state.zoom,
        panX: nextSession.state.panX,
        panY: nextSession.state.panY
      };
  const nextPanoramaCamera = currentState.viewerMode === 'panorama'
    ? {
        panoramaYawDeg: currentState.panoramaYawDeg,
        panoramaPitchDeg: currentState.panoramaPitchDeg,
        panoramaHfovDeg: currentState.panoramaHfovDeg
      }
    : {
        panoramaYawDeg: nextSession.state.panoramaYawDeg,
        panoramaPitchDeg: nextSession.state.panoramaPitchDeg,
        panoramaHfovDeg: nextSession.state.panoramaHfovDeg
      };

  return buildViewerStateForLayer(
    {
      ...cloneViewerSessionState(nextSession.state),
      viewerMode: currentState.viewerMode,
      ...nextImageCamera,
      ...nextPanoramaCamera,
      exposureEv: currentState.exposureEv,
      displaySelection: cloneDisplaySelection(currentState.displaySelection),
      visualizationMode: currentState.visualizationMode,
      activeColormapId: currentState.activeColormapId,
      colormapRange: cloneDisplayLuminanceRange(currentState.colormapRange),
      colormapRangeMode: currentState.colormapRangeMode,
      colormapZeroCentered: currentState.colormapZeroCentered,
      stokesDegreeModulation: { ...currentState.stokesDegreeModulation },
      lockedPixel
    },
    nextSession.decoded,
    nextSession.state.activeLayer
  );
}

export function buildResetSessionState(
  activeSession: OpenedImageSession | null,
  currentState: ViewerSessionState,
  defaultColormapId: string,
  viewport: ViewportInfo
): ViewerSessionState {
  if (!activeSession) {
    return createClearedViewerState(defaultColormapId);
  }

  const fitView = computeFitView(viewport, activeSession.decoded.width, activeSession.decoded.height);
  return buildViewerStateForLayer(
    {
      ...createClearedViewerState(defaultColormapId),
      viewerMode: currentState.viewerMode,
      zoom: fitView.zoom,
      panX: fitView.panX,
      panY: fitView.panY
    },
    activeSession.decoded,
    0
  );
}

export function computeFitView(
  viewport: ViewportInfo,
  width: number,
  height: number
): { zoom: number; panX: number; panY: number } {
  const fitZoom = clampZoom(Math.min(viewport.width / width, viewport.height / height));

  return {
    zoom: fitZoom,
    panX: width * 0.5,
    panY: height * 0.5
  };
}

function remapPanToImageCenterAnchor(
  panX: number,
  panY: number,
  previousImage: DecodedExrImage | null,
  nextImage: DecodedExrImage
): { panX: number; panY: number } {
  if (!previousImage) {
    return { panX, panY };
  }

  const previousCenterX = previousImage.width * 0.5;
  const previousCenterY = previousImage.height * 0.5;
  const nextCenterX = nextImage.width * 0.5;
  const nextCenterY = nextImage.height * 0.5;

  return {
    panX: nextCenterX + (panX - previousCenterX),
    panY: nextCenterY + (panY - previousCenterY)
  };
}

function clampPixelToImageBounds(pixel: ImagePixel, width: number, height: number): ImagePixel | null {
  if (pixel.ix < 0 || pixel.iy < 0 || pixel.ix >= width || pixel.iy >= height) {
    return null;
  }

  return {
    ix: pixel.ix,
    iy: pixel.iy
  };
}
