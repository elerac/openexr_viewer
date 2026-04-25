import type { ViewportInfo, ViewportRect } from '../types';
import type { PointerPosition } from './shared';

export const SCREENSHOT_SELECTION_MIN_SIZE = 16;
export const SCREENSHOT_SELECTION_SQUARE_SNAP_THRESHOLD = 12;

const DEFAULT_SELECTION_VIEWPORT_RATIO = 0.7;
const HANDLE_HIT_RADIUS = 8;

export type ScreenshotSelectionHandle =
  | 'move'
  | 'edge-n'
  | 'edge-e'
  | 'edge-s'
  | 'edge-w'
  | 'corner-nw'
  | 'corner-ne'
  | 'corner-se'
  | 'corner-sw';

export interface ScreenshotSelectionDrag {
  handle: ScreenshotSelectionHandle;
  startPoint: PointerPosition;
  startRect: ViewportRect;
}

export interface ScreenshotSelectionDragUpdate {
  rect: ViewportRect;
  squareSnapped: boolean;
}

export interface ScreenshotSelectionDragOptions {
  preserveAspectRatio?: boolean;
}

export function createDefaultScreenshotSelectionRect(viewport: ViewportInfo): ViewportRect {
  const width = Math.max(1, viewport.width * DEFAULT_SELECTION_VIEWPORT_RATIO);
  const height = Math.max(1, viewport.height * DEFAULT_SELECTION_VIEWPORT_RATIO);
  return clampScreenshotSelectionRect({
    x: (viewport.width - width) * 0.5,
    y: (viewport.height - height) * 0.5,
    width,
    height
  }, viewport);
}

export function clampScreenshotSelectionRect(
  rect: ViewportRect,
  viewport: ViewportInfo
): ViewportRect {
  const maxWidth = Math.max(1, viewport.width);
  const maxHeight = Math.max(1, viewport.height);
  const minWidth = Math.min(SCREENSHOT_SELECTION_MIN_SIZE, maxWidth);
  const minHeight = Math.min(SCREENSHOT_SELECTION_MIN_SIZE, maxHeight);
  const width = Math.min(maxWidth, Math.max(minWidth, sanitizeDimension(rect.width, minWidth)));
  const height = Math.min(maxHeight, Math.max(minHeight, sanitizeDimension(rect.height, minHeight)));
  return {
    x: clamp(sanitizeCoordinate(rect.x), 0, maxWidth - width),
    y: clamp(sanitizeCoordinate(rect.y), 0, maxHeight - height),
    width,
    height
  };
}

export function resolveScreenshotSelectionHandle(
  point: PointerPosition,
  rect: ViewportRect
): ScreenshotSelectionHandle | null {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const nearLeft = Math.abs(point.x - left) <= HANDLE_HIT_RADIUS;
  const nearRight = Math.abs(point.x - right) <= HANDLE_HIT_RADIUS;
  const nearTop = Math.abs(point.y - top) <= HANDLE_HIT_RADIUS;
  const nearBottom = Math.abs(point.y - bottom) <= HANDLE_HIT_RADIUS;
  const withinHorizontal = point.x >= left - HANDLE_HIT_RADIUS && point.x <= right + HANDLE_HIT_RADIUS;
  const withinVertical = point.y >= top - HANDLE_HIT_RADIUS && point.y <= bottom + HANDLE_HIT_RADIUS;

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

export function updateScreenshotSelectionRectFromDrag(
  drag: ScreenshotSelectionDrag,
  point: PointerPosition,
  viewport: ViewportInfo,
  options: ScreenshotSelectionDragOptions = {}
): ScreenshotSelectionDragUpdate {
  const deltaX = point.x - drag.startPoint.x;
  const deltaY = point.y - drag.startPoint.y;
  if (drag.handle === 'move') {
    return {
      rect: clampScreenshotSelectionRect({
        ...drag.startRect,
        x: drag.startRect.x + deltaX,
        y: drag.startRect.y + deltaY
      }, viewport),
      squareSnapped: false
    };
  }

  return resizeScreenshotSelectionRect(
    drag.startRect,
    drag.handle,
    deltaX,
    deltaY,
    viewport,
    options
  );
}

function resizeScreenshotSelectionRect(
  rect: ViewportRect,
  handle: Exclude<ScreenshotSelectionHandle, 'move'>,
  deltaX: number,
  deltaY: number,
  viewport: ViewportInfo,
  options: ScreenshotSelectionDragOptions
): ScreenshotSelectionDragUpdate {
  const maxWidth = Math.max(1, viewport.width);
  const maxHeight = Math.max(1, viewport.height);
  const minWidth = Math.min(SCREENSHOT_SELECTION_MIN_SIZE, maxWidth);
  const minHeight = Math.min(SCREENSHOT_SELECTION_MIN_SIZE, maxHeight);
  const viewportBounds = { width: maxWidth, height: maxHeight };

  if (options.preserveAspectRatio) {
    return {
      rect: resizeScreenshotSelectionRectWithAspectRatio(
        rect,
        handle,
        deltaX,
        deltaY,
        viewportBounds,
        minWidth,
        minHeight
      ),
      squareSnapped: false
    };
  }

  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.height;

  if (handle === 'edge-w' || handle === 'corner-nw' || handle === 'corner-sw') {
    left = clamp(rect.x + deltaX, 0, right - minWidth);
  }
  if (handle === 'edge-e' || handle === 'corner-ne' || handle === 'corner-se') {
    right = clamp(rect.x + rect.width + deltaX, left + minWidth, maxWidth);
  }
  if (handle === 'edge-n' || handle === 'corner-nw' || handle === 'corner-ne') {
    top = clamp(rect.y + deltaY, 0, bottom - minHeight);
  }
  if (handle === 'edge-s' || handle === 'corner-sw' || handle === 'corner-se') {
    bottom = clamp(rect.y + rect.height + deltaY, top + minHeight, maxHeight);
  }

  const resizedRect = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
  const squareSnappedRect = snapScreenshotSelectionResizeToSquare(
    resizedRect,
    handle,
    viewportBounds,
    minWidth,
    minHeight
  );

  return squareSnappedRect
    ? { rect: squareSnappedRect, squareSnapped: true }
    : { rect: resizedRect, squareSnapped: false };
}

function resizeScreenshotSelectionRectWithAspectRatio(
  rect: ViewportRect,
  handle: Exclude<ScreenshotSelectionHandle, 'move'>,
  deltaX: number,
  deltaY: number,
  viewport: ViewportInfo,
  minWidth: number,
  minHeight: number
): ViewportRect {
  const aspectRatio = sanitizeDimension(rect.width, minWidth) / sanitizeDimension(rect.height, minHeight);
  if (handle === 'corner-nw' || handle === 'corner-ne' || handle === 'corner-se' || handle === 'corner-sw') {
    return resizeCornerWithAspectRatio(rect, handle, deltaX, deltaY, viewport, minWidth, minHeight, aspectRatio);
  }

  return resizeEdgeWithAspectRatio(rect, handle, deltaX, deltaY, viewport, minWidth, minHeight, aspectRatio);
}

function resizeCornerWithAspectRatio(
  rect: ViewportRect,
  handle: 'corner-nw' | 'corner-ne' | 'corner-se' | 'corner-sw',
  deltaX: number,
  deltaY: number,
  viewport: ViewportInfo,
  minWidth: number,
  minHeight: number,
  aspectRatio: number
): ViewportRect {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const maxWidth = handle === 'corner-nw' || handle === 'corner-sw' ? right : viewport.width - left;
  const maxHeight = handle === 'corner-nw' || handle === 'corner-ne' ? bottom : viewport.height - top;
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
    minWidth,
    minHeight,
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

function resizeEdgeWithAspectRatio(
  rect: ViewportRect,
  handle: 'edge-n' | 'edge-e' | 'edge-s' | 'edge-w',
  deltaX: number,
  deltaY: number,
  viewport: ViewportInfo,
  minWidth: number,
  minHeight: number,
  aspectRatio: number
): ViewportRect {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const centerX = rect.x + rect.width * 0.5;
  const centerY = rect.y + rect.height * 0.5;

  if (handle === 'edge-e' || handle === 'edge-w') {
    const maxWidth = handle === 'edge-w' ? right : viewport.width - left;
    const rawWidth = handle === 'edge-w' ? rect.width - deltaX : rect.width + deltaX;
    const size = chooseAspectLockedSize({
      rawWidth,
      rawHeight: rawWidth / aspectRatio,
      maxWidth,
      maxHeight: viewport.height,
      minWidth,
      minHeight,
      aspectRatio,
      widthDrive: true
    });
    const x = handle === 'edge-w' ? right - size.width : left;
    const y = clamp(centerY - size.height * 0.5, 0, viewport.height - size.height);
    return { x, y, ...size };
  }

  const maxHeight = handle === 'edge-n' ? bottom : viewport.height - top;
  const rawHeight = handle === 'edge-n' ? rect.height - deltaY : rect.height + deltaY;
  const size = chooseAspectLockedSize({
    rawWidth: rawHeight * aspectRatio,
    rawHeight,
    maxWidth: viewport.width,
    maxHeight,
    minWidth,
    minHeight,
    aspectRatio,
    widthDrive: false
  });
  const x = clamp(centerX - size.width * 0.5, 0, viewport.width - size.width);
  const y = handle === 'edge-n' ? bottom - size.height : top;
  return { x, y, ...size };
}

function chooseAspectLockedSize({
  rawWidth,
  rawHeight,
  maxWidth,
  maxHeight,
  minWidth,
  minHeight,
  aspectRatio,
  widthDrive
}: {
  rawWidth: number;
  rawHeight: number;
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
  aspectRatio: number;
  widthDrive: boolean;
}): Pick<ViewportRect, 'width' | 'height'> {
  if (widthDrive) {
    const width = clamp(
      rawWidth,
      Math.max(minWidth, minHeight * aspectRatio),
      Math.min(maxWidth, maxHeight * aspectRatio)
    );
    return { width, height: width / aspectRatio };
  }

  const height = clamp(
    rawHeight,
    Math.max(minHeight, minWidth / aspectRatio),
    Math.min(maxHeight, maxWidth / aspectRatio)
  );
  return { width: height * aspectRatio, height };
}

function snapScreenshotSelectionResizeToSquare(
  rect: ViewportRect,
  handle: Exclude<ScreenshotSelectionHandle, 'move'>,
  viewport: ViewportInfo,
  minWidth: number,
  minHeight: number
): ViewportRect | null {
  if (Math.abs(rect.width - rect.height) > SCREENSHOT_SELECTION_SQUARE_SNAP_THRESHOLD) {
    return null;
  }

  if (handle === 'corner-nw' || handle === 'corner-ne' || handle === 'corner-se' || handle === 'corner-sw') {
    return snapCornerResizeToSquare(rect, handle, viewport, minWidth, minHeight);
  }

  return snapEdgeResizeToSquare(rect, handle, viewport, minWidth, minHeight);
}

function snapCornerResizeToSquare(
  rect: ViewportRect,
  handle: 'corner-nw' | 'corner-ne' | 'corner-se' | 'corner-sw',
  viewport: ViewportInfo,
  minWidth: number,
  minHeight: number
): ViewportRect | null {
  const minSide = Math.max(minWidth, minHeight);

  if (handle === 'corner-nw') {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const side = chooseSquareSide(rect.width, rect.height, minSide, Math.min(right, bottom));
    return side === null ? null : { x: right - side, y: bottom - side, width: side, height: side };
  }

  if (handle === 'corner-ne') {
    const left = rect.x;
    const bottom = rect.y + rect.height;
    const side = chooseSquareSide(rect.width, rect.height, minSide, Math.min(viewport.width - left, bottom));
    return side === null ? null : { x: left, y: bottom - side, width: side, height: side };
  }

  if (handle === 'corner-se') {
    const left = rect.x;
    const top = rect.y;
    const side = chooseSquareSide(
      rect.width,
      rect.height,
      minSide,
      Math.min(viewport.width - left, viewport.height - top)
    );
    return side === null ? null : { x: left, y: top, width: side, height: side };
  }

  const right = rect.x + rect.width;
  const top = rect.y;
  const side = chooseSquareSide(rect.width, rect.height, minSide, Math.min(right, viewport.height - top));
  return side === null ? null : { x: right - side, y: top, width: side, height: side };
}

function snapEdgeResizeToSquare(
  rect: ViewportRect,
  handle: 'edge-n' | 'edge-e' | 'edge-s' | 'edge-w',
  viewport: ViewportInfo,
  minWidth: number,
  minHeight: number
): ViewportRect | null {
  if (handle === 'edge-e') {
    const side = rect.height;
    if (side < minWidth || rect.x + side > viewport.width) {
      return null;
    }

    return { ...rect, width: side };
  }

  if (handle === 'edge-w') {
    const side = rect.height;
    const right = rect.x + rect.width;
    if (side < minWidth || right - side < 0) {
      return null;
    }

    return { x: right - side, y: rect.y, width: side, height: rect.height };
  }

  if (handle === 'edge-s') {
    const side = rect.width;
    if (side < minHeight || rect.y + side > viewport.height) {
      return null;
    }

    return { ...rect, height: side };
  }

  const side = rect.width;
  const bottom = rect.y + rect.height;
  if (side < minHeight || bottom - side < 0) {
    return null;
  }

  return { x: rect.x, y: bottom - side, width: rect.width, height: side };
}

function chooseSquareSide(width: number, height: number, minSide: number, maxSide: number): number | null {
  if (maxSide < minSide) {
    return null;
  }

  return clamp((width + height) * 0.5, minSide, maxSide);
}

function sanitizeCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function sanitizeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
