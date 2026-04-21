import { linearToSrgbByte } from './color';
import { isMonoSelection } from './display-model';
import { buildSelectedDisplayTexture } from './display-texture';
import { DecodedExrImage, ViewerState } from './types';

const OPENED_IMAGE_THUMBNAIL_SIZE = 40;
const THUMBNAIL_STATS_MAX_SAMPLES = 4096;
const THUMBNAIL_CHECKER_DARK = 23;
const THUMBNAIL_CHECKER_LIGHT = 31;

export function createOpenedImageThumbnailDataUrl(
  decoded: DecodedExrImage,
  state: ViewerState
): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const layer = decoded.layers[state.activeLayer] ?? null;
  if (!layer || decoded.width <= 0 || decoded.height <= 0) {
    return null;
  }

  try {
    const displayTexture = buildSelectedDisplayTexture(
      layer,
      decoded.width,
      decoded.height,
      state.displaySelection
    );

    return createOpenedImageThumbnailDataUrlFromDisplayTexture(
      displayTexture,
      decoded.width,
      decoded.height,
      state
    );
  } catch {
    return null;
  }
}

export function createOpenedImageThumbnailDataUrlFromDisplayTexture(
  displayTexture: Float32Array,
  width: number,
  height: number,
  state: ViewerState
): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = OPENED_IMAGE_THUMBNAIL_SIZE;
  canvas.height = OPENED_IMAGE_THUMBNAIL_SIZE;

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  const thumbnailSize = OPENED_IMAGE_THUMBNAIL_SIZE;
  const imageData = context.createImageData(thumbnailSize, thumbnailSize);
  const fitScale = Math.min(thumbnailSize / width, thumbnailSize / height);
  const fittedWidth = Math.max(1, Math.round(width * fitScale));
  const fittedHeight = Math.max(1, Math.round(height * fitScale));
  const offsetX = Math.floor((thumbnailSize - fittedWidth) / 2);
  const offsetY = Math.floor((thumbnailSize - fittedHeight) / 2);
  const scalarThumbnail = isMonoSelection(state.displaySelection);
  const stats = computeThumbnailStats(displayTexture, scalarThumbnail);
  const exposureScale = Math.pow(2, state.exposureEv);

  for (let y = 0; y < thumbnailSize; y += 1) {
    for (let x = 0; x < thumbnailSize; x += 1) {
      const outIndex = (y * thumbnailSize + x) * 4;
      const checker = ((Math.floor(x / 5) + Math.floor(y / 5)) % 2) === 0
        ? THUMBNAIL_CHECKER_DARK
        : THUMBNAIL_CHECKER_LIGHT;
      imageData.data[outIndex + 0] = checker;
      imageData.data[outIndex + 1] = checker;
      imageData.data[outIndex + 2] = checker;
      imageData.data[outIndex + 3] = 255;

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
      const sourceIndex = (sourceY * width + sourceX) * 4;
      const alpha = clamp01(displayTexture[sourceIndex + 3]);

      let r = displayTexture[sourceIndex + 0];
      let g = displayTexture[sourceIndex + 1];
      let b = displayTexture[sourceIndex + 2];

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

      imageData.data[outIndex + 0] = Math.round(srgbR * alpha + checker * (1 - alpha));
      imageData.data[outIndex + 1] = Math.round(srgbG * alpha + checker * (1 - alpha));
      imageData.data[outIndex + 2] = Math.round(srgbB * alpha + checker * (1 - alpha));
      imageData.data[outIndex + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function computeThumbnailStats(
  displayTexture: Float32Array,
  scalarThumbnail: boolean
): { scalarMin: number; scalarMax: number; rgbMax: number } {
  const pixelCount = displayTexture.length / 4;
  const sampleStep = Math.max(1, Math.floor(pixelCount / THUMBNAIL_STATS_MAX_SAMPLES));
  let scalarMin = Number.POSITIVE_INFINITY;
  let scalarMax = Number.NEGATIVE_INFINITY;
  let rgbMax = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += sampleStep) {
    const textureIndex = pixelIndex * 4;
    const r = displayTexture[textureIndex + 0];
    const g = displayTexture[textureIndex + 1];
    const b = displayTexture[textureIndex + 2];

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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
