import { describe, expect, it } from 'vitest';
import { collectDecodedImageTransferables } from '../src/decode-transferables';
import { createImage, createLayerFromChannels } from './helpers/state-fixtures';

describe('decode transferables', () => {
  it('collects one transferable buffer per decoded layer', () => {
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

    expect(transferables).toHaveLength(2);
    expect(transferables[0]).toBe(beauty.channelStorage.pixels.buffer);
    expect(transferables[1]).toBe(depth.channelStorage.pixels.buffer);
  });
});
