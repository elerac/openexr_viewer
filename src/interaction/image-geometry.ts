import type { ImagePixel, ViewerState, ViewerViewState, ViewportInfo } from '../types';

export const MIN_ZOOM = 0.125;
export const MAX_ZOOM = 512;

export interface ViewportClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function exposureToScale(exposureEv: number): number {
  return 2 ** exposureEv;
}

export function screenToImage(
  screenX: number,
  screenY: number,
  state: ViewerState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): ImagePixel | null {
  const imageX = state.panX + (screenX - viewport.width * 0.5) / state.zoom;
  const imageY = state.panY + (screenY - viewport.height * 0.5) / state.zoom;

  const ix = Math.floor(imageX);
  const iy = Math.floor(imageY);

  if (ix < 0 || iy < 0 || ix >= imageWidth || iy >= imageHeight) {
    return null;
  }

  return { ix, iy };
}

export function screenToImageClamped(
  screenX: number,
  screenY: number,
  state: ViewerState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): ImagePixel | null {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  const imageX = state.panX + (screenX - viewport.width * 0.5) / state.zoom;
  const imageY = state.panY + (screenY - viewport.height * 0.5) / state.zoom;

  return {
    ix: Math.min(imageWidth - 1, Math.max(0, Math.floor(imageX))),
    iy: Math.min(imageHeight - 1, Math.max(0, Math.floor(imageY)))
  };
}

export function imageToScreen(
  imageX: number,
  imageY: number,
  state: ViewerState,
  viewport: ViewportInfo
): { x: number; y: number } {
  return {
    x: (imageX - state.panX) * state.zoom + viewport.width * 0.5,
    y: (imageY - state.panY) * state.zoom + viewport.height * 0.5
  };
}

export function preserveImagePanOnViewportChange(
  state: Pick<ViewerViewState, 'zoom' | 'panX' | 'panY'>,
  previousViewport: ViewportClientRect,
  nextViewport: ViewportClientRect
): { panX: number; panY: number } {
  if (!Number.isFinite(state.zoom) || state.zoom <= 0) {
    return {
      panX: state.panX,
      panY: state.panY
    };
  }

  const previousCenterX = previousViewport.left + previousViewport.width * 0.5;
  const previousCenterY = previousViewport.top + previousViewport.height * 0.5;
  const nextCenterX = nextViewport.left + nextViewport.width * 0.5;
  const nextCenterY = nextViewport.top + nextViewport.height * 0.5;

  return {
    panX: state.panX + (nextCenterX - previousCenterX) / state.zoom,
    panY: state.panY + (nextCenterY - previousCenterY) / state.zoom
  };
}

export function zoomAroundPoint(
  state: ViewerState,
  viewport: ViewportInfo,
  screenX: number,
  screenY: number,
  requestedZoom: number
): { zoom: number; panX: number; panY: number } {
  const zoom = clampZoom(requestedZoom);
  const imageX = state.panX + (screenX - viewport.width * 0.5) / state.zoom;
  const imageY = state.panY + (screenY - viewport.height * 0.5) / state.zoom;

  return {
    zoom,
    panX: imageX - (screenX - viewport.width * 0.5) / zoom,
    panY: imageY - (screenY - viewport.height * 0.5) / zoom
  };
}
