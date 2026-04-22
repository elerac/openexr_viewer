import { describe, expect, it } from 'vitest';
import {
  __debugGetMaterializedChannel,
  __debugGetMaterializedChannelCount,
  discardMaterializedChannel,
  getFiniteChannelRange,
  getChannelReadView,
  readChannelValue,
  readPixelChannelValue
} from '../src/channel-storage';
import {
  createInterleavedLayerFromChannels,
  createLayerFromChannels
} from './helpers/state-fixtures';

describe('channel storage', () => {
  it('exposes stable offsets and strides for interleaved channel views', () => {
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [10, 20],
      B: [100, 200]
    });

    const green = getChannelReadView(layer, 'G');
    const blue = getChannelReadView(layer, 'B');

    expect(green).toEqual({
      pixels: layer.channelStorage.pixels,
      offset: 1,
      stride: 3
    });
    expect(blue).toEqual({
      pixels: layer.channelStorage.pixels,
      offset: 2,
      stride: 3
    });
  });

  it('reads strided channel values and tolerates missing channels', () => {
    const layer = createInterleavedLayerFromChannels({
      B: [100, 200],
      R: [1, 2],
      G: [10, 20]
    });

    const red = getChannelReadView(layer, 'R');

    expect(readChannelValue(red, 0)).toBe(1);
    expect(readChannelValue(red, 1)).toBe(2);
    expect(getChannelReadView(layer, 'A')).toBeNull();
    expect(readChannelValue(null, 0)).toBe(0);
  });

  it('reads individual channel values directly from a pixel block', () => {
    const layer = createLayerFromChannels({
      R: [1, 2],
      G: [10, 20],
      B: [100, 200]
    });

    expect(readPixelChannelValue(layer, 0, 'R')).toBe(1);
    expect(readPixelChannelValue(layer, 0, 'G')).toBe(10);
    expect(readPixelChannelValue(layer, 1, 'B')).toBe(200);
    expect(readPixelChannelValue(layer, 1, 'A')).toBe(0);
  });

  it('materializes fallback planar channels lazily and memoizes them', () => {
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [10, 20],
      B: [100, 200]
    });

    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);

    const greenA = __debugGetMaterializedChannel(layer, 'G');
    expect(Array.from(greenA ?? [])).toEqual([10, 20]);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(1);

    const greenB = __debugGetMaterializedChannel(layer, 'G');
    expect(greenB).toBe(greenA);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(1);

    expect(__debugGetMaterializedChannel(layer, 'A')).toBeNull();
    expect(__debugGetMaterializedChannelCount(layer)).toBe(1);
  });

  it('evicts one materialized interleaved channel without disturbing the others', () => {
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [10, 20],
      B: [100, 200]
    });

    const red = __debugGetMaterializedChannel(layer, 'R');
    const green = __debugGetMaterializedChannel(layer, 'G');
    expect(red).not.toBeNull();
    expect(green).not.toBeNull();
    expect(__debugGetMaterializedChannelCount(layer)).toBe(2);

    discardMaterializedChannel(layer, 'R');

    expect(__debugGetMaterializedChannelCount(layer)).toBe(1);
    const reloadedRed = __debugGetMaterializedChannel(layer, 'R');
    expect(reloadedRed).not.toBe(red);
    expect(Array.from(reloadedRed ?? [])).toEqual([1, 2]);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(2);
  });

  it('computes and reuses finite ranges for interleaved mono channels', () => {
    const layer = createInterleavedLayerFromChannels({
      Z: [Number.NEGATIVE_INFINITY, -2, 4, Number.NaN]
    });

    expect(getFiniteChannelRange(layer, 'Z')).toEqual({ min: -2, max: 4 });
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);

    const dense = __debugGetMaterializedChannel(layer, 'Z');
    expect(Array.from(dense ?? [])).toEqual([Number.NEGATIVE_INFINITY, -2, 4, Number.NaN]);
    expect(getFiniteChannelRange(layer, 'Z')).toEqual({ min: -2, max: 4 });
    expect(__debugGetMaterializedChannelCount(layer)).toBe(1);
  });

  it('returns dense direct views for planar channel storage without materialization', () => {
    const layer = createLayerFromChannels({
      R: [1, 2],
      G: [10, 20],
      B: [100, 200]
    });

    const green = getChannelReadView(layer, 'G');

    expect(green).toEqual({
      pixels: layer.channelStorage.kind === 'planar-f32' ? layer.channelStorage.pixelsByChannel.G : null,
      offset: 0,
      stride: 1
    });
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
  });
});
