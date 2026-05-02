import { describe, expect, it } from 'vitest';
import { computeRec709Luminance } from '../src/color';
import { computeDisplaySelectionRoiStats } from '../src/analysis/roi-stats';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayerFromChannels,
  createStokesSelection
} from './helpers/state-fixtures';

describe('display ROI stats', () => {
  it('computes ROI stats for active RGB selections and preserves per-channel valid counts', () => {
    const layer = createLayerFromChannels({
      R: [1, 2, Number.NaN, 4],
      G: [10, 20, 30, 40],
      B: [100, 200, 300, 400],
      A: [0.25, 0.5, Number.POSITIVE_INFINITY, 1]
    });

    const stats = computeDisplaySelectionRoiStats(
      layer,
      2,
      2,
      { x0: 0, y0: 0, x1: 1, y1: 1 },
      createChannelRgbSelection('R', 'G', 'B', 'A')
    );

    expect(stats?.pixelCount).toBe(4);
    expect(stats?.channels).toEqual([
      createExpectedStatsChannel('R', 1, (1 + 2 + 4) / 3, 4, 3, 1, 0, 0),
      createExpectedStatsChannel('G', 10, 25, 40, 4, 0, 0, 0),
      createExpectedStatsChannel('B', 100, 250, 400, 4, 0, 0, 0),
      createExpectedStatsChannel('A', 0.25, (0.25 + 0.5 + 1) / 3, 1, 3, 0, 0, 1)
    ]);
  });

  it('computes ROI stats for mono and stokes selections without coercing invalid values to zero', () => {
    const monoLayer = createLayerFromChannels({
      Y: [0, 1, Number.NaN, 3]
    });
    const monoStats = computeDisplaySelectionRoiStats(
      monoLayer,
      2,
      2,
      { x0: 0, y0: 0, x1: 1, y1: 1 },
      createChannelMonoSelection('Y')
    );

    expect(monoStats?.channels).toEqual([
      createExpectedStatsChannel('Mono', 0, 4 / 3, 3, 3, 1, 0, 0)
    ]);

    const stokesLayer = createLayerFromChannels({
      S0: [1, 1, 1, 1],
      S1: [1, 0, Number.NaN, 0],
      S2: [0, 1, 0, -1],
      S3: [0, 0, 0, 0]
    });
    const stokesStats = computeDisplaySelectionRoiStats(
      stokesLayer,
      2,
      2,
      { x0: 0, y0: 0, x1: 1, y1: 1 },
      createStokesSelection('aolp')
    );

    expect(stokesStats?.channels).toEqual([
      {
        label: 'Mono',
        min: 0,
        mean: (0 + Math.PI / 4 + (3 * Math.PI) / 4) / 3,
        max: (3 * Math.PI) / 4,
        validPixelCount: 3,
        nanPixelCount: 1,
        negativeInfinityPixelCount: 0,
        positiveInfinityPixelCount: 0
      }
    ]);
  });

  it('computes grouped RGB Stokes ROI stats in RGB mode and mono stats in Colormap mode', () => {
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

    const rgbStats = computeDisplaySelectionRoiStats(
      layer,
      1,
      1,
      { x0: 0, y0: 0, x1: 0, y1: 0 },
      createStokesSelection('dolp', 'stokesRgb')
    );
    const colormapStats = computeDisplaySelectionRoiStats(
      layer,
      1,
      1,
      { x0: 0, y0: 0, x1: 0, y1: 0 },
      createStokesSelection('dolp', 'stokesRgb'),
      'colormap'
    );
    const expectedG = Math.sqrt(1 + Math.fround(Math.sqrt(3)) ** 2) / 2;
    const expectedMono = Math.sqrt(
      computeRec709Luminance(1, 1, 2) ** 2 +
      computeRec709Luminance(0, Math.fround(Math.sqrt(3)), 0) ** 2
    ) / computeRec709Luminance(1, 2, 4);

    expect(rgbStats?.channels).toEqual([
      createExpectedStatsChannel('R', 1, 1, 1, 1, 0, 0, 0),
      createExpectedStatsChannel('G', expectedG, expectedG, expectedG, 1, 0, 0, 0),
      createExpectedStatsChannel('B', 0.5, 0.5, 0.5, 1, 0, 0, 0)
    ]);
    expect(colormapStats?.channels).toEqual([
      {
        label: 'Mono',
        min: expectedMono,
        mean: expectedMono,
        max: expectedMono,
        validPixelCount: 1,
        nanPixelCount: 0,
        negativeInfinityPixelCount: 0,
        positiveInfinityPixelCount: 0
      }
    ]);
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
