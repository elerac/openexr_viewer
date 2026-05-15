import { getChannelReadView, readChannelValue, type ChannelReadView } from './channel-storage';
import { CIE_1931_2DEG_CMFS, CIE_D65_ILLUMINANT, type CieSpectrumRow, type CieXyzRow } from './spectral-color-data';
import type { SpectralChannel } from './spectral';
import type { DecodedLayer } from './types';

export interface SpectralRgbCoefficient {
  channelName: string;
  wavelength: number;
  r: number;
  g: number;
  b: number;
}

export interface ResolvedSpectralRgbChannel extends SpectralRgbCoefficient {
  view: ChannelReadView | null;
}

export interface SpectralRgbSample {
  r: number;
  g: number;
  b: number;
}

export interface ReadSpectralRgbSampleOptions {
  clamp?: boolean;
}

const XYZ_TO_LINEAR_SRGB = [
  [3.24096994, -1.53738318, -0.49861076],
  [-0.96924364, 1.8759675, 0.04155506],
  [0.05563008, -0.20397696, 1.05697151]
] as const;

const EMPTY_SPECTRAL_RGB_SAMPLE: SpectralRgbSample = { r: 0, g: 0, b: 0 };

export function buildReflectanceSpectralRgbCoefficients(
  channels: readonly SpectralChannel[]
): SpectralRgbCoefficient[] {
  const uniqueChannels = selectUniqueSortedSpectralChannels(channels);
  if (uniqueChannels.length < 2) {
    return [];
  }

  const wavelengths = uniqueChannels.map((channel) => channel.wavelength);
  const weights = trapezoidWeights(wavelengths);
  const xyzBasis = uniqueChannels.map((channel, index) => {
    const wavelength = channel.wavelength;
    const xBar = interpolateCieXyz(CIE_1931_2DEG_CMFS, wavelength, 1);
    const yBar = interpolateCieXyz(CIE_1931_2DEG_CMFS, wavelength, 2);
    const zBar = interpolateCieXyz(CIE_1931_2DEG_CMFS, wavelength, 3);
    const illuminant = interpolateSpectrum(CIE_D65_ILLUMINANT, wavelength);
    const weight = weights[index] ?? 0;
    return {
      channel,
      x: illuminant * xBar * weight,
      y: illuminant * yBar * weight,
      z: illuminant * zBar * weight
    };
  });

  const denominator = xyzBasis.reduce((sum, basis) => sum + basis.y, 0);
  if (!(denominator > 0)) {
    return [];
  }

  const scale = 1 / denominator;
  return xyzBasis.map(({ channel, x, y, z }) => {
    const scaledX = x * scale;
    const scaledY = y * scale;
    const scaledZ = z * scale;
    return {
      channelName: channel.channelName,
      wavelength: channel.wavelength,
      r: XYZ_TO_LINEAR_SRGB[0][0] * scaledX + XYZ_TO_LINEAR_SRGB[0][1] * scaledY + XYZ_TO_LINEAR_SRGB[0][2] * scaledZ,
      g: XYZ_TO_LINEAR_SRGB[1][0] * scaledX + XYZ_TO_LINEAR_SRGB[1][1] * scaledY + XYZ_TO_LINEAR_SRGB[1][2] * scaledZ,
      b: XYZ_TO_LINEAR_SRGB[2][0] * scaledX + XYZ_TO_LINEAR_SRGB[2][1] * scaledY + XYZ_TO_LINEAR_SRGB[2][2] * scaledZ
    };
  });
}

export function resolveSpectralRgbChannels(
  layer: DecodedLayer,
  coefficients: readonly SpectralRgbCoefficient[]
): ResolvedSpectralRgbChannel[] {
  return coefficients.map((coefficient) => ({
    ...coefficient,
    view: getChannelReadView(layer, coefficient.channelName)
  }));
}

export function readSpectralRgbSampleAtIndex(
  channels: readonly ResolvedSpectralRgbChannel[],
  pixelIndex: number,
  output?: SpectralRgbSample,
  options: ReadSpectralRgbSampleOptions = {}
): SpectralRgbSample {
  const out = output ?? { ...EMPTY_SPECTRAL_RGB_SAMPLE };
  let r = 0;
  let g = 0;
  let b = 0;

  for (const channel of channels) {
    const value = sanitizeSpectralValue(readChannelValue(channel.view, pixelIndex));
    r += value * channel.r;
    g += value * channel.g;
    b += value * channel.b;
  }

  const shouldClamp = options.clamp ?? true;
  out.r = shouldClamp ? clamp01(r) : sanitizeSpectralValue(r);
  out.g = shouldClamp ? clamp01(g) : sanitizeSpectralValue(g);
  out.b = shouldClamp ? clamp01(b) : sanitizeSpectralValue(b);
  return out;
}

export function readSignedSpectralRgbSampleAtIndex(
  channels: readonly ResolvedSpectralRgbChannel[],
  pixelIndex: number,
  output?: SpectralRgbSample
): SpectralRgbSample {
  return readSpectralRgbSampleAtIndex(channels, pixelIndex, output, { clamp: false });
}

export function trapezoidWeights(sortedWavelengthsNm: readonly number[]): number[] {
  if (sortedWavelengthsNm.length < 2) {
    return [];
  }

  const weights = new Array<number>(sortedWavelengthsNm.length);
  weights[0] = 0.5 * (sortedWavelengthsNm[1]! - sortedWavelengthsNm[0]!);
  weights[weights.length - 1] = 0.5 * (
    sortedWavelengthsNm[sortedWavelengthsNm.length - 1]! -
    sortedWavelengthsNm[sortedWavelengthsNm.length - 2]!
  );

  for (let index = 1; index < sortedWavelengthsNm.length - 1; index += 1) {
    weights[index] = 0.5 * (sortedWavelengthsNm[index + 1]! - sortedWavelengthsNm[index - 1]!);
  }

  return weights.map((weight) => Math.max(0, weight));
}

function selectUniqueSortedSpectralChannels(channels: readonly SpectralChannel[]): SpectralChannel[] {
  const sorted = [...channels].sort((a, b) => a.wavelength - b.wavelength);
  const unique: SpectralChannel[] = [];
  const usedWavelengths = new Set<number>();

  for (const channel of sorted) {
    if (!Number.isFinite(channel.wavelength) || usedWavelengths.has(channel.wavelength)) {
      continue;
    }

    usedWavelengths.add(channel.wavelength);
    unique.push(channel);
  }

  return unique;
}

function interpolateCieXyz(
  table: readonly CieXyzRow[],
  wavelength: number,
  componentIndex: 1 | 2 | 3
): number {
  return interpolateTable(table, wavelength, componentIndex);
}

function interpolateSpectrum(table: readonly CieSpectrumRow[], wavelength: number): number {
  return interpolateTable(table, wavelength, 1);
}

function interpolateTable<T extends readonly number[]>(
  table: readonly T[],
  wavelength: number,
  valueIndex: number
): number {
  if (!Number.isFinite(wavelength) || table.length === 0) {
    return 0;
  }

  const first = table[0]!;
  const last = table[table.length - 1]!;
  if (wavelength < first[0]! || wavelength > last[0]!) {
    return 0;
  }

  let low = 0;
  let high = table.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (table[mid]![0]! <= wavelength) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const lowRow = table[low]!;
  const highRow = table[high]!;
  const lowWavelength = lowRow[0]!;
  const highWavelength = highRow[0]!;
  const lowValue = lowRow[valueIndex] ?? 0;
  const highValue = highRow[valueIndex] ?? 0;
  if (wavelength === lowWavelength || highWavelength === lowWavelength) {
    return lowValue;
  }

  const t = (wavelength - lowWavelength) / (highWavelength - lowWavelength);
  return lowValue * (1 - t) + highValue * t;
}

function sanitizeSpectralValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
