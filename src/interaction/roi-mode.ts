import {
  clampImageRoiToBounds,
  createImageRoiFromPixels,
  getImageRoiHeight,
  getImageRoiPixelCount,
  getImageRoiWidth,
  normalizeImageRoi
} from '../roi';
import type {
  ImagePixel,
  ImageRoi,
  RoiAdjustmentHandle,
  ViewerRoiInteractionState,
  ViewerState,
  ViewportInfo
} from '../types';
import { imageToScreen, screenToImage, screenToImageClamped } from './image-geometry';
import type { ImageSize, PointerPosition } from './shared';

const ROI_ADJUSTMENT_HANDLE_HIT_RADIUS = 8;
const ROI_MIN_SIZE = 1;

interface RoiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type RoiResizeHandle = Exclude<RoiAdjustmentHandle, 'move'>;
type ResizeAxisEdge = 'start' | 'end' | null;

export interface RoiAdjustmentDrag {
  handle: RoiAdjustmentHandle;
  startPoint: PointerPosition;
  startRoi: ImageRoi;
  startRect: RoiRect;
}

export interface RoiAdjustmentDragOptions {
  preserveAspectRatio?: boolean;
  resizeFromCenter?: boolean;
}

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

export function createRoiAdjustmentDrag(
  handle: RoiAdjustmentHandle,
  startPoint: PointerPosition,
  roi: ImageRoi
): RoiAdjustmentDrag {
  const normalized = normalizeImageRoi(roi);
  return {
    handle,
    startPoint,
    startRoi: normalized,
    startRect: roiToRect(normalized)
  };
}

export function createRoiInteractionState(
  overrides: Partial<ViewerRoiInteractionState> = {}
): ViewerRoiInteractionState {
  return {
    hoverHandle: null,
    activeHandle: null,
    ...overrides
  };
}

export function resolveRoiAdjustmentHandle(
  point: PointerPosition,
  roi: ImageRoi,
  state: ViewerState,
  viewport: ViewportInfo
): RoiAdjustmentHandle | null {
  const rect = getRoiScreenRect(roi, state, viewport);
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const nearLeft = Math.abs(point.x - left) <= ROI_ADJUSTMENT_HANDLE_HIT_RADIUS;
  const nearRight = Math.abs(point.x - right) <= ROI_ADJUSTMENT_HANDLE_HIT_RADIUS;
  const nearTop = Math.abs(point.y - top) <= ROI_ADJUSTMENT_HANDLE_HIT_RADIUS;
  const nearBottom = Math.abs(point.y - bottom) <= ROI_ADJUSTMENT_HANDLE_HIT_RADIUS;
  const withinHorizontal =
    point.x >= left - ROI_ADJUSTMENT_HANDLE_HIT_RADIUS &&
    point.x <= right + ROI_ADJUSTMENT_HANDLE_HIT_RADIUS;
  const withinVertical =
    point.y >= top - ROI_ADJUSTMENT_HANDLE_HIT_RADIUS &&
    point.y <= bottom + ROI_ADJUSTMENT_HANDLE_HIT_RADIUS;

  if (nearLeft && nearTop) {
    return 'corner-nw';
  }
  if (nearRight && nearTop) {
    return 'corner-ne';
  }
  if (nearRight && nearBottom) {
    return 'corner-se';
  }
  if (nearLeft && nearBottom) {
    return 'corner-sw';
  }
  if (nearTop && withinHorizontal) {
    return 'edge-n';
  }
  if (nearRight && withinVertical) {
    return 'edge-e';
  }
  if (nearBottom && withinHorizontal) {
    return 'edge-s';
  }
  if (nearLeft && withinVertical) {
    return 'edge-w';
  }
  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
    return 'move';
  }

  return null;
}

export function updateRoiFromAdjustmentDrag(
  drag: RoiAdjustmentDrag,
  point: PointerPosition,
  state: ViewerState,
  imageSize: ImageSize,
  options: RoiAdjustmentDragOptions = {}
): ImageRoi {
  const deltaX = (point.x - drag.startPoint.x) / sanitizeZoom(state.zoom);
  const deltaY = (point.y - drag.startPoint.y) / sanitizeZoom(state.zoom);

  if (drag.handle === 'move') {
    return rectToRoi(clampRoiRect({
      ...drag.startRect,
      x: drag.startRect.x + deltaX,
      y: drag.startRect.y + deltaY
    }, imageSize), imageSize);
  }

  return rectToRoi(resizeRoiRect(
    drag.startRect,
    drag.handle,
    deltaX,
    deltaY,
    imageSize,
    options
  ), imageSize);
}

function getRoiScreenRect(
  roi: ImageRoi,
  state: ViewerState,
  viewport: ViewportInfo
): RoiRect {
  const normalized = normalizeImageRoi(roi);
  const topLeft = imageToScreen(normalized.x0, normalized.y0, state, viewport);
  const bottomRight = imageToScreen(normalized.x1 + 1, normalized.y1 + 1, state, viewport);
  return {
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y),
    width: Math.abs(bottomRight.x - topLeft.x),
    height: Math.abs(bottomRight.y - topLeft.y)
  };
}

function roiToRect(roi: ImageRoi): RoiRect {
  return {
    x: roi.x0,
    y: roi.y0,
    width: getImageRoiWidth(roi),
    height: getImageRoiHeight(roi)
  };
}

function rectToRoi(rect: RoiRect, imageSize: ImageSize): ImageRoi {
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const x1 = Math.round(rect.x + rect.width) - 1;
  const y1 = Math.round(rect.y + rect.height) - 1;
  return clampImageRoiToBounds({ x0, y0, x1, y1 }, imageSize.width, imageSize.height) ?? {
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0
  };
}

function resizeRoiRect(
  rect: RoiRect,
  handle: RoiResizeHandle,
  deltaX: number,
  deltaY: number,
  imageSize: ImageSize,
  options: RoiAdjustmentDragOptions
): RoiRect {
  if (options.preserveAspectRatio) {
    return options.resizeFromCenter
      ? resizeRoiRectFromCenterWithAspectRatio(rect, handle, deltaX, deltaY, imageSize)
      : resizeRoiRectWithAspectRatio(rect, handle, deltaX, deltaY, imageSize);
  }

  return options.resizeFromCenter
    ? resizeRoiRectFromCenter(rect, handle, deltaX, deltaY, imageSize)
    : resizeRoiRectFromFixedEdge(rect, handle, deltaX, deltaY, imageSize);
}

function resizeRoiRectFromFixedEdge(
  rect: RoiRect,
  handle: RoiResizeHandle,
  deltaX: number,
  deltaY: number,
  imageSize: ImageSize
): RoiRect {
  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.height;

  if (handle === 'edge-w' || handle === 'corner-nw' || handle === 'corner-sw') {
    left = clamp(rect.x + deltaX, 0, right - ROI_MIN_SIZE);
  }
  if (handle === 'edge-e' || handle === 'corner-ne' || handle === 'corner-se') {
    right = clamp(rect.x + rect.width + deltaX, left + ROI_MIN_SIZE, imageSize.width);
  }
  if (handle === 'edge-n' || handle === 'corner-nw' || handle === 'corner-ne') {
    top = clamp(rect.y + deltaY, 0, bottom - ROI_MIN_SIZE);
  }
  if (handle === 'edge-s' || handle === 'corner-sw' || handle === 'corner-se') {
    bottom = clamp(rect.y + rect.height + deltaY, top + ROI_MIN_SIZE, imageSize.height);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function resizeRoiRectFromCenter(
  rect: RoiRect,
  handle: RoiResizeHandle,
  deltaX: number,
  deltaY: number,
  imageSize: ImageSize
): RoiRect {
  const centerX = rect.x + rect.width * 0.5;
  const centerY = rect.y + rect.height * 0.5;
  const horizontalEdge = resolveHorizontalResizeEdge(handle);
  const verticalEdge = resolveVerticalResizeEdge(handle);
  const rawWidth = horizontalEdge === 'start'
    ? rect.width - 2 * deltaX
    : horizontalEdge === 'end'
      ? rect.width + 2 * deltaX
      : rect.width;
  const rawHeight = verticalEdge === 'start'
    ? rect.height - 2 * deltaY
    : verticalEdge === 'end'
      ? rect.height + 2 * deltaY
      : rect.height;
  const width = clamp(rawWidth, ROI_MIN_SIZE, getCenteredMaxSize(centerX, imageSize.width));
  const height = clamp(rawHeight, ROI_MIN_SIZE, getCenteredMaxSize(centerY, imageSize.height));

  return createRectFromCenter(centerX, centerY, width, height);
}

function resizeRoiRectWithAspectRatio(
  rect: RoiRect,
  handle: RoiResizeHandle,
  deltaX: number,
  deltaY: number,
  imageSize: ImageSize
): RoiRect {
  const aspectRatio = rect.width / rect.height;
  if (handle === 'corner-nw' || handle === 'corner-ne' || handle === 'corner-se' || handle === 'corner-sw') {
    return resizeRoiCornerWithAspectRatio(rect, handle, deltaX, deltaY, imageSize, aspectRatio);
  }

  return resizeRoiEdgeWithAspectRatio(rect, handle, deltaX, deltaY, imageSize, aspectRatio);
}

function resizeRoiRectFromCenterWithAspectRatio(
  rect: RoiRect,
  handle: RoiResizeHandle,
  deltaX: number,
  deltaY: number,
  imageSize: ImageSize
): RoiRect {
  const centerX = rect.x + rect.width * 0.5;
  const centerY = rect.y + rect.height * 0.5;
  const aspectRatio = rect.width / rect.height;
  const horizontalEdge = resolveHorizontalResizeEdge(handle);
  const verticalEdge = resolveVerticalResizeEdge(handle);
  const rawWidth = horizontalEdge === 'start'
    ? rect.width - 2 * deltaX
    : horizontalEdge === 'end'
      ? rect.width + 2 * deltaX
      : rect.width;
  const rawHeight = verticalEdge === 'start'
    ? rect.height - 2 * deltaY
    : verticalEdge === 'end'
      ? rect.height + 2 * deltaY
      : rect.height;
  const widthDrive = horizontalEdge !== null && (
    verticalEdge === null ||
    Math.abs(deltaX / Math.max(rect.width, Number.EPSILON))
      >= Math.abs(deltaY / Math.max(rect.height, Number.EPSILON))
  );
  const size = chooseAspectLockedSize({
    rawWidth,
    rawHeight,
    maxWidth: getCenteredMaxSize(centerX, imageSize.width),
    maxHeight: getCenteredMaxSize(centerY, imageSize.height),
    aspectRatio,
    widthDrive
  });

  return createRectFromCenter(centerX, centerY, size.width, size.height);
}

function resizeRoiCornerWithAspectRatio(
  rect: RoiRect,
  handle: 'corner-nw' | 'corner-ne' | 'corner-se' | 'corner-sw',
  deltaX: number,
  deltaY: number,
  imageSize: ImageSize,
  aspectRatio: number
): RoiRect {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const maxWidth = handle === 'corner-nw' || handle === 'corner-sw' ? right : imageSize.width - left;
  const maxHeight = handle === 'corner-nw' || handle === 'corner-ne' ? bottom : imageSize.height - top;
  const rawWidth = handle === 'corner-nw' || handle === 'corner-sw'
    ? rect.width - deltaX
    : rect.width + deltaX;
  const rawHeight = handle === 'corner-nw' || handle === 'corner-ne'
    ? rect.height - deltaY
    : rect.height + deltaY;
  const widthDrive = Math.abs(deltaX / Math.max(rect.width, Number.EPSILON))
    >= Math.abs(deltaY / Math.max(rect.height, Number.EPSILON));
  const size = chooseAspectLockedSize({
    rawWidth,
    rawHeight,
    maxWidth,
    maxHeight,
    aspectRatio,
    widthDrive
  });

  if (handle === 'corner-nw') {
    return { x: right - size.width, y: bottom - size.height, ...size };
  }
  if (handle === 'corner-ne') {
    return { x: left, y: bottom - size.height, ...size };
  }
  if (handle === 'corner-se') {
    return { x: left, y: top, ...size };
  }

  return { x: right - size.width, y: top, ...size };
}

function resizeRoiEdgeWithAspectRatio(
  rect: RoiRect,
  handle: 'edge-n' | 'edge-e' | 'edge-s' | 'edge-w',
  deltaX: number,
  deltaY: number,
  imageSize: ImageSize,
  aspectRatio: number
): RoiRect {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const centerX = rect.x + rect.width * 0.5;
  const centerY = rect.y + rect.height * 0.5;

  if (handle === 'edge-e' || handle === 'edge-w') {
    const maxWidth = handle === 'edge-w' ? right : imageSize.width - left;
    const rawWidth = handle === 'edge-w' ? rect.width - deltaX : rect.width + deltaX;
    const size = chooseAspectLockedSize({
      rawWidth,
      rawHeight: rawWidth / aspectRatio,
      maxWidth,
      maxHeight: imageSize.height,
      aspectRatio,
      widthDrive: true
    });
    const x = handle === 'edge-w' ? right - size.width : left;
    const y = clamp(centerY - size.height * 0.5, 0, imageSize.height - size.height);
    return { x, y, ...size };
  }

  const maxHeight = handle === 'edge-n' ? bottom : imageSize.height - top;
  const rawHeight = handle === 'edge-n' ? rect.height - deltaY : rect.height + deltaY;
  const size = chooseAspectLockedSize({
    rawWidth: rawHeight * aspectRatio,
    rawHeight,
    maxWidth: imageSize.width,
    maxHeight,
    aspectRatio,
    widthDrive: false
  });
  const x = clamp(centerX - size.width * 0.5, 0, imageSize.width - size.width);
  const y = handle === 'edge-n' ? bottom - size.height : top;
  return { x, y, ...size };
}

function chooseAspectLockedSize({
  rawWidth,
  rawHeight,
  maxWidth,
  maxHeight,
  aspectRatio,
  widthDrive
}: {
  rawWidth: number;
  rawHeight: number;
  maxWidth: number;
  maxHeight: number;
  aspectRatio: number;
  widthDrive: boolean;
}): Pick<RoiRect, 'width' | 'height'> {
  if (widthDrive) {
    const minWidth = Math.max(ROI_MIN_SIZE, ROI_MIN_SIZE * aspectRatio);
    const width = clamp(rawWidth, minWidth, Math.max(minWidth, Math.min(maxWidth, maxHeight * aspectRatio)));
    return { width, height: width / aspectRatio };
  }

  const minHeight = Math.max(ROI_MIN_SIZE, ROI_MIN_SIZE / aspectRatio);
  const height = clamp(rawHeight, minHeight, Math.max(minHeight, Math.min(maxHeight, maxWidth / aspectRatio)));
  return { width: height * aspectRatio, height };
}

function resolveHorizontalResizeEdge(handle: RoiResizeHandle): ResizeAxisEdge {
  if (handle === 'edge-w' || handle === 'corner-nw' || handle === 'corner-sw') {
    return 'start';
  }
  if (handle === 'edge-e' || handle === 'corner-ne' || handle === 'corner-se') {
    return 'end';
  }
  return null;
}

function resolveVerticalResizeEdge(handle: RoiResizeHandle): ResizeAxisEdge {
  if (handle === 'edge-n' || handle === 'corner-nw' || handle === 'corner-ne') {
    return 'start';
  }
  if (handle === 'edge-s' || handle === 'corner-sw' || handle === 'corner-se') {
    return 'end';
  }
  return null;
}

function clampRoiRect(rect: RoiRect, imageSize: ImageSize): RoiRect {
  const width = clamp(rect.width, ROI_MIN_SIZE, imageSize.width);
  const height = clamp(rect.height, ROI_MIN_SIZE, imageSize.height);
  return {
    x: clamp(rect.x, 0, imageSize.width - width),
    y: clamp(rect.y, 0, imageSize.height - height),
    width,
    height
  };
}

function createRectFromCenter(centerX: number, centerY: number, width: number, height: number): RoiRect {
  return {
    x: centerX - width * 0.5,
    y: centerY - height * 0.5,
    width,
    height
  };
}

function getCenteredMaxSize(center: number, imageSize: number): number {
  return 2 * Math.min(center, imageSize - center);
}

function sanitizeZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
