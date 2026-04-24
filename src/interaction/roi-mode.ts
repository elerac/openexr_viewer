import { createImageRoiFromPixels, getImageRoiPixelCount } from '../roi';
import type { ImagePixel, ViewerState, ViewportInfo } from '../types';
import { screenToImage, screenToImageClamped } from './image-geometry';
import type { ImageSize, PointerPosition } from './shared';

export function resolveRoiAnchorPixel(
  point: PointerPosition,
  state: ViewerState,
  viewport: ViewportInfo,
  imageSize: ImageSize
): ImagePixel | null {
  return screenToImage(point.x, point.y, state, viewport, imageSize.width, imageSize.height);
}

export function createDraftRoiFromAnchor(anchorPixel: ImagePixel): ViewerState['draftRoi'] {
  return createImageRoiFromPixels(anchorPixel, anchorPixel);
}

export function updateDraftRoiFromDrag(
  anchorPixel: ImagePixel,
  point: PointerPosition,
  state: ViewerState,
  viewport: ViewportInfo,
  imageSize: ImageSize
): ViewerState['draftRoi'] {
  const targetPixel = screenToImageClamped(
    point.x,
    point.y,
    state,
    viewport,
    imageSize.width,
    imageSize.height
  );

  return targetPixel ? createImageRoiFromPixels(anchorPixel, targetPixel) : null;
}

export function commitRoiFromDrag(
  anchorPixel: ImagePixel,
  point: PointerPosition,
  state: ViewerState,
  viewport: ViewportInfo,
  imageSize: ImageSize
): ViewerState['roi'] {
  const targetPixel = screenToImageClamped(
    point.x,
    point.y,
    state,
    viewport,
    imageSize.width,
    imageSize.height
  ) ?? anchorPixel;
  const roi = createImageRoiFromPixels(anchorPixel, targetPixel);
  return getImageRoiPixelCount(roi) === 1 ? null : roi;
}
