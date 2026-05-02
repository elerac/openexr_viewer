import {
  getChannelReadView,
  readChannelValue,
  type ChannelReadView
} from '../channel-storage';
import { computeStokesDegreeModulationDisplayValue, computeStokesDisplayValue } from '../stokes';
import {
  computeRgbStokesMonoValues,
  computeStokesDisplayValueForChannels,
  readScalarStokesSample,
  resolveStokesChannelArraysFromSlots,
  type ResolvedScalarStokesChannels,
  type StokesSample
} from '../stokes/stokes-display';
import type { DecodedLayer, VisualizationMode } from '../types';
import {
  buildDisplaySourceBinding,
  createEmptyDisplaySourceBinding,
  type DisplaySourceBinding
} from './bindings';

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
    case 'stokesDirect':
      return createStokesDirectEvaluator(layer, binding);
    case 'stokesRgb':
      return createRgbStokesEvaluator(layer, binding, 'stokesRgb');
    case 'stokesRgbLuminance':
      return createRgbStokesEvaluator(layer, binding, 'stokesRgbLuminance');
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

function getOptionalChannelReadView(
  layer: DecodedLayer,
  channelName: string | null
): ChannelReadView | null {
  return channelName ? getChannelReadView(layer, channelName) : null;
}
