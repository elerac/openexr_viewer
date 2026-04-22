import type { DecodedExrImage } from './types';

export function collectDecodedImageTransferables(image: DecodedExrImage): Transferable[] {
  const transferables: Transferable[] = [];
  for (const layer of image.layers) {
    const pixels = layer.channelStorage.kind === 'interleaved-f32'
      ? layer.channelStorage.pixels
      : Object.values(layer.channelStorage.pixelsByChannel)[0];
    if (pixels && pixels.buffer instanceof ArrayBuffer) {
      transferables.push(pixels.buffer);
    }
  }
  return transferables;
}
