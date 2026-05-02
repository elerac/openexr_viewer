import type { DisplaySelection } from '../display-model';
import type { DecodedLayer, VisualizationMode } from '../types';
import {
  createDisplayPixelValues,
  readDisplaySelectionPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator,
  type DisplayPixelValues,
  type DisplaySelectionEvaluator
} from '../display/evaluator';
import {
  maybeYieldCooperativeCompute,
  selectKthFloat32,
  selectKthFloat32Async,
  throwIfCooperativeComputeAborted,
  type CooperativeComputeOptions
} from './compute';

export const AUTO_EXPOSURE_PERCENTILE = 99.5;
export const AUTO_EXPOSURE_PERCENTILE_MIN = 1;
export const AUTO_EXPOSURE_PERCENTILE_MAX = 100;
export const AUTO_EXPOSURE_PERCENTILE_STEP = 0.1;
export const AUTO_EXPOSURE_SOURCE = 'rgbMax' as const;
export const AUTO_EXPOSURE_MIN_EV = -10;
export const AUTO_EXPOSURE_MAX_EV = 10;
export const AUTO_EXPOSURE_PREVIEW_MAX_EDGE = 256;

export interface AutoExposureResult {
  scalar: number;
  exposureEv: number;
  percentile: number;
  source: typeof AUTO_EXPOSURE_SOURCE;
}

export function createAutoExposureResult(
  scalar: number,
  percentile = AUTO_EXPOSURE_PERCENTILE
): AutoExposureResult {
  const normalizedScalar = normalizeAutoExposureScalar(scalar);
  return {
    scalar: normalizedScalar,
    exposureEv: computeAutoExposureEvFromScalar(normalizedScalar),
    percentile,
    source: AUTO_EXPOSURE_SOURCE
  };
}

export function computeAutoExposureEvFromScalar(scalar: number): number {
  const normalizedScalar = normalizeAutoExposureScalar(scalar);
  if (normalizedScalar === 1) {
    return 0;
  }

  return clampAutoExposureEv(-Math.log2(normalizedScalar));
}

export function clampAutoExposureEv(exposureEv: number): number {
  if (!Number.isFinite(exposureEv)) {
    return 0;
  }

  return Math.min(AUTO_EXPOSURE_MAX_EV, Math.max(AUTO_EXPOSURE_MIN_EV, exposureEv));
}

export function normalizeAutoExposurePercentile(value: number): number {
  if (!Number.isFinite(value)) {
    return AUTO_EXPOSURE_PERCENTILE;
  }

  const steppedValue = Math.round(value / AUTO_EXPOSURE_PERCENTILE_STEP) * AUTO_EXPOSURE_PERCENTILE_STEP;
  const clampedValue = Math.min(
    AUTO_EXPOSURE_PERCENTILE_MAX,
    Math.max(AUTO_EXPOSURE_PERCENTILE_MIN, steppedValue)
  );
  return Number(clampedValue.toFixed(1));
}

export function parseAutoExposurePercentile(value: string | null): number {
  if (value === null || value.trim() === '') {
    return AUTO_EXPOSURE_PERCENTILE;
  }

  return normalizeAutoExposurePercentile(Number(value));
}

export function formatAutoExposurePercentile(value: number): string {
  return normalizeAutoExposurePercentile(value).toFixed(1);
}

export function computeDisplaySelectionAutoExposure(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  percentile = AUTO_EXPOSURE_PERCENTILE
): AutoExposureResult {
  const pixelCount = Math.max(0, width * height);
  if (pixelCount === 0) {
    return createAutoExposureResult(1, percentile);
  }

  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode);
  const values = createDisplayPixelValues();
  const scalars = new Float32Array(pixelCount);
  let scalarCount = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const scalar = readAutoExposureScalar(evaluator, pixelIndex, values);
    if (!Number.isFinite(scalar) || scalar <= 0) {
      continue;
    }

    scalars[scalarCount] = scalar;
    scalarCount += 1;
  }

  if (scalarCount === 0) {
    return createAutoExposureResult(1, percentile);
  }

  const percentileIndex = resolveAutoExposurePercentileIndex(scalarCount, percentile);
  const sortedScalars = scalars.subarray(0, scalarCount);
  return createAutoExposureResult(selectKthFloat32(sortedScalars, scalarCount, percentileIndex), percentile);
}

export function computeDisplaySelectionAutoExposurePreview(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  percentile = AUTO_EXPOSURE_PERCENTILE
): AutoExposureResult {
  const sampleWidth = resolveAutoExposurePreviewSampleSize(width);
  const sampleHeight = resolveAutoExposurePreviewSampleSize(height);
  const sampleCount = sampleWidth * sampleHeight;
  if (sampleCount === 0) {
    return createAutoExposureResult(1, percentile);
  }

  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode);
  const values = createDisplayPixelValues();
  const scalars = new Float32Array(sampleCount);
  let scalarCount = 0;

  for (let sampleY = 0; sampleY < sampleHeight; sampleY += 1) {
    const sourceY = resolveAutoExposurePreviewSourceCoordinate(sampleY, sampleHeight, height);
    const sourceRowOffset = sourceY * width;
    for (let sampleX = 0; sampleX < sampleWidth; sampleX += 1) {
      const sourceX = resolveAutoExposurePreviewSourceCoordinate(sampleX, sampleWidth, width);
      const scalar = readAutoExposureScalar(evaluator, sourceRowOffset + sourceX, values);
      if (!Number.isFinite(scalar) || scalar <= 0) {
        continue;
      }

      scalars[scalarCount] = scalar;
      scalarCount += 1;
    }
  }

  if (scalarCount === 0) {
    return createAutoExposureResult(1, percentile);
  }

  const percentileIndex = resolveAutoExposurePercentileIndex(scalarCount, percentile);
  const sortedScalars = scalars.subarray(0, scalarCount);
  return createAutoExposureResult(selectKthFloat32(sortedScalars, scalarCount, percentileIndex), percentile);
}

export async function computeDisplaySelectionAutoExposureAsync(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  percentile = AUTO_EXPOSURE_PERCENTILE,
  options: CooperativeComputeOptions = {}
): Promise<AutoExposureResult> {
  throwIfCooperativeComputeAborted(options);
  const pixelCount = Math.max(0, width * height);
  if (pixelCount === 0) {
    return createAutoExposureResult(1, percentile);
  }

  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode);
  const values = createDisplayPixelValues();
  const scalars = new Float32Array(pixelCount);
  let scalarCount = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const scalar = readAutoExposureScalar(evaluator, pixelIndex, values);
    if (Number.isFinite(scalar) && scalar > 0) {
      scalars[scalarCount] = scalar;
      scalarCount += 1;
    }

    const yieldPromise = maybeYieldCooperativeCompute(pixelIndex + 1, pixelCount, options);
    if (yieldPromise) {
      await yieldPromise;
    }
  }

  if (scalarCount === 0) {
    return createAutoExposureResult(1, percentile);
  }

  const percentileIndex = resolveAutoExposurePercentileIndex(scalarCount, percentile);
  const selectedScalar = await selectKthFloat32Async(
    scalars.subarray(0, scalarCount),
    scalarCount,
    percentileIndex,
    options
  );
  return createAutoExposureResult(selectedScalar, percentile);
}

function normalizeAutoExposureScalar(scalar: number): number {
  return Number.isFinite(scalar) && scalar > 0 ? scalar : 1;
}

function readAutoExposureScalar(
  evaluator: DisplaySelectionEvaluator,
  pixelIndex: number,
  values: DisplayPixelValues
): number {
  readDisplaySelectionPixelValuesAtIndex(evaluator, pixelIndex, values);
  return Math.max(values.r, values.g, values.b);
}

function resolveAutoExposurePercentileIndex(count: number, percentile: number): number {
  const percentile01 = Math.min(1, Math.max(0, percentile / 100));
  return Math.floor((Math.max(1, count) - 1) * percentile01);
}

function resolveAutoExposurePreviewSampleSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return 0;
  }

  return Math.min(AUTO_EXPOSURE_PREVIEW_MAX_EDGE, Math.floor(size));
}

function resolveAutoExposurePreviewSourceCoordinate(
  sampleIndex: number,
  sampleCount: number,
  sourceSize: number
): number {
  const maxIndex = Math.max(0, Math.floor(sourceSize) - 1);
  return Math.min(maxIndex, Math.floor(((sampleIndex + 0.5) * sourceSize) / sampleCount));
}
