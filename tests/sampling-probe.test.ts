import { describe, expect, it } from 'vitest';
import {
  readDisplaySelectionPixelValues,
  samplePixelValues,
  samplePixelValuesForDisplay
} from '../src/sampling/probe';
import type { ImagePixel } from '../src/types';
import {
  createLayer,
  createLayerFromChannels,
  createStokesSelection
} from './helpers/state-fixtures';

describe('display probe sampling', () => {
  it('samples raw pixel values for valid pixels only', () => {
    const layer = createLayer();
    const insidePixel: ImagePixel = { ix: 1, iy: 1 };
    const outsidePixel: ImagePixel = { ix: 2, iy: 2 };

    expect(samplePixelValues(layer, 2, 2, insidePixel)?.values).toEqual({ R: 3, G: 13, B: 23 });
    expect(samplePixelValues(layer, 2, 2, outsidePixel)).toBeNull();
  });

  it('appends semantic Stokes sample values for scalar, grouped RGB, and split RGB selections', () => {
    const scalarLayer = createLayerFromChannels({
      S0: [1],
      S1: [0],
      S2: [1],
      S3: [0]
    }, 'scalar-stokes');

    const rgbLayer = createLayerFromChannels({
      'S0.R': [1],
      'S0.G': [1],
      'S0.B': [1],
      'S1.R': [0],
      'S1.G': [0],
      'S1.B': [0],
      'S2.R': [1],
      'S2.G': [1],
      'S2.B': [1],
      'S3.R': [0],
      'S3.G': [0],
      'S3.B': [0]
    }, 'rgb-stokes');
    const suffixedLayer = createLayerFromChannels({
      'S0.Y': [1],
      'S1.Y': [0],
      'S2.Y': [1],
      'S3.Y': [0]
    }, 'suffixed-stokes');
    const spectralChannels: Record<string, number[]> = {};
    for (let wavelength = 380; wavelength <= 780; wavelength += 20) {
      spectralChannels[`S0.${wavelength}nm`] = [1];
      spectralChannels[`S1.${wavelength}nm`] = [-0.5];
      spectralChannels[`S2.${wavelength}nm`] = [0];
      spectralChannels[`S3.${wavelength}nm`] = [0];
    }
    const spectralLayer = createLayerFromChannels(spectralChannels, 'spectral-stokes');

    expect(
      samplePixelValuesForDisplay(scalarLayer, 1, 1, { ix: 0, iy: 0 }, createStokesSelection('aolp'))?.values.AoLP
    ).toBeCloseTo(Math.PI / 4, 6);
    expect(
      samplePixelValuesForDisplay(
        suffixedLayer,
        1,
        1,
        { ix: 0, iy: 0 },
        createStokesSelection('aolp', 'stokesScalar', null, 'Y')
      )?.values['AoLP.Y']
    ).toBeCloseTo(Math.PI / 4, 6);
    expect(
      samplePixelValuesForDisplay(
        suffixedLayer,
        1,
        1,
        { ix: 0, iy: 0 },
        createStokesSelection('aolp', 'stokesScalar', null, 'Y')
      )?.values['DoLP.Y']
    ).toBeCloseTo(1, 6);
    expect(
      samplePixelValuesForDisplay(rgbLayer, 1, 1, { ix: 0, iy: 0 }, createStokesSelection('aolp', 'stokesRgb'))?.values['AoLP.R']
    ).toBeCloseTo(Math.PI / 4, 6);
    expect(
      samplePixelValuesForDisplay(rgbLayer, 1, 1, { ix: 0, iy: 0 }, createStokesSelection('aolp', 'stokesRgb'))?.values['AoLP.G']
    ).toBeCloseTo(Math.PI / 4, 6);
    expect(
      samplePixelValuesForDisplay(rgbLayer, 1, 1, { ix: 0, iy: 0 }, createStokesSelection('aolp', 'stokesRgb'))?.values['AoLP.B']
    ).toBeCloseTo(Math.PI / 4, 6);
    expect(
      samplePixelValuesForDisplay(rgbLayer, 1, 1, { ix: 0, iy: 0 }, createStokesSelection('aolp', 'stokesRgb', 'B'))?.values['AoLP.B']
    ).toBeCloseTo(Math.PI / 4, 6);
    expect(
      samplePixelValuesForDisplay(
        rgbLayer,
        1,
        1,
        { ix: 0, iy: 0 },
        createStokesSelection('aolp', 'stokesRgb'),
        'colormap'
      )?.values.AoLP
    ).toBeCloseTo(Math.PI / 4, 6);
    expect(
      samplePixelValuesForDisplay(
        spectralLayer,
        1,
        1,
        { ix: 0, iy: 0 },
        createStokesSelection('s1_over_s0', 'stokesSpectralRgb')
      )?.values['S1/S0 Spectral RGB.R']
    ).toBeCloseTo(-0.5, 5);
    expect(
      samplePixelValuesForDisplay(
        spectralLayer,
        1,
        1,
        { ix: 0, iy: 0 },
        createStokesSelection('s1_over_s0', 'stokesSpectralRgb'),
        'colormap'
      )?.values['S1/S0 Spectral RGB']
    ).toBeCloseTo(-0.5, 5);
  });

  it('reads per-pixel display values for overlays without overloading stokes alpha', () => {
    const layer = createLayerFromChannels({
      S0: [1],
      S1: [1],
      S2: [0],
      S3: [0]
    }, 'stokes');

    expect(readDisplaySelectionPixelValues(
      layer,
      1,
      1,
      { ix: 0, iy: 0 },
      createStokesSelection('aolp')
    )).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 1
    });
  });
});
