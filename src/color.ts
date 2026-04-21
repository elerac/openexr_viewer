export const REC709_LUMINANCE_WEIGHTS = {
  r: 0.2126,
  g: 0.7152,
  b: 0.0722
} as const;

export const SRGB_TRANSFER = {
  cutoff: 0.0031308,
  linearScale: 12.92,
  encodedScale: 1.055,
  encodedOffset: 0.055,
  gamma: 2.4
} as const;

export function computeRec709Luminance(r: number, g: number, b: number): number {
  return REC709_LUMINANCE_WEIGHTS.r * r +
    REC709_LUMINANCE_WEIGHTS.g * g +
    REC709_LUMINANCE_WEIGHTS.b * b;
}

export function linearToSrgb(value: number): number {
  const linear = sanitizeNonNegativeFinite(value);
  return linear <= SRGB_TRANSFER.cutoff
    ? linear * SRGB_TRANSFER.linearScale
    : SRGB_TRANSFER.encodedScale * Math.pow(linear, 1 / SRGB_TRANSFER.gamma) - SRGB_TRANSFER.encodedOffset;
}

export function linearToSrgbByte(value: number): number {
  const srgb = linearToSrgb(value);
  return Math.max(0, Math.min(255, Math.round(srgb * 255)));
}

function sanitizeNonNegativeFinite(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}
