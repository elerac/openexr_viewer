import { decodeRawExr } from './exr-runtime';
import { DecodedExrImage, DecodedLayer } from './types';

export async function loadExr(bytes: Uint8Array): Promise<DecodedExrImage> {
  const decoded = await decodeRawExr(bytes);

  const width = decoded.width;
  const height = decoded.height;
  const layers: DecodedLayer[] = [];

  try {
    for (let layerIndex = 0; layerIndex < decoded.layerCount; layerIndex += 1) {
      const channelNames = decoded.getLayerChannelNames(layerIndex);
      const interleaved = decoded.getLayerPixels(layerIndex, channelNames);
      if (!interleaved) {
        throw new Error(`Decoded EXR layer ${layerIndex} is missing pixel data.`);
      }

      const channelData = splitInterleavedChannels(interleaved, width, height, channelNames);

      layers.push({
        name: decoded.getLayerName(layerIndex) ?? null,
        channelNames,
        channelData
      });
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

export function splitInterleavedChannels(
  interleaved: Float32Array,
  width: number,
  height: number,
  channelNames: string[]
): Map<string, Float32Array> {
  const pixelCount = width * height;
  const channelCount = channelNames.length;

  if (interleaved.length !== pixelCount * channelCount) {
    throw new Error(
      `Invalid interleaved channel length: expected ${pixelCount * channelCount}, got ${interleaved.length}`
    );
  }

  const result = new Map<string, Float32Array>();
  for (const channelName of channelNames) {
    result.set(channelName, new Float32Array(pixelCount));
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const baseIndex = pixelIndex * channelCount;

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const channelName = channelNames[channelIndex];
      const values = result.get(channelName);
      if (!values) {
        continue;
      }
      values[pixelIndex] = interleaved[baseIndex + channelIndex];
    }
  }

  return result;
}
