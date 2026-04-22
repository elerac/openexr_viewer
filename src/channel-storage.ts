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

interface MaterializedChannelEntry {
  pixels: Float32Array;
  finiteRange: FiniteValueRange | null;
}

const materializedChannels = new WeakMap<InterleavedChannelStorage, Map<string, MaterializedChannelEntry>>();

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

  return materializeChannel(layer, channelName)?.pixels ?? null;
}

export function getFiniteChannelRange(
  layer: ChannelStorageBackedLayer,
  channelName: string
): FiniteValueRange | null {
  if (layer.channelStorage.kind === 'planar-f32') {
    return computeFiniteValueRange(layer.channelStorage.pixelsByChannel[channelName] ?? null);
  }

  const materialized = materializedChannels.get(layer.channelStorage)?.get(channelName);
  if (materialized) {
    return materialized.finiteRange;
  }

  const view = getChannelReadView(layer, channelName);
  if (!view) {
    return null;
  }

  return computeFiniteValueRangeFromView(view, getChannelStoragePixelCount(layer.channelStorage));
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

export function discardMaterializedChannel(
  layer: ChannelStorageBackedLayer,
  channelName: string
): void {
  if (layer.channelStorage.kind !== 'interleaved-f32') {
    return;
  }

  const storageChannels = materializedChannels.get(layer.channelStorage);
  if (!storageChannels) {
    return;
  }

  storageChannels.delete(channelName);
  if (storageChannels.size === 0) {
    materializedChannels.delete(layer.channelStorage);
  }
}

function materializeChannel(
  layer: ChannelStorageBackedLayer,
  channelName: string
): MaterializedChannelEntry | null {
  const storage = layer.channelStorage;
  if (storage.kind !== 'interleaved-f32') {
    const pixels = storage.pixelsByChannel[channelName] ?? null;
    return pixels
      ? {
          pixels,
          finiteRange: computeFiniteValueRange(pixels)
        }
      : null;
  }

  let storageChannels = materializedChannels.get(storage);
  if (!storageChannels) {
    storageChannels = new Map<string, MaterializedChannelEntry>();
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
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const value = readChannelValue(view, pixelIndex);
    values[pixelIndex] = value;
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

  const entry: MaterializedChannelEntry = {
    pixels: values,
    finiteRange: finiteCount > 0 ? { min, max } : null
  };
  storageChannels.set(channelName, entry);
  return entry;
}

function computeFiniteValueRange(pixels: Float32Array | null): FiniteValueRange | null {
  if (!pixels) {
    return null;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;

  for (let index = 0; index < pixels.length; index += 1) {
    const value = pixels[index] ?? 0;
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

  return finiteCount > 0 ? { min, max } : null;
}

function computeFiniteValueRangeFromView(
  view: ChannelReadView,
  pixelCount: number
): FiniteValueRange | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const value = readChannelValue(view, pixelIndex);
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

  return finiteCount > 0 ? { min, max } : null;
}

export function __debugGetMaterializedChannel(
  layer: ChannelStorageBackedLayer,
  channelName: string
): Float32Array | null {
  return materializeChannel(layer, channelName)?.pixels ?? null;
}

export function __debugGetMaterializedChannelCount(layer: ChannelStorageBackedLayer): number {
  return layer.channelStorage.kind === 'interleaved-f32'
    ? materializedChannels.get(layer.channelStorage)?.size ?? 0
    : 0;
}
