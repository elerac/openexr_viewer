import { describe, expect, it } from 'vitest';
import {
  computeDisplaySelectionAutoExposure,
  computeDisplaySelectionAutoExposureAsync,
  computeDisplaySelectionAutoExposurePreview
} from '../src/analysis/auto-exposure';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayerFromChannels
} from './helpers/state-fixtures';

describe('display auto exposure', () => {
  it('computes auto exposure from the lower-rank 99.5th percentile rgb max scalar', () => {
    const layer = createLayerFromChannels({
      R: [1, 2, 4, 8, 1000],
      G: [0, 0, 0, 0, 0],
      B: [0, 0, 0, 0, 0]
    }, 'beauty');

    const autoExposure = computeDisplaySelectionAutoExposure(
      layer,
      5,
      1,
      createChannelRgbSelection('R', 'G', 'B')
    );

    expect(autoExposure.scalar).toBe(8);
    expect(autoExposure.exposureEv).toBe(-3);
    expect(autoExposure.percentile).toBe(99.5);
    expect(autoExposure.source).toBe('rgbMax');
  });

  it('computes preview auto exposure from a bounded low-resolution sample grid', () => {
    const width = 512;
    const values = Array.from({ length: width }, (_, index) => index % 2 === 0 ? 100 : 1);
    const layer = createLayerFromChannels({
      R: values,
      G: new Array(width).fill(0),
      B: new Array(width).fill(0)
    }, 'beauty');

    const preview = computeDisplaySelectionAutoExposurePreview(
      layer,
      width,
      1,
      createChannelRgbSelection('R', 'G', 'B'),
      'rgb',
      100
    );
    const exact = computeDisplaySelectionAutoExposure(
      layer,
      width,
      1,
      createChannelRgbSelection('R', 'G', 'B'),
      'rgb',
      100
    );

    expect(preview.scalar).toBe(1);
    expect(preview.exposureEv).toBe(0);
    expect(exact.scalar).toBe(100);
  });

  it('filters invalid and non-positive scalars in preview auto exposure', () => {
    const layer = createLayerFromChannels({
      R: [Number.NaN, -1, 0, 4],
      G: [0, 0, 0, 0],
      B: [0, 0, 0, 0]
    }, 'beauty');

    const preview = computeDisplaySelectionAutoExposurePreview(
      layer,
      4,
      1,
      createChannelRgbSelection('R', 'G', 'B')
    );

    expect(preview.scalar).toBe(4);
    expect(preview.exposureEv).toBe(-2);
  });

  it('uses the active percentile for preview auto exposure', () => {
    const layer = createLayerFromChannels({
      R: [1, 2, 4, 8, 1000],
      G: [0, 0, 0, 0, 0],
      B: [0, 0, 0, 0, 0]
    }, 'beauty');

    const preview = computeDisplaySelectionAutoExposurePreview(
      layer,
      5,
      1,
      createChannelRgbSelection('R', 'G', 'B'),
      'rgb',
      50
    );

    expect(preview.scalar).toBe(4);
    expect(preview.exposureEv).toBe(-2);
    expect(preview.percentile).toBe(50);
  });

  it('falls back to neutral preview auto exposure when no positive scalars are available', () => {
    const layer = createLayerFromChannels({
      R: [0, -1],
      G: [0, -2],
      B: [0, -3]
    }, 'beauty');

    const preview = computeDisplaySelectionAutoExposurePreview(
      layer,
      2,
      1,
      createChannelRgbSelection('R', 'G', 'B')
    );

    expect(preview.scalar).toBe(1);
    expect(preview.exposureEv).toBe(0);
  });

  it('matches exact auto exposure on small images', () => {
    const layer = createLayerFromChannels({
      R: [1, 2, 4, 8, 16, 32, 64, 128],
      G: [0, 0, 0, 0, 0, 0, 0, 0],
      B: [0, 0, 0, 0, 0, 0, 0, 0]
    }, 'beauty');
    const selection = createChannelRgbSelection('R', 'G', 'B');

    const exact = computeDisplaySelectionAutoExposure(layer, 4, 2, selection, 'rgb', 75);
    const preview = computeDisplaySelectionAutoExposurePreview(layer, 4, 2, selection, 'rgb', 75);

    expect(preview).toEqual(exact);
  });

  it('computes auto exposure for mono selections while ignoring invalid and non-positive scalars', () => {
    const layer = createLayerFromChannels({
      Y: [Number.NaN, -1, 0, 0.25, 2]
    }, 'gray');

    const autoExposure = computeDisplaySelectionAutoExposure(
      layer,
      5,
      1,
      createChannelMonoSelection('Y')
    );

    expect(autoExposure.scalar).toBe(0.25);
    expect(autoExposure.exposureEv).toBe(2);
  });

  it('falls back to neutral auto exposure when no positive scalars are available', () => {
    const layer = createLayerFromChannels({
      R: [0, -1],
      G: [0, -2],
      B: [0, -3]
    }, 'beauty');

    const autoExposure = computeDisplaySelectionAutoExposure(
      layer,
      2,
      1,
      createChannelRgbSelection('R', 'G', 'B')
    );

    expect(autoExposure.scalar).toBe(1);
    expect(autoExposure.exposureEv).toBe(0);
  });

  it('aborts chunked auto exposure work before completion', async () => {
    const layer = createLayerFromChannels({
      R: [1, 2, 3, 4],
      G: [0, 0, 0, 0],
      B: [0, 0, 0, 0]
    }, 'beauty');
    const selection = createChannelRgbSelection('R', 'G', 'B');
    const controller = new AbortController();

    await expect(computeDisplaySelectionAutoExposureAsync(
      layer,
      4,
      1,
      selection,
      'rgb',
      99.5,
      {
        signal: controller.signal,
        chunkSize: 1,
        yieldControl: async () => {
          controller.abort();
        }
      }
    )).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('clamps computed auto exposure to the existing exposure range', () => {
    const bright = createLayerFromChannels({
      R: [4096],
      G: [0],
      B: [0]
    }, 'bright');
    const dark = createLayerFromChannels({
      R: [1 / 2048],
      G: [0],
      B: [0]
    }, 'dark');

    expect(computeDisplaySelectionAutoExposure(bright, 1, 1, createChannelRgbSelection('R', 'G', 'B')).exposureEv)
      .toBe(-10);
    expect(computeDisplaySelectionAutoExposure(dark, 1, 1, createChannelRgbSelection('R', 'G', 'B')).exposureEv)
      .toBe(10);
  });
});
