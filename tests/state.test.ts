import { describe, expect, it } from 'vitest';
import { DEFAULT_COLORMAP_ID } from '../src/colormaps';
import {
  buildChannelDisplayOptions,
  buildDisplayHistogram,
  buildLayerDisplayHistogram,
  buildSelectedDisplayTexture,
  buildDisplayTexture,
  buildStokesDisplayTexture,
  buildViewerStateForLayer,
  buildSessionDisplayName,
  buildZeroCenteredColormapRange,
  computeStokesAolp,
  computeStokesDocp,
  computeStokesDop,
  computeStokesDolp,
  computeStokesEang,
  computeStokesNormalizedComponent,
  computeDisplayTextureLuminanceRange,
  computeHistogramRenderCeiling,
  createInitialState,
  detectRgbStokesChannels,
  detectScalarStokesChannels,
  extractRgbChannelGroups,
  findMergedSelectionForSplitDisplay,
  findSelectedRgbGroup,
  findSplitSelectionForMergedDisplay,
  getStokesDisplayOptions,
  persistActiveSessionState,
  pickDefaultDisplayChannels,
  pickNextSessionIndexAfterRemoval,
  scaleHistogramCount,
  samplePixelValuesForDisplay,
  samplePixelValues
} from '../src/state';
import { DecodedExrImage, DecodedLayer, ImagePixel, ViewerState } from '../src/types';

function createLayer(): DecodedLayer {
  const channelData = new Map<string, Float32Array>();
  channelData.set('R', new Float32Array([0, 1, 2, 3]));
  channelData.set('G', new Float32Array([10, 11, 12, 13]));
  channelData.set('B', new Float32Array([20, 21, 22, 23]));

  return {
    name: 'beauty',
    channelNames: ['R', 'G', 'B'],
    channelData
  };
}

function createImage(layers: DecodedLayer[]): DecodedExrImage {
  return {
    width: 2,
    height: 2,
    layers
  };
}

function createViewerState(overrides: Partial<ViewerState> = {}): ViewerState {
  return {
    ...createInitialState(),
    ...overrides
  };
}

describe('state helpers', () => {
  it('defaults to normal RGB visualization mode', () => {
    expect(createInitialState().visualizationMode).toBe('rgb');
    expect(createInitialState().activeColormapId).toBe(DEFAULT_COLORMAP_ID);
    expect(createInitialState().colormapRange).toBeNull();
    expect(createInitialState().colormapRangeMode).toBe('alwaysAuto');
    expect(createInitialState().colormapZeroCentered).toBe(false);
    expect(createInitialState().displaySource).toBe('channels');
    expect(createInitialState().stokesParameter).toBeNull();
    expect(createInitialState().stokesDegreeModulation).toEqual({
      aolp: false,
      cop: true,
      top: true
    });
  });

  it('builds RGBA display texture from selected channels', () => {
    const layer = createLayer();
    const texture = buildDisplayTexture(layer, 2, 2, 'R', 'G', 'B');

    expect(texture.length).toBe(16);
    expect(Array.from(texture.slice(0, 4))).toEqual([0, 10, 20, 1]);
    expect(Array.from(texture.slice(12, 16))).toEqual([3, 13, 23, 1]);
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

  it('detects scalar and RGB Stokes channel layouts', () => {
    expect(detectScalarStokesChannels(['S0', 'S1', 'S2', 'S3'])).toEqual({
      s0: 'S0',
      s1: 'S1',
      s2: 'S2',
      s3: 'S3'
    });
    expect(detectScalarStokesChannels(['S0', 'S1', 'S2'])).toBeNull();

    const rgbNames = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B',
      'S3.R', 'S3.G', 'S3.B'
    ];
    expect(detectRgbStokesChannels(rgbNames)?.r).toEqual({
      s0: 'S0.R',
      s1: 'S1.R',
      s2: 'S2.R',
      s3: 'S3.R'
    });
    expect(getStokesDisplayOptions(['S0', 'S1', 'S2', 'S3']).map((option) => option.label)).toEqual([
      'Stokes AoLP',
      'Stokes DoLP',
      'Stokes DoP',
      'Stokes DoCP',
      'Stokes CoP',
      'Stokes ToP',
      'Stokes S1/S0',
      'Stokes S2/S0',
      'Stokes S3/S0'
    ]);
    expect(getStokesDisplayOptions(rgbNames).map((option) => option.label)).toEqual([
      'AoLP.(R,G,B)',
      'DoLP.(R,G,B)',
      'DoP.(R,G,B)',
      'DoCP.(R,G,B)',
      'CoP.(R,G,B)',
      'ToP.(R,G,B)',
      'S1/S0.(R,G,B)',
      'S2/S0.(R,G,B)',
      'S3/S0.(R,G,B)'
    ]);
    expect(getStokesDisplayOptions(rgbNames, {
      includeRgbGroups: false,
      includeSplitChannels: true
    }).map((option) => option.label)).toEqual([
      'AoLP.R',
      'AoLP.G',
      'AoLP.B',
      'DoLP.R',
      'DoLP.G',
      'DoLP.B',
      'DoP.R',
      'DoP.G',
      'DoP.B',
      'DoCP.R',
      'DoCP.G',
      'DoCP.B',
      'CoP.R',
      'CoP.G',
      'CoP.B',
      'ToP.R',
      'ToP.G',
      'ToP.B',
      'S1/S0.R',
      'S1/S0.G',
      'S1/S0.B',
      'S2/S0.R',
      'S2/S0.G',
      'S2/S0.B',
      'S3/S0.R',
      'S3/S0.G',
      'S3/S0.B'
    ]);
    expect(getStokesDisplayOptions(rgbNames, {
      includeRgbGroups: false,
      includeSplitChannels: true
    })[0]?.mapping).toEqual({
      displayR: 'S0.R',
      displayG: 'S0.R',
      displayB: 'S0.R'
    });
  });

  it('computes derived Stokes values', () => {
    expect(computeStokesAolp(1, 0)).toBeCloseTo(0, 6);
    expect(computeStokesAolp(0, 1)).toBeCloseTo(Math.PI / 4, 6);
    expect(computeStokesAolp(-1, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(computeStokesAolp(0, -1)).toBeCloseTo((3 * Math.PI) / 4, 6);
    expect(computeStokesAolp(Number.NaN, 1)).toBe(0);

    expect(computeStokesDolp(1, 1, 0)).toBeCloseTo(1, 6);
    expect(computeStokesDolp(2, 1, Math.sqrt(3))).toBeCloseTo(1, 6);
    expect(computeStokesDolp(0, 1, 1)).toBe(0);
    expect(computeStokesDolp(1, Number.NaN, 1)).toBe(0);

    expect(computeStokesDop(1, 0, 0, 0)).toBe(0);
    expect(computeStokesDop(1, 1, 0, 0)).toBeCloseTo(1, 6);
    expect(computeStokesDop(2, 1, 1, Math.sqrt(2))).toBeCloseTo(1, 6);
    expect(computeStokesDop(0, 1, 1, 1)).toBe(0);
    expect(computeStokesDop(1, 1, Number.NaN, 1)).toBe(0);

    expect(computeStokesDocp(1, 0)).toBe(0);
    expect(computeStokesDocp(2, -1)).toBeCloseTo(0.5, 6);
    expect(computeStokesDocp(0, 1)).toBe(0);
    expect(computeStokesDocp(1, Number.NaN)).toBe(0);

    expect(computeStokesEang(0, 0, 1)).toBeCloseTo(Math.PI / 4, 6);
    expect(computeStokesEang(0, 0, -1)).toBeCloseTo(-Math.PI / 4, 6);
    expect(computeStokesEang(1, 0, 0)).toBe(0);
    expect(computeStokesEang(Number.NaN, 0, 1)).toBe(0);

    expect(computeStokesNormalizedComponent(2, 1)).toBeCloseTo(0.5, 6);
    expect(computeStokesNormalizedComponent(2, -1)).toBeCloseTo(-0.5, 6);
    expect(computeStokesNormalizedComponent(0, 1)).toBe(0);
    expect(computeStokesNormalizedComponent(Number.NaN, 1)).toBe(0);
    expect(computeStokesNormalizedComponent(1, Number.NaN)).toBe(0);
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

  it('computes finite luminance range from a display texture', () => {
    const texture = new Float32Array([
      1, 0, 0, 1,
      0, 1, 0, 1,
      0, 0, 1, 1
    ]);

    const range = computeDisplayTextureLuminanceRange(texture);

    expect(range?.min).toBeCloseTo(0.0722, 6);
    expect(range?.max).toBeCloseTo(0.7152, 6);
  });

  it('keeps collapsed luminance ranges explicit and returns null for empty textures', () => {
    const flatTexture = new Float32Array([
      0.25, 0.25, 0.25, 1,
      0.25, 0.25, 0.25, 1
    ]);

    expect(computeDisplayTextureLuminanceRange(flatTexture)).toEqual({
      min: 0.25,
      max: 0.25
    });
    expect(computeDisplayTextureLuminanceRange(new Float32Array())).toBeNull();
  });

  it('builds zero-centered colormap ranges from the largest absolute bound', () => {
    expect(buildZeroCenteredColormapRange({ min: -2, max: 1 })).toEqual({ min: -2, max: 2 });
    expect(buildZeroCenteredColormapRange({ min: 0.2, max: 3 })).toEqual({ min: -3, max: 3 });
    expect(buildZeroCenteredColormapRange({ min: 0, max: 0 })).toEqual({ min: -1, max: 1 });
  });

  it('returns exact raw channel values for a probed pixel', () => {
    const layer = createLayer();
    const pixel: ImagePixel = { ix: 1, iy: 1 };

    const sample = samplePixelValues(layer, 2, 2, pixel);

    expect(sample?.values.R).toBe(3);
    expect(sample?.values.G).toBe(13);
    expect(sample?.values.B).toBe(23);
  });

  it('builds raw-count luminance histogram with dynamic domain bounds', () => {
    const displayTexture = new Float32Array([
      0.01, 0.01, 0.01, 1,
      0.1, 0.1, 0.1, 1,
      0.4, 0.4, 0.4, 1,
      1.0, 1.0, 1.0, 1
    ]);

    const histogram = buildDisplayHistogram(displayTexture, {
      bins: 32,
      xAxis: 'linear'
    });

    expect(histogram.mode).toBe('luminance');
    expect(histogram.xAxis).toBe('linear');
    expect(histogram.channelBins).toBeNull();
    expect(histogram.bins.length).toBe(32);
    expect(Array.from(histogram.bins).reduce((sum, value) => sum + value, 0)).toBe(4);
    expect(histogram.min).toBeCloseTo(0.01, 6);
    expect(histogram.max).toBeCloseTo(1.0, 6);
    expect(histogram.mean).toBeCloseTo(0.3775, 6);
    expect(histogram.channelMeans).toBeNull();
    expect(histogram.nonPositiveCount).toBe(0);
  });

  it('builds RGB histogram when requested', () => {
    const displayTexture = new Float32Array([
      0.0, 0.2, 0.8, 1,
      0.2, 0.4, 0.6, 1,
      0.6, 0.8, 0.4, 1,
      0.8, 1.0, 0.2, 1
    ]);

    const histogram = buildDisplayHistogram(displayTexture, {
      bins: 32,
      mode: 'rgb',
      xAxis: 'linear'
    });

    expect(histogram.mode).toBe('rgb');
    expect(histogram.channelBins).not.toBeNull();
    expect(histogram.channelBins?.r.length).toBe(32);
    expect(histogram.channelBins?.g.length).toBe(32);
    expect(histogram.channelBins?.b.length).toBe(32);
    expect(Array.from(histogram.channelBins?.r ?? []).reduce((sum, value) => sum + value, 0)).toBe(4);
    expect(Array.from(histogram.channelBins?.g ?? []).reduce((sum, value) => sum + value, 0)).toBe(4);
    expect(Array.from(histogram.channelBins?.b ?? []).reduce((sum, value) => sum + value, 0)).toBe(4);
    expect(histogram.min).toBeCloseTo(0, 6);
    expect(histogram.max).toBeCloseTo(1, 6);
    expect(histogram.mean).toBeCloseTo(0.5, 6);
    expect(histogram.channelMeans?.r).toBeCloseTo(0.4, 6);
    expect(histogram.channelMeans?.g).toBeCloseTo(0.6, 6);
    expect(histogram.channelMeans?.b).toBeCloseTo(0.5, 6);
    expect(histogram.channelNonPositiveCounts).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('is exposure independent for same display texture input', () => {
    const displayTexture = new Float32Array([
      0.05, 0.1, 0.2, 1,
      0.2, 0.3, 0.4, 1,
      0.8, 0.7, 0.6, 1
    ]);

    const first = buildDisplayHistogram(displayTexture, { bins: 16, xAxis: 'ev' });
    const second = buildDisplayHistogram(displayTexture, { bins: 16, xAxis: 'ev' });
    expect(first.mode).toBe('luminance');
    expect(Array.from(first.bins)).toEqual(Array.from(second.bins));
    expect(first.min).toBe(second.min);
    expect(first.max).toBe(second.max);
  });

  it('uses EV x-axis binning by default', () => {
    const values = [0.25, 0.5, 1, 2, 4];
    const displayTexture = new Float32Array(
      values.flatMap((v) => [v, v, v, 1])
    );

    const histogram = buildDisplayHistogram(displayTexture, { bins: 5 });
    const nonZeroBins = Array.from(histogram.bins)
      .map((v, i) => (v > 0 ? i : -1))
      .filter((i) => i >= 0);

    expect(nonZeroBins).toEqual([0, 1, 2, 3, 4]);
    expect(histogram.min).toBeCloseTo(-2, 6);
    expect(histogram.max).toBeCloseTo(2, 6);
  });

  it('counts non-positive samples in the dedicated EV bucket only', () => {
    const values = [0, -1, 1, 2];
    const displayTexture = new Float32Array(values.flatMap((v) => [v, v, v, 1]));

    const histogram = buildDisplayHistogram(displayTexture, { bins: 4, xAxis: 'ev' });

    expect(histogram.nonPositiveCount).toBe(2);
    expect(Array.from(histogram.bins).reduce((sum, value) => sum + value, 0)).toBe(2);
  });

  it('uses linear x-axis binning when requested', () => {
    const values = [0, 1, 2, 3];
    const displayTexture = new Float32Array(values.flatMap((v) => [v, v, v, 1]));

    const histogram = buildDisplayHistogram(displayTexture, { bins: 4, xAxis: 'linear' });
    const nonZeroBins = Array.from(histogram.bins)
      .map((v, i) => (v > 0 ? i : -1))
      .filter((i) => i >= 0);

    expect(nonZeroBins).toEqual([0, 1, 2, 3]);
  });

  it('derives distinct y-axis heights from the same raw histogram counts', () => {
    const count = 4;
    const ceiling = 16;

    expect(scaleHistogramCount(count, ceiling, 'linear')).toBeCloseTo(0.25, 6);
    expect(scaleHistogramCount(count, ceiling, 'sqrt')).toBeCloseTo(0.5, 6);
    expect(scaleHistogramCount(count, ceiling, 'log')).toBeCloseTo(
      Math.log1p(4) / Math.log1p(16),
      6
    );
  });

  it('keeps the main distribution visible when one bin dominates', () => {
    const values = [
      ...new Array<number>(50).fill(0),
      ...new Array<number>(5).fill(0.1),
      ...new Array<number>(5).fill(0.2),
      ...new Array<number>(5).fill(0.4),
      ...new Array<number>(5).fill(0.8)
    ];
    const displayTexture = new Float32Array(values.flatMap((v) => [v, v, v, 1]));

    const histogram = buildDisplayHistogram(displayTexture, { bins: 64, xAxis: 'ev' });
    const ceiling = computeHistogramRenderCeiling(histogram);

    expect(ceiling).toBe(5);
    expect(scaleHistogramCount(histogram.nonPositiveCount, ceiling, 'linear')).toBe(1);
  });

  it('re-resolves display channels when switching to a layer without the current mapping', () => {
    const altLayer: DecodedLayer = {
      name: 'alt',
      channelNames: ['X', 'Y', 'Z'],
      channelData: new Map([
        ['X', new Float32Array([4, 4, 4, 4])],
        ['Y', new Float32Array([5, 5, 5, 5])],
        ['Z', new Float32Array([6, 6, 6, 6])]
      ])
    };
    const image = createImage([createLayer(), altLayer]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        displayR: 'R',
        displayG: 'G',
        displayB: 'B'
      }),
      image,
      1
    );

    expect(nextState.activeLayer).toBe(1);
    expect(nextState.displayR).toBe('X');
    expect(nextState.displayG).toBe('Y');
    expect(nextState.displayB).toBe('Z');
  });

  it('resolves a real default mapping when the current selection is all zero channels', () => {
    const image = createImage([createLayer()]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        displayR: '__ZERO__',
        displayG: '__ZERO__',
        displayB: '__ZERO__'
      }),
      image,
      0
    );

    expect(nextState.displayR).toBe('R');
    expect(nextState.displayG).toBe('G');
    expect(nextState.displayB).toBe('B');
  });

  it('clamps an out-of-range layer selection and restores a valid mapping', () => {
    const image = createImage([createLayer()]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        activeLayer: 3,
        displayR: 'X',
        displayG: 'Y',
        displayB: 'Z'
      }),
      image,
      3
    );

    expect(nextState.activeLayer).toBe(0);
    expect(nextState.displayR).toBe('R');
    expect(nextState.displayG).toBe('G');
    expect(nextState.displayB).toBe('B');
  });

  it('preserves available Stokes selections and falls back when unavailable', () => {
    const stokesLayer: DecodedLayer = {
      name: 'stokes',
      channelNames: ['S0', 'S1', 'S2', 'S3'],
      channelData: new Map([
        ['S0', new Float32Array([1, 1, 1, 1])],
        ['S1', new Float32Array([1, 1, 1, 1])],
        ['S2', new Float32Array([0, 0, 0, 0])],
        ['S3', new Float32Array([0, 0, 0, 0])]
      ])
    };
    const image = createImage([stokesLayer, createLayer()]);

    const preserved = buildViewerStateForLayer(
      createViewerState({
        displaySource: 'stokesScalar',
        stokesParameter: 'aolp',
        displayR: 'S0',
        displayG: 'S1',
        displayB: 'S2'
      }),
      image,
      0
    );
    expect(preserved.displaySource).toBe('stokesScalar');
    expect(preserved.stokesParameter).toBe('aolp');

    const fallback = buildViewerStateForLayer(preserved, image, 1);
    expect(fallback.displaySource).toBe('channels');
    expect(fallback.stokesParameter).toBeNull();
    expect(fallback.displayR).toBe('R');
    expect(fallback.displayG).toBe('G');
    expect(fallback.displayB).toBe('B');
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

  it('builds layer histograms without counting non-finite samples', () => {
    const channel = new Float32Array([1, Number.NaN, 0.5, 2]);
    const layer: DecodedLayer = {
      name: 'histogram',
      channelNames: ['R', 'G', 'B'],
      channelData: new Map([
        ['R', channel],
        ['G', channel],
        ['B', channel]
      ])
    };

    const histogram = buildLayerDisplayHistogram(layer, 2, 2, 'R', 'G', 'B', {
      bins: 4,
      xAxis: 'linear'
    });

    expect(histogram.mode).toBe('luminance');
    expect(Array.from(histogram.bins).reduce((sum, value) => sum + value, 0)).toBe(3);
    expect(histogram.mean).toBeCloseTo((1 + 0.5 + 2) / 3, 6);
  });

  it('extracts RGB groups from channel namespaces', () => {
    const groups = extractRgbChannelGroups([
      'HOGE.R',
      'HOGE.G',
      'HOGE.B',
      'FUGA.R',
      'FUGA.G',
      'FUGA.B',
      'depth.Z'
    ]);

    expect(groups.map((group) => group.key)).toEqual(['FUGA', 'HOGE']);
    expect(groups[0]).toEqual({
      key: 'FUGA',
      label: 'FUGA.(R,G,B)',
      r: 'FUGA.R',
      g: 'FUGA.G',
      b: 'FUGA.B'
    });
  });

  it('matches selected display channels to an RGB group', () => {
    const groups = extractRgbChannelGroups(['HOGE.R', 'HOGE.G', 'HOGE.B']);

    const match = findSelectedRgbGroup(groups, 'HOGE.R', 'HOGE.G', 'HOGE.B');
    expect(match?.key).toBe('HOGE');

    const noMatch = findSelectedRgbGroup(groups, 'HOGE.R', 'HOGE.G', '__ZERO__');
    expect(noMatch).toBeNull();
  });

  it('labels bare R/G/B group as R,G,B', () => {
    const groups = extractRgbChannelGroups(['R', 'G', 'B']);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('R,G,B');
  });

  it('builds grouped channel display options for bare RGB by default', () => {
    const options = buildChannelDisplayOptions(['R', 'G', 'B']);

    expect(options.map((option) => option.label)).toEqual(['R,G,B']);
    expect(options[0]?.mapping).toEqual({
      displayR: 'R',
      displayG: 'G',
      displayB: 'B'
    });
  });

  it('builds grouped and split channel display options for bare RGB when requested', () => {
    const options = buildChannelDisplayOptions(['R', 'G', 'B'], { includeSplitChannels: true });

    expect(options.map((option) => option.label)).toEqual(['R,G,B', 'R', 'G', 'B']);
    expect(options[0]?.mapping).toEqual({
      displayR: 'R',
      displayG: 'G',
      displayB: 'B'
    });
    expect(options[1]?.mapping).toEqual({
      displayR: 'R',
      displayG: 'R',
      displayB: 'R'
    });
    expect(options[2]?.mapping).toEqual({
      displayR: 'G',
      displayG: 'G',
      displayB: 'G'
    });
    expect(options[3]?.mapping).toEqual({
      displayR: 'B',
      displayG: 'B',
      displayB: 'B'
    });
  });

  it('builds split-only channel display options for bare RGB when groups are hidden', () => {
    const options = buildChannelDisplayOptions(['R', 'G', 'B'], {
      includeRgbGroups: false,
      includeSplitChannels: true
    });

    expect(options.map((option) => option.label)).toEqual(['R', 'G', 'B']);
    expect(options[0]?.mapping).toEqual({
      displayR: 'R',
      displayG: 'R',
      displayB: 'R'
    });
  });

  it('builds grouped and split channel display options for namespaced RGB when requested', () => {
    const defaultOptions = buildChannelDisplayOptions(['HOGE.R', 'HOGE.G', 'HOGE.B', 'HOGE.A']);
    const splitOptions = buildChannelDisplayOptions(['HOGE.R', 'HOGE.G', 'HOGE.B', 'HOGE.A'], {
      includeSplitChannels: true
    });
    const splitOnlyOptions = buildChannelDisplayOptions(['HOGE.R', 'HOGE.G', 'HOGE.B', 'HOGE.A'], {
      includeRgbGroups: false,
      includeSplitChannels: true
    });

    expect(defaultOptions.map((option) => option.label)).toEqual(['HOGE.(R,G,B,A)']);
    expect(splitOptions.map((option) => option.label)).toEqual([
      'HOGE.(R,G,B,A)',
      'HOGE.R',
      'HOGE.G',
      'HOGE.B'
    ]);
    expect(splitOptions[1]?.mapping).toEqual({
      displayR: 'HOGE.R',
      displayG: 'HOGE.R',
      displayB: 'HOGE.R'
    });
    expect(splitOnlyOptions.map((option) => option.label)).toEqual(['HOGE.R', 'HOGE.G', 'HOGE.B']);
  });

  it('remaps grouped and split RGB Stokes selections when toggling split mode', () => {
    const rgbStokesNames = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B',
      'S3.R', 'S3.G', 'S3.B'
    ];
    const grouped = {
      ...createViewerState(),
      displaySource: 'stokesRgb' as const,
      stokesParameter: 'aolp' as const,
      displayR: 'S0.R',
      displayG: 'S0.G',
      displayB: 'S0.B'
    };
    const split = findSplitSelectionForMergedDisplay(rgbStokesNames, grouped);

    expect(split).toEqual({
      displaySource: 'stokesRgb',
      stokesParameter: 'aolp',
      displayR: 'S0.R',
      displayG: 'S0.R',
      displayB: 'S0.R'
    });
    if (!split) {
      throw new Error('Expected split Stokes selection.');
    }
    expect(findMergedSelectionForSplitDisplay(rgbStokesNames, split)).toEqual({
      displaySource: 'stokesRgb',
      stokesParameter: 'aolp',
      displayR: 'S0.R',
      displayG: 'S0.G',
      displayB: 'S0.B'
    });
  });

  it('labels RGB groups with alpha as R,G,B,A', () => {
    const bare = extractRgbChannelGroups(['R', 'G', 'B', 'A']);
    expect(bare).toHaveLength(1);
    expect(bare[0]?.label).toBe('R,G,B,A');

    const namespaced = extractRgbChannelGroups(['HOGE.R', 'HOGE.G', 'HOGE.B', 'HOGE.A']);
    expect(namespaced).toHaveLength(1);
    expect(namespaced[0]?.label).toBe('HOGE.(R,G,B,A)');
  });

  it('prefers detected RGB group as default display mapping', () => {
    const defaults = pickDefaultDisplayChannels(['AOV.X', 'HOGE.B', 'HOGE.R', 'HOGE.G']);

    expect(defaults).toEqual({
      displayR: 'HOGE.R',
      displayG: 'HOGE.G',
      displayB: 'HOGE.B'
    });
  });

  it('computes colormap luminance range from a repeated single-channel mapping', () => {
    const layer: DecodedLayer = {
      name: 'single-channel',
      channelNames: ['R', 'G', 'B'],
      channelData: new Map([
        ['R', new Float32Array([10, 20])],
        ['G', new Float32Array([0.25, 0.75])],
        ['B', new Float32Array([100, 200])]
      ])
    };

    const texture = buildDisplayTexture(layer, 2, 1, 'G', 'G', 'G');
    const range = computeDisplayTextureLuminanceRange(texture);

    expect(range?.min).toBeCloseTo(0.25, 6);
    expect(range?.max).toBeCloseTo(0.75, 6);
  });

  it('uses single-channel layers as grayscale default display mapping', () => {
    const defaults = pickDefaultDisplayChannels(['Y']);

    expect(defaults).toEqual({
      displayR: 'Y',
      displayG: 'Y',
      displayB: 'Y'
    });
  });

  it('uses the non-alpha channel as grayscale default display mapping', () => {
    const defaults = pickDefaultDisplayChannels(['Y', 'A']);

    expect(defaults).toEqual({
      displayR: 'Y',
      displayG: 'Y',
      displayB: 'Y'
    });
  });

  it('builds disambiguated session labels for duplicate filenames', () => {
    const first = buildSessionDisplayName('sample.exr', []);
    const second = buildSessionDisplayName('sample.exr', ['sample.exr']);
    const third = buildSessionDisplayName('sample.exr', ['sample.exr', 'other.exr', 'sample.exr']);

    expect(first).toBe('sample.exr');
    expect(second).toBe('sample.exr (2)');
    expect(third).toBe('sample.exr (3)');
  });

  it('selects nearest next index after closing active session', () => {
    expect(pickNextSessionIndexAfterRemoval(1, 2)).toBe(1);
    expect(pickNextSessionIndexAfterRemoval(2, 2)).toBe(1);
    expect(pickNextSessionIndexAfterRemoval(0, 1)).toBe(0);
    expect(pickNextSessionIndexAfterRemoval(0, 0)).toBe(-1);
  });

  it('persists active session state without mutating others', () => {
    const baseState: ViewerState = createViewerState({
      displayR: 'R',
      displayG: 'G',
      displayB: 'B'
    });

    const sessions = [
      { id: 'a', state: { ...baseState, exposureEv: -1 } },
      { id: 'b', state: { ...baseState, exposureEv: 2 } }
    ];

    persistActiveSessionState(sessions, 'a', { ...baseState, exposureEv: 3, zoom: 5 });

    expect(sessions[0].state.exposureEv).toBe(3);
    expect(sessions[0].state.zoom).toBe(5);
    expect(sessions[1].state.exposureEv).toBe(2);
  });
});
