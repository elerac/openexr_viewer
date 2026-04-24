import type { ImagePixel, ViewerState, ViewportInfo } from '../types';
import { screenToImage } from './image-geometry';
import { screenToPanoramaPixel } from './panorama-geometry';
import type { ImageSize, PointerPosition } from './shared';

export function resolveProbePixel(
  point: PointerPosition,
  state: ViewerState,
  viewport: ViewportInfo,
  imageSize: ImageSize
): ImagePixel | null {
  return state.viewerMode === 'panorama'
    ? screenToPanoramaPixel(point.x, point.y, state, viewport, imageSize.width, imageSize.height)
    : screenToImage(point.x, point.y, state, viewport, imageSize.width, imageSize.height);
}

export function resolveHoverPixel(
  lastPointerInElement: PointerPosition | null,
  state: ViewerState,
  viewport: ViewportInfo,
  imageSize: ImageSize
): ImagePixel | null {
  if (!lastPointerInElement) {
    return null;
  }

  return resolveProbePixel(lastPointerInElement, state, viewport, imageSize);
}
