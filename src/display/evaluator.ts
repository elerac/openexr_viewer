import {
  getChannelReadView,
  readChannelValue,
  type ChannelReadView
} from '../channel-storage';
import { computeStokesDegreeModulationDisplayValue, computeStokesDisplayValue } from '../stokes';
import {
  computeRawStokesDisplayValue,
  computeRawStokesDisplayValueForChannels,
  computeRgbStokesMonoValues,
  computeStokesDisplayValueForChannels,
  readScalarStokesSample,
  resolveStokesChannelArraysFromSlots,
  type ResolvedScalarStokesChannels,
  type StokesSample
} from '../stokes/stokes-display';
import {
  computeRawSpectralStokesRgbDisplayValues,
  computeSpectralStokesRgbDisplayValues,
  computeSpectralStokesRgbMonoValues,
  resolveSpectralStokesRgbChannelArrays,
  type ResolvedSpectralStokesRgbChannels
} from '../stokes/spectral-stokes-rgb';
import type { DecodedLayer, VisualizationMode } from '../types';
import {
  buildDisplaySourceBinding,
  createEmptyDisplaySourceBinding,
  type DisplaySourceBinding
} from './bindings';
import {
  buildReflectanceSpectralRgbCoefficients,
  readSpectralRgbSampleAtIndex,
  resolveSpectralRgbChannels,
  type ResolvedSpectralRgbChannel
} from '../spectral-color';
import {
  detectSpectralChannelsForSeries,
  parseSpectralRgbSourceName,
  shouldReadSpectralRgbSeriesSigned
} from '../spectral';

export interface DisplayPixelValues {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type DisplaySelectionEvaluator =
  | {
      kind: 'empty';
      binding: DisplaySourceBinding;
    }
  | {
      kind: 'channelRgb';
      binding: DisplaySourceBinding;
      r: ChannelReadView | null;
      g: ChannelReadView | null;
      b: ChannelReadView | null;
      a: ChannelReadView | null;
    }
  | {
      kind: 'channelMono';
      binding: DisplaySourceBinding;
      channel: ChannelReadView | null;
      a: ChannelReadView | null;
    }
  | {
      kind: 'spectralRgb';
      binding: DisplaySourceBinding;
      channels: ResolvedSpectralRgbChannel[];
      signed: boolean;
    }
  | {
      kind: 'stokesDirect';
      binding: DisplaySourceBinding;
      parameter: NonNullable<DisplaySourceBinding['stokesParameter']>;
      stokes: ResolvedScalarStokesChannels;
    }
  | {
      kind: 'stokesRgb';
      binding: DisplaySourceBinding;
      parameter: NonNullable<DisplaySourceBinding['stokesParameter']>;
      r: ResolvedScalarStokesChannels;
      g: ResolvedScalarStokesChannels;
      b: ResolvedScalarStokesChannels;
    }
  | {
      kind: 'stokesRgbLuminance';
      binding: DisplaySourceBinding;
      parameter: NonNullable<DisplaySourceBinding['stokesParameter']>;
      r: ResolvedScalarStokesChannels;
      g: ResolvedScalarStokesChannels;
      b: ResolvedScalarStokesChannels;
    }
  | {
      kind: 'stokesSpectralRgb';
      binding: DisplaySourceBinding;
      parameter: NonNullable<DisplaySourceBinding['stokesParameter']>;
      channels: ResolvedSpectralStokesRgbChannels;
    }
  | {
      kind: 'stokesSpectralRgbLuminance';
      binding: DisplaySourceBinding;
      parameter: NonNullable<DisplaySourceBinding['stokesParameter']>;
      channels: ResolvedSpectralStokesRgbChannels;
    };

export function resolveDisplaySelectionEvaluator(
  layer: DecodedLayer,
  selection: Parameters<typeof buildDisplaySourceBinding>[1],
  visualizationMode: VisualizationMode = 'rgb'
): DisplaySelectionEvaluator {
  return createDisplaySelectionEvaluator(layer, buildDisplaySourceBinding(layer, selection, visualizationMode));
}

export function createDisplaySelectionEvaluator(
  layer: DecodedLayer,
  binding: DisplaySourceBinding
): DisplaySelectionEvaluator {
  switch (binding.mode) {
    case 'empty':
      return {
        kind: 'empty',
        binding
      };
    case 'channelRgb':
      return {
        kind: 'channelRgb',
        binding,
        r: getOptionalChannelReadView(layer, binding.slots[0]),
        g: getOptionalChannelReadView(layer, binding.slots[1]),
        b: getOptionalChannelReadView(layer, binding.slots[2]),
        a: getOptionalChannelReadView(layer, binding.slots[3])
      };
    case 'channelMono':
      return {
        kind: 'channelMono',
        binding,
        channel: getOptionalChannelReadView(layer, binding.slots[0]),
        a: getOptionalChannelReadView(layer, binding.slots[3])
      };
    case 'spectralRgb':
      return createSpectralRgbEvaluator(layer, binding);
    case 'stokesDirect':
      return createStokesDirectEvaluator(layer, binding);
    case 'stokesRgb':
      return createRgbStokesEvaluator(layer, binding, 'stokesRgb');
    case 'stokesRgbLuminance':
      return createRgbStokesEvaluator(layer, binding, 'stokesRgbLuminance');
    case 'stokesSpectralRgb':
      return createSpectralStokesRgbEvaluator(layer, binding, 'stokesSpectralRgb');
    case 'stokesSpectralRgbLuminance':
      return createSpectralStokesRgbEvaluator(layer, binding, 'stokesSpectralRgbLuminance');
  }
}

export function readDisplaySelectionPixelValuesAtIndex(
  evaluator: DisplaySelectionEvaluator,
  pixelIndex: number,
  output?: DisplayPixelValues
): DisplayPixelValues {
  const out = output ?? createDisplayPixelValues();

  switch (evaluator.kind) {
    case 'empty':
      return setDisplayPixelValues(out, 0, 0, 0, 1);
    case 'channelRgb':
      return setDisplayPixelValues(
        out,
        sanitizeDisplayValue(readChannelValue(evaluator.r, pixelIndex)),
        sanitizeDisplayValue(readChannelValue(evaluator.g, pixelIndex)),
        sanitizeDisplayValue(readChannelValue(evaluator.b, pixelIndex)),
        evaluator.a ? sanitizeAlphaValue(readChannelValue(evaluator.a, pixelIndex)) : 1
      );
    case 'channelMono': {
      const value = sanitizeDisplayValue(readChannelValue(evaluator.channel, pixelIndex));
      return setDisplayPixelValues(
        out,
        value,
        value,
        value,
        evaluator.a ? sanitizeAlphaValue(readChannelValue(evaluator.a, pixelIndex)) : 1
      );
    }
    case 'spectralRgb':
      return writeSpectralRgbDisplayPixel(out, evaluator.channels, evaluator.signed, pixelIndex);
    case 'stokesDirect':
      return writeStokesDisplayPixel(
        out,
        evaluator.parameter,
        readScalarStokesSample(evaluator.stokes, pixelIndex)
      );
    case 'stokesRgb':
      return writeRgbStokesDisplayPixel(
        out,
        evaluator.parameter,
        evaluator.r,
        evaluator.g,
        evaluator.b,
        pixelIndex
      );
    case 'stokesRgbLuminance':
      return writeStokesDisplayPixel(
        out,
        evaluator.parameter,
        computeRgbStokesMonoValues(evaluator.r, evaluator.g, evaluator.b, pixelIndex)
      );
    case 'stokesSpectralRgb':
      return writeSpectralStokesRgbDisplayPixel(
        out,
        evaluator.parameter,
        evaluator.channels,
        pixelIndex
      );
    case 'stokesSpectralRgbLuminance':
      return writeStokesDisplayPixel(
        out,
        evaluator.parameter,
        computeSpectralStokesRgbMonoValues(evaluator.channels, pixelIndex)
      );
  }
}

export function readDisplaySelectionOverlayPixelValuesAtIndex(
  evaluator: DisplaySelectionEvaluator,
  pixelIndex: number,
  output?: DisplayPixelValues
): DisplayPixelValues {
  const out = output ?? createDisplayPixelValues();

  switch (evaluator.kind) {
    case 'empty':
      return setDisplayPixelValues(out, 0, 0, 0, 1);
    case 'channelRgb':
      return setDisplayPixelValues(
        out,
        readChannelValue(evaluator.r, pixelIndex),
        readChannelValue(evaluator.g, pixelIndex),
        readChannelValue(evaluator.b, pixelIndex),
        evaluator.a ? readChannelValue(evaluator.a, pixelIndex) : 1
      );
    case 'channelMono': {
      const value = readChannelValue(evaluator.channel, pixelIndex);
      return setDisplayPixelValues(
        out,
        value,
        value,
        value,
        evaluator.a ? readChannelValue(evaluator.a, pixelIndex) : 1
      );
    }
    case 'spectralRgb':
      return writeSpectralRgbDisplayPixel(out, evaluator.channels, evaluator.signed, pixelIndex);
    case 'stokesDirect':
      return writeRawStokesDisplayPixel(
        out,
        evaluator.parameter,
        readScalarStokesSample(evaluator.stokes, pixelIndex)
      );
    case 'stokesRgb':
      return writeRawRgbStokesDisplayPixel(
        out,
        evaluator.parameter,
        evaluator.r,
        evaluator.g,
        evaluator.b,
        pixelIndex
      );
    case 'stokesRgbLuminance':
      return writeRawStokesDisplayPixel(
        out,
        evaluator.parameter,
        computeRgbStokesMonoValues(evaluator.r, evaluator.g, evaluator.b, pixelIndex)
      );
    case 'stokesSpectralRgb':
      return writeRawSpectralStokesRgbDisplayPixel(
        out,
        evaluator.parameter,
        evaluator.channels,
        pixelIndex
      );
    case 'stokesSpectralRgbLuminance':
      return writeRawStokesDisplayPixel(
        out,
        evaluator.parameter,
        computeSpectralStokesRgbMonoValues(evaluator.channels, pixelIndex)
      );
  }
}

export function readDisplaySelectionSnapshotPixelValuesAtIndex(
  evaluator: DisplaySelectionEvaluator,
  pixelIndex: number,
  output?: DisplayPixelValues
): DisplayPixelValues {
  const out = output ?? createDisplayPixelValues();

  switch (evaluator.kind) {
    case 'empty':
      return setDisplayPixelValues(out, 0, 0, 0, 1);
    case 'channelRgb':
      return setDisplayPixelValues(
        out,
        sanitizeDisplayValue(readChannelValue(evaluator.r, pixelIndex)),
        sanitizeDisplayValue(readChannelValue(evaluator.g, pixelIndex)),
        sanitizeDisplayValue(readChannelValue(evaluator.b, pixelIndex)),
        evaluator.a ? sanitizeAlphaValue(readChannelValue(evaluator.a, pixelIndex)) : 1
      );
    case 'channelMono': {
      const value = sanitizeDisplayValue(readChannelValue(evaluator.channel, pixelIndex));
      return setDisplayPixelValues(
        out,
        value,
        value,
        value,
        evaluator.a ? sanitizeAlphaValue(readChannelValue(evaluator.a, pixelIndex)) : 1
      );
    }
    case 'spectralRgb':
      return writeSpectralRgbDisplayPixel(out, evaluator.channels, evaluator.signed, pixelIndex);
    case 'stokesDirect':
      return writeStokesSnapshotDisplayPixel(
        out,
        evaluator.parameter,
        readScalarStokesSample(evaluator.stokes, pixelIndex)
      );
    case 'stokesRgb':
      return writeRgbStokesSnapshotDisplayPixel(
        out,
        evaluator.parameter,
        evaluator.r,
        evaluator.g,
        evaluator.b,
        pixelIndex
      );
    case 'stokesRgbLuminance':
      return writeStokesSnapshotDisplayPixel(
        out,
        evaluator.parameter,
        computeRgbStokesMonoValues(evaluator.r, evaluator.g, evaluator.b, pixelIndex)
      );
    case 'stokesSpectralRgb':
      return writeSpectralStokesRgbSnapshotDisplayPixel(
        out,
        evaluator.parameter,
        evaluator.channels,
        pixelIndex
      );
    case 'stokesSpectralRgbLuminance':
      return writeStokesSnapshotDisplayPixel(
        out,
        evaluator.parameter,
        computeSpectralStokesRgbMonoValues(evaluator.channels, pixelIndex)
      );
  }
}

export function sanitizeDisplayValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function sanitizeAlphaValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function createDisplayPixelValues(): DisplayPixelValues {
  return { r: 0, g: 0, b: 0, a: 1 };
}

function createStokesDirectEvaluator(
  layer: DecodedLayer,
  binding: DisplaySourceBinding
): DisplaySelectionEvaluator {
  const parameter = binding.stokesParameter;
  if (!parameter) {
    return {
      kind: 'empty',
      binding: createEmptyDisplaySourceBinding()
    };
  }

  return {
    kind: 'stokesDirect',
    binding,
    parameter,
    stokes: resolveStokesChannelArraysFromSlots(layer, binding.slots, 0)
  };
}

function createSpectralRgbEvaluator(
  layer: DecodedLayer,
  binding: DisplaySourceBinding
): DisplaySelectionEvaluator {
  const seriesKey = parseSpectralRgbSourceName(binding.slots[0]) ?? '';
  const spectralChannels = detectSpectralChannelsForSeries(layer.channelNames, seriesKey);
  const coefficients = buildReflectanceSpectralRgbCoefficients(spectralChannels);
  return {
    kind: 'spectralRgb',
    binding,
    channels: resolveSpectralRgbChannels(layer, coefficients),
    signed: shouldReadSpectralRgbSeriesSigned(layer.channelNames, seriesKey)
  };
}

function createRgbStokesEvaluator(
  layer: DecodedLayer,
  binding: DisplaySourceBinding,
  kind: 'stokesRgb' | 'stokesRgbLuminance'
): DisplaySelectionEvaluator {
  const parameter = binding.stokesParameter;
  if (!parameter) {
    return {
      kind: 'empty',
      binding: createEmptyDisplaySourceBinding()
    };
  }

  return {
    kind,
    binding,
    parameter,
    r: resolveStokesChannelArraysFromSlots(layer, binding.slots, 0),
    g: resolveStokesChannelArraysFromSlots(layer, binding.slots, 4),
    b: resolveStokesChannelArraysFromSlots(layer, binding.slots, 8)
  };
}

function createSpectralStokesRgbEvaluator(
  layer: DecodedLayer,
  binding: DisplaySourceBinding,
  kind: 'stokesSpectralRgb' | 'stokesSpectralRgbLuminance'
): DisplaySelectionEvaluator {
  const parameter = binding.stokesParameter;
  if (!parameter) {
    return {
      kind: 'empty',
      binding: createEmptyDisplaySourceBinding()
    };
  }

  return {
    kind,
    binding,
    parameter,
    channels: resolveSpectralStokesRgbChannelArrays(layer)
  };
}

function setDisplayPixelValues(
  output: DisplayPixelValues,
  r: number,
  g: number,
  b: number,
  a: number
): DisplayPixelValues {
  output.r = r;
  output.g = g;
  output.b = b;
  output.a = a;
  return output;
}

function writeSpectralRgbDisplayPixel(
  output: DisplayPixelValues,
  channels: readonly ResolvedSpectralRgbChannel[],
  signed: boolean,
  pixelIndex: number
): DisplayPixelValues {
  const rgb = readSpectralRgbSampleAtIndex(channels, pixelIndex, undefined, { clamp: !signed });
  return setDisplayPixelValues(output, rgb.r, rgb.g, rgb.b, 1);
}

function writeStokesDisplayPixel(
  output: DisplayPixelValues,
  parameter: NonNullable<DisplaySourceBinding['stokesParameter']>,
  sample: StokesSample
): DisplayPixelValues {
  const value = computeStokesDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
  return setDisplayPixelValues(output, value, value, value, 1);
}

function writeRgbStokesDisplayPixel(
  output: DisplayPixelValues,
  parameter: NonNullable<DisplaySourceBinding['stokesParameter']>,
  r: ResolvedScalarStokesChannels,
  g: ResolvedScalarStokesChannels,
  b: ResolvedScalarStokesChannels,
  pixelIndex: number
): DisplayPixelValues {
  return setDisplayPixelValues(
    output,
    computeStokesDisplayValueForChannels(parameter, r, pixelIndex),
    computeStokesDisplayValueForChannels(parameter, g, pixelIndex),
    computeStokesDisplayValueForChannels(parameter, b, pixelIndex),
    1
  );
}

function writeSpectralStokesRgbDisplayPixel(
  output: DisplayPixelValues,
  parameter: NonNullable<DisplaySourceBinding['stokesParameter']>,
  channels: ResolvedSpectralStokesRgbChannels,
  pixelIndex: number
): DisplayPixelValues {
  const values = computeSpectralStokesRgbDisplayValues(parameter, channels, pixelIndex);
  return setDisplayPixelValues(output, values.r, values.g, values.b, 1);
}

function writeRawStokesDisplayPixel(
  output: DisplayPixelValues,
  parameter: NonNullable<DisplaySourceBinding['stokesParameter']>,
  sample: StokesSample
): DisplayPixelValues {
  const value = computeRawStokesDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
  return setDisplayPixelValues(output, value, value, value, 1);
}

function writeRawRgbStokesDisplayPixel(
  output: DisplayPixelValues,
  parameter: NonNullable<DisplaySourceBinding['stokesParameter']>,
  r: ResolvedScalarStokesChannels,
  g: ResolvedScalarStokesChannels,
  b: ResolvedScalarStokesChannels,
  pixelIndex: number
): DisplayPixelValues {
  return setDisplayPixelValues(
    output,
    computeRawStokesDisplayValueForChannels(parameter, r, pixelIndex),
    computeRawStokesDisplayValueForChannels(parameter, g, pixelIndex),
    computeRawStokesDisplayValueForChannels(parameter, b, pixelIndex),
    1
  );
}

function writeRawSpectralStokesRgbDisplayPixel(
  output: DisplayPixelValues,
  parameter: NonNullable<DisplaySourceBinding['stokesParameter']>,
  channels: ResolvedSpectralStokesRgbChannels,
  pixelIndex: number
): DisplayPixelValues {
  const values = computeRawSpectralStokesRgbDisplayValues(parameter, channels, pixelIndex);
  return setDisplayPixelValues(output, values.r, values.g, values.b, 1);
}

function writeStokesSnapshotDisplayPixel(
  output: DisplayPixelValues,
  parameter: NonNullable<DisplaySourceBinding['stokesParameter']>,
  sample: StokesSample
): DisplayPixelValues {
  const value = computeStokesDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
  const modulation = computeStokesDegreeModulationDisplayValue(
    parameter,
    sample.s0,
    sample.s1,
    sample.s2,
    sample.s3
  );
  return setDisplayPixelValues(output, value, value, value, modulation ?? 1);
}

function writeRgbStokesSnapshotDisplayPixel(
  output: DisplayPixelValues,
  parameter: NonNullable<DisplaySourceBinding['stokesParameter']>,
  r: ResolvedScalarStokesChannels,
  g: ResolvedScalarStokesChannels,
  b: ResolvedScalarStokesChannels,
  pixelIndex: number
): DisplayPixelValues {
  return setDisplayPixelValues(
    output,
    computeStokesDisplayValueForChannels(parameter, r, pixelIndex),
    computeStokesDisplayValueForChannels(parameter, g, pixelIndex),
    computeStokesDisplayValueForChannels(parameter, b, pixelIndex),
    1
  );
}

function writeSpectralStokesRgbSnapshotDisplayPixel(
  output: DisplayPixelValues,
  parameter: NonNullable<DisplaySourceBinding['stokesParameter']>,
  channels: ResolvedSpectralStokesRgbChannels,
  pixelIndex: number
): DisplayPixelValues {
  const values = computeSpectralStokesRgbDisplayValues(parameter, channels, pixelIndex);
  return setDisplayPixelValues(output, values.r, values.g, values.b, 1);
}

function getOptionalChannelReadView(
  layer: DecodedLayer,
  channelName: string | null
): ChannelReadView | null {
  return channelName ? getChannelReadView(layer, channelName) : null;
}
