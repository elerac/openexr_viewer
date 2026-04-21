import { describe, expect, it } from 'vitest';
import {
  buildDisplayTexture,
  buildDisplayTextureRevisionKey,
  buildSelectedDisplayTexture,
  buildStokesDisplayTexture,
  samplePixelValues,
  samplePixelValuesForDisplay
} from '../src/display-texture';
import { DecodedLayer, ImagePixel } from '../src/types';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayer,
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
    const layer: DecodedLayer = {
      name: 'rgba',
      channelNames: ['R', 'G', 'B', 'A'],
      channelData: new Map([
        ['R', new Float32Array([1, 1, 1, 1])],
        ['G', new Float32Array([0, 0, 0, 0])],
        ['B', new Float32Array([0, 0, 0, 0])],
        ['A', new Float32Array([0.25, 2, -1, Number.NaN])]
      ])
    };

    const texture = buildDisplayTexture(layer, 2, 2, 'R', 'G', 'B', 'A');
    expect(Array.from(texture.filter((_, index) => index % 4 === 3))).toEqual([0.25, 1, 0, 0]);
  });

  it('builds grayscale display textures for mono selections', () => {
    const layer: DecodedLayer = {
      name: 'gray',
      channelNames: ['Y'],
      channelData: new Map([
        ['Y', new Float32Array([0.25, 0.5, 0.75, 1])]
      ])
    };

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

  it('builds scalar Stokes AoLP display textures with values duplicated across RGB', () => {
    const layer: DecodedLayer = {
      name: 'stokes',
      channelNames: ['S0', 'S1', 'S2', 'S3'],
      channelData: new Map([
        ['S0', new Float32Array([1, 1, 1, 1])],
        ['S1', new Float32Array([1, 0, -1, 0])],
        ['S2', new Float32Array([0, 1, 0, -1])],
        ['S3', new Float32Array([0, 0, 0, 0])]
      ])
    };

    const texture = buildStokesDisplayTexture(layer, 2, 2, createStokesSelection('aolp'));

    expect(Array.from(texture.slice(0, 4))).toEqual([0, 0, 0, 1]);
    expect(texture[4]).toBeCloseTo(Math.PI / 4, 6);
    expect(texture[5]).toBeCloseTo(Math.PI / 4, 6);
    expect(texture[8]).toBeCloseTo(Math.PI / 2, 6);
    expect(texture[12]).toBeCloseTo((3 * Math.PI) / 4, 6);
  });

  it('builds scalar Stokes DoLP display textures and stabilizes invalid samples', () => {
    const layer: DecodedLayer = {
      name: 'stokes',
      channelNames: ['S0', 'S1', 'S2', 'S3'],
      channelData: new Map([
        ['S0', new Float32Array([1, 2, 0, 1])],
        ['S1', new Float32Array([1, 1, 1, Number.NaN])],
        ['S2', new Float32Array([0, Math.sqrt(3), 1, 0])],
        ['S3', new Float32Array([0, 0, 0, 0])]
      ])
    };

    const texture = buildSelectedDisplayTexture(layer, 2, 2, createStokesSelection('dolp'));
    expect(texture[0]).toBeCloseTo(1, 6);
    expect(texture[4]).toBeCloseTo(1, 6);
    expect(texture[8]).toBe(0);
    expect(texture[12]).toBe(0);
  });

  it('builds grouped and split RGB Stokes display textures', () => {
    const layer: DecodedLayer = {
      name: 'stokes-rgb',
      channelNames: [
        'S0.R', 'S0.G', 'S0.B',
        'S1.R', 'S1.G', 'S1.B',
        'S2.R', 'S2.G', 'S2.B',
        'S3.R', 'S3.G', 'S3.B'
      ],
      channelData: new Map([
        ['S0.R', new Float32Array([1])],
        ['S0.G', new Float32Array([2])],
        ['S0.B', new Float32Array([4])],
        ['S1.R', new Float32Array([1])],
        ['S1.G', new Float32Array([1])],
        ['S1.B', new Float32Array([2])],
        ['S2.R', new Float32Array([0])],
        ['S2.G', new Float32Array([Math.sqrt(3)])],
        ['S2.B', new Float32Array([0])],
        ['S3.R', new Float32Array([0])],
        ['S3.G', new Float32Array([0])],
        ['S3.B', new Float32Array([0])]
      ])
    };

    const grouped = buildSelectedDisplayTexture(layer, 1, 1, createStokesSelection('dolp', 'stokesRgb'));
    const split = buildSelectedDisplayTexture(layer, 1, 1, createStokesSelection('aolp', 'stokesRgb', 'G'));

    expect(grouped[0]).toBeCloseTo(
      Math.sqrt(
        (0.2126 * 1 + 0.7152 * 1 + 0.0722 * 2) ** 2 +
        (0.2126 * 0 + 0.7152 * Math.sqrt(3) + 0.0722 * 0) ** 2
      ) / (0.2126 * 1 + 0.7152 * 2 + 0.0722 * 4),
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
    const scalarLayer: DecodedLayer = {
      name: 'scalar-stokes',
      channelNames: ['S0', 'S1', 'S2', 'S3'],
      channelData: new Map([
        ['S0', new Float32Array([1])],
        ['S1', new Float32Array([0])],
        ['S2', new Float32Array([1])],
        ['S3', new Float32Array([0])]
      ])
    };

    const rgbLayer: DecodedLayer = {
      name: 'rgb-stokes',
      channelNames: [
        'S0.R', 'S0.G', 'S0.B',
        'S1.R', 'S1.G', 'S1.B',
        'S2.R', 'S2.G', 'S2.B',
        'S3.R', 'S3.G', 'S3.B'
      ],
      channelData: new Map([
        ['S0.R', new Float32Array([1])],
        ['S0.G', new Float32Array([1])],
        ['S0.B', new Float32Array([1])],
        ['S1.R', new Float32Array([0])],
        ['S1.G', new Float32Array([0])],
        ['S1.B', new Float32Array([0])],
        ['S2.R', new Float32Array([1])],
        ['S2.G', new Float32Array([1])],
        ['S2.B', new Float32Array([1])],
        ['S3.R', new Float32Array([0])],
        ['S3.G', new Float32Array([0])],
        ['S3.B', new Float32Array([0])]
      ])
    };

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

  it('matches revision keys used by viewer state', () => {
    const state = createViewerState({
      activeLayer: 2,
      displaySelection: createChannelMonoSelection('Y', 'A')
    });

    expect(buildDisplayTextureRevisionKey(state)).toBe('2:channelMono:Y:A');
  });
});
