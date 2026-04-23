import { describe, expect, it } from 'vitest';
import { __debugGetMaterializedChannelCount } from '../src/channel-storage';
import { computeRec709Luminance, linearToSrgbByte } from '../src/color';
import {
  mapValueToColormapRgbBytes,
  type ColormapLut
} from '../src/colormaps';
import { buildDisplaySelectionThumbnailPixels, buildOpenedImageThumbnailPixels } from '../src/thumbnail';
import { createDefaultStokesDegreeModulation } from '../src/stokes';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createInterleavedLayerFromChannels,
  createLayerFromChannels,
  createStokesSelection
} from './helpers/state-fixtures';

function createThumbnailState(
  overrides: Partial<Parameters<typeof buildOpenedImageThumbnailPixels>[3]> = {}
): Parameters<typeof buildOpenedImageThumbnailPixels>[3] {
  return {
    exposureEv: 0,
    viewerMode: 'image',
    visualizationMode: 'rgb',
    activeColormapId: '0',
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    colormapZeroCentered: false,
    stokesDegreeModulation: createDefaultStokesDegreeModulation(),
    zoom: 1,
    panX: 0,
    panY: 0,
    panoramaYawDeg: 0,
    panoramaPitchDeg: 0,
    panoramaHfovDeg: 60,
    activeLayer: 0,
    displaySelection: null,
    lockedPixel: null,
    roi: null,
    ...overrides
  };
}

const redBlackGreenLut: ColormapLut = {
  id: 'preview',
  label: 'Red / Black / Green',
  entryCount: 3,
  rgba8: new Uint8Array([
    255, 0, 0, 255,
    0, 0, 0, 255,
    0, 255, 0, 255
  ])
};

describe('thumbnail rendering', () => {
  it('normalizes mono thumbnails from sampled min and max', () => {
    const layer = createLayerFromChannels({
      Y: [0, 2]
    }, 'beauty');

    const thumbnail = buildOpenedImageThumbnailPixels(
      layer,
      2,
      1,
      createThumbnailState({
        displaySelection: createChannelMonoSelection('Y')
      })
    );

    expect(readPixel(thumbnail.data, thumbnail.width, 5, 20)).toEqual([0, 0, 0, 255]);
    expect(readPixel(thumbnail.data, thumbnail.width, 35, 20)).toEqual([255, 255, 255, 255]);
  });

  it('applies rgb max scaling and exposure before sRGB encoding', () => {
    const layer = createLayerFromChannels({
      R: [0.25],
      G: [0.5],
      B: [1]
    }, 'beauty');

    const thumbnail = buildOpenedImageThumbnailPixels(
      layer,
      1,
      1,
      createThumbnailState({
        exposureEv: 1,
        displaySelection: createChannelRgbSelection('R', 'G', 'B')
      })
    );

    expect(readPixel(thumbnail.data, thumbnail.width, 20, 20)).toEqual([
      linearToSrgbByte(0.5),
      linearToSrgbByte(1),
      linearToSrgbByte(2),
      255
    ]);
  });

  it('composites alpha thumbnails over the checkerboard', () => {
    const layer = createLayerFromChannels({
      R: [1],
      G: [0],
      B: [0],
      A: [0.25]
    }, 'beauty');

    const thumbnail = buildOpenedImageThumbnailPixels(
      layer,
      1,
      1,
      createThumbnailState({
        displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A')
      })
    );

    expect(readPixel(thumbnail.data, thumbnail.width, 0, 0)).toEqual([81, 17, 17, 255]);
  });

  it('contain-fits wide images into the 40x40 thumbnail bounds', () => {
    const layer = createLayerFromChannels({
      R: [0, 1],
      G: [0, 1],
      B: [0, 1]
    }, 'beauty');

    const thumbnail = buildOpenedImageThumbnailPixels(
      layer,
      2,
      1,
      createThumbnailState({
        displaySelection: createChannelRgbSelection('R', 'G', 'B')
      })
    );

    expect(readPixel(thumbnail.data, thumbnail.width, 20, 0)).toEqual([23, 23, 23, 255]);
    expect(readPixel(thumbnail.data, thumbnail.width, 5, 20)).toEqual([0, 0, 0, 255]);
    expect(readPixel(thumbnail.data, thumbnail.width, 35, 20)).toEqual([255, 255, 255, 255]);
  });

  it('renders higher-resolution channel thumbnails while keeping the same contain-fit behavior', () => {
    const layer = createLayerFromChannels({
      R: [0, 1],
      G: [0, 1],
      B: [0, 1]
    }, 'beauty');

    const thumbnail = buildDisplaySelectionThumbnailPixels(
      layer,
      2,
      1,
      createThumbnailState(),
      createChannelRgbSelection('R', 'G', 'B'),
      128
    );

    expect(thumbnail.width).toBe(128);
    expect(thumbnail.height).toBe(128);
    expect(readPixel(thumbnail.data, thumbnail.width, 64, 0)).toEqual([23, 23, 23, 255]);
    expect(readPixel(thumbnail.data, thumbnail.width, 16, 64)).toEqual([0, 0, 0, 255]);
    expect(readPixel(thumbnail.data, thumbnail.width, 112, 64)).toEqual([255, 255, 255, 255]);
  });

  it('does not materialize interleaved channels while sampling the thumbnail', () => {
    const layer = createInterleavedLayerFromChannels({
      R: [0, 1],
      G: [0, 1],
      B: [0, 1]
    });

    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);

    buildOpenedImageThumbnailPixels(
      layer,
      2,
      1,
      createThumbnailState({
        displaySelection: createChannelRgbSelection('R', 'G', 'B')
      })
    );

    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
  });

  it('renders stokes selections through the shared display-selection thumbnail path', () => {
    const layer = createLayerFromChannels({
      S0: [1, 1],
      S1: [0, 1],
      S2: [0, 0],
      S3: [0, 0]
    }, 'stokes');

    const thumbnail = buildDisplaySelectionThumbnailPixels(
      layer,
      2,
      1,
      createThumbnailState(),
      createStokesSelection('s1_over_s0')
    );

    expect(readPixel(thumbnail.data, thumbnail.width, 5, 20)).toEqual([0, 0, 0, 255]);
    expect(readPixel(thumbnail.data, thumbnail.width, 35, 20)).toEqual([255, 255, 255, 255]);
  });

  it('renders registered scalar stokes previews through the supplied colormap', () => {
    const layer = createLayerFromChannels({
      S0: [1, 1],
      S1: [1, -1],
      S2: [0, 0],
      S3: [0, 0]
    }, 'stokes');

    const thumbnail = buildDisplaySelectionThumbnailPixels(
      layer,
      2,
      1,
      createThumbnailState(),
      createStokesSelection('s1_over_s0'),
      40,
      {
        visualizationMode: 'colormap',
        colormapRange: { min: -1, max: 1 },
        colormapLut: redBlackGreenLut,
        stokesDegreeModulation: createDefaultStokesDegreeModulation()
      }
    );

    expect(readPixel(thumbnail.data, thumbnail.width, 5, 20)).toEqual([0, 255, 0, 255]);
    expect(readPixel(thumbnail.data, thumbnail.width, 35, 20)).toEqual([255, 0, 0, 255]);
  });

  it('uses the grouped rgb stokes mono path for colormap thumbnail previews', () => {
    const layer = createLayerFromChannels({
      'S0.R': [1],
      'S0.G': [1],
      'S0.B': [1],
      'S1.R': [1],
      'S1.G': [0],
      'S1.B': [0],
      'S2.R': [0],
      'S2.G': [0],
      'S2.B': [0],
      'S3.R': [0],
      'S3.G': [0],
      'S3.B': [0]
    }, 'stokesRgb');

    const thumbnail = buildDisplaySelectionThumbnailPixels(
      layer,
      1,
      1,
      createThumbnailState(),
      createStokesSelection('s1_over_s0', 'stokesRgb'),
      40,
      {
        visualizationMode: 'colormap',
        colormapRange: { min: 0, max: 1 },
        colormapLut: redBlackGreenLut,
        stokesDegreeModulation: createDefaultStokesDegreeModulation()
      }
    );

    expect(readPixel(thumbnail.data, thumbnail.width, 20, 20)).toEqual([
      ...mapValueToColormapRgbBytes(computeRec709Luminance(1, 0, 0), { min: 0, max: 1 }, redBlackGreenLut),
      255
    ]);
  });

  it('modulates stokes angle thumbnail previews with the paired degree value', () => {
    const layer = createLayerFromChannels({
      S0: [2],
      S1: [1],
      S2: [0],
      S3: [0]
    }, 'stokes');

    const unmodulated = buildDisplaySelectionThumbnailPixels(
      layer,
      1,
      1,
      createThumbnailState(),
      createStokesSelection('aolp'),
      40,
      {
        visualizationMode: 'colormap',
        colormapRange: { min: 0, max: 1 },
        colormapLut: redBlackGreenLut,
        stokesDegreeModulation: { aolp: false, cop: true, top: true }
      }
    );
    const modulated = buildDisplaySelectionThumbnailPixels(
      layer,
      1,
      1,
      createThumbnailState(),
      createStokesSelection('aolp'),
      40,
      {
        visualizationMode: 'colormap',
        colormapRange: { min: 0, max: 1 },
        colormapLut: redBlackGreenLut,
        stokesDegreeModulation: { aolp: true, cop: true, top: true }
      }
    );

    expect(readPixel(unmodulated.data, unmodulated.width, 20, 20)).toEqual([255, 0, 0, 255]);
    expect(readPixel(modulated.data, modulated.width, 20, 20)).toEqual([128, 0, 0, 255]);
  });
});

function readPixel(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [
    data[offset + 0] ?? 0,
    data[offset + 1] ?? 0,
    data[offset + 2] ?? 0,
    data[offset + 3] ?? 0
  ];
}
