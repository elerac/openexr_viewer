export interface InterleavedChannelStorage {
  kind: 'interleaved-f32';
  pixels: Float32Array;
  channelCount: number;
  channelIndexByName: Record<string, number>;
}

export interface ChannelReadView {
  pixels: Float32Array;
  offset: number;
  stride: number;
}

export interface ChannelStorageBackedLayer {
  channelNames: string[];
  channelStorage: InterleavedChannelStorage;
}

const materializedChannels = new WeakMap<InterleavedChannelStorage, Map<string, Float32Array>>();

export function createInterleavedChannelStorage(
  pixels: Float32Array,
  channelNames: string[]
): InterleavedChannelStorage {
  const channelIndexByName: Record<string, number> = {};
  for (let channelIndex = 0; channelIndex < channelNames.length; channelIndex += 1) {
    const channelName = channelNames[channelIndex];
    if (!channelName) {
      continue;
    }
    channelIndexByName[channelName] = channelIndex;
  }

  return {
    kind: 'interleaved-f32',
    pixels,
    channelCount: channelNames.length,
    channelIndexByName
  };
}

export function getChannelReadView(
  layer: ChannelStorageBackedLayer,
  channelName: string
): ChannelReadView | null {
  const channelIndex = layer.channelStorage.channelIndexByName[channelName];
  if (channelIndex === undefined) {
    return null;
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

  return layer.channelStorage.pixels[pixelIndex * layer.channelStorage.channelCount + channelIndex] ?? 0;
}

function materializeChannel(
  layer: ChannelStorageBackedLayer,
  channelName: string
): Float32Array | null {
  const storage = layer.channelStorage;
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

  const pixelCount = storage.channelCount > 0 ? Math.floor(storage.pixels.length / storage.channelCount) : 0;
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
  return materializedChannels.get(layer.channelStorage)?.size ?? 0;
}
