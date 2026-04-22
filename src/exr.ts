import { decodeRawExr } from './exr-runtime';
import { parseExrMetadata } from './exr-metadata';
import { createInterleavedChannelStorage } from './channel-storage';
import { DecodedExrImage, DecodedLayer } from './types';

export async function loadExr(bytes: Uint8Array): Promise<DecodedExrImage> {
  const metadataByLayer = parseExrMetadata(bytes);
  const decoded = await decodeRawExr(bytes);

  const width = decoded.width;
  const height = decoded.height;
  const layers: DecodedLayer[] = [];

  try {
    for (let layerIndex = 0; layerIndex < decoded.layerCount; layerIndex += 1) {
      const channelNames = decoded.getLayerChannelNames(layerIndex);
      const name = decoded.getLayerName(layerIndex) ?? null;
      const metadata = metadataByLayer[layerIndex] ?? [];
      const interleaved = decoded.getLayerPixels(layerIndex, channelNames);
      if (!interleaved) {
        throw new Error(`Decoded EXR layer ${layerIndex} is missing pixel data.`);
      }
      const expectedLength = width * height * channelNames.length;
      if (interleaved.length !== expectedLength) {
        throw new Error(
          `Invalid interleaved channel length for layer ${layerIndex}: expected ${expectedLength}, got ${interleaved.length}`
        );
      }

      const layer: DecodedLayer = {
        name,
        channelNames,
        channelStorage: createInterleavedChannelStorage(interleaved, channelNames),
        analysis: {
          displayLuminanceRangeBySelectionKey: {},
          finiteRangeByChannel: {}
        },
        metadata
      };

      layers.push(layer);
    }
  } finally {
    decoded.free();
  }

  if (layers.length === 0) {
    throw new Error('Decoded EXR has no layers.');
  }

  return {
    width,
    height,
    layers
  };
}
