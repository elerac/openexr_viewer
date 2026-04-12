import { DisplayChannelMapping, ImagePixel, PixelSample, ZERO_CHANNEL } from './types';

export interface ProbeColorPreview {
  cssColor: string;
  rValue: string;
  gValue: string;
  bValue: string;
}

export function resolveActiveProbePixel(
  lockedPixel: ImagePixel | null,
  hoveredPixel: ImagePixel | null
): ImagePixel | null {
  return lockedPixel ?? hoveredPixel;
}

export function resolveProbeMode(lockedPixel: ImagePixel | null): 'Hover' | 'Locked' {
  return lockedPixel ? 'Locked' : 'Hover';
}

export function buildProbeColorPreview(
  sample: PixelSample | null,
  selection: DisplayChannelMapping,
  exposureEv: number
): ProbeColorPreview | null {
  if (!sample) {
    return null;
  }

  const exposureScale = 2 ** exposureEv;
  const bytes = [
    toSrgbByte(readProbeChannel(sample, selection.displayR) * exposureScale),
    toSrgbByte(readProbeChannel(sample, selection.displayG) * exposureScale),
    toSrgbByte(readProbeChannel(sample, selection.displayB) * exposureScale)
  ];

  return {
    cssColor: `rgb(${bytes[0]}, ${bytes[1]}, ${bytes[2]})`,
    rValue: formatProbeRgbValue(readProbeChannel(sample, selection.displayR)),
    gValue: formatProbeRgbValue(readProbeChannel(sample, selection.displayG)),
    bValue: formatProbeRgbValue(readProbeChannel(sample, selection.displayB))
  };
}

function readProbeChannel(sample: PixelSample, channelName: string): number {
  if (channelName === ZERO_CHANNEL) {
    return 0;
  }

  const value = sample.values[channelName];
  return Number.isFinite(value) ? value : 0;
}

function toSrgbByte(value: number): number {
  const linear = Math.max(0, value);
  const srgb =
    linear <= 0.0031308
      ? linear * 12.92
      : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;

  return Math.max(0, Math.min(255, Math.round(srgb * 255)));
}

function formatProbeRgbValue(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  if (value === 0) {
    return '0';
  }

  return Number(value.toPrecision(4)).toString();
}
