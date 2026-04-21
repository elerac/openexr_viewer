import { computeRec709Luminance } from './color';
import {
  getChannelReadView,
  readChannelValue,
  type ChannelReadView
} from './channel-storage';
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
  getStokesParameterLabel,
  isStokesDisplayAvailable,
  type RgbStokesChannels,
  type RgbStokesComponent,
  type ScalarStokesChannels
} from './stokes';
import {
  DecodedLayer,
  ImagePixel,
  PixelSample,
  ViewerState
} from './types';

export function buildDisplayTextureRevisionKey(state: Pick<ViewerState, 'activeLayer' | 'displaySelection'>): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionKey(state.displaySelection)
  ].join(':');
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
  if (!selection) {
    const out = output && output.length === width * height * 4 ? output : new Float32Array(width * height * 4);
    return fillDisplayTexture(out, 0, 0, 0);
  }

  switch (selection.kind) {
    case 'channelRgb':
      return buildDisplayTexture(
        layer,
        width,
        height,
        selection.r,
        selection.g,
        selection.b,
        selection.alpha,
        output
      );
    case 'channelMono':
      return buildDisplayTexture(
        layer,
        width,
        height,
        selection.channel,
        selection.channel,
        selection.channel,
        selection.alpha,
        output
      );
    case 'stokesScalar':
    case 'stokesAngle':
      if (!isStokesDisplayAvailable(layer.channelNames, selection)) {
        const out = output && output.length === width * height * 4 ? output : new Float32Array(width * height * 4);
        return fillDisplayTexture(out, 0, 0, 0);
      }
      return buildStokesDisplayTexture(layer, width, height, selection, output);
  }
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

  if (selection.source.kind === 'scalar') {
    const channels = detectScalarStokesChannels(layer.channelNames);
    if (!channels) {
      return fillDisplayTexture(out, 0, 0, 0);
    }

    const samples = resolveStokesChannelArrays(layer, channels);
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      writeStokesPixel(out, pixelIndex, selection.parameter, readScalarStokesSample(samples, pixelIndex));
    }
    return out;
  }

  const channels = detectRgbStokesChannels(layer.channelNames);
  if (!channels) {
    return fillDisplayTexture(out, 0, 0, 0);
  }

  if (selection.source.kind === 'rgbComponent') {
    const componentChannels = resolveStokesChannelArrays(layer, getRgbComponentChannels(channels, selection.source.component));
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      writeStokesPixel(out, pixelIndex, selection.parameter, readScalarStokesSample(componentChannels, pixelIndex));
    }
    return out;
  }

  const r = resolveStokesChannelArrays(layer, channels.r);
  const g = resolveStokesChannelArrays(layer, channels.g);
  const b = resolveStokesChannelArrays(layer, channels.b);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    writeStokesPixel(out, pixelIndex, selection.parameter, computeRgbStokesMonoValues(r, g, b, pixelIndex));
  }

  return out;
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
  const { pixels, channelCount } = layer.channelStorage;
  const pixelBaseIndex = flatIndex * channelCount;

  for (let channelIndex = 0; channelIndex < layer.channelNames.length; channelIndex += 1) {
    const channelName = layer.channelNames[channelIndex];
    if (!channelName) {
      continue;
    }
    values[channelName] = pixels[pixelBaseIndex + channelIndex] ?? 0;
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

function resolveStokesChannelArrays(
  layer: DecodedLayer,
  channels: ScalarStokesChannels
): { s0: ChannelReadView | null; s1: ChannelReadView | null; s2: ChannelReadView | null; s3: ChannelReadView | null } {
  return {
    s0: getChannelReadView(layer, channels.s0),
    s1: getChannelReadView(layer, channels.s1),
    s2: getChannelReadView(layer, channels.s2),
    s3: getChannelReadView(layer, channels.s3)
  };
}

function readScalarStokesSample(
  channels: { s0: ChannelReadView | null; s1: ChannelReadView | null; s2: ChannelReadView | null; s3: ChannelReadView | null },
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
  r: { s0: ChannelReadView | null; s1: ChannelReadView | null; s2: ChannelReadView | null; s3: ChannelReadView | null },
  g: { s0: ChannelReadView | null; s1: ChannelReadView | null; s2: ChannelReadView | null; s3: ChannelReadView | null },
  b: { s0: ChannelReadView | null; s1: ChannelReadView | null; s2: ChannelReadView | null; s3: ChannelReadView | null },
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

function fillDisplayTexture(out: Float32Array, r: number, g: number, b: number): Float32Array {
  for (let i = 0; i < out.length; i += 4) {
    out[i + 0] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 1;
  }

  return out;
}

function writeStokesPixel(
  out: Float32Array,
  pixelIndex: number,
  parameter: StokesParameter,
  sample: { s0: number; s1: number; s2: number; s3: number }
): void {
  const value = computeStokesDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
  const modulation = computeStokesDegreeModulationDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
  const outIndex = pixelIndex * 4;
  out[outIndex + 0] = value;
  out[outIndex + 1] = value;
  out[outIndex + 2] = value;
  out[outIndex + 3] = modulation ?? 1;
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
