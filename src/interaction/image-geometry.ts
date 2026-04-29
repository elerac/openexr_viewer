import type { ImagePixel, ViewerState, ViewerViewState, ViewportInfo, ViewportInsets } from '../types';

export const MIN_ZOOM = 0.03125;
export const MAX_ZOOM = 512;

export interface ViewportClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const FIT_VIEW_EPSILON = 1e-6;

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

export function computeFitView(
  viewport: ViewportInfo,
  width: number,
  height: number,
  fitInsets?: Partial<ViewportInsets> | null
): { zoom: number; panX: number; panY: number } {
  const fitArea = resolveFitArea(viewport, fitInsets);
  const fitZoom = clampZoom(Math.min(fitArea.width / width, fitArea.height / height));

  return {
    zoom: fitZoom,
    panX: width * 0.5 + (viewport.width * 0.5 - fitArea.centerX) / fitZoom,
    panY: height * 0.5 + (viewport.height * 0.5 - fitArea.centerY) / fitZoom
  };
}

export function isFitViewForViewport(
  view: Pick<ViewerViewState, 'zoom' | 'panX' | 'panY'>,
  viewport: ViewportInfo,
  width: number,
  height: number,
  fitInsets?: Partial<ViewportInsets> | null
): boolean {
  const fitView = computeFitView(viewport, width, height, fitInsets);
  return (
    Math.abs(view.zoom - fitView.zoom) <= FIT_VIEW_EPSILON &&
    Math.abs(view.panX - fitView.panX) <= FIT_VIEW_EPSILON &&
    Math.abs(view.panY - fitView.panY) <= FIT_VIEW_EPSILON
  );
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

function resolveFitArea(
  viewport: ViewportInfo,
  fitInsets?: Partial<ViewportInsets> | null
): { width: number; height: number; centerX: number; centerY: number } {
  const left = sanitizeInset(fitInsets?.left);
  const right = sanitizeInset(fitInsets?.right);
  const top = sanitizeInset(fitInsets?.top);
  const bottom = sanitizeInset(fitInsets?.bottom);
  const horizontal = resolveInsetAxis(viewport.width, left, right);
  const vertical = resolveInsetAxis(viewport.height, top, bottom);

  return {
    width: horizontal.size,
    height: vertical.size,
    centerX: horizontal.center,
    centerY: vertical.center
  };
}

function resolveInsetAxis(
  viewportSize: number,
  leadingInset: number,
  trailingInset: number
): { size: number; center: number } {
  const size = Math.max(1, Number.isFinite(viewportSize) ? viewportSize : 1);
  const totalInset = leadingInset + trailingInset;
  if (totalInset >= size) {
    const scale = totalInset > 0 ? (size - 1) / totalInset : 0;
    const leading = leadingInset * scale;
    return {
      size: 1,
      center: leading + 0.5
    };
  }

  const availableSize = size - totalInset;
  return {
    size: availableSize,
    center: leadingInset + availableSize * 0.5
  };
}

function sanitizeInset(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
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
