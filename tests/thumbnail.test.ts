import { describe, expect, it } from 'vitest';
import { __debugGetMaterializedChannelCount } from '../src/channel-storage';
import { linearToSrgbByte } from '../src/color';
import { buildOpenedImageThumbnailPixels } from '../src/thumbnail';
import { createDefaultStokesDegreeModulation } from '../src/stokes';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createInterleavedLayerFromChannels,
  createLayerFromChannels
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
    ...overrides
  };
}

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
