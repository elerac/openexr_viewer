import { describe, expect, it } from 'vitest';
import { collectDecodedImageTransferables } from '../src/decode-transferables';
import { createImage, createInterleavedLayerFromChannels } from './helpers/state-fixtures';

describe('decode transferables', () => {
  it('collects one transferable buffer per decoded interleaved layer', () => {
    const beauty = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    }, 'beauty');
    const depth = createInterleavedLayerFromChannels({
      Z: [7, 8]
    }, 'depth');
    const image = createImage([beauty, depth]);

    const transferables = collectDecodedImageTransferables(image);

    expect(transferables).toHaveLength(2);
    expect(transferables).toEqual([
      beauty.channelStorage.kind === 'interleaved-f32' ? beauty.channelStorage.pixels.buffer : null,
      depth.channelStorage.kind === 'interleaved-f32' ? depth.channelStorage.pixels.buffer : null
    ]);
  });
});
