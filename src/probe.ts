import { ColormapLut, mapValueToColormapRgbBytes } from './colormaps';
import {
  DisplayChannelMapping,
  DisplayLuminanceRange,
  ImagePixel,
  PixelSample,
  VisualizationMode,
  ZERO_CHANNEL
} from './types';

export interface ProbeColorPreview {
  cssColor: string;
  rValue: string;
  gValue: string;
  bValue: string;
}

export interface ProbeVisualizationOptions {
  mode: VisualizationMode;
  colormapRange: DisplayLuminanceRange | null;
  colormapLut?: ColormapLut | null;
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
  exposureEv: number,
  visualization: ProbeVisualizationOptions = { mode: 'rgb', colormapRange: null }
): ProbeColorPreview | null {
  if (!sample) {
    return null;
  }

  const rawR = readProbeChannel(sample, selection.displayR);
  const rawG = readProbeChannel(sample, selection.displayG);
  const rawB = readProbeChannel(sample, selection.displayB);
  const exposureScale = 2 ** exposureEv;
  const bytes =
    visualization.mode === 'colormap'
      ? mapValueToColormapRgbBytes(
          0.2126 * rawR + 0.7152 * rawG + 0.0722 * rawB,
          visualization.colormapRange,
          visualization.colormapLut ?? null
        )
      : [
          toSrgbByte(rawR * exposureScale),
          toSrgbByte(rawG * exposureScale),
          toSrgbByte(rawB * exposureScale)
        ];

  return {
    cssColor: `rgb(${bytes[0]}, ${bytes[1]}, ${bytes[2]})`,
    rValue: formatProbeRgbValue(rawR),
    gValue: formatProbeRgbValue(rawG),
    bValue: formatProbeRgbValue(rawB)
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
