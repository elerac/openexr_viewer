export interface InterleavedChannelStorage {
  kind: 'interleaved-f32';
  pixels: Float32Array;
  channelCount: number;
  channelIndexByName: Record<string, number>;
}

export interface PlanarChannelStorage {
  kind: 'planar-f32';
  channelCount: number;
  channelIndexByName: Record<string, number>;
  pixelsByChannel: Record<string, Float32Array>;
}

export interface FiniteValueRange {
  min: number;
  max: number;
}

export type ChannelStorage = InterleavedChannelStorage | PlanarChannelStorage;

export interface ChannelReadView {
  pixels: Float32Array;
  offset: number;
  stride: number;
}

export interface ChannelStorageBackedLayer {
  channelNames: string[];
  channelStorage: ChannelStorage;
}

const materializedChannels = new WeakMap<InterleavedChannelStorage, Map<string, Float32Array>>();

export function createInterleavedChannelStorage(
  pixels: Float32Array,
  channelNames: string[]
): InterleavedChannelStorage {
  const channelIndexByName = buildChannelIndexByName(channelNames);

  return {
    kind: 'interleaved-f32',
    pixels,
    channelCount: channelNames.length,
    channelIndexByName
  };
}

export function createPlanarChannelStorage(
  pixelsByChannel: Record<string, Float32Array>,
  channelNames: string[]
): PlanarChannelStorage {
  return {
    kind: 'planar-f32',
    channelCount: channelNames.length,
    channelIndexByName: buildChannelIndexByName(channelNames),
    pixelsByChannel
  };
}

export function createPlanarChannelStorageFromInterleaved(
  pixels: Float32Array,
  channelNames: string[]
): {
  storage: PlanarChannelStorage;
  finiteRangeByChannel: Record<string, FiniteValueRange | null>;
} {
  const pixelCount = channelNames.length > 0 ? Math.floor(pixels.length / channelNames.length) : 0;
  const pixelsByChannel: Record<string, Float32Array> = {};
  const finiteRangeByChannel: Record<string, FiniteValueRange | null> = {};

  for (let channelIndex = 0; channelIndex < channelNames.length; channelIndex += 1) {
    const channelName = channelNames[channelIndex];
    if (!channelName) {
      continue;
    }

    const dense = new Float32Array(pixelCount);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let finiteCount = 0;

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const value = pixels[pixelIndex * channelNames.length + channelIndex] ?? 0;
      dense[pixelIndex] = value;
      if (!Number.isFinite(value)) {
        continue;
      }

      finiteCount += 1;
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }

    pixelsByChannel[channelName] = dense;
    finiteRangeByChannel[channelName] = finiteCount > 0 ? { min, max } : null;
  }

  return {
    storage: createPlanarChannelStorage(pixelsByChannel, channelNames),
    finiteRangeByChannel
  };
}

function buildChannelIndexByName(channelNames: string[]): Record<string, number> {
  const channelIndexByName: Record<string, number> = {};
  for (let channelIndex = 0; channelIndex < channelNames.length; channelIndex += 1) {
    const channelName = channelNames[channelIndex];
    if (!channelName) {
      continue;
    }
    channelIndexByName[channelName] = channelIndex;
  }

  return channelIndexByName;
}

export function getChannelReadView(
  layer: ChannelStorageBackedLayer,
  channelName: string
): ChannelReadView | null {
  const channelIndex = layer.channelStorage.channelIndexByName[channelName];
  if (channelIndex === undefined) {
    return null;
  }

  if (layer.channelStorage.kind === 'planar-f32') {
    const pixels = layer.channelStorage.pixelsByChannel[channelName];
    if (!pixels) {
      return null;
    }

    return {
      pixels,
      offset: 0,
      stride: 1
    };
  }

  return {
    pixels: layer.channelStorage.pixels,
    offset: channelIndex,
    stride: layer.channelStorage.channelCount
  };
}

export function readChannelValue(view: ChannelReadView | null, pixelIndex: number): number {
  if (!view) {
    return 0;
  }

  return view.pixels[view.offset + pixelIndex * view.stride] ?? 0;
}

export function readPixelChannelValue(
  layer: ChannelStorageBackedLayer,
  pixelIndex: number,
  channelName: string
): number {
  const channelIndex = layer.channelStorage.channelIndexByName[channelName];
  if (channelIndex === undefined) {
    return 0;
  }

  if (layer.channelStorage.kind === 'planar-f32') {
    return layer.channelStorage.pixelsByChannel[channelName]?.[pixelIndex] ?? 0;
  }

  return layer.channelStorage.pixels[pixelIndex * layer.channelStorage.channelCount + channelIndex] ?? 0;
}

export function getChannelDenseArray(
  layer: ChannelStorageBackedLayer,
  channelName: string
): Float32Array | null {
  if (layer.channelStorage.kind === 'planar-f32') {
    return layer.channelStorage.pixelsByChannel[channelName] ?? null;
  }

  return materializeChannel(layer, channelName);
}

export function getChannelStoragePixelCount(storage: ChannelStorage): number {
  if (storage.channelCount <= 0) {
    return 0;
  }

  if (storage.kind === 'planar-f32') {
    for (const pixels of Object.values(storage.pixelsByChannel)) {
      return pixels.length;
    }
    return 0;
  }

  return Math.floor(storage.pixels.length / storage.channelCount);
}

export function copyChannelToDenseArray(
  layer: ChannelStorageBackedLayer,
  channelName: string,
  output?: Float32Array
): Float32Array | null {
  if (layer.channelStorage.kind === 'planar-f32') {
    const dense = layer.channelStorage.pixelsByChannel[channelName];
    if (!dense) {
      return null;
    }

    if (!output || output.length !== dense.length) {
      return dense;
    }

    output.set(dense);
    return output;
  }

  const view = getChannelReadView(layer, channelName);
  if (!view) {
    return null;
  }

  const pixelCount = getChannelStoragePixelCount(layer.channelStorage);
  const dense = output && output.length === pixelCount
    ? output
    : new Float32Array(pixelCount);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    dense[pixelIndex] = readChannelValue(view, pixelIndex);
  }

  return dense;
}

function materializeChannel(
  layer: ChannelStorageBackedLayer,
  channelName: string
): Float32Array | null {
  const storage = layer.channelStorage;
  if (storage.kind !== 'interleaved-f32') {
    return storage.pixelsByChannel[channelName] ?? null;
  }

  let storageChannels = materializedChannels.get(storage);
  if (!storageChannels) {
    storageChannels = new Map<string, Float32Array>();
    materializedChannels.set(storage, storageChannels);
  }

  const cached = storageChannels.get(channelName);
  if (cached) {
    return cached;
  }

  const view = getChannelReadView(layer, channelName);
  if (!view) {
    return null;
  }

  const pixelCount = getChannelStoragePixelCount(storage);
  const values = new Float32Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    values[pixelIndex] = readChannelValue(view, pixelIndex);
  }

  storageChannels.set(channelName, values);
  return values;
}

export function __debugGetMaterializedChannel(
  layer: ChannelStorageBackedLayer,
  channelName: string
): Float32Array | null {
  return materializeChannel(layer, channelName);
}

export function __debugGetMaterializedChannelCount(layer: ChannelStorageBackedLayer): number {
  return layer.channelStorage.kind === 'interleaved-f32'
    ? materializedChannels.get(layer.channelStorage)?.size ?? 0
    : 0;
}
