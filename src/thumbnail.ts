import { computeRec709Luminance, linearToSrgbByte } from './color';
import {
  mapValueToColormapRgbBytes,
  modulateRgbBytesValue,
  type ColormapLut
} from './colormaps';
import {
  cloneDisplaySelection,
  isMonoSelection,
  selectionUsesImageAlpha,
  type DisplaySelection,
  type StokesDegreeModulationState
} from './display-model';
import {
  readDisplaySelectionPixelValuesAtIndex,
  readDisplaySelectionSnapshotPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator,
  type DisplayPixelValues
} from './display-texture';
import { isStokesDegreeModulationEnabled } from './stokes';
import {
  DecodedExrImage,
  DecodedLayer,
  DisplayLuminanceRange,
  ViewerSessionState,
  VisualizationMode
} from './types';

const OPENED_IMAGE_THUMBNAIL_SIZE = 40;
const CHANNEL_VIEW_THUMBNAIL_SIZE = 128;
const THUMBNAIL_STATS_MAX_SAMPLES = 4096;
const THUMBNAIL_CHECKER_DARK = 23;
const THUMBNAIL_CHECKER_LIGHT = 31;

export interface OpenedImageThumbnailPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ThumbnailPreviewOptions {
  visualizationMode: VisualizationMode;
  colormapRange: DisplayLuminanceRange | null;
  colormapLut: ColormapLut | null;
  stokesDegreeModulation: StokesDegreeModulationState;
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
    const pixels = buildDisplaySelectionThumbnailPixels(
      layer,
      decoded.width,
      decoded.height,
      state,
      state.displaySelection
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
  return buildDisplaySelectionThumbnailPixels(layer, width, height, state, state.displaySelection);
}

export function createChannelViewThumbnailDataUrl(
  decoded: DecodedExrImage,
  state: ViewerSessionState,
  selection: DisplaySelection,
  preview: ThumbnailPreviewOptions | null = null
): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const layer = decoded.layers[state.activeLayer] ?? null;
  if (!layer || decoded.width <= 0 || decoded.height <= 0) {
    return null;
  }

  try {
    const pixels = buildDisplaySelectionThumbnailPixels(
      layer,
      decoded.width,
      decoded.height,
      state,
      selection,
      CHANNEL_VIEW_THUMBNAIL_SIZE,
      preview
    );
    return createOpenedImageThumbnailDataUrlFromPixels(pixels);
  } catch {
    return null;
  }
}

export function buildDisplaySelectionThumbnailPixels(
  layer: DecodedLayer,
  width: number,
  height: number,
  state: ViewerSessionState,
  selection: DisplaySelection | null,
  outputSize = OPENED_IMAGE_THUMBNAIL_SIZE,
  preview: ThumbnailPreviewOptions | null = null
): OpenedImageThumbnailPixels {
  const thumbnailSize = Math.max(1, Math.round(outputSize));
  const thumbnailData = new Uint8ClampedArray(thumbnailSize * thumbnailSize * 4);
  const fitScale = Math.min(thumbnailSize / width, thumbnailSize / height);
  const fittedWidth = Math.max(1, Math.round(width * fitScale));
  const fittedHeight = Math.max(1, Math.round(height * fitScale));
  const offsetX = Math.floor((thumbnailSize - fittedWidth) / 2);
  const offsetY = Math.floor((thumbnailSize - fittedHeight) / 2);
  const effectiveSelection = cloneDisplaySelection(selection);
  const scalarThumbnail = isMonoSelection(effectiveSelection);
  const useColormapPreview = Boolean(
    preview?.visualizationMode === 'colormap' &&
    preview.colormapRange &&
    preview.colormapRange.max > preview.colormapRange.min &&
    preview.colormapLut
  );
  const colormapPreview = useColormapPreview ? preview : null;
  const evaluator = resolveDisplaySelectionEvaluator(
    layer,
    effectiveSelection,
    useColormapPreview ? 'colormap' : 'rgb'
  );
  const sample = createThumbnailSample();
  const stats = useColormapPreview
    ? null
    : computeThumbnailStats(evaluator, width, height, scalarThumbnail, sample);
  const exposureScale = Math.pow(2, state.exposureEv);
  const useImageAlpha = selectionUsesImageAlpha(effectiveSelection);
  const useStokesDegreeModulation = useColormapPreview &&
    isStokesDegreeModulationEnabled(effectiveSelection, colormapPreview!.stokesDegreeModulation);

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

      if (colormapPreview?.colormapRange && colormapPreview.colormapLut) {
        readDisplaySelectionSnapshotPixelValuesAtIndex(evaluator, sourceIndex, sample);
        let rgb = mapValueToColormapRgbBytes(
          computeRec709Luminance(sample.r, sample.g, sample.b),
          colormapPreview.colormapRange,
          colormapPreview.colormapLut
        );
        if (useStokesDegreeModulation) {
          rgb = modulateRgbBytesValue(rgb, sample.a);
        }

        const alpha = useImageAlpha ? clamp01(sample.a) : 1;
        thumbnailData[outIndex + 0] = Math.round(rgb[0] * alpha + checker * (1 - alpha));
        thumbnailData[outIndex + 1] = Math.round(rgb[1] * alpha + checker * (1 - alpha));
        thumbnailData[outIndex + 2] = Math.round(rgb[2] * alpha + checker * (1 - alpha));
      } else {
        readDisplaySelectionPixelValuesAtIndex(evaluator, sourceIndex, sample);
        const alpha = clamp01(sample.a);

        let r = sample.r;
        let g = sample.g;
        let b = sample.b;

        if (scalarThumbnail && stats && stats.scalarMax > stats.scalarMin) {
          const value = clamp01((r - stats.scalarMin) / (stats.scalarMax - stats.scalarMin));
          r = value;
          g = value;
          b = value;
        } else if (stats) {
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
      }
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
