import {
  AUTO_EXPOSURE_PERCENTILE,
  AUTO_EXPOSURE_SOURCE,
  createAutoExposureResult,
  type AutoExposureResult
} from './auto-exposure';
import { computeRec709Luminance } from './color';
import {
  readPixelChannelValue,
  getChannelReadView,
  readChannelValue,
  type ChannelReadView
} from './channel-storage';
import {
  isGroupedRgbStokesSelection,
  isStokesSelection,
  selectionUsesImageAlpha,
  serializeDisplaySelectionKey,
  type DisplaySelection,
  type StokesSelection,
  type StokesParameter
} from './display-model';
import { clampImageRoiToBounds, getImageRoiHeight, getImageRoiPixelCount, getImageRoiWidth } from './roi';
import {
  computeStokesDegreeModulationDisplayValue,
  computeStokesDegreeModulationValue,
  computeStokesDisplayValue,
  detectRgbStokesChannels,
  detectScalarStokesChannels,
  getStokesDegreeModulationLabel,
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
  type ImageRoi,
  type PixelSample,
  type RoiStats,
  type RoiStatsChannelSummary,
  type VisualizationMode,
  type ViewerState
} from './types';

export const DISPLAY_SOURCE_SLOT_COUNT = 12;

export type DisplaySourceMode =
  | 'empty'
  | 'channelRgb'
  | 'channelMono'
  | 'stokesDirect'
  | 'stokesRgb'
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
      kind: 'stokesRgb';
      binding: DisplaySourceBinding;
      parameter: StokesParameter;
      r: ResolvedScalarStokesChannels;
      g: ResolvedScalarStokesChannels;
      b: ResolvedScalarStokesChannels;
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

function serializeDisplaySelectionRevisionKey(
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode
): string {
  if (!selection) {
    return 'none';
  }

  const baseKey = serializeDisplaySelectionKey(selection);
  return isGroupedRgbStokesSelection(selection)
    ? `${baseKey}:${visualizationMode}`
    : baseKey;
}

export function serializeDisplaySelectionLuminanceKey(
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb'
): string {
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
      return serializeDisplaySelectionRevisionKey(selection, visualizationMode);
  }
}

export function buildDisplayTextureRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> & Partial<Pick<ViewerState, 'visualizationMode'>>
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionRevisionKey(state.displaySelection, state.visualizationMode ?? 'rgb')
  ].join(':');
}

export function buildDisplayLuminanceRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> & Partial<Pick<ViewerState, 'visualizationMode'>>
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionLuminanceKey(state.displaySelection, state.visualizationMode ?? 'rgb')
  ].join(':');
}

export function buildDisplayAutoExposureRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> & Partial<Pick<ViewerState, 'visualizationMode'>>,
  percentile = AUTO_EXPOSURE_PERCENTILE
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionRevisionKey(state.displaySelection, state.visualizationMode ?? 'rgb'),
    `autoExposure:${AUTO_EXPOSURE_SOURCE}:p${percentile}`
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
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb'
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
      return resolveStokesDisplaySelectionEvaluator(layer, selection, visualizationMode);
  }
}

export function buildDisplaySourceBinding(
  layer: DecodedLayer,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb'
): DisplaySourceBinding {
  return resolveDisplaySelectionEvaluator(layer, selection, visualizationMode).binding;
}

export function getDisplaySourceBindingChannelNames(binding: DisplaySourceBinding): string[] {
  const uniqueChannels = new Set<string>();

  for (const channelName of binding.slots) {
    if (!channelName) {
      continue;
    }

    uniqueChannels.add(channelName);
  }

  return [...uniqueChannels];
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
  visualizationMode: VisualizationMode = 'rgb',
  output?: Float32Array
): Float32Array {
  const pixelCount = width * height;
  const requiredLength = pixelCount * 4;
  const out = output && output.length === requiredLength
    ? output
    : new Float32Array(requiredLength);

  return fillDisplayTextureFromEvaluator(
    resolveDisplaySelectionEvaluator(layer, selection, visualizationMode),
    pixelCount,
    out
  );
}

export function buildStokesDisplayTexture(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: StokesSelection,
  visualizationMode: VisualizationMode = 'rgb',
  output?: Float32Array
): Float32Array {
  const pixelCount = width * height;
  const requiredLength = pixelCount * 4;
  const out = output && output.length === requiredLength
    ? output
    : new Float32Array(requiredLength);

  return fillDisplayTextureFromEvaluator(
    resolveDisplaySelectionEvaluator(layer, selection, visualizationMode),
    pixelCount,
    out
  );
}

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
    readDisplaySelectionPixelValuesAtIndex(evaluator, pixelIndex, values);
    const scalar = Math.max(values.r, values.g, values.b);
    if (!Number.isFinite(scalar) || scalar <= 0) {
      continue;
    }

    scalars[scalarCount] = scalar;
    scalarCount += 1;
  }

  if (scalarCount === 0) {
    return createAutoExposureResult(1, percentile);
  }

  const percentile01 = Math.min(1, Math.max(0, percentile / 100));
  const percentileIndex = Math.floor((scalarCount - 1) * percentile01);
  const sortedScalars = scalars.subarray(0, scalarCount);
  sortedScalars.sort();
  return createAutoExposureResult(sortedScalars[percentileIndex] ?? 1, percentile);
}

export function computeDisplaySelectionRoiStats(
  layer: DecodedLayer,
  width: number,
  height: number,
  roi: ImageRoi,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb'
): RoiStats | null {
  const clampedRoi = clampImageRoiToBounds(roi, width, height);
  if (!clampedRoi) {
    return null;
  }

  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode);
  const accumulators = createRoiStatsAccumulators(evaluator, selection);
  const pixelCount = getImageRoiPixelCount(clampedRoi);

  for (let iy = clampedRoi.y0; iy <= clampedRoi.y1; iy += 1) {
    const rowOffset = iy * width;
    for (let ix = clampedRoi.x0; ix <= clampedRoi.x1; ix += 1) {
      const pixelIndex = rowOffset + ix;
      for (const accumulator of accumulators) {
        const value = accumulator.read(pixelIndex);
        if (!Number.isFinite(value)) {
          continue;
        }

        accumulator.validPixelCount += 1;
        accumulator.sum += value;
        if (value < accumulator.min) {
          accumulator.min = value;
        }
        if (value > accumulator.max) {
          accumulator.max = value;
        }
      }
    }
  }

  return {
    roi: clampedRoi,
    width: getImageRoiWidth(clampedRoi),
    height: getImageRoiHeight(clampedRoi),
    pixelCount,
    channels: accumulators.map(toRoiStatsChannelSummary)
  };
}

export function readDisplaySelectionPixelValues(
  layer: DecodedLayer,
  width: number,
  height: number,
  pixel: ImagePixel,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  output?: DisplayPixelValues
): DisplayPixelValues | null {
  if (pixel.ix < 0 || pixel.iy < 0 || pixel.ix >= width || pixel.iy >= height) {
    return null;
  }

  return readDisplaySelectionPixelValuesAtIndex(
    resolveDisplaySelectionEvaluator(layer, selection, visualizationMode),
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
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb'
): PixelSample | null {
  const sample = samplePixelValues(layer, width, height, pixel);
  if (!sample || !isStokesSelection(selection) || !isStokesDisplayAvailable(layer.channelNames, selection)) {
    return sample;
  }

  const flatIndex = pixel.iy * width + pixel.ix;
  appendStokesSampleValues(layer, flatIndex, selection, sample.values, visualizationMode);
  return sample;
}

function resolveStokesDisplaySelectionEvaluator(
  layer: DecodedLayer,
  selection: StokesSelection,
  visualizationMode: VisualizationMode
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

  const mode: 'stokesRgb' | 'stokesRgbLuminance' = visualizationMode === 'colormap'
    ? 'stokesRgbLuminance'
    : 'stokesRgb';
  return {
    kind: mode,
    binding: createDisplaySourceBinding(
      mode,
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
      case 'stokesRgb':
        writeRgbStokesSnapshotPixel(
          output,
          outIndex,
          evaluator.parameter,
          evaluator.r,
          evaluator.g,
          evaluator.b,
          pixelIndex
        );
        break;
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

function writeRgbStokesDisplayPixel(
  output: DisplayPixelValues,
  parameter: StokesParameter,
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
  parameter: StokesParameter,
  sample: { s0: number; s1: number; s2: number; s3: number }
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
  parameter: StokesParameter,
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

function writeRgbStokesSnapshotPixel(
  output: Float32Array,
  outIndex: number,
  parameter: StokesParameter,
  r: ResolvedScalarStokesChannels,
  g: ResolvedScalarStokesChannels,
  b: ResolvedScalarStokesChannels,
  pixelIndex: number
): void {
  output[outIndex + 0] = computeStokesDisplayValueForChannels(parameter, r, pixelIndex);
  output[outIndex + 1] = computeStokesDisplayValueForChannels(parameter, g, pixelIndex);
  output[outIndex + 2] = computeStokesDisplayValueForChannels(parameter, b, pixelIndex);
  output[outIndex + 3] = 1;
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

function computeStokesDisplayValueForChannels(
  parameter: StokesParameter,
  channels: ResolvedScalarStokesChannels,
  pixelIndex: number
): number {
  const sample = readScalarStokesSample(channels, pixelIndex);
  return sanitizeDisplayValue(computeStokesDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3));
}

function computeRawStokesDisplayValueForChannels(
  parameter: StokesParameter,
  channels: ResolvedScalarStokesChannels,
  pixelIndex: number
): number {
  const sample = readScalarStokesSample(channels, pixelIndex);
  return computeRawStokesDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
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

interface RoiStatsAccumulator {
  label: string;
  min: number;
  max: number;
  sum: number;
  validPixelCount: number;
  read: (pixelIndex: number) => number;
}

function createRoiStatsAccumulators(
  evaluator: DisplaySelectionEvaluator,
  selection: DisplaySelection | null
): RoiStatsAccumulator[] {
  switch (evaluator.kind) {
    case 'empty':
      return [];
    case 'channelRgb': {
      const rows: RoiStatsAccumulator[] = [
        createRoiStatsAccumulator('R', (pixelIndex) => readChannelValue(evaluator.r, pixelIndex)),
        createRoiStatsAccumulator('G', (pixelIndex) => readChannelValue(evaluator.g, pixelIndex)),
        createRoiStatsAccumulator('B', (pixelIndex) => readChannelValue(evaluator.b, pixelIndex))
      ];
      if (selectionUsesImageAlpha(selection) && evaluator.a) {
        rows.push(createRoiStatsAccumulator('A', (pixelIndex) => readChannelValue(evaluator.a, pixelIndex)));
      }
      return rows;
    }
    case 'channelMono': {
      const rows = [
        createRoiStatsAccumulator('Mono', (pixelIndex) => readChannelValue(evaluator.channel, pixelIndex))
      ];
      if (selectionUsesImageAlpha(selection) && evaluator.a) {
        rows.push(createRoiStatsAccumulator('A', (pixelIndex) => readChannelValue(evaluator.a, pixelIndex)));
      }
      return rows;
    }
    case 'stokesDirect':
      return [
        createRoiStatsAccumulator(
          'Mono',
          (pixelIndex) => {
            const sample = readScalarStokesSample(evaluator.stokes, pixelIndex);
            return computeRawStokesDisplayValue(
              evaluator.parameter,
              sample.s0,
              sample.s1,
              sample.s2,
              sample.s3
            );
          }
        )
      ];
    case 'stokesRgb':
      return [
        createRoiStatsAccumulator('R', (pixelIndex) => computeRawStokesDisplayValueForChannels(
          evaluator.parameter,
          evaluator.r,
          pixelIndex
        )),
        createRoiStatsAccumulator('G', (pixelIndex) => computeRawStokesDisplayValueForChannels(
          evaluator.parameter,
          evaluator.g,
          pixelIndex
        )),
        createRoiStatsAccumulator('B', (pixelIndex) => computeRawStokesDisplayValueForChannels(
          evaluator.parameter,
          evaluator.b,
          pixelIndex
        ))
      ];
    case 'stokesRgbLuminance':
      return [
        createRoiStatsAccumulator(
          'Mono',
          (pixelIndex) => {
            const sample = computeRgbStokesMonoValues(evaluator.r, evaluator.g, evaluator.b, pixelIndex);
            return computeRawStokesDisplayValue(
              evaluator.parameter,
              sample.s0,
              sample.s1,
              sample.s2,
              sample.s3
            );
          }
        )
      ];
  }
}

function createRoiStatsAccumulator(
  label: string,
  read: (pixelIndex: number) => number
): RoiStatsAccumulator {
  return {
    label,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    sum: 0,
    validPixelCount: 0,
    read
  };
}

function computeRawStokesDisplayValue(
  parameter: StokesParameter,
  s0: number,
  s1: number,
  s2: number,
  s3: number
): number {
  switch (parameter) {
    case 'aolp':
      return computeRawStokesAolp(s1, s2);
    case 'dolp':
      return computeRawStokesDolp(s0, s1, s2);
    case 'dop':
      return computeRawStokesDop(s0, s1, s2, s3);
    case 'docp':
      return computeRawStokesDocp(s0, s3);
    case 'cop':
    case 'top':
      return computeRawStokesEang(s1, s2, s3);
    case 's1_over_s0':
      return computeRawStokesNormalizedComponent(s0, s1);
    case 's2_over_s0':
      return computeRawStokesNormalizedComponent(s0, s2);
    case 's3_over_s0':
      return computeRawStokesNormalizedComponent(s0, s3);
  }
}

function computeRawStokesAolp(s1: number, s2: number): number {
  if (!Number.isFinite(s1) || !Number.isFinite(s2)) {
    return Number.NaN;
  }

  const aolp = 0.5 * Math.atan2(s2, s1);
  if (!Number.isFinite(aolp)) {
    return Number.NaN;
  }

  return aolp < 0 ? aolp + Math.PI : aolp;
}

function computeRawStokesDolp(s0: number, s1: number, s2: number): number {
  if (!Number.isFinite(s0) || !Number.isFinite(s1) || !Number.isFinite(s2) || s0 === 0) {
    return Number.NaN;
  }

  const dolp = Math.sqrt(s1 ** 2 + s2 ** 2) / s0;
  return Number.isFinite(dolp) ? dolp : Number.NaN;
}

function computeRawStokesDop(s0: number, s1: number, s2: number, s3: number): number {
  if (
    !Number.isFinite(s0) ||
    !Number.isFinite(s1) ||
    !Number.isFinite(s2) ||
    !Number.isFinite(s3) ||
    s0 === 0
  ) {
    return Number.NaN;
  }

  const dop = Math.sqrt(s1 ** 2 + s2 ** 2 + s3 ** 2) / s0;
  return Number.isFinite(dop) ? dop : Number.NaN;
}

function computeRawStokesDocp(s0: number, s3: number): number {
  if (!Number.isFinite(s0) || !Number.isFinite(s3) || s0 === 0) {
    return Number.NaN;
  }

  const docp = Math.abs(s3) / s0;
  return Number.isFinite(docp) ? docp : Number.NaN;
}

function computeRawStokesEang(s1: number, s2: number, s3: number): number {
  if (!Number.isFinite(s1) || !Number.isFinite(s2) || !Number.isFinite(s3)) {
    return Number.NaN;
  }

  const eang = 0.5 * Math.atan2(s3, Math.sqrt(s1 ** 2 + s2 ** 2));
  return Number.isFinite(eang) ? eang : Number.NaN;
}

function computeRawStokesNormalizedComponent(s0: number, component: number): number {
  if (!Number.isFinite(s0) || !Number.isFinite(component) || s0 === 0) {
    return Number.NaN;
  }

  const normalized = component / s0;
  return Number.isFinite(normalized) ? normalized : Number.NaN;
}

function toRoiStatsChannelSummary(accumulator: RoiStatsAccumulator): RoiStatsChannelSummary {
  if (accumulator.validPixelCount === 0) {
    return {
      label: accumulator.label,
      min: null,
      mean: null,
      max: null,
      validPixelCount: 0
    };
  }

  return {
    label: accumulator.label,
    min: accumulator.min,
    mean: accumulator.sum / accumulator.validPixelCount,
    max: accumulator.max,
    validPixelCount: accumulator.validPixelCount
  };
}

function appendStokesSampleValues(
  layer: DecodedLayer,
  flatIndex: number,
  selection: StokesSelection,
  values: Record<string, number>,
  visualizationMode: VisualizationMode
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
  if (visualizationMode === 'rgb') {
    const componentSamples: Array<[RgbStokesComponent, { s0: number; s1: number; s2: number; s3: number }]> = [
      ['R', readScalarStokesSample(r, flatIndex)],
      ['G', readScalarStokesSample(g, flatIndex)],
      ['B', readScalarStokesSample(b, flatIndex)]
    ];
    for (const [component, sample] of componentSamples) {
      values[`${label}.${component}`] = computeStokesDisplayValue(
        selection.parameter,
        sample.s0,
        sample.s1,
        sample.s2,
        sample.s3
      );
      appendStokesDegreeModulationSampleValue(selection.parameter, sample, values, component);
    }
    return;
  }

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
