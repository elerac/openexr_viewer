import { describe, expect, it } from 'vitest';
import {
  computeDisplaySelectionImageStats,
  computeDisplaySelectionImageStatsAsync,
  computeDisplaySelectionLuminanceRange,
  computeDisplaySelectionLuminanceRangeAsync
} from '../src/analysis/image-stats';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayerFromChannels
} from './helpers/state-fixtures';

describe('display image stats', () => {
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

  it('computes whole-image stats for active display selections and counts invalid values', () => {
    const layer = createLayerFromChannels({
      R: [1, 2, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
      G: [0, -2, 4, 6, 8],
      B: [Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN],
      A: [0.5, Number.POSITIVE_INFINITY, 1, Number.NEGATIVE_INFINITY, Number.NaN]
    });

    const stats = computeDisplaySelectionImageStats(
      layer,
      5,
      1,
      createChannelRgbSelection('R', 'G', 'B', 'A')
    );

    expect(stats).toEqual({
      width: 5,
      height: 1,
      pixelCount: 5,
      channels: [
        createExpectedStatsChannel('R', 1, 1.5, 2, 2, 1, 1, 1),
        createExpectedStatsChannel('G', -2, 3.2, 8, 5, 0, 0, 0),
        createExpectedStatsChannel('B', null, null, null, 0, 5, 0, 0),
        createExpectedStatsChannel('A', 0.5, 0.75, 1, 2, 1, 1, 1)
      ]
    });
  });

  it('aborts chunked luminance and image stats work before completion', async () => {
    const layer = createLayerFromChannels({
      R: [1, 2, 3, 4],
      G: [0, 0, 0, 0],
      B: [0, 0, 0, 0]
    }, 'beauty');
    const selection = createChannelRgbSelection('R', 'G', 'B');

    async function expectAbort(
      run: (options: {
        signal: AbortSignal;
        chunkSize: number;
        yieldControl: () => Promise<void>;
      }) => Promise<unknown>
    ) {
      const controller = new AbortController();
      await expect(run({
        signal: controller.signal,
        chunkSize: 1,
        yieldControl: async () => {
          controller.abort();
        }
      })).rejects.toMatchObject({ name: 'AbortError' });
    }

    await expectAbort((options) => computeDisplaySelectionLuminanceRangeAsync(
      layer,
      4,
      1,
      selection,
      'rgb',
      options
    ));
    await expectAbort((options) => computeDisplaySelectionImageStatsAsync(
      layer,
      4,
      1,
      selection,
      'rgb',
      options
    ));
  });
});

function createExpectedStatsChannel(
  label: string,
  min: number | null,
  mean: number | null,
  max: number | null,
  validPixelCount: number,
  nanPixelCount: number,
  negativeInfinityPixelCount: number,
  positiveInfinityPixelCount: number
) {
  return {
    label,
    min,
    mean,
    max,
    validPixelCount,
    nanPixelCount,
    negativeInfinityPixelCount,
    positiveInfinityPixelCount
  };
}
