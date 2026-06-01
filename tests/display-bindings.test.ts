import { describe, expect, it } from 'vitest';
import { buildDisplaySourceBinding } from '../src/display/bindings';
import { buildMuellerMatrixSourceName, buildRgbMuellerMatrixSourceName, MUELLER_MATRIX_ELEMENTS } from '../src/mueller';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createMuellerMatrixSelection,
  createRgbMuellerMatrixSelection,
  createSpectralRgbSelection,
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
    const uvLayer = createLayerFromChannels({
      U: [1],
      V: [2],
      A: [0.5]
    });
    const normalLayer = createLayerFromChannels({
      'normal.X': [0],
      'normal.Y': [0],
      'normal.Z': [1],
      'normal.A': [0.5]
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
    const suffixedStokesLayer = createLayerFromChannels({
      'S0.Y': [1],
      'S1.Y': [2],
      'S2.Y': [3],
      'S3.Y': [4]
    });
    const muellerLayer = createLayerFromChannels(Object.fromEntries(
      MUELLER_MATRIX_ELEMENTS.map((element, index) => [element, [index + 1]])
    ));
    const suffixedMuellerLayer = createLayerFromChannels(Object.fromEntries(
      MUELLER_MATRIX_ELEMENTS.map((element, index) => [`${element}.Y`, [index + 1]])
    ));
    const rgbMuellerLayer = createLayerFromChannels(Object.fromEntries(
      MUELLER_MATRIX_ELEMENTS.flatMap((element, index) => [
        [`${element}.R`, [index + 1]],
        [`${element}.G`, [index + 2]],
        [`${element}.B`, [index + 3]]
      ])
    ));
    const spectralLayer = createLayerFromChannels({
      '400nm': [1],
      '500nm': [1],
      '600nm': [1]
    });
    const spectralStokesLayer = createLayerFromChannels({
      'S0.400nm': [1],
      'S1.400nm': [0.25],
      'S2.400nm': [0],
      'S3.400nm': [0],
      'S0.500nm': [1],
      'S1.500nm': [0.25],
      'S2.500nm': [0],
      'S3.500nm': [0]
    });

    const rgbBinding = buildDisplaySourceBinding(channelLayer, createChannelRgbSelection('R', 'G', 'B', 'A'));
    const uvBinding = buildDisplaySourceBinding(uvLayer, createChannelRgbSelection('U', 'V', null, 'A'));
    const normalBinding = buildDisplaySourceBinding(
      normalLayer,
      createChannelRgbSelection('normal.X', 'normal.Y', 'normal.Z', 'normal.A', 'normalMap')
    );
    const monoBinding = buildDisplaySourceBinding(channelLayer, createChannelMonoSelection('G', 'A'));
    const stokesBinding = buildDisplaySourceBinding(stokesLayer, createStokesSelection('dop', 'stokesRgb'));
    const suffixedStokesBinding = buildDisplaySourceBinding(
      suffixedStokesLayer,
      createStokesSelection('dop', 'stokesScalar', null, 'Y')
    );
    const muellerBinding = buildDisplaySourceBinding(muellerLayer, createMuellerMatrixSelection());
    const suffixedMuellerBinding = buildDisplaySourceBinding(
      suffixedMuellerLayer,
      createMuellerMatrixSelection('Y')
    );
    const rgbMuellerBinding = buildDisplaySourceBinding(rgbMuellerLayer, createRgbMuellerMatrixSelection());
    const splitRgbMuellerBinding = buildDisplaySourceBinding(rgbMuellerLayer, createMuellerMatrixSelection('G'));
    const stokesColormapBinding = buildDisplaySourceBinding(
      stokesLayer,
      createStokesSelection('dop', 'stokesRgb'),
      'colormap'
    );
    const spectralBinding = buildDisplaySourceBinding(spectralLayer, createSpectralRgbSelection());
    const spectralStokesBinding = buildDisplaySourceBinding(
      spectralStokesLayer,
      createStokesSelection('s1_over_s0', 'stokesSpectralRgb')
    );
    const spectralStokesColormapBinding = buildDisplaySourceBinding(
      spectralStokesLayer,
      createStokesSelection('s1_over_s0', 'stokesSpectralRgb'),
      'colormap'
    );

    expect(rgbBinding.mode).toBe('channelRgb');
    expect(rgbBinding.slots.slice(0, 4)).toEqual(['R', 'G', 'B', 'A']);
    expect(rgbBinding.usesImageAlpha).toBe(true);
    expect(rgbBinding.stokesParameter).toBeNull();

    expect(uvBinding.mode).toBe('channelRgb');
    expect(uvBinding.slots.slice(0, 4)).toEqual(['U', 'V', null, 'A']);
    expect(uvBinding.usesImageAlpha).toBe(true);
    expect(uvBinding.stokesParameter).toBeNull();

    expect(normalBinding.mode).toBe('channelNormalMap');
    expect(normalBinding.slots.slice(0, 4)).toEqual(['normal.X', 'normal.Y', 'normal.Z', 'normal.A']);
    expect(normalBinding.usesImageAlpha).toBe(true);
    expect(normalBinding.stokesParameter).toBeNull();

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
    expect(suffixedStokesBinding.mode).toBe('stokesDirect');
    expect(suffixedStokesBinding.slots.slice(0, 4)).toEqual(['S0.Y', 'S1.Y', 'S2.Y', 'S3.Y']);
    expect(suffixedStokesBinding.usesImageAlpha).toBe(false);
    expect(suffixedStokesBinding.stokesParameter).toBe('dop');
    expect(muellerBinding.mode).toBe('muellerMatrix');
    expect(muellerBinding.slots[0]).toBe(buildMuellerMatrixSourceName());
    expect(muellerBinding.usesImageAlpha).toBe(false);
    expect(muellerBinding.stokesParameter).toBeNull();
    expect(suffixedMuellerBinding.mode).toBe('muellerMatrix');
    expect(suffixedMuellerBinding.slots[0]).toBe(buildMuellerMatrixSourceName('Y'));
    expect(suffixedMuellerBinding.usesImageAlpha).toBe(false);
    expect(suffixedMuellerBinding.stokesParameter).toBeNull();
    expect(rgbMuellerBinding.mode).toBe('muellerMatrix');
    expect(rgbMuellerBinding.slots[0]).toBe(buildRgbMuellerMatrixSourceName());
    expect(rgbMuellerBinding.usesImageAlpha).toBe(false);
    expect(rgbMuellerBinding.stokesParameter).toBeNull();
    expect(splitRgbMuellerBinding.mode).toBe('muellerMatrix');
    expect(splitRgbMuellerBinding.slots[0]).toBe(buildMuellerMatrixSourceName('G'));
    expect(splitRgbMuellerBinding.usesImageAlpha).toBe(false);
    expect(splitRgbMuellerBinding.stokesParameter).toBeNull();
    expect(stokesColormapBinding.mode).toBe('stokesRgbLuminance');
    expect(stokesColormapBinding.slots).toEqual(stokesBinding.slots);
    expect(spectralBinding.mode).toBe('spectralRgb');
    expect(spectralBinding.slots[0]).toBe('__spectralRgb:');
    expect(spectralBinding.usesImageAlpha).toBe(false);
    expect(spectralStokesBinding.mode).toBe('stokesSpectralRgb');
    expect(spectralStokesBinding.slots.slice(0, 4)).toEqual([
      '__spectralStokesRgb:S0',
      '__spectralStokesRgb:S1',
      '__spectralStokesRgb:S2',
      '__spectralStokesRgb:S3'
    ]);
    expect(spectralStokesBinding.usesImageAlpha).toBe(false);
    expect(spectralStokesBinding.stokesParameter).toBe('s1_over_s0');
    expect(spectralStokesColormapBinding.mode).toBe('stokesSpectralRgbLuminance');
    expect(spectralStokesColormapBinding.slots).toEqual(spectralStokesBinding.slots);
  });

  it('returns empty bindings for derived spectral RGB selections when grouping is disabled', () => {
    const spectralLayer = createLayerFromChannels({
      '400nm': [1],
      '500nm': [1],
      '600nm': [1]
    });
    const spectralStokesLayer = createLayerFromChannels({
      'S0.400nm': [1],
      'S1.400nm': [0.25],
      'S2.400nm': [0],
      'S3.400nm': [0],
      'S0.500nm': [1],
      'S1.500nm': [0.25],
      'S2.500nm': [0],
      'S3.500nm': [0]
    });

    expect(buildDisplaySourceBinding(
      spectralLayer,
      createSpectralRgbSelection(),
      'rgb',
      { spectralRgbGroupingEnabled: false }
    ).mode).toBe('empty');
    expect(buildDisplaySourceBinding(
      spectralStokesLayer,
      createStokesSelection('s1_over_s0', 'stokesSpectralRgb'),
      'rgb',
      { spectralRgbGroupingEnabled: false }
    ).mode).toBe('empty');
  });

  it('binds linear-only Stokes selections except full-vector parameters', () => {
    const scalarLayer = createLayerFromChannels({
      S0: [2],
      S1: [1],
      S2: [Math.sqrt(3)]
    });
    const rgbLayer = createLayerFromChannels({
      'S0.R': [2],
      'S0.G': [2],
      'S0.B': [2],
      'S1.R': [1],
      'S1.G': [1],
      'S1.B': [1],
      'S2.R': [Math.sqrt(3)],
      'S2.G': [Math.sqrt(3)],
      'S2.B': [Math.sqrt(3)]
    });
    const spectralLayer = createLayerFromChannels({
      'S0.400nm': [2],
      'S1.400nm': [1],
      'S2.400nm': [Math.sqrt(3)],
      'S0.500nm': [2],
      'S1.500nm': [1],
      'S2.500nm': [Math.sqrt(3)]
    });

    const scalarBinding = buildDisplaySourceBinding(scalarLayer, createStokesSelection('dolp'));
    const scalarDopBinding = buildDisplaySourceBinding(scalarLayer, createStokesSelection('dop'));
    const scalarHiddenBinding = buildDisplaySourceBinding(scalarLayer, createStokesSelection('docp'));
    const rgbBinding = buildDisplaySourceBinding(rgbLayer, createStokesSelection('dolp', 'stokesRgb'));
    const rgbDopBinding = buildDisplaySourceBinding(rgbLayer, createStokesSelection('dop', 'stokesRgb'));
    const spectralBinding = buildDisplaySourceBinding(
      spectralLayer,
      createStokesSelection('dolp', 'stokesSpectralRgb')
    );
    const spectralDopBinding = buildDisplaySourceBinding(
      spectralLayer,
      createStokesSelection('dop', 'stokesSpectralRgb')
    );

    expect(scalarBinding.mode).toBe('stokesDirect');
    expect(scalarBinding.slots.slice(0, 4)).toEqual(['S0', 'S1', 'S2', null]);
    expect(scalarDopBinding.mode).toBe('empty');
    expect(scalarHiddenBinding.mode).toBe('empty');
    expect(rgbBinding.mode).toBe('stokesRgb');
    expect(rgbBinding.slots).toEqual([
      'S0.R', 'S1.R', 'S2.R', null,
      'S0.G', 'S1.G', 'S2.G', null,
      'S0.B', 'S1.B', 'S2.B', null
    ]);
    expect(rgbDopBinding.mode).toBe('empty');
    expect(spectralBinding.mode).toBe('stokesSpectralRgb');
    expect(spectralBinding.slots.slice(0, 4)).toEqual([
      '__spectralStokesRgb:S0',
      '__spectralStokesRgb:S1',
      '__spectralStokesRgb:S2',
      null
    ]);
    expect(spectralDopBinding.mode).toBe('empty');
  });
});
