import { describe, expect, it } from 'vitest';
import { computeRec709Luminance } from '../src/color';
import {
  buildDisplayLuminanceRevisionKey,
  buildDisplaySourceBinding,
  buildDisplayTexture,
  buildDisplayTextureRevisionKey,
  buildSelectedDisplayTexture,
  buildStokesDisplayTexture,
  computeDisplaySelectionLuminanceRange,
  readDisplaySelectionPixelValues,
  samplePixelValues,
  samplePixelValuesForDisplay
} from '../src/display-texture';
import { __debugGetMaterializedChannelCount } from '../src/channel-storage';
import { ImagePixel } from '../src/types';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayer,
  createLayerFromChannels,
  createStokesSelection,
  createViewerState
} from './helpers/state-fixtures';

describe('display texture', () => {
  it('builds RGBA display texture from selected channels', () => {
    const layer = createLayer();
    const texture = buildDisplayTexture(layer, 2, 2, 'R', 'G', 'B');

    expect(texture.length).toBe(16);
    expect(Array.from(texture.slice(0, 4))).toEqual([0, 10, 20, 1]);
    expect(Array.from(texture.slice(12, 16))).toEqual([3, 13, 23, 1]);
  });

  it('writes selected display alpha into RGBA display textures', () => {
    const layer = createLayerFromChannels({
      R: [1, 1, 1, 1],
      G: [0, 0, 0, 0],
      B: [0, 0, 0, 0],
      A: [0.25, 2, -1, Number.NaN]
    }, 'rgba');

    const texture = buildDisplayTexture(layer, 2, 2, 'R', 'G', 'B', 'A');
    expect(Array.from(texture.filter((_, index) => index % 4 === 3))).toEqual([0.25, 1, 0, 0]);
  });

  it('builds grayscale display textures for mono selections', () => {
    const layer = createLayerFromChannels({
      Y: [0.25, 0.5, 0.75, 1]
    }, 'gray');

    const texture = buildSelectedDisplayTexture(layer, 2, 2, createChannelMonoSelection('Y'));
    expect(Array.from(texture.slice(0, 4))).toEqual([0.25, 0.25, 0.25, 1]);
    expect(Array.from(texture.slice(12, 16))).toEqual([1, 1, 1, 1]);
  });

  it('builds a stable revision key for display selection state', () => {
    expect(buildDisplayTextureRevisionKey({
      activeLayer: 0,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    })).toBe('0:channelRgb:R:G:B:');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 1,
      displaySelection: createStokesSelection('aolp', 'stokesRgb', 'G')
    })).toBe('1:stokesAngle:aolp:rgbComponent:G');
  });

  it('builds luminance revision keys that ignore alpha-only channel changes', () => {
    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 0,
      displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A')
    })).toBe('0:channelRgb:R:G:B');

    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 2,
      displaySelection: createChannelMonoSelection('Y', 'A')
    })).toBe('2:channelMono:Y');
  });

  it('builds scalar Stokes AoLP display textures with values duplicated across RGB', () => {
    const layer = createLayerFromChannels({
      S0: [1, 1, 1, 1],
      S1: [1, 0, -1, 0],
      S2: [0, 1, 0, -1],
      S3: [0, 0, 0, 0]
    }, 'stokes');

    const texture = buildStokesDisplayTexture(layer, 2, 2, createStokesSelection('aolp'));

    expect(Array.from(texture.slice(0, 4))).toEqual([0, 0, 0, 1]);
    expect(texture[4]).toBeCloseTo(Math.PI / 4, 6);
    expect(texture[5]).toBeCloseTo(Math.PI / 4, 6);
    expect(texture[8]).toBeCloseTo(Math.PI / 2, 6);
    expect(texture[12]).toBeCloseTo((3 * Math.PI) / 4, 6);
  });

  it('builds scalar Stokes DoLP display textures and stabilizes invalid samples', () => {
    const layer = createLayerFromChannels({
      S0: [1, 2, 0, 1],
      S1: [1, 1, 1, Number.NaN],
      S2: [0, Math.sqrt(3), 1, 0],
      S3: [0, 0, 0, 0]
    }, 'stokes');

    const texture = buildSelectedDisplayTexture(layer, 2, 2, createStokesSelection('dolp'));
    expect(texture[0]).toBeCloseTo(1, 6);
    expect(texture[4]).toBeCloseTo(1, 6);
    expect(texture[8]).toBe(0);
    expect(texture[12]).toBe(0);
  });

  it('builds grouped and split RGB Stokes display textures', () => {
    const layer = createLayerFromChannels({
      'S0.R': [1],
      'S0.G': [2],
      'S0.B': [4],
      'S1.R': [1],
      'S1.G': [1],
      'S1.B': [2],
      'S2.R': [0],
      'S2.G': [Math.sqrt(3)],
      'S2.B': [0],
      'S3.R': [0],
      'S3.G': [0],
      'S3.B': [0]
    }, 'stokes-rgb');

    const grouped = buildSelectedDisplayTexture(layer, 1, 1, createStokesSelection('dolp', 'stokesRgb'));
    const split = buildSelectedDisplayTexture(layer, 1, 1, createStokesSelection('aolp', 'stokesRgb', 'G'));

    expect(grouped[0]).toBeCloseTo(
      Math.sqrt(
        computeRec709Luminance(1, 1, 2) ** 2 +
        computeRec709Luminance(0, Math.sqrt(3), 0) ** 2
      ) / computeRec709Luminance(1, 2, 4),
      6
    );
    expect(split[0]).toBeCloseTo(Math.PI / 6, 6);
    expect(split[1]).toBeCloseTo(Math.PI / 6, 6);
    expect(split[2]).toBeCloseTo(Math.PI / 6, 6);
  });

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

    expect(
      samplePixelValuesForDisplay(scalarLayer, 1, 1, { ix: 0, iy: 0 }, createStokesSelection('aolp'))?.values.AoLP
    ).toBeCloseTo(Math.PI / 4, 6);
    expect(
      samplePixelValuesForDisplay(rgbLayer, 1, 1, { ix: 0, iy: 0 }, createStokesSelection('aolp', 'stokesRgb'))?.values.AoLP
    ).toBeCloseTo(Math.PI / 4, 6);
    expect(
      samplePixelValuesForDisplay(rgbLayer, 1, 1, { ix: 0, iy: 0 }, createStokesSelection('aolp', 'stokesRgb', 'B'))?.values['AoLP.B']
    ).toBeCloseTo(Math.PI / 4, 6);
  });

  it('handles null display selections by returning black textures', () => {
    const layer = createLayer();
    const texture = buildSelectedDisplayTexture(layer, 2, 2, null);
    expect(Array.from(texture)).toEqual(new Array(16).fill(0).map((value, index) => index % 4 === 3 ? 1 : 0));
  });

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

    expect(rgbBinding.mode).toBe('channelRgb');
    expect(rgbBinding.slots.slice(0, 4)).toEqual(['R', 'G', 'B', 'A']);
    expect(rgbBinding.usesImageAlpha).toBe(true);
    expect(rgbBinding.stokesParameter).toBeNull();

    expect(monoBinding.mode).toBe('channelMono');
    expect(monoBinding.slots.slice(0, 4)).toEqual(['G', null, null, 'A']);
    expect(monoBinding.usesImageAlpha).toBe(true);
    expect(monoBinding.stokesParameter).toBeNull();

    expect(stokesBinding.mode).toBe('stokesRgbLuminance');
    expect(stokesBinding.slots).toEqual([
      'S0.R', 'S1.R', 'S2.R', 'S3.R',
      'S0.G', 'S1.G', 'S2.G', 'S3.G',
      'S0.B', 'S1.B', 'S2.B', 'S3.B'
    ]);
    expect(stokesBinding.usesImageAlpha).toBe(false);
    expect(stokesBinding.stokesParameter).toBe('dop');
  });

  it('computes display luminance ranges directly from decoded source channels', () => {
    const layer = createLayerFromChannels({
      R: [0.25, 0.75],
      G: [0.25, 0.75],
      B: [0.25, 0.75]
    });

    expect(computeDisplaySelectionLuminanceRange(
      layer,
      2,
      1,
      createChannelMonoSelection('R')
    )).toEqual({ min: 0.25, max: 0.75 });
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

  it('does not trigger planar materialization during normal display reads', () => {
    const layer = createLayer();

    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    buildSelectedDisplayTexture(layer, 2, 2, createChannelRgbSelection('R', 'G', 'B'));
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    samplePixelValuesForDisplay(layer, 2, 2, { ix: 0, iy: 0 }, createChannelRgbSelection('R', 'G', 'B'));
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
  });

  it('matches revision keys used by viewer state', () => {
    const state = createViewerState({
      activeLayer: 2,
      displaySelection: createChannelMonoSelection('Y', 'A')
    });

    expect(buildDisplayTextureRevisionKey(state)).toBe('2:channelMono:Y:A');
  });
});
