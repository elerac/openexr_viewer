import { computeRec709Luminance } from './color';
import {
  readPixelChannelValue,
  getChannelReadView,
  readChannelValue,
  type FiniteValueRange,
  type ChannelReadView
} from './channel-storage';
import { buildChannelDisplayOptions } from './display-selection';
import {
  isStokesSelection,
  serializeDisplaySelectionKey,
  type DisplaySelection,
  type StokesSelection,
  type StokesParameter
} from './display-model';
import {
  computeStokesDegreeModulationDisplayValue,
  computeStokesDegreeModulationValue,
  computeStokesDisplayValue,
  detectRgbStokesChannels,
  detectScalarStokesChannels,
  getStokesDegreeModulationLabel,
  getStokesDisplayOptions,
  getStokesParameterLabel,
  isStokesDisplayAvailable,
  type RgbStokesChannels,
  type RgbStokesComponent,
  type ScalarStokesChannels
} from './stokes';
import {
  type DecodedLayer,
  type DisplayLuminanceRange,
  type ImagePixel,
  type PixelSample,
  type ViewerState
} from './types';

export const DISPLAY_SOURCE_SLOT_COUNT = 12;

export type DisplaySourceMode =
  | 'empty'
  | 'channelRgb'
  | 'channelMono'
  | 'stokesDirect'
  | 'stokesRgbLuminance';

export interface DisplaySourceBinding {
  mode: DisplaySourceMode;
  slots: Array<string | null>;
  usesImageAlpha: boolean;
  stokesParameter: StokesParameter | null;
}

export interface DisplayPixelValues {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface ResolvedScalarStokesChannels {
  s0: ChannelReadView | null;
  s1: ChannelReadView | null;
  s2: ChannelReadView | null;
  s3: ChannelReadView | null;
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
      parameter: StokesParameter;
      stokes: ResolvedScalarStokesChannels;
    }
  | {
      kind: 'stokesRgbLuminance';
      binding: DisplaySourceBinding;
      parameter: StokesParameter;
      r: ResolvedScalarStokesChannels;
      g: ResolvedScalarStokesChannels;
      b: ResolvedScalarStokesChannels;
    };

const EMPTY_DISPLAY_SLOTS = Object.freeze(
  Array.from({ length: DISPLAY_SOURCE_SLOT_COUNT }, () => null as string | null)
);

export function serializeDisplaySelectionLuminanceKey(selection: DisplaySelection | null): string {
  if (!selection) {
    return 'none';
  }

  switch (selection.kind) {
    case 'channelRgb':
      return `channelRgb:${selection.r}:${selection.g}:${selection.b}`;
    case 'channelMono':
      return `channelMono:${selection.channel}`;
    case 'stokesScalar':
    case 'stokesAngle':
      return serializeDisplaySelectionKey(selection);
  }
}

export function buildDisplayTextureRevisionKey(state: Pick<ViewerState, 'activeLayer' | 'displaySelection'>): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionKey(state.displaySelection)
  ].join(':');
}

export function buildDisplayLuminanceRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'>
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionLuminanceKey(state.displaySelection)
  ].join(':');
}

export function createEmptyDisplaySourceBinding(): DisplaySourceBinding {
  return {
    mode: 'empty',
    slots: [...EMPTY_DISPLAY_SLOTS],
    usesImageAlpha: false,
    stokesParameter: null
  };
}

export function resolveDisplaySelectionEvaluator(
  layer: DecodedLayer,
  selection: DisplaySelection | null
): DisplaySelectionEvaluator {
  if (!selection) {
    return {
      kind: 'empty',
      binding: createEmptyDisplaySourceBinding()
    };
  }

  switch (selection.kind) {
    case 'channelRgb':
      return {
        kind: 'channelRgb',
        binding: createDisplaySourceBinding(
          'channelRgb',
          [selection.r, selection.g, selection.b, selection.alpha],
          selection.alpha !== null,
          null
        ),
        r: getChannelReadView(layer, selection.r),
        g: getChannelReadView(layer, selection.g),
        b: getChannelReadView(layer, selection.b),
        a: selection.alpha ? getChannelReadView(layer, selection.alpha) : null
      };
    case 'channelMono':
      return {
        kind: 'channelMono',
        binding: createDisplaySourceBinding(
          'channelMono',
          [selection.channel, null, null, selection.alpha],
          selection.alpha !== null,
          null
        ),
        channel: getChannelReadView(layer, selection.channel),
        a: selection.alpha ? getChannelReadView(layer, selection.alpha) : null
      };
    case 'stokesScalar':
    case 'stokesAngle':
      return resolveStokesDisplaySelectionEvaluator(layer, selection);
  }
}

export function buildDisplaySourceBinding(
  layer: DecodedLayer,
  selection: DisplaySelection | null
): DisplaySourceBinding {
  return resolveDisplaySelectionEvaluator(layer, selection).binding;
}

export function buildDisplayTexture(
  layer: DecodedLayer,
  width: number,
  height: number,
  displayR: string,
  displayG: string,
  displayB: string,
  displayAOrOutput?: string | null | Float32Array,
  output?: Float32Array
): Float32Array {
  const pixelCount = width * height;
  const requiredLength = pixelCount * 4;
  const displayA = displayAOrOutput instanceof Float32Array ? null : displayAOrOutput ?? null;
  const outputBuffer = displayAOrOutput instanceof Float32Array ? displayAOrOutput : output;
  const out = outputBuffer && outputBuffer.length === requiredLength
    ? outputBuffer
    : new Float32Array(requiredLength);

  const channelR = getChannelReadView(layer, displayR);
  const channelG = getChannelReadView(layer, displayG);
  const channelB = getChannelReadView(layer, displayB);
  const channelA = displayA ? getChannelReadView(layer, displayA) : null;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const outIndex = pixelIndex * 4;
    out[outIndex + 0] = sanitizeDisplayValue(readChannelValue(channelR, pixelIndex));
    out[outIndex + 1] = sanitizeDisplayValue(readChannelValue(channelG, pixelIndex));
    out[outIndex + 2] = sanitizeDisplayValue(readChannelValue(channelB, pixelIndex));
    out[outIndex + 3] = channelA ? sanitizeAlphaValue(readChannelValue(channelA, pixelIndex)) : 1;
  }

  return out;
}

export function buildSelectedDisplayTexture(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: DisplaySelection | null,
  output?: Float32Array
): Float32Array {
  const pixelCount = width * height;
  const requiredLength = pixelCount * 4;
  const out = output && output.length === requiredLength
    ? output
    : new Float32Array(requiredLength);

  return fillDisplayTextureFromEvaluator(resolveDisplaySelectionEvaluator(layer, selection), pixelCount, out);
}

export function buildStokesDisplayTexture(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: StokesSelection,
  output?: Float32Array
): Float32Array {
  const pixelCount = width * height;
  const requiredLength = pixelCount * 4;
  const out = output && output.length === requiredLength
    ? output
    : new Float32Array(requiredLength);

  return fillDisplayTextureFromEvaluator(resolveDisplaySelectionEvaluator(layer, selection), pixelCount, out);
}

export function computeDisplaySelectionLuminanceRange(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: DisplaySelection | null
): DisplayLuminanceRange | null {
  const pixelCount = width * height;
  const evaluator = resolveDisplaySelectionEvaluator(layer, selection);
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

export function precomputeDisplaySelectionLuminanceRangeBySelectionKey(
  layer: DecodedLayer,
  width: number,
  height: number,
  finiteRangeByChannel: Record<string, FiniteValueRange | null> = {}
): Record<string, DisplayLuminanceRange | null> {
  const rangesBySelectionKey: Record<string, DisplayLuminanceRange | null> = {};
  const selectionsByKey = collectDisplaySelectionsForAnalysis(layer.channelNames);

  for (const [selectionKey, selection] of selectionsByKey) {
    if (selection?.kind === 'channelMono') {
      rangesBySelectionKey[selectionKey] = finiteRangeByChannel[selection.channel]
        ?? computeDisplaySelectionLuminanceRange(layer, width, height, selection);
      continue;
    }

    rangesBySelectionKey[selectionKey] = computeDisplaySelectionLuminanceRange(layer, width, height, selection);
  }

  return rangesBySelectionKey;
}

export function readDisplaySelectionPixelValues(
  layer: DecodedLayer,
  width: number,
  height: number,
  pixel: ImagePixel,
  selection: DisplaySelection | null,
  output?: DisplayPixelValues
): DisplayPixelValues | null {
  if (pixel.ix < 0 || pixel.iy < 0 || pixel.ix >= width || pixel.iy >= height) {
    return null;
  }

  return readDisplaySelectionPixelValuesAtIndex(
    resolveDisplaySelectionEvaluator(layer, selection),
    pixel.iy * width + pixel.ix,
    output
  );
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
    case 'stokesRgbLuminance':
      return writeStokesDisplayPixel(
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

export function samplePixelValues(
  layer: DecodedLayer,
  width: number,
  height: number,
  pixel: ImagePixel
): PixelSample | null {
  if (pixel.ix < 0 || pixel.iy < 0 || pixel.ix >= width || pixel.iy >= height) {
    return null;
  }

  const flatIndex = pixel.iy * width + pixel.ix;
  const values: Record<string, number> = {};

  for (let channelIndex = 0; channelIndex < layer.channelNames.length; channelIndex += 1) {
    const channelName = layer.channelNames[channelIndex];
    if (!channelName) {
      continue;
    }
    values[channelName] = readPixelChannelValue(layer, flatIndex, channelName);
  }

  return {
    x: pixel.ix,
    y: pixel.iy,
    values
  };
}

export function samplePixelValuesForDisplay(
  layer: DecodedLayer,
  width: number,
  height: number,
  pixel: ImagePixel,
  selection: DisplaySelection | null
): PixelSample | null {
  const sample = samplePixelValues(layer, width, height, pixel);
  if (!sample || !isStokesSelection(selection) || !isStokesDisplayAvailable(layer.channelNames, selection)) {
    return sample;
  }

  const flatIndex = pixel.iy * width + pixel.ix;
  appendStokesSampleValues(layer, flatIndex, selection, sample.values);
  return sample;
}

function resolveStokesDisplaySelectionEvaluator(
  layer: DecodedLayer,
  selection: StokesSelection
): DisplaySelectionEvaluator {
  if (!isStokesDisplayAvailable(layer.channelNames, selection)) {
    return {
      kind: 'empty',
      binding: createEmptyDisplaySourceBinding()
    };
  }

  if (selection.source.kind === 'scalar') {
    const channels = detectScalarStokesChannels(layer.channelNames);
    if (!channels) {
      return {
        kind: 'empty',
        binding: createEmptyDisplaySourceBinding()
      };
    }

    return {
      kind: 'stokesDirect',
      binding: createDisplaySourceBinding(
        'stokesDirect',
        [channels.s0, channels.s1, channels.s2, channels.s3],
        false,
        selection.parameter
      ),
      parameter: selection.parameter,
      stokes: resolveStokesChannelArrays(layer, channels)
    };
  }

  const channels = detectRgbStokesChannels(layer.channelNames);
  if (!channels) {
    return {
      kind: 'empty',
      binding: createEmptyDisplaySourceBinding()
    };
  }

  if (selection.source.kind === 'rgbComponent') {
    const componentChannels = getRgbComponentChannels(channels, selection.source.component);
    return {
      kind: 'stokesDirect',
      binding: createDisplaySourceBinding(
        'stokesDirect',
        [componentChannels.s0, componentChannels.s1, componentChannels.s2, componentChannels.s3],
        false,
        selection.parameter
      ),
      parameter: selection.parameter,
      stokes: resolveStokesChannelArrays(layer, componentChannels)
    };
  }

  return {
    kind: 'stokesRgbLuminance',
    binding: createDisplaySourceBinding(
      'stokesRgbLuminance',
      [
        channels.r.s0, channels.r.s1, channels.r.s2, channels.r.s3,
        channels.g.s0, channels.g.s1, channels.g.s2, channels.g.s3,
        channels.b.s0, channels.b.s1, channels.b.s2, channels.b.s3
      ],
      false,
      selection.parameter
    ),
    parameter: selection.parameter,
    r: resolveStokesChannelArrays(layer, channels.r),
    g: resolveStokesChannelArrays(layer, channels.g),
    b: resolveStokesChannelArrays(layer, channels.b)
  };
}

function collectDisplaySelectionsForAnalysis(channelNames: string[]): Map<string, DisplaySelection | null> {
  const selections = new Map<string, DisplaySelection | null>();
  const pushSelection = (selection: DisplaySelection | null): void => {
    selections.set(serializeDisplaySelectionLuminanceKey(selection), selection);
  };

  pushSelection(null);

  for (const option of buildChannelDisplayOptions(channelNames, {
    includeRgbGroups: true,
    includeSplitChannels: false
  })) {
    pushSelection(option.selection);
  }

  for (const option of buildChannelDisplayOptions(channelNames, {
    includeRgbGroups: false,
    includeSplitChannels: true
  })) {
    pushSelection(option.selection);
  }

  for (const option of getStokesDisplayOptions(channelNames, {
    includeRgbGroups: true,
    includeSplitChannels: false
  })) {
    pushSelection(option.selection);
  }

  for (const option of getStokesDisplayOptions(channelNames, {
    includeRgbGroups: false,
    includeSplitChannels: true
  })) {
    pushSelection(option.selection);
  }

  return selections;
}

function createDisplaySourceBinding(
  mode: DisplaySourceMode,
  slots: Array<string | null>,
  usesImageAlpha: boolean,
  stokesParameter: StokesParameter | null
): DisplaySourceBinding {
  const paddedSlots = [...EMPTY_DISPLAY_SLOTS];
  for (let slotIndex = 0; slotIndex < Math.min(paddedSlots.length, slots.length); slotIndex += 1) {
    paddedSlots[slotIndex] = slots[slotIndex] ?? null;
  }

  return {
    mode,
    slots: paddedSlots,
    usesImageAlpha,
    stokesParameter
  };
}

function fillDisplayTextureFromEvaluator(
  evaluator: DisplaySelectionEvaluator,
  pixelCount: number,
  output: Float32Array
): Float32Array {
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const outIndex = pixelIndex * 4;
    switch (evaluator.kind) {
      case 'empty':
        output[outIndex + 0] = 0;
        output[outIndex + 1] = 0;
        output[outIndex + 2] = 0;
        output[outIndex + 3] = 1;
        break;
      case 'channelRgb':
        output[outIndex + 0] = sanitizeDisplayValue(readChannelValue(evaluator.r, pixelIndex));
        output[outIndex + 1] = sanitizeDisplayValue(readChannelValue(evaluator.g, pixelIndex));
        output[outIndex + 2] = sanitizeDisplayValue(readChannelValue(evaluator.b, pixelIndex));
        output[outIndex + 3] = evaluator.a ? sanitizeAlphaValue(readChannelValue(evaluator.a, pixelIndex)) : 1;
        break;
      case 'channelMono': {
        const value = sanitizeDisplayValue(readChannelValue(evaluator.channel, pixelIndex));
        output[outIndex + 0] = value;
        output[outIndex + 1] = value;
        output[outIndex + 2] = value;
        output[outIndex + 3] = evaluator.a ? sanitizeAlphaValue(readChannelValue(evaluator.a, pixelIndex)) : 1;
        break;
      }
      case 'stokesDirect': {
        const sample = readScalarStokesSample(evaluator.stokes, pixelIndex);
        writeStokesSnapshotPixel(output, outIndex, evaluator.parameter, sample);
        break;
      }
      case 'stokesRgbLuminance': {
        const sample = computeRgbStokesMonoValues(evaluator.r, evaluator.g, evaluator.b, pixelIndex);
        writeStokesSnapshotPixel(output, outIndex, evaluator.parameter, sample);
        break;
      }
    }
  }

  return output;
}

function createDisplayPixelValues(): DisplayPixelValues {
  return { r: 0, g: 0, b: 0, a: 1 };
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
  parameter: StokesParameter,
  sample: { s0: number; s1: number; s2: number; s3: number }
): DisplayPixelValues {
  const value = computeStokesDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
  return setDisplayPixelValues(output, value, value, value, 1);
}

function writeStokesSnapshotPixel(
  output: Float32Array,
  outIndex: number,
  parameter: StokesParameter,
  sample: { s0: number; s1: number; s2: number; s3: number }
): void {
  const value = computeStokesDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
  const modulation = computeStokesDegreeModulationDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
  output[outIndex + 0] = value;
  output[outIndex + 1] = value;
  output[outIndex + 2] = value;
  output[outIndex + 3] = modulation ?? 1;
}

function resolveStokesChannelArrays(
  layer: DecodedLayer,
  channels: ScalarStokesChannels
): ResolvedScalarStokesChannels {
  return {
    s0: getChannelReadView(layer, channels.s0),
    s1: getChannelReadView(layer, channels.s1),
    s2: getChannelReadView(layer, channels.s2),
    s3: getChannelReadView(layer, channels.s3)
  };
}

function readScalarStokesSample(
  channels: ResolvedScalarStokesChannels,
  pixelIndex: number
): { s0: number; s1: number; s2: number; s3: number } {
  return {
    s0: readChannelValue(channels.s0, pixelIndex),
    s1: readChannelValue(channels.s1, pixelIndex),
    s2: readChannelValue(channels.s2, pixelIndex),
    s3: readChannelValue(channels.s3, pixelIndex)
  };
}

function computeRgbStokesMonoValues(
  r: ResolvedScalarStokesChannels,
  g: ResolvedScalarStokesChannels,
  b: ResolvedScalarStokesChannels,
  pixelIndex: number
): { s0: number; s1: number; s2: number; s3: number } {
  return {
    s0: computeRec709Luminance(
      readChannelValue(r.s0, pixelIndex),
      readChannelValue(g.s0, pixelIndex),
      readChannelValue(b.s0, pixelIndex)
    ),
    s1: computeRec709Luminance(
      readChannelValue(r.s1, pixelIndex),
      readChannelValue(g.s1, pixelIndex),
      readChannelValue(b.s1, pixelIndex)
    ),
    s2: computeRec709Luminance(
      readChannelValue(r.s2, pixelIndex),
      readChannelValue(g.s2, pixelIndex),
      readChannelValue(b.s2, pixelIndex)
    ),
    s3: computeRec709Luminance(
      readChannelValue(r.s3, pixelIndex),
      readChannelValue(g.s3, pixelIndex),
      readChannelValue(b.s3, pixelIndex)
    )
  };
}

function appendStokesSampleValues(
  layer: DecodedLayer,
  flatIndex: number,
  selection: StokesSelection,
  values: Record<string, number>
): void {
  const label = getStokesParameterLabel(selection.parameter);

  if (selection.source.kind === 'scalar') {
    const channels = detectScalarStokesChannels(layer.channelNames);
    if (!channels) {
      return;
    }

    const sample = readScalarStokesSample(resolveStokesChannelArrays(layer, channels), flatIndex);
    values[label] = computeStokesDisplayValue(selection.parameter, sample.s0, sample.s1, sample.s2, sample.s3);
    appendStokesDegreeModulationSampleValue(selection.parameter, sample, values);
    return;
  }

  const channels = detectRgbStokesChannels(layer.channelNames);
  if (!channels) {
    return;
  }

  if (selection.source.kind === 'rgbComponent') {
    const componentChannels = resolveStokesChannelArrays(layer, getRgbComponentChannels(channels, selection.source.component));
    const sample = readScalarStokesSample(componentChannels, flatIndex);
    values[`${label}.${selection.source.component}`] = computeStokesDisplayValue(
      selection.parameter,
      sample.s0,
      sample.s1,
      sample.s2,
      sample.s3
    );
    appendStokesDegreeModulationSampleValue(selection.parameter, sample, values, selection.source.component);
    return;
  }

  const r = resolveStokesChannelArrays(layer, channels.r);
  const g = resolveStokesChannelArrays(layer, channels.g);
  const b = resolveStokesChannelArrays(layer, channels.b);
  const sample = computeRgbStokesMonoValues(r, g, b, flatIndex);
  values[label] = computeStokesDisplayValue(selection.parameter, sample.s0, sample.s1, sample.s2, sample.s3);
  appendStokesDegreeModulationSampleValue(selection.parameter, sample, values);
}

function appendStokesDegreeModulationSampleValue(
  parameter: StokesParameter,
  sample: { s0: number; s1: number; s2: number; s3: number },
  values: Record<string, number>,
  component: RgbStokesComponent | null = null
): void {
  const label = getStokesDegreeModulationLabel(parameter);
  if (!label) {
    return;
  }

  const value = computeStokesDegreeModulationValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
  if (value !== null) {
    values[component ? `${label}.${component}` : label] = value;
  }
}

function getRgbComponentChannels(channels: RgbStokesChannels, component: RgbStokesComponent): ScalarStokesChannels {
  if (component === 'R') {
    return channels.r;
  }
  if (component === 'G') {
    return channels.g;
  }
  return channels.b;
}
