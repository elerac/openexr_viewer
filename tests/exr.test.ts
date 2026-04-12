import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadExr, splitInterleavedChannels } from '../src/exr';

describe('exr decode', () => {
  it('splits interleaved channels with stable indexing', () => {
    const map = splitInterleavedChannels(
      new Float32Array([
        1, 10, 100,
        2, 20, 200
      ]),
      2,
      1,
      ['R', 'G', 'B']
    );

    expect(Array.from(map.get('R') ?? [])).toEqual([1, 2]);
    expect(Array.from(map.get('G') ?? [])).toEqual([10, 20]);
    expect(Array.from(map.get('B') ?? [])).toEqual([100, 200]);
  });

  it('decodes cbox_rgb.exr with RGB channels', async () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const exrPath = path.resolve(testDir, '../public/cbox_rgb.exr');
    const bytes = new Uint8Array(readFileSync(exrPath));

    const image = await loadExr(bytes);

    expect(image.width).toBe(256);
    expect(image.height).toBe(256);

    const first = image.layers[0];
    expect(first.channelNames).toContain('R');
    expect(first.channelNames).toContain('G');
    expect(first.channelNames).toContain('B');
    expect(first.channelData.get('R')?.length).toBe(image.width * image.height);
  }, 60000);

});
