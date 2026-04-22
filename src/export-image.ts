import { computeRec709Luminance, linearToSrgbByte } from './color';
import {
  mapValueToColormapRgbBytes,
  modulateRgbBytesValue,
  type ColormapLut
} from './colormaps';
import { selectionUsesImageAlpha } from './display-model';
import { isStokesDegreeModulationEnabled } from './stokes';
import type { ViewerSessionState } from './types';

type ExportVisualizationState = Pick<
  ViewerSessionState,
  'colormapRange' | 'displaySelection' | 'exposureEv' | 'stokesDegreeModulation' | 'visualizationMode'
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
        rgb = modulateRgbBytesValue(rgb, rawAlpha);
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

export async function createPngBlobFromPixels(pixels: ExportImagePixels): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new Error('Image export is only available in a browser environment.');
  }

  return await canvasToBlob(createCanvasFromPixels(pixels), 'image/png');
}

function createCanvasFromPixels(pixels: ExportImagePixels): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create a 2D canvas context for export.');
  }

  context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode the exported PNG.'));
        return;
      }

      resolve(blob);
    }, type);
  });
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
