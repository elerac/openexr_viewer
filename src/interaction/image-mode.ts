import type { ViewerState, ViewportInfo } from '../types';
import type { PointerPosition } from './shared';
import { zoomAroundPoint } from './image-geometry';

export function zoomImageFromWheel(
  state: ViewerState,
  viewport: ViewportInfo,
  point: PointerPosition,
  deltaY: number
): Pick<ViewerState, 'zoom' | 'panX' | 'panY'> {
  const zoomFactor = Math.exp(-deltaY * 0.0015);
  const requestedZoom = state.zoom * zoomFactor;
  return zoomAroundPoint(state, viewport, point.x, point.y, requestedZoom);
}

export function panImageFromDrag(
  state: ViewerState,
  deltaX: number,
  deltaY: number
): Pick<
  ViewerState,
  'zoom' | 'panX' | 'panY' | 'panoramaYawDeg' | 'panoramaPitchDeg' | 'panoramaHfovDeg'
> {
  return {
    zoom: state.zoom,
    panX: state.panX - deltaX / state.zoom,
    panY: state.panY - deltaY / state.zoom,
    panoramaYawDeg: state.panoramaYawDeg,
    panoramaPitchDeg: state.panoramaPitchDeg,
    panoramaHfovDeg: state.panoramaHfovDeg
  };
}
