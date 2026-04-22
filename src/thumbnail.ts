import { linearToSrgbByte } from './color';
import { isMonoSelection } from './display-model';
import {
  readDisplaySelectionPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator,
  type DisplayPixelValues
} from './display-texture';
import { DecodedExrImage, DecodedLayer, ViewerSessionState } from './types';

const OPENED_IMAGE_THUMBNAIL_SIZE = 40;
const THUMBNAIL_STATS_MAX_SAMPLES = 4096;
const THUMBNAIL_CHECKER_DARK = 23;
const THUMBNAIL_CHECKER_LIGHT = 31;

export interface OpenedImageThumbnailPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createOpenedImageThumbnailDataUrl(
  decoded: DecodedExrImage,
  state: ViewerSessionState
): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const layer = decoded.layers[state.activeLayer] ?? null;
  if (!layer || decoded.width <= 0 || decoded.height <= 0) {
    return null;
  }

  try {
    const pixels = buildOpenedImageThumbnailPixels(
      layer,
      decoded.width,
      decoded.height,
      state
    );

    return createOpenedImageThumbnailDataUrlFromPixels(pixels);
  } catch {
    return null;
  }
}

export function buildOpenedImageThumbnailPixels(
  layer: DecodedLayer,
  width: number,
  height: number,
  state: ViewerSessionState
): OpenedImageThumbnailPixels {
  const thumbnailSize = OPENED_IMAGE_THUMBNAIL_SIZE;
  const thumbnailData = new Uint8ClampedArray(thumbnailSize * thumbnailSize * 4);
  const fitScale = Math.min(thumbnailSize / width, thumbnailSize / height);
  const fittedWidth = Math.max(1, Math.round(width * fitScale));
  const fittedHeight = Math.max(1, Math.round(height * fitScale));
  const offsetX = Math.floor((thumbnailSize - fittedWidth) / 2);
  const offsetY = Math.floor((thumbnailSize - fittedHeight) / 2);
  const scalarThumbnail = isMonoSelection(state.displaySelection);
  const evaluator = resolveDisplaySelectionEvaluator(layer, state.displaySelection);
  const sample = createThumbnailSample();
  const stats = computeThumbnailStats(evaluator, width, height, scalarThumbnail, sample);
  const exposureScale = Math.pow(2, state.exposureEv);

  for (let y = 0; y < thumbnailSize; y += 1) {
    for (let x = 0; x < thumbnailSize; x += 1) {
      const outIndex = (y * thumbnailSize + x) * 4;
      const checker = ((Math.floor(x / 5) + Math.floor(y / 5)) % 2) === 0
        ? THUMBNAIL_CHECKER_DARK
        : THUMBNAIL_CHECKER_LIGHT;
      thumbnailData[outIndex + 0] = checker;
      thumbnailData[outIndex + 1] = checker;
      thumbnailData[outIndex + 2] = checker;
      thumbnailData[outIndex + 3] = 255;

      if (
        x < offsetX ||
        y < offsetY ||
        x >= offsetX + fittedWidth ||
        y >= offsetY + fittedHeight
      ) {
        continue;
      }

      const sourceX = Math.min(
        width - 1,
        Math.max(0, Math.floor(((x - offsetX + 0.5) / fittedWidth) * width))
      );
      const sourceY = Math.min(
        height - 1,
        Math.max(0, Math.floor(((y - offsetY + 0.5) / fittedHeight) * height))
      );
      const sourceIndex = sourceY * width + sourceX;
      readDisplaySelectionPixelValuesAtIndex(evaluator, sourceIndex, sample);
      const alpha = clamp01(sample.a);

      let r = sample.r;
      let g = sample.g;
      let b = sample.b;

      if (scalarThumbnail && stats.scalarMax > stats.scalarMin) {
        const value = clamp01((r - stats.scalarMin) / (stats.scalarMax - stats.scalarMin));
        r = value;
        g = value;
        b = value;
      } else {
        const scale = (stats.rgbMax > 1 ? 1 / stats.rgbMax : 1) * exposureScale;
        r *= scale;
        g *= scale;
        b *= scale;
      }

      const srgbR = linearToSrgbByte(r);
      const srgbG = linearToSrgbByte(g);
      const srgbB = linearToSrgbByte(b);

      thumbnailData[outIndex + 0] = Math.round(srgbR * alpha + checker * (1 - alpha));
      thumbnailData[outIndex + 1] = Math.round(srgbG * alpha + checker * (1 - alpha));
      thumbnailData[outIndex + 2] = Math.round(srgbB * alpha + checker * (1 - alpha));
      thumbnailData[outIndex + 3] = 255;
    }
  }

  return {
    width: thumbnailSize,
    height: thumbnailSize,
    data: thumbnailData
  };
}

export function createOpenedImageThumbnailDataUrlFromPixels(
  pixels: OpenedImageThumbnailPixels
): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  return canvas.toDataURL('image/png');
}

function computeThumbnailStats(
  evaluator: ReturnType<typeof resolveDisplaySelectionEvaluator>,
  width: number,
  height: number,
  scalarThumbnail: boolean,
  sample: DisplayPixelValues
): { scalarMin: number; scalarMax: number; rgbMax: number } {
  const pixelCount = width * height;
  const sampleStep = Math.max(1, Math.floor(pixelCount / THUMBNAIL_STATS_MAX_SAMPLES));
  let scalarMin = Number.POSITIVE_INFINITY;
  let scalarMax = Number.NEGATIVE_INFINITY;
  let rgbMax = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += sampleStep) {
    readDisplaySelectionPixelValuesAtIndex(evaluator, pixelIndex, sample);
    const r = sample.r;
    const g = sample.g;
    const b = sample.b;

    if (scalarThumbnail && Number.isFinite(r)) {
      scalarMin = Math.min(scalarMin, r);
      scalarMax = Math.max(scalarMax, r);
    }

    if (Number.isFinite(r) && r > rgbMax) {
      rgbMax = r;
    }
    if (Number.isFinite(g) && g > rgbMax) {
      rgbMax = g;
    }
    if (Number.isFinite(b) && b > rgbMax) {
      rgbMax = b;
    }
  }

  return {
    scalarMin: Number.isFinite(scalarMin) ? scalarMin : 0,
    scalarMax: Number.isFinite(scalarMax) ? scalarMax : 0,
    rgbMax: Math.max(rgbMax, 1e-6)
  };
}

function createThumbnailSample(): DisplayPixelValues {
  return {
    r: 0,
    g: 0,
    b: 0,
    a: 0
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
