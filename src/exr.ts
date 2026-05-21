import { decodeRawExr } from './exr-runtime';
import { parseExrMetadata } from './exr-metadata';
import { createInterleavedChannelStorage } from './channel-storage';
import type { DecodedExrImage, DecodedLayer, ExrMetadataEntry } from './types';

interface Box2i {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface LayerWindows {
  dataWindow: Box2i | null;
  displayWindow: Box2i | null;
}

interface LayerPixelReader {
  getLayerPixels(layerIndex: number, channelNames: string[]): Float32Array | undefined;
}

export async function loadExr(bytes: Uint8Array): Promise<DecodedExrImage> {
  const metadataByLayer = parseExrMetadata(bytes);
  const decoded = await decodeRawExr(bytes);

  const width = decoded.width;
  const height = decoded.height;
  const layers: DecodedLayer[] = [];

  let decodeError: unknown;
  try {
    for (let layerIndex = 0; layerIndex < decoded.layerCount; layerIndex += 1) {
      const channelNames = decoded.getLayerChannelNames(layerIndex);
      const name = decoded.getLayerName(layerIndex) ?? null;
      const metadata = metadataByLayer[layerIndex] ?? [];
      const interleaved = readLayerInterleavedPixels(decoded, layerIndex, channelNames, width, height, metadata);

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
  } catch (error) {
    decodeError = error;
  } finally {
    try {
      decoded.free();
    } catch (freeError) {
      if (!decodeError) {
        decodeError = freeError;
      }
    }
  }

  if (decodeError) {
    throw decodeError;
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

export function readLayerInterleavedPixels(
  reader: LayerPixelReader,
  layerIndex: number,
  channelNames: string[],
  width: number,
  height: number,
  metadata: ExrMetadataEntry[]
): Float32Array {
  const expectedLength = width * height * channelNames.length;
  const windows = getLayerWindows(metadata);

  if (!hasCroppedDataWindow(windows, width, height)) {
    const interleaved = reader.getLayerPixels(layerIndex, channelNames);
    if (!interleaved) {
      throw new Error(`Decoded EXR layer ${layerIndex} is missing pixel data.`);
    }
    if (interleaved.length !== expectedLength) {
      throw new Error(
        `Invalid interleaved channel length for layer ${layerIndex}: expected ${expectedLength}, got ${interleaved.length}`
      );
    }
    return interleaved;
  }

  return readCroppedLayerInterleavedPixels(reader, layerIndex, channelNames, width, height, windows);
}

function readCroppedLayerInterleavedPixels(
  reader: LayerPixelReader,
  layerIndex: number,
  channelNames: string[],
  width: number,
  height: number,
  windows: LayerWindows
): Float32Array {
  const dataWindow = windows.dataWindow;
  if (!dataWindow) {
    throw new Error(`Decoded EXR layer ${layerIndex} has cropped pixels but no dataWindow metadata.`);
  }

  const channelCount = channelNames.length;
  const fullPixelCount = width * height;
  const interleaved = new Float32Array(fullPixelCount * channelCount);
  const dataWidth = getBoxWidth(dataWindow);
  const dataHeight = getBoxHeight(dataWindow);
  const dataPixelCount = dataWidth * dataHeight;
  const displayMinX = windows.displayWindow?.minX ?? 0;
  const displayMinY = windows.displayWindow?.minY ?? 0;

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelName = channelNames[channelIndex];
    if (!channelName) {
      continue;
    }

    const channelPixels = reader.getLayerPixels(layerIndex, [channelName]);
    if (!channelPixels) {
      throw new Error(`Decoded EXR layer ${layerIndex} is missing pixel data for channel ${channelName}.`);
    }

    if (channelPixels.length === fullPixelCount) {
      copyFullChannel(interleaved, channelPixels, channelIndex, channelCount);
      continue;
    }

    if (channelPixels.length !== dataPixelCount) {
      throw new Error(
        `Invalid channel length for layer ${layerIndex} channel ${channelName}: expected ${dataPixelCount} or ${fullPixelCount}, got ${channelPixels.length}`
      );
    }

    copyCroppedChannel(interleaved, channelPixels, {
      channelIndex,
      channelCount,
      width,
      height,
      dataWindow,
      dataWidth,
      dataHeight,
      displayMinX,
      displayMinY
    });
  }

  return interleaved;
}

function copyFullChannel(
  interleaved: Float32Array,
  channelPixels: Float32Array,
  channelIndex: number,
  channelCount: number
): void {
  for (let pixelIndex = 0; pixelIndex < channelPixels.length; pixelIndex += 1) {
    interleaved[pixelIndex * channelCount + channelIndex] = channelPixels[pixelIndex] ?? 0;
  }
}

function copyCroppedChannel(
  interleaved: Float32Array,
  channelPixels: Float32Array,
  options: {
    channelIndex: number;
    channelCount: number;
    width: number;
    height: number;
    dataWindow: Box2i;
    dataWidth: number;
    dataHeight: number;
    displayMinX: number;
    displayMinY: number;
  }
): void {
  for (let row = 0; row < options.dataHeight; row += 1) {
    const destY = options.dataWindow.minY - options.displayMinY + row;
    if (destY < 0 || destY >= options.height) {
      continue;
    }

    for (let column = 0; column < options.dataWidth; column += 1) {
      const destX = options.dataWindow.minX - options.displayMinX + column;
      if (destX < 0 || destX >= options.width) {
        continue;
      }

      const sourceIndex = row * options.dataWidth + column;
      const destIndex = (destY * options.width + destX) * options.channelCount + options.channelIndex;
      interleaved[destIndex] = channelPixels[sourceIndex] ?? 0;
    }
  }
}

function getLayerWindows(metadata: ExrMetadataEntry[]): LayerWindows {
  return {
    dataWindow: parseBox2iMetadata(metadata.find((entry) => entry.key === 'dataWindow')?.value),
    displayWindow: parseBox2iMetadata(metadata.find((entry) => entry.key === 'displayWindow')?.value)
  };
}

function hasCroppedDataWindow(windows: LayerWindows, width: number, height: number): boolean {
  const dataWindow = windows.dataWindow;
  if (!dataWindow) {
    return false;
  }

  const displayWindow = windows.displayWindow ?? { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
  return (
    getBoxWidth(dataWindow) !== width ||
    getBoxHeight(dataWindow) !== height ||
    dataWindow.minX !== displayWindow.minX ||
    dataWindow.minY !== displayWindow.minY
  );
}

function parseBox2iMetadata(value: string | undefined): Box2i | null {
  if (!value) {
    return null;
  }

  const match = /^\[(-?\d+),(-?\d+)\]-\[(-?\d+),(-?\d+)\]$/u.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, minX, minY, maxX, maxY] = match;
  return {
    minX: Number(minX),
    minY: Number(minY),
    maxX: Number(maxX),
    maxY: Number(maxY)
  };
}

function getBoxWidth(box: Box2i): number {
  return Math.max(0, box.maxX - box.minX + 1);
}

function getBoxHeight(box: Box2i): number {
  return Math.max(0, box.maxY - box.minY + 1);
}
