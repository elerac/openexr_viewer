import { describe, expect, it } from 'vitest';
import { buildDisplaySourceBinding } from '../src/display/bindings';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayerFromChannels,
  createStokesSelection
} from './helpers/state-fixtures';

describe('display bindings', () => {
  it('maps selections onto fixed source-texture slots for the shader path', () => {
    const channelLayer = createLayerFromChannels({
      R: [1],
      G: [2],
      B: [3],
      A: [0.5]
    });
    const stokesLayer = createLayerFromChannels({
      'S0.R': [1],
      'S0.G': [2],
      'S0.B': [3],
      'S1.R': [4],
      'S1.G': [5],
      'S1.B': [6],
      'S2.R': [7],
      'S2.G': [8],
      'S2.B': [9],
      'S3.R': [10],
      'S3.G': [11],
      'S3.B': [12]
    });

    const rgbBinding = buildDisplaySourceBinding(channelLayer, createChannelRgbSelection('R', 'G', 'B', 'A'));
    const monoBinding = buildDisplaySourceBinding(channelLayer, createChannelMonoSelection('G', 'A'));
    const stokesBinding = buildDisplaySourceBinding(stokesLayer, createStokesSelection('dop', 'stokesRgb'));
    const stokesColormapBinding = buildDisplaySourceBinding(
      stokesLayer,
      createStokesSelection('dop', 'stokesRgb'),
      'colormap'
    );

    expect(rgbBinding.mode).toBe('channelRgb');
    expect(rgbBinding.slots.slice(0, 4)).toEqual(['R', 'G', 'B', 'A']);
    expect(rgbBinding.usesImageAlpha).toBe(true);
    expect(rgbBinding.stokesParameter).toBeNull();

    expect(monoBinding.mode).toBe('channelMono');
    expect(monoBinding.slots.slice(0, 4)).toEqual(['G', null, null, 'A']);
    expect(monoBinding.usesImageAlpha).toBe(true);
    expect(monoBinding.stokesParameter).toBeNull();

    expect(stokesBinding.mode).toBe('stokesRgb');
    expect(stokesBinding.slots).toEqual([
      'S0.R', 'S1.R', 'S2.R', 'S3.R',
      'S0.G', 'S1.G', 'S2.G', 'S3.G',
      'S0.B', 'S1.B', 'S2.B', 'S3.B'
    ]);
    expect(stokesBinding.usesImageAlpha).toBe(false);
    expect(stokesBinding.stokesParameter).toBe('dop');
    expect(stokesColormapBinding.mode).toBe('stokesRgbLuminance');
    expect(stokesColormapBinding.slots).toEqual(stokesBinding.slots);
  });
});
