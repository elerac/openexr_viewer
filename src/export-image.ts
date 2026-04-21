import { computeRec709Luminance, linearToSrgbByte } from './color';
import {
  mapValueToColormapRgbBytes,
  modulateRgbBytesValue,
  type ColormapLut
} from './colormaps';
import { selectionUsesImageAlpha } from './display-model';
import { isStokesDegreeModulationEnabled } from './stokes';
import type {
  DecodedExrImage,
  ExportImageRequest,
  ViewerSessionState
} from './types';

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

export interface CreateExportImageBlobArgs {
  request: ExportImageRequest;
  decoded: DecodedExrImage;
  displayTexture: Float32Array;
  state: ViewerSessionState;
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

export async function createExportImageBlob({
  request,
  decoded,
  displayTexture,
  state,
  colormapLut
}: CreateExportImageBlobArgs): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new Error('Image export is only available in a browser environment.');
  }
  if (request.format !== 'png') {
    throw new Error(`Unsupported export format: ${request.format}`);
  }
  if (state.visualizationMode === 'colormap' && !colormapLut) {
    throw new Error('The active colormap is not ready for export.');
  }
  if (decoded.width <= 0 || decoded.height <= 0) {
    throw new Error('No exportable image is active.');
  }

  const pixels = buildExportImagePixels({
    displayTexture,
    width: decoded.width,
    height: decoded.height,
    state,
    colormapLut
  });

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = pixels.width;
  sourceCanvas.height = pixels.height;

  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) {
    throw new Error('Unable to create a 2D canvas context for export.');
  }

  sourceContext.putImageData(
    new ImageData(new Uint8ClampedArray(Array.from(pixels.data)), pixels.width, pixels.height),
    0,
    0
  );

  const targetWidth = clampRequestedDimension(request.width, pixels.width);
  const targetHeight = clampRequestedDimension(request.height, pixels.height);
  const exportCanvas = targetWidth === pixels.width && targetHeight === pixels.height
    ? sourceCanvas
    : resizeExportCanvas(sourceCanvas, targetWidth, targetHeight);

  return await canvasToBlob(exportCanvas, 'image/png');
}

function resizeExportCanvas(
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number
): HTMLCanvasElement {
  const resizedCanvas = document.createElement('canvas');
  resizedCanvas.width = width;
  resizedCanvas.height = height;
  const resizedContext = resizedCanvas.getContext('2d');
  if (!resizedContext) {
    throw new Error('Unable to create a resized export canvas.');
  }

  resizedContext.imageSmoothingEnabled = true;
  resizedContext.imageSmoothingQuality = 'high';
  resizedContext.drawImage(sourceCanvas, 0, 0, width, height);
  return resizedCanvas;
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

function clampRequestedDimension(value: number, sourceSize: number): number {
  if (!Number.isFinite(value)) {
    return sourceSize;
  }

  return Math.min(Math.max(1, Math.round(value)), sourceSize);
}
