import { readChannelValue } from '../channel-storage';
import { selectionUsesImageAlpha, type DisplaySelection } from '../display-model';
import {
  computeRawStokesDisplayValue,
  computeRawStokesDisplayValueForChannels,
  computeRgbStokesMonoValues,
  readScalarStokesSample
} from '../stokes/stokes-display';
import type { StatsChannelSummary } from '../types';
import type { DisplaySelectionEvaluator } from '../display/evaluator';

export interface StatsAccumulator {
  label: string;
  min: number;
  max: number;
  sum: number;
  validPixelCount: number;
  nanPixelCount: number;
  negativeInfinityPixelCount: number;
  positiveInfinityPixelCount: number;
  read: (pixelIndex: number) => number;
}

export function createDisplaySelectionStatsAccumulators(
  evaluator: DisplaySelectionEvaluator,
  selection: DisplaySelection | null
): StatsAccumulator[] {
  switch (evaluator.kind) {
    case 'empty':
      return [];
    case 'channelRgb': {
      const rows: StatsAccumulator[] = [
        createStatsAccumulator('R', (pixelIndex) => readChannelValue(evaluator.r, pixelIndex)),
        createStatsAccumulator('G', (pixelIndex) => readChannelValue(evaluator.g, pixelIndex)),
        createStatsAccumulator('B', (pixelIndex) => readChannelValue(evaluator.b, pixelIndex))
      ];
      if (selectionUsesImageAlpha(selection) && evaluator.a) {
        rows.push(createStatsAccumulator('A', (pixelIndex) => readChannelValue(evaluator.a, pixelIndex)));
      }
      return rows;
    }
    case 'channelMono': {
      const rows = [
        createStatsAccumulator('Mono', (pixelIndex) => readChannelValue(evaluator.channel, pixelIndex))
      ];
      if (selectionUsesImageAlpha(selection) && evaluator.a) {
        rows.push(createStatsAccumulator('A', (pixelIndex) => readChannelValue(evaluator.a, pixelIndex)));
      }
      return rows;
    }
    case 'stokesDirect':
      return [
        createStatsAccumulator(
          'Mono',
          (pixelIndex) => {
            const sample = readScalarStokesSample(evaluator.stokes, pixelIndex);
            return computeRawStokesDisplayValue(
              evaluator.parameter,
              sample.s0,
              sample.s1,
              sample.s2,
              sample.s3
            );
          }
        )
      ];
    case 'stokesRgb':
      return [
        createStatsAccumulator('R', (pixelIndex) => computeRawStokesDisplayValueForChannels(
          evaluator.parameter,
          evaluator.r,
          pixelIndex
        )),
        createStatsAccumulator('G', (pixelIndex) => computeRawStokesDisplayValueForChannels(
          evaluator.parameter,
          evaluator.g,
          pixelIndex
        )),
        createStatsAccumulator('B', (pixelIndex) => computeRawStokesDisplayValueForChannels(
          evaluator.parameter,
          evaluator.b,
          pixelIndex
        ))
      ];
    case 'stokesRgbLuminance':
      return [
        createStatsAccumulator(
          'Mono',
          (pixelIndex) => {
            const sample = computeRgbStokesMonoValues(evaluator.r, evaluator.g, evaluator.b, pixelIndex);
            return computeRawStokesDisplayValue(
              evaluator.parameter,
              sample.s0,
              sample.s1,
              sample.s2,
              sample.s3
            );
          }
        )
      ];
  }
}

export function accumulateStatsValue(accumulator: StatsAccumulator, value: number): void {
  if (Number.isFinite(value)) {
    accumulator.validPixelCount += 1;
    accumulator.sum += value;
    if (value < accumulator.min) {
      accumulator.min = value;
    }
    if (value > accumulator.max) {
      accumulator.max = value;
    }
    return;
  }

  if (Number.isNaN(value)) {
    accumulator.nanPixelCount += 1;
    return;
  }

  if (value === Number.NEGATIVE_INFINITY) {
    accumulator.negativeInfinityPixelCount += 1;
    return;
  }

  if (value === Number.POSITIVE_INFINITY) {
    accumulator.positiveInfinityPixelCount += 1;
  }
}

export function toStatsChannelSummary(accumulator: StatsAccumulator): StatsChannelSummary {
  if (accumulator.validPixelCount === 0) {
    return {
      label: accumulator.label,
      min: null,
      mean: null,
      max: null,
      validPixelCount: 0,
      nanPixelCount: accumulator.nanPixelCount,
      negativeInfinityPixelCount: accumulator.negativeInfinityPixelCount,
      positiveInfinityPixelCount: accumulator.positiveInfinityPixelCount
    };
  }

  return {
    label: accumulator.label,
    min: accumulator.min,
    mean: accumulator.sum / accumulator.validPixelCount,
    max: accumulator.max,
    validPixelCount: accumulator.validPixelCount,
    nanPixelCount: accumulator.nanPixelCount,
    negativeInfinityPixelCount: accumulator.negativeInfinityPixelCount,
    positiveInfinityPixelCount: accumulator.positiveInfinityPixelCount
  };
}

function createStatsAccumulator(
  label: string,
  read: (pixelIndex: number) => number
): StatsAccumulator {
  return {
    label,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    sum: 0,
    validPixelCount: 0,
    nanPixelCount: 0,
    negativeInfinityPixelCount: 0,
    positiveInfinityPixelCount: 0,
    read
  };
}
