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
import { createLayer, createViewerState } from './helpers/state-fixtures';

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

  it('builds grayscale display texture when one channel drives RGB', () => {
    const layer: DecodedLayer = {
      name: 'gray',
      channelNames: ['Y'],
      channelData: new Map([
        ['Y', new Float32Array([0.25, 0.5, 0.75, 1])]
      ])
    };
    const texture = buildDisplayTexture(layer, 2, 2, 'Y', 'Y', 'Y');

    expect(Array.from(texture.slice(0, 4))).toEqual([0.25, 0.25, 0.25, 1]);
    expect(Array.from(texture.slice(12, 16))).toEqual([1, 1, 1, 1]);
  });

  it('sanitizes non-finite values in the display texture', () => {
    const channelData = new Map<string, Float32Array>();
    channelData.set('R', new Float32Array([NaN, Infinity, -Infinity, 1]));
    channelData.set('G', new Float32Array([2, 2, 2, 2]));
    channelData.set('B', new Float32Array([3, 3, 3, 3]));

    const layer: DecodedLayer = {
      name: 'unstable',
      channelNames: ['R', 'G', 'B'],
      channelData
    };

    const texture = buildDisplayTexture(layer, 2, 2, 'R', 'G', 'B');

    expect(Array.from(texture.slice(0, 12))).toEqual([0, 2, 3, 1, 0, 2, 3, 1, 0, 2, 3, 1]);
    expect(Array.from(texture.slice(12, 16))).toEqual([1, 2, 3, 1]);
  });

  it('builds a stable revision key for display texture selection state', () => {
    expect(buildDisplayTextureRevisionKey({
      activeLayer: 0,
      displaySource: 'channels',
      stokesParameter: null,
      displayR: 'R',
      displayG: 'G',
      displayB: 'B',
      displayA: null
    })).toBe('0:channels::R:G:B:');
    expect(buildDisplayTextureRevisionKey({
      activeLayer: 1,
      displaySource: 'stokesRgb',
      stokesParameter: 'aolp',
      displayR: 'S0.R',
      displayG: 'S0.R',
      displayB: 'S0.R',
      displayA: null
    })).toBe('1:stokesRgb:aolp:S0.R:S0.R:S0.R:');
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

    const texture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 'aolp');

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

    const texture = buildSelectedDisplayTexture(layer, 2, 2, {
      ...createViewerState(),
      displaySource: 'stokesScalar',
      stokesParameter: 'dolp'
    });

    expect(texture[0]).toBeCloseTo(1, 6);
    expect(texture[4]).toBeCloseTo(1, 6);
    expect(texture[8]).toBe(0);
    expect(texture[12]).toBe(0);
  });

  it('builds scalar Stokes DoP and DoCP display textures', () => {
    const layer: DecodedLayer = {
      name: 'stokes',
      channelNames: ['S0', 'S1', 'S2', 'S3'],
      channelData: new Map([
        ['S0', new Float32Array([2, 1, 0, 1])],
        ['S1', new Float32Array([1, 0, 1, 0])],
        ['S2', new Float32Array([1, 0, 1, 0])],
        ['S3', new Float32Array([Math.sqrt(2), -1, 1, Number.NaN])]
      ])
    };

    const dopTexture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 'dop');
    const docpTexture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 'docp');

    expect(dopTexture[0]).toBeCloseTo(1, 6);
    expect(dopTexture[4]).toBeCloseTo(1, 6);
    expect(dopTexture[8]).toBe(0);
    expect(dopTexture[12]).toBe(0);
    expect(docpTexture[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(docpTexture[4]).toBeCloseTo(1, 6);
    expect(docpTexture[8]).toBe(0);
    expect(docpTexture[12]).toBe(0);
  });

  it('builds scalar normalized Stokes component display textures', () => {
    const layer: DecodedLayer = {
      name: 'stokes',
      channelNames: ['S0', 'S1', 'S2', 'S3'],
      channelData: new Map([
        ['S0', new Float32Array([2, 2, 0, Number.NaN])],
        ['S1', new Float32Array([1, -1, 1, 1])],
        ['S2', new Float32Array([-2, 1, 1, 1])],
        ['S3', new Float32Array([4, Number.NaN, 1, 1])]
      ])
    };

    const s1Texture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 's1_over_s0');
    const s2Texture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 's2_over_s0');
    const s3Texture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 's3_over_s0');

    expect(s1Texture[0]).toBeCloseTo(0.5, 6);
    expect(s1Texture[4]).toBeCloseTo(-0.5, 6);
    expect(s1Texture[8]).toBe(0);
    expect(s1Texture[12]).toBe(0);
    expect(s1Texture[3]).toBe(1);
    expect(s2Texture[0]).toBeCloseTo(-1, 6);
    expect(s2Texture[4]).toBeCloseTo(0.5, 6);
    expect(s2Texture[8]).toBe(0);
    expect(s2Texture[12]).toBe(0);
    expect(s3Texture[0]).toBeCloseTo(2, 6);
    expect(s3Texture[4]).toBe(0);
    expect(s3Texture[8]).toBe(0);
    expect(s3Texture[12]).toBe(0);
  });

  it('builds scalar Stokes CoP and ToP display textures from signed ellipticity angle', () => {
    const layer: DecodedLayer = {
      name: 'stokes',
      channelNames: ['S0', 'S1', 'S2', 'S3'],
      channelData: new Map([
        ['S0', new Float32Array([1, 1, 1, 1])],
        ['S1', new Float32Array([0, 0, 1, Number.NaN])],
        ['S2', new Float32Array([0, 0, 0, 0])],
        ['S3', new Float32Array([1, -1, 0, 1])]
      ])
    };

    const copTexture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 'cop');
    const topTexture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 'top');

    expect(copTexture[0]).toBeCloseTo(Math.PI / 4, 6);
    expect(copTexture[4]).toBeCloseTo(-Math.PI / 4, 6);
    expect(copTexture[8]).toBe(0);
    expect(copTexture[12]).toBe(0);
    expect(copTexture[3]).toBe(1);
    expect(copTexture[7]).toBe(1);
    expect(copTexture[11]).toBe(0);
    expect(copTexture[15]).toBe(1);
    expect(topTexture[0]).toBeCloseTo(Math.PI / 4, 6);
    expect(topTexture[4]).toBeCloseTo(-Math.PI / 4, 6);
    expect(topTexture[8]).toBe(0);
    expect(topTexture[12]).toBe(0);
    expect(topTexture[3]).toBe(1);
    expect(topTexture[7]).toBe(1);
    expect(topTexture[11]).toBe(1);
    expect(topTexture[15]).toBe(0);
  });

  it('stores clamped paired degree modulation values in angle Stokes texture alpha', () => {
    const layer: DecodedLayer = {
      name: 'stokes',
      channelNames: ['S0', 'S1', 'S2', 'S3'],
      channelData: new Map([
        ['S0', new Float32Array([2, 1, 2, 0])],
        ['S1', new Float32Array([1, 0, 2, 1])],
        ['S2', new Float32Array([1, 0, 0, 1])],
        ['S3', new Float32Array([0, 2, 2, 1])]
      ])
    };

    const aolpTexture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 'aolp');
    const copTexture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 'cop');
    const topTexture = buildStokesDisplayTexture(layer, 2, 2, 'stokesScalar', 'top');

    expect(aolpTexture[3]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(aolpTexture[7]).toBe(0);
    expect(aolpTexture[11]).toBe(1);
    expect(aolpTexture[15]).toBe(0);
    expect(copTexture[3]).toBe(0);
    expect(copTexture[7]).toBe(1);
    expect(copTexture[11]).toBe(1);
    expect(copTexture[15]).toBe(0);
    expect(topTexture[3]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(topTexture[7]).toBe(1);
    expect(topTexture[11]).toBe(1);
    expect(topTexture[15]).toBe(0);
  });

  it('builds RGB Stokes derived display textures from mono Rec.709 Stokes values', () => {
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
        ['S0.G', new Float32Array([1])],
        ['S0.B', new Float32Array([1])],
        ['S1.R', new Float32Array([1])],
        ['S1.G', new Float32Array([0])],
        ['S1.B', new Float32Array([0])],
        ['S2.R', new Float32Array([0])],
        ['S2.G', new Float32Array([1])],
        ['S2.B', new Float32Array([0])],
        ['S3.R', new Float32Array([0])],
        ['S3.G', new Float32Array([0])],
        ['S3.B', new Float32Array([1])]
      ])
    };

    const texture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 'aolp');
    const expected = 0.5 * Math.atan2(0.7152, 0.2126);

    expect(texture[0]).toBeCloseTo(expected, 6);
    expect(texture[1]).toBeCloseTo(expected, 6);
    expect(texture[2]).toBeCloseTo(expected, 6);
    expect(texture[3]).toBeCloseTo(Math.sqrt(0.2126 ** 2 + 0.7152 ** 2), 6);

    const dopTexture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 'dop');
    const docpTexture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 'docp');
    const copTexture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 'cop');
    const topTexture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 'top');
    const s1Texture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 's1_over_s0');
    const s2Texture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 's2_over_s0');
    const s3Texture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 's3_over_s0');
    const expectedEang = 0.5 * Math.atan2(0.0722, Math.sqrt(0.2126 ** 2 + 0.7152 ** 2));
    expect(dopTexture[0]).toBeCloseTo(Math.sqrt(0.2126 ** 2 + 0.7152 ** 2 + 0.0722 ** 2), 6);
    expect(dopTexture[1]).toBeCloseTo(dopTexture[0], 6);
    expect(dopTexture[2]).toBeCloseTo(dopTexture[0], 6);
    expect(docpTexture[0]).toBeCloseTo(0.0722, 6);
    expect(docpTexture[1]).toBeCloseTo(0.0722, 6);
    expect(docpTexture[2]).toBeCloseTo(0.0722, 6);
    expect(copTexture[0]).toBeCloseTo(expectedEang, 6);
    expect(copTexture[1]).toBeCloseTo(expectedEang, 6);
    expect(copTexture[2]).toBeCloseTo(expectedEang, 6);
    expect(copTexture[3]).toBeCloseTo(0.0722, 6);
    expect(topTexture[0]).toBeCloseTo(expectedEang, 6);
    expect(topTexture[1]).toBeCloseTo(expectedEang, 6);
    expect(topTexture[2]).toBeCloseTo(expectedEang, 6);
    expect(topTexture[3]).toBeCloseTo(Math.sqrt(0.2126 ** 2 + 0.7152 ** 2 + 0.0722 ** 2), 6);
    expect(s1Texture[0]).toBeCloseTo(0.2126, 6);
    expect(s1Texture[1]).toBeCloseTo(0.2126, 6);
    expect(s1Texture[2]).toBeCloseTo(0.2126, 6);
    expect(s2Texture[0]).toBeCloseTo(0.7152, 6);
    expect(s2Texture[1]).toBeCloseTo(0.7152, 6);
    expect(s2Texture[2]).toBeCloseTo(0.7152, 6);
    expect(s3Texture[0]).toBeCloseTo(0.0722, 6);
    expect(s3Texture[1]).toBeCloseTo(0.0722, 6);
    expect(s3Texture[2]).toBeCloseTo(0.0722, 6);
  });

  it('builds split RGB Stokes display textures from the selected component', () => {
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
        ['S0.G', new Float32Array([1])],
        ['S0.B', new Float32Array([2])],
        ['S1.R', new Float32Array([1])],
        ['S1.G', new Float32Array([0])],
        ['S1.B', new Float32Array([0])],
        ['S2.R', new Float32Array([0])],
        ['S2.G', new Float32Array([1])],
        ['S2.B', new Float32Array([0])],
        ['S3.R', new Float32Array([0])],
        ['S3.G', new Float32Array([0])],
        ['S3.B', new Float32Array([1])]
      ])
    };

    const aolpGTexture = buildSelectedDisplayTexture(layer, 1, 1, {
      ...createViewerState(),
      displaySource: 'stokesRgb',
      stokesParameter: 'aolp',
      displayR: 'S0.G',
      displayG: 'S0.G',
      displayB: 'S0.G'
    });
    const docpBTexture = buildSelectedDisplayTexture(layer, 1, 1, {
      ...createViewerState(),
      displaySource: 'stokesRgb',
      stokesParameter: 'docp',
      displayR: 'S0.B',
      displayG: 'S0.B',
      displayB: 'S0.B'
    });
    const s3BTexture = buildSelectedDisplayTexture(layer, 1, 1, {
      ...createViewerState(),
      displaySource: 'stokesRgb',
      stokesParameter: 's3_over_s0',
      displayR: 'S0.B',
      displayG: 'S0.B',
      displayB: 'S0.B'
    });

    expect(aolpGTexture[0]).toBeCloseTo(Math.PI / 4, 6);
    expect(aolpGTexture[1]).toBeCloseTo(Math.PI / 4, 6);
    expect(aolpGTexture[2]).toBeCloseTo(Math.PI / 4, 6);
    expect(aolpGTexture[3]).toBeCloseTo(1, 6);
    expect(docpBTexture[0]).toBeCloseTo(0.5, 6);
    expect(docpBTexture[1]).toBeCloseTo(0.5, 6);
    expect(docpBTexture[2]).toBeCloseTo(0.5, 6);
    expect(s3BTexture[0]).toBeCloseTo(0.5, 6);
    expect(s3BTexture[1]).toBeCloseTo(0.5, 6);
    expect(s3BTexture[2]).toBeCloseTo(0.5, 6);
    expect(s3BTexture[3]).toBe(1);
  });

  it('returns zero for RGB Stokes denominator-derived values when the mono S0 denominator is invalid', () => {
    const layer: DecodedLayer = {
      name: 'stokes-rgb',
      channelNames: [
        'S0.R', 'S0.G', 'S0.B',
        'S1.R', 'S1.G', 'S1.B',
        'S2.R', 'S2.G', 'S2.B',
        'S3.R', 'S3.G', 'S3.B'
      ],
      channelData: new Map([
        ['S0.R', new Float32Array([0])],
        ['S0.G', new Float32Array([0])],
        ['S0.B', new Float32Array([0])],
        ['S1.R', new Float32Array([1])],
        ['S1.G', new Float32Array([1])],
        ['S1.B', new Float32Array([1])],
        ['S2.R', new Float32Array([1])],
        ['S2.G', new Float32Array([1])],
        ['S2.B', new Float32Array([1])],
        ['S3.R', new Float32Array([1])],
        ['S3.G', new Float32Array([1])],
        ['S3.B', new Float32Array([1])]
      ])
    };

    const dolpTexture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 'dolp');
    const dopTexture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 'dop');
    const docpTexture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 'docp');
    const s1Texture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 's1_over_s0');
    const s2Texture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 's2_over_s0');
    const s3Texture = buildStokesDisplayTexture(layer, 1, 1, 'stokesRgb', 's3_over_s0');

    expect(Array.from(dolpTexture)).toEqual([0, 0, 0, 1]);
    expect(Array.from(dopTexture)).toEqual([0, 0, 0, 1]);
    expect(Array.from(docpTexture)).toEqual([0, 0, 0, 1]);
    expect(Array.from(s1Texture)).toEqual([0, 0, 0, 1]);
    expect(Array.from(s2Texture)).toEqual([0, 0, 0, 1]);
    expect(Array.from(s3Texture)).toEqual([0, 0, 0, 1]);
  });

  it('returns exact raw channel values for a probed pixel', () => {
    const layer = createLayer();
    const pixel: ImagePixel = { ix: 1, iy: 1 };

    const sample = samplePixelValues(layer, 2, 2, pixel);

    expect(sample?.values.R).toBe(3);
    expect(sample?.values.G).toBe(13);
    expect(sample?.values.B).toBe(23);
  });

  it('adds selected derived Stokes values to probe samples', () => {
    const layer: DecodedLayer = {
      name: 'stokes',
      channelNames: ['S0', 'S1', 'S2', 'S3'],
      channelData: new Map([
        ['S0', new Float32Array([1])],
        ['S1', new Float32Array([0])],
        ['S2', new Float32Array([1])],
        ['S3', new Float32Array([0])]
      ])
    };

    const sample = samplePixelValuesForDisplay(
      layer,
      1,
      1,
      { ix: 0, iy: 0 },
      {
        ...createViewerState(),
        displaySource: 'stokesScalar',
        stokesParameter: 'aolp'
      }
    );

    expect(sample?.values.S0).toBe(1);
    expect(sample?.values.AoLP).toBeCloseTo(Math.PI / 4, 6);
    expect(sample?.values.DoLP).toBeCloseTo(1, 6);

    const docpSample = samplePixelValuesForDisplay(
      {
        ...layer,
        channelData: new Map([
          ['S0', new Float32Array([2])],
          ['S1', new Float32Array([0])],
          ['S2', new Float32Array([0])],
          ['S3', new Float32Array([-1])]
        ])
      },
      1,
      1,
      { ix: 0, iy: 0 },
      {
        ...createViewerState(),
        displaySource: 'stokesScalar',
        stokesParameter: 'docp'
      }
    );

    expect(docpSample?.values.DoCP).toBeCloseTo(0.5, 6);

    const copSample = samplePixelValuesForDisplay(
      {
        ...layer,
        channelData: new Map([
          ['S0', new Float32Array([1])],
          ['S1', new Float32Array([0])],
          ['S2', new Float32Array([0])],
          ['S3', new Float32Array([-1])]
        ])
      },
      1,
      1,
      { ix: 0, iy: 0 },
      {
        ...createViewerState(),
        displaySource: 'stokesScalar',
        stokesParameter: 'cop'
      }
    );

    expect(copSample?.values.CoP).toBeCloseTo(-Math.PI / 4, 6);
    expect(copSample?.values.DoCP).toBeCloseTo(1, 6);

    const normalizedSample = samplePixelValuesForDisplay(
      {
        ...layer,
        channelData: new Map([
          ['S0', new Float32Array([2])],
          ['S1', new Float32Array([1])],
          ['S2', new Float32Array([-1])],
          ['S3', new Float32Array([4])]
        ])
      },
      1,
      1,
      { ix: 0, iy: 0 },
      {
        ...createViewerState(),
        displaySource: 'stokesScalar',
        stokesParameter: 's2_over_s0'
      }
    );

    expect(normalizedSample?.values['S2/S0']).toBeCloseTo(-0.5, 6);
  });

  it('adds mono-derived RGB Stokes values to probe samples', () => {
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
        ['S0.G', new Float32Array([1])],
        ['S0.B', new Float32Array([1])],
        ['S1.R', new Float32Array([1])],
        ['S1.G', new Float32Array([0])],
        ['S1.B', new Float32Array([0])],
        ['S2.R', new Float32Array([0])],
        ['S2.G', new Float32Array([1])],
        ['S2.B', new Float32Array([0])],
        ['S3.R', new Float32Array([0])],
        ['S3.G', new Float32Array([0])],
        ['S3.B', new Float32Array([1])]
      ])
    };

    const sample = samplePixelValuesForDisplay(
      layer,
      1,
      1,
      { ix: 0, iy: 0 },
      {
        ...createViewerState(),
        displaySource: 'stokesRgb',
        stokesParameter: 'aolp'
      }
    );

    expect(sample?.values['S0.R']).toBe(1);
    expect(sample?.values.AoLP).toBeCloseTo(0.5 * Math.atan2(0.7152, 0.2126), 6);
    expect(sample?.values.DoLP).toBeCloseTo(Math.sqrt(0.2126 ** 2 + 0.7152 ** 2), 6);
    expect(sample?.values['AoLP.R']).toBeUndefined();

    const dopSample = samplePixelValuesForDisplay(
      layer,
      1,
      1,
      { ix: 0, iy: 0 },
      {
        ...createViewerState(),
        displaySource: 'stokesRgb',
        stokesParameter: 'dop'
      }
    );

    expect(dopSample?.values.DoP).toBeCloseTo(Math.sqrt(0.2126 ** 2 + 0.7152 ** 2 + 0.0722 ** 2), 6);
    expect(dopSample?.values['DoP.R']).toBeUndefined();

    const topSample = samplePixelValuesForDisplay(
      layer,
      1,
      1,
      { ix: 0, iy: 0 },
      {
        ...createViewerState(),
        displaySource: 'stokesRgb',
        stokesParameter: 'top'
      }
    );

    expect(topSample?.values.ToP).toBeCloseTo(
      0.5 * Math.atan2(0.0722, Math.sqrt(0.2126 ** 2 + 0.7152 ** 2)),
      6
    );
    expect(topSample?.values.DoP).toBeCloseTo(Math.sqrt(0.2126 ** 2 + 0.7152 ** 2 + 0.0722 ** 2), 6);
    expect(topSample?.values['ToP.R']).toBeUndefined();

    const normalizedSample = samplePixelValuesForDisplay(
      layer,
      1,
      1,
      { ix: 0, iy: 0 },
      {
        ...createViewerState(),
        displaySource: 'stokesRgb',
        stokesParameter: 's1_over_s0'
      }
    );

    expect(normalizedSample?.values['S1/S0']).toBeCloseTo(0.2126, 6);
    expect(normalizedSample?.values['S1/S0.R']).toBeUndefined();
  });

  it('adds split RGB Stokes values to probe samples with component labels', () => {
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
        ['S0.G', new Float32Array([1])],
        ['S0.B', new Float32Array([1])],
        ['S1.R', new Float32Array([1])],
        ['S1.G', new Float32Array([0])],
        ['S1.B', new Float32Array([0])],
        ['S2.R', new Float32Array([0])],
        ['S2.G', new Float32Array([1])],
        ['S2.B', new Float32Array([0])],
        ['S3.R', new Float32Array([0])],
        ['S3.G', new Float32Array([0])],
        ['S3.B', new Float32Array([1])]
      ])
    };

    const sample = samplePixelValuesForDisplay(
      layer,
      1,
      1,
      { ix: 0, iy: 0 },
      {
        ...createViewerState(),
        displaySource: 'stokesRgb',
        stokesParameter: 'aolp',
        displayR: 'S0.G',
        displayG: 'S0.G',
        displayB: 'S0.G'
      }
    );

    expect(sample?.values.AoLP).toBeUndefined();
    expect(sample?.values.DoLP).toBeUndefined();
    expect(sample?.values['AoLP.G']).toBeCloseTo(Math.PI / 4, 6);
    expect(sample?.values['DoLP.G']).toBeCloseTo(1, 6);

    const normalizedSample = samplePixelValuesForDisplay(
      layer,
      1,
      1,
      { ix: 0, iy: 0 },
      {
        ...createViewerState(),
        displaySource: 'stokesRgb',
        stokesParameter: 's2_over_s0',
        displayR: 'S0.G',
        displayG: 'S0.G',
        displayB: 'S0.G'
      }
    );

    expect(normalizedSample?.values['S2/S0']).toBeUndefined();
    expect(normalizedSample?.values['S2/S0.G']).toBeCloseTo(1, 6);
  });
});
