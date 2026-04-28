export const AUTO_EXPOSURE_PERCENTILE = 99.5;
export const AUTO_EXPOSURE_PERCENTILE_MIN = 1;
export const AUTO_EXPOSURE_PERCENTILE_MAX = 100;
export const AUTO_EXPOSURE_PERCENTILE_STEP = 0.1;
export const AUTO_EXPOSURE_SOURCE = 'rgbMax' as const;
export const AUTO_EXPOSURE_MIN_EV = -10;
export const AUTO_EXPOSURE_MAX_EV = 10;

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

function normalizeAutoExposureScalar(scalar: number): number {
  return Number.isFinite(scalar) && scalar > 0 ? scalar : 1;
}
