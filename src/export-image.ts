import type { ExportImagePixels } from './export/export-pixels';

export {
  buildColormapExportPixels,
  buildExportImagePixels,
  type BuildColormapExportPixelsArgs,
  type BuildExportImagePixelsArgs,
  type ExportImagePixels
} from './export/export-pixels';

export function renderPixelsToCanvas(canvas: HTMLCanvasElement, pixels: ExportImagePixels): void {
  canvas.width = pixels.width;
  canvas.height = pixels.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create a 2D canvas context for export.');
  }

  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
}

export function createPngDataUrlFromPixels(pixels: ExportImagePixels): string {
  if (typeof document === 'undefined') {
    throw new Error('Image export previews are only available in a browser environment.');
  }

  const canvas = document.createElement('canvas');
  renderPixelsToCanvas(canvas, pixels);
  return canvas.toDataURL('image/png');
}

export async function createPngBlobFromPixels(pixels: ExportImagePixels): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new Error('Image export is only available in a browser environment.');
  }

  const canvas = document.createElement('canvas');
  renderPixelsToCanvas(canvas, pixels);
  return await canvasToBlob(canvas, 'image/png');
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
