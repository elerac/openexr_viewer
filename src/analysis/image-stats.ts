import { computeRec709Luminance } from '../color';
import type { DisplaySelection } from '../display-model';
import {
  createDisplayPixelValues,
  readDisplaySelectionPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator
} from '../display/evaluator';
import type { DecodedLayer, DisplayLuminanceRange, ImageStats, VisualizationMode } from '../types';
import {
  maybeYieldCooperativeCompute,
  throwIfCooperativeComputeAborted,
  type CooperativeComputeOptions
} from './compute';
import {
  accumulateStatsValue,
  createDisplaySelectionStatsAccumulators,
  toStatsChannelSummary
} from './stats-accumulator';

export function computeDisplaySelectionLuminanceRange(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb'
): DisplayLuminanceRange | null {
  const pixelCount = width * height;
  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode);
  const values = createDisplayPixelValues();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    readDisplaySelectionPixelValuesAtIndex(evaluator, pixelIndex, values);
    const luminance = computeRec709Luminance(values.r, values.g, values.b);
    if (!Number.isFinite(luminance)) {
      continue;
    }

    finiteCount += 1;
    if (luminance < min) {
      min = luminance;
    }
    if (luminance > max) {
      max = luminance;
    }
  }

  if (finiteCount === 0) {
    return null;
  }

  return { min, max };
}

export async function computeDisplaySelectionLuminanceRangeAsync(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  options: CooperativeComputeOptions = {}
): Promise<DisplayLuminanceRange | null> {
  throwIfCooperativeComputeAborted(options);
  const pixelCount = width * height;
  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode);
  const values = createDisplayPixelValues();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    readDisplaySelectionPixelValuesAtIndex(evaluator, pixelIndex, values);
    const luminance = computeRec709Luminance(values.r, values.g, values.b);
    if (Number.isFinite(luminance)) {
      finiteCount += 1;
      if (luminance < min) {
        min = luminance;
      }
      if (luminance > max) {
        max = luminance;
      }
    }

    const yieldPromise = maybeYieldCooperativeCompute(pixelIndex + 1, pixelCount, options);
    if (yieldPromise) {
      await yieldPromise;
    }
  }

  if (finiteCount === 0) {
    return null;
  }

  return { min, max };
}

export function computeDisplaySelectionImageStats(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb'
): ImageStats | null {
  const pixelCount = Math.max(0, width * height);
  if (pixelCount === 0) {
    return null;
  }

  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode);
  const accumulators = createDisplaySelectionStatsAccumulators(evaluator, selection);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    for (const accumulator of accumulators) {
      accumulateStatsValue(accumulator, accumulator.read(pixelIndex));
    }
  }

  return {
    width,
    height,
    pixelCount,
    channels: accumulators.map(toStatsChannelSummary)
  };
}

export async function computeDisplaySelectionImageStatsAsync(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  options: CooperativeComputeOptions = {}
): Promise<ImageStats | null> {
  throwIfCooperativeComputeAborted(options);
  const pixelCount = Math.max(0, width * height);
  if (pixelCount === 0) {
    return null;
  }

  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode);
  const accumulators = createDisplaySelectionStatsAccumulators(evaluator, selection);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    for (const accumulator of accumulators) {
      accumulateStatsValue(accumulator, accumulator.read(pixelIndex));
    }

    const yieldPromise = maybeYieldCooperativeCompute(pixelIndex + 1, pixelCount, options);
    if (yieldPromise) {
      await yieldPromise;
    }
  }

  return {
    width,
    height,
    pixelCount,
    channels: accumulators.map(toStatsChannelSummary)
  };
}
