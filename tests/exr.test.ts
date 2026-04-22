import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getChannelReadView, readChannelValue } from '../src/channel-storage';
import { loadExr } from '../src/exr';

describe('exr decode', () => {
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
    expect(first.channelStorage.kind).toBe('interleaved-f32');
    expect(first.channelStorage.channelCount).toBe(first.channelNames.length);
    expect(first.channelStorage.kind === 'interleaved-f32' && first.channelStorage.pixels.length)
      .toBe(image.width * image.height * first.channelNames.length);
    expect(first.analysis.displayLuminanceRangeBySelectionKey).toEqual({});
    expect(first.analysis.finiteRangeByChannel).toEqual({});
    const red = getChannelReadView(first, 'R');
    expect(readChannelValue(red, 0)).toBeTypeOf('number');
    expect(first.metadata?.some((entry) => entry.key === 'compression' && entry.value === 'PIZ')).toBe(true);
    expect(first.metadata?.some((entry) => entry.key === 'channels' && entry.value === '3 (R, G, B)')).toBe(true);
  }, 60000);
});
