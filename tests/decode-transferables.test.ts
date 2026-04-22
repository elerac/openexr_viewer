import { describe, expect, it } from 'vitest';
import { collectDecodedImageTransferables } from '../src/decode-transferables';
import { createImage, createLayerFromChannels } from './helpers/state-fixtures';

describe('decode transferables', () => {
  it('collects one transferable buffer per decoded planar channel', () => {
    const beauty = createLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    }, 'beauty');
    const depth = createLayerFromChannels({
      Z: [7, 8]
    }, 'depth');
    const image = createImage([beauty, depth]);

    const transferables = collectDecodedImageTransferables(image);

    expect(transferables).toHaveLength(4);
    expect(transferables).toEqual([
      beauty.channelStorage.kind === 'planar-f32' ? beauty.channelStorage.pixelsByChannel.R.buffer : null,
      beauty.channelStorage.kind === 'planar-f32' ? beauty.channelStorage.pixelsByChannel.G.buffer : null,
      beauty.channelStorage.kind === 'planar-f32' ? beauty.channelStorage.pixelsByChannel.B.buffer : null,
      depth.channelStorage.kind === 'planar-f32' ? depth.channelStorage.pixelsByChannel.Z.buffer : null
    ]);
  });
});
