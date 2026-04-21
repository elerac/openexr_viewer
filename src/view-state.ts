import type {
  ImagePixel,
  ViewerInteractionState,
  ViewerRenderState,
  ViewerSessionState,
  ViewerViewState
} from './types';

export function pickViewState(state: ViewerViewState): ViewerViewState {
  return {
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    panoramaYawDeg: state.panoramaYawDeg,
    panoramaPitchDeg: state.panoramaPitchDeg,
    panoramaHfovDeg: state.panoramaHfovDeg
  };
}

export function createInteractionState(sessionState: ViewerSessionState): ViewerInteractionState {
  return {
    view: pickViewState(sessionState),
    hoveredPixel: null
  };
}

export function mergeRenderState(
  sessionState: ViewerSessionState,
  interactionState: ViewerInteractionState
): ViewerRenderState {
  return {
    ...sessionState,
    ...interactionState.view,
    hoveredPixel: interactionState.hoveredPixel
  };
}

export function sameViewState(a: ViewerViewState, b: ViewerViewState): boolean {
  return (
    a.zoom === b.zoom &&
    a.panX === b.panX &&
    a.panY === b.panY &&
    a.panoramaYawDeg === b.panoramaYawDeg &&
    a.panoramaPitchDeg === b.panoramaPitchDeg &&
    a.panoramaHfovDeg === b.panoramaHfovDeg
  );
}

export function samePixel(a: ImagePixel | null | undefined, b: ImagePixel | null | undefined): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.ix === b.ix && a.iy === b.iy;
}
