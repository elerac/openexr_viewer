import { computeRec709Luminance, linearToSrgbByte } from './color';
import {
  mapValueToColormapRgbBytes,
  modulateRgbBytesHsv,
  type ColormapLut
} from './colormaps';
import {
  cloneDisplaySelection,
  isMonoSelection,
  selectionUsesImageAlpha,
  type DisplaySelection,
  type StokesAolpDegreeModulationMode,
  type StokesDegreeModulationState
} from './display-model';
import {
  readDisplaySelectionPixelValuesAtIndex,
  readDisplaySelectionSnapshotPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator,
  type DisplayPixelValues
} from './display-texture';
import { isStokesDegreeModulationEnabled, resolveStokesDegreeModulationMode } from './stokes';
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
  stokesAolpDegreeModulationMode?: StokesAolpDegreeModulationMode;
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
  maxEdge = OPENED_IMAGE_THUMBNAIL_SIZE,
  preview: ThumbnailPreviewOptions | null = null
): OpenedImageThumbnailPixels {
  const { width: thumbnailWidth, height: thumbnailHeight } = resolveThumbnailDimensions(
    width,
    height,
    maxEdge
  );
  const thumbnailData = new Uint8ClampedArray(thumbnailWidth * thumbnailHeight * 4);
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
  const stokesDegreeModulationMode = resolveStokesDegreeModulationMode(
    effectiveSelection,
    colormapPreview?.stokesAolpDegreeModulationMode ?? state.stokesAolpDegreeModulationMode
  );

  for (let y = 0; y < thumbnailHeight; y += 1) {
    for (let x = 0; x < thumbnailWidth; x += 1) {
      const outIndex = (y * thumbnailWidth + x) * 4;

      const sourceX = Math.min(
        width - 1,
        Math.max(0, Math.floor(((x + 0.5) / thumbnailWidth) * width))
      );
      const sourceY = Math.min(
        height - 1,
        Math.max(0, Math.floor(((y + 0.5) / thumbnailHeight) * height))
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
          rgb = modulateRgbBytesHsv(rgb, sample.a, stokesDegreeModulationMode);
        }

        const alpha = useImageAlpha ? clamp01(sample.a) : 1;
        thumbnailData[outIndex + 0] = rgb[0];
        thumbnailData[outIndex + 1] = rgb[1];
        thumbnailData[outIndex + 2] = rgb[2];
        thumbnailData[outIndex + 3] = Math.round(alpha * 255);
      } else {
        readDisplaySelectionPixelValuesAtIndex(evaluator, sourceIndex, sample);
        const alpha = useImageAlpha ? clamp01(sample.a) : 1;

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

        thumbnailData[outIndex + 0] = srgbR;
        thumbnailData[outIndex + 1] = srgbG;
        thumbnailData[outIndex + 2] = srgbB;
        thumbnailData[outIndex + 3] = Math.round(alpha * 255);
      }
    }
  }

  return {
    width: thumbnailWidth,
    height: thumbnailHeight,
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

  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
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

function resolveThumbnailDimensions(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const resolvedMaxEdge = Math.max(1, Math.round(maxEdge));
  if (width >= height) {
    return {
      width: resolvedMaxEdge,
      height: Math.max(1, Math.round((resolvedMaxEdge * height) / width))
    };
  }

  return {
    width: Math.max(1, Math.round((resolvedMaxEdge * width) / height)),
    height: resolvedMaxEdge
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
