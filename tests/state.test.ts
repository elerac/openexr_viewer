import { describe, expect, it } from 'vitest';
import {
  buildDisplayHistogram,
  buildLayerDisplayHistogram,
  buildDisplayTexture,
  buildViewerStateForLayer,
  buildSessionDisplayName,
  computeDisplayTextureLuminanceRange,
  computeHistogramRenderCeiling,
  createInitialState,
  extractRgbChannelGroups,
  findSelectedRgbGroup,
  persistActiveSessionState,
  pickDefaultDisplayChannels,
  pickNextSessionIndexAfterRemoval,
  scaleHistogramCount,
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

describe('state helpers', () => {
  it('defaults to normal RGB visualization mode', () => {
    expect(createInitialState().visualizationMode).toBe('rgb');
    expect(createInitialState().colormapRange).toBeNull();
    expect(createInitialState().colormapRangeMode).toBe('alwaysAuto');
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
      {
        exposureEv: 0,
        visualizationMode: 'rgb',
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        zoom: 1,
        panX: 0,
        panY: 0,
        activeLayer: 0,
        displayR: 'R',
        displayG: 'G',
        displayB: 'B',
        hoveredPixel: null,
        lockedPixel: null
      },
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
      {
        exposureEv: 0,
        visualizationMode: 'rgb',
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        zoom: 1,
        panX: 0,
        panY: 0,
        activeLayer: 0,
        displayR: '__ZERO__',
        displayG: '__ZERO__',
        displayB: '__ZERO__',
        hoveredPixel: null,
        lockedPixel: null
      },
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
      {
        exposureEv: 0,
        visualizationMode: 'rgb',
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        zoom: 1,
        panX: 0,
        panY: 0,
        activeLayer: 3,
        displayR: 'X',
        displayG: 'Y',
        displayB: 'Z',
        hoveredPixel: null,
        lockedPixel: null
      },
      image,
      3
    );

    expect(nextState.activeLayer).toBe(0);
    expect(nextState.displayR).toBe('R');
    expect(nextState.displayG).toBe('G');
    expect(nextState.displayB).toBe('B');
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
    const baseState: ViewerState = {
      exposureEv: 0,
      visualizationMode: 'rgb',
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      zoom: 1,
      panX: 0,
      panY: 0,
      activeLayer: 0,
      displayR: 'R',
      displayG: 'G',
      displayB: 'B',
      hoveredPixel: null,
      lockedPixel: null
    };

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
