import { computeRec709Luminance, linearToSrgbByte } from '../color';
import {
  mapValueToColormapRgbBytes,
  sampleColormapRgbBytes,
  modulateRgbBytesHsv,
  type ColormapLut
} from '../colormaps';
import { selectionUsesImageAlpha } from '../display-model';
import { isStokesDegreeModulationEnabled, resolveStokesDegreeModulationMode } from '../stokes';
import type { ExportColormapOrientation, ViewerSessionState } from '../types';

type ExportVisualizationState = Pick<
  ViewerSessionState,
  | 'colormapRange'
  | 'displaySelection'
  | 'exposureEv'
  | 'stokesAolpDegreeModulationMode'
  | 'stokesDegreeModulation'
  | 'visualizationMode'
>;

export interface ExportImagePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface BuildExportImagePixelsArgs {
  displayTexture: Float32Array;
  width: number;
  height: number;
  state: ExportVisualizationState;
  colormapLut: ColormapLut | null;
}

export interface BuildColormapExportPixelsArgs {
  lut: ColormapLut;
  width: number;
  height: number;
  orientation: ExportColormapOrientation;
}

export function buildExportImagePixels({
  displayTexture,
  width,
  height,
  state,
  colormapLut
}: BuildExportImagePixelsArgs): ExportImagePixels {
  const pixelCount = width * height;
  const data = new Uint8ClampedArray(pixelCount * 4);
  const useImageAlpha = selectionUsesImageAlpha(state.displaySelection);
  const useStokesDegreeModulation = isStokesDegreeModulationEnabled(
    state.displaySelection,
    state.stokesDegreeModulation
  );
  const stokesDegreeModulationMode = resolveStokesDegreeModulationMode(
    state.displaySelection,
    state.stokesAolpDegreeModulationMode
  );
  const exposureScale = 2 ** state.exposureEv;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const textureIndex = pixelIndex * 4;
    const outputIndex = textureIndex;
    const rawR = sanitizeDisplayValue(displayTexture[textureIndex + 0]);
    const rawG = sanitizeDisplayValue(displayTexture[textureIndex + 1]);
    const rawB = sanitizeDisplayValue(displayTexture[textureIndex + 2]);
    const rawAlpha = clampAlpha(displayTexture[textureIndex + 3]);

    let rgb: [number, number, number];
    if (state.visualizationMode === 'colormap') {
      rgb = mapValueToColormapRgbBytes(
        computeRec709Luminance(rawR, rawG, rawB),
        state.colormapRange,
        colormapLut
      );
      if (useStokesDegreeModulation) {
        rgb = modulateRgbBytesHsv(rgb, rawAlpha, stokesDegreeModulationMode);
      }
    } else {
      rgb = [
        linearToSrgbByte(rawR * exposureScale),
        linearToSrgbByte(rawG * exposureScale),
        linearToSrgbByte(rawB * exposureScale)
      ];
    }

    data[outputIndex + 0] = rgb[0];
    data[outputIndex + 1] = rgb[1];
    data[outputIndex + 2] = rgb[2];
    data[outputIndex + 3] = useImageAlpha ? Math.round(rawAlpha * 255) : 255;
  }

  return {
    width,
    height,
    data
  };
}

export function buildColormapExportPixels({
  lut,
  width,
  height,
  orientation
}: BuildColormapExportPixelsArgs): ExportImagePixels {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Colormap export dimensions must be positive integers.');
  }

  const pixelCount = width * height;
  const data = new Uint8ClampedArray(pixelCount * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const outputIndex = pixelIndex * 4;
      const t = orientation === 'horizontal'
        ? computeGradientPosition(x, width)
        : computeGradientPosition(height - 1 - y, height);
      const [r, g, b] = sampleColormapRgbBytes(lut, t);
      data[outputIndex + 0] = r;
      data[outputIndex + 1] = g;
      data[outputIndex + 2] = b;
      data[outputIndex + 3] = 255;
    }
  }

  return {
    width,
    height,
    data
  };
}

function sanitizeDisplayValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function computeGradientPosition(index: number, length: number): number {
  if (length <= 1) {
    return 0;
  }

  return index / (length - 1);
}
