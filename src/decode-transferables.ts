import type { DecodedExrImage } from './types';

export function collectDecodedImageTransferables(image: DecodedExrImage): Transferable[] {
  const transferables: Transferable[] = [];
  for (const layer of image.layers) {
    if (layer.channelStorage.kind === 'planar-f32') {
      for (const pixels of Object.values(layer.channelStorage.pixelsByChannel)) {
        if (pixels.buffer instanceof ArrayBuffer) {
          transferables.push(pixels.buffer);
        }
      }
      continue;
    }

    const pixels = layer.channelStorage.pixels;
    if (pixels.buffer instanceof ArrayBuffer) {
      transferables.push(pixels.buffer);
    }
  }
  return transferables;
}
