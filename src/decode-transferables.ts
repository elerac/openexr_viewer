import type { DecodedExrImage } from './types';

export function collectDecodedImageTransferables(image: DecodedExrImage): Transferable[] {
  const transferables: Transferable[] = [];
  for (const layer of image.layers) {
    const pixels = layer.channelStorage.pixels;
    if (pixels.buffer instanceof ArrayBuffer) {
      transferables.push(pixels.buffer);
    }
  }
  return transferables;
}
