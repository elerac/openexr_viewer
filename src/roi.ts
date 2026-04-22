import type { ImagePixel, ImageRoi } from './types';

export function normalizeImageRoi(roi: ImageRoi): ImageRoi {
  const x0 = Math.min(Math.floor(roi.x0), Math.floor(roi.x1));
  const y0 = Math.min(Math.floor(roi.y0), Math.floor(roi.y1));
  const x1 = Math.max(Math.floor(roi.x0), Math.floor(roi.x1));
  const y1 = Math.max(Math.floor(roi.y0), Math.floor(roi.y1));

  return { x0, y0, x1, y1 };
}

export function cloneImageRoi(roi: ImageRoi | null): ImageRoi | null {
  return roi ? { ...roi } : null;
}

export function sameImageRoi(a: ImageRoi | null | undefined, b: ImageRoi | null | undefined): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

export function clampImageRoiToBounds(
  roi: ImageRoi,
  width: number,
  height: number
): ImageRoi | null {
  if (width <= 0 || height <= 0) {
    return null;
  }

  const normalized = normalizeImageRoi(roi);
  if (normalized.x1 < 0 || normalized.y1 < 0 || normalized.x0 >= width || normalized.y0 >= height) {
    return null;
  }

  return normalizeImageRoi({
    x0: clampInclusive(normalized.x0, 0, width - 1),
    y0: clampInclusive(normalized.y0, 0, height - 1),
    x1: clampInclusive(normalized.x1, 0, width - 1),
    y1: clampInclusive(normalized.y1, 0, height - 1)
  });
}

export function createImageRoiFromPixels(anchor: ImagePixel, target: ImagePixel): ImageRoi {
  return normalizeImageRoi({
    x0: anchor.ix,
    y0: anchor.iy,
    x1: target.ix,
    y1: target.iy
  });
}

export function getImageRoiWidth(roi: ImageRoi): number {
  return roi.x1 - roi.x0 + 1;
}

export function getImageRoiHeight(roi: ImageRoi): number {
  return roi.y1 - roi.y0 + 1;
}

export function getImageRoiPixelCount(roi: ImageRoi): number {
  return getImageRoiWidth(roi) * getImageRoiHeight(roi);
}

function clampInclusive(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
