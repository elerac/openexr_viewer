import {
  computeStokesDegreeModulationDisplayValue,
  computeStokesDegreeModulationValue,
  computeStokesDisplayValue,
  detectRgbStokesChannels,
  detectScalarStokesChannels,
  getStokesDegreeModulationLabel,
  getStokesParameterLabel,
  isStokesDisplayAvailable,
  isStokesDisplaySelection,
  resolveRgbStokesSplitComponent,
  type RgbStokesChannels,
  type RgbStokesComponent,
  type ScalarStokesChannels
} from './stokes';
import {
  DecodedLayer,
  DisplayChannelMapping,
  DisplaySelection,
  DisplaySourceKind,
  ImagePixel,
  PixelSample,
  StokesParameter,
  ViewerState,
  ZERO_CHANNEL
} from './types';

const LUMINANCE_WEIGHTS = { r: 0.2126, g: 0.7152, b: 0.0722 };

export function buildDisplayTextureRevisionKey(state: Pick<
  ViewerState,
  'activeLayer' | 'displaySource' | 'stokesParameter' | 'displayR' | 'displayG' | 'displayB' | 'displayA'
>): string {
  return [
    state.activeLayer,
    state.displaySource,
    state.stokesParameter ?? '',
    state.displayR,
    state.displayG,
    state.displayB,
    state.displayA ?? ''
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

  const channelR = getChannel(layer, displayR);
  const channelG = getChannel(layer, displayG);
  const channelB = getChannel(layer, displayB);
  const channelA = displayA ? getChannel(layer, displayA) : null;

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
  selection: DisplaySelection,
  output?: Float32Array
): Float32Array {
  if (isStokesDisplaySelection(selection) && isStokesDisplayAvailable(layer.channelNames, selection)) {
    return buildStokesDisplayTexture(
      layer,
      width,
      height,
      selection.displaySource,
      selection.stokesParameter,
      selection,
      output
    );
  }

  return buildDisplayTexture(
    layer,
    width,
    height,
    selection.displayR,
    selection.displayG,
    selection.displayB,
    selection.displayA ?? null,
    output
  );
}

export function buildStokesDisplayTexture(
  layer: DecodedLayer,
  width: number,
  height: number,
  displaySource: Exclude<DisplaySourceKind, 'channels'>,
  parameter: StokesParameter,
  selectionOrOutput?: DisplayChannelMapping | Float32Array,
  output?: Float32Array
): Float32Array {
  const pixelCount = width * height;
  const requiredLength = pixelCount * 4;
  const selection = selectionOrOutput instanceof Float32Array ? null : selectionOrOutput ?? null;
  const outputBuffer = selectionOrOutput instanceof Float32Array ? selectionOrOutput : output;
  const out = outputBuffer && outputBuffer.length === requiredLength
    ? outputBuffer
    : new Float32Array(requiredLength);

  if (displaySource === 'stokesScalar') {
    const channels = detectScalarStokesChannels(layer.channelNames);
    if (!channels) {
      return fillDisplayTexture(out, 0, 0, 0);
    }

    const s0 = getChannel(layer, channels.s0);
    const s1 = getChannel(layer, channels.s1);
    const s2 = getChannel(layer, channels.s2);
    const s3 = getChannel(layer, channels.s3);

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const s0Value = readChannelValue(s0, pixelIndex);
      const s1Value = readChannelValue(s1, pixelIndex);
      const s2Value = readChannelValue(s2, pixelIndex);
      const s3Value = readChannelValue(s3, pixelIndex);
      const value = computeStokesDisplayValue(
        parameter,
        s0Value,
        s1Value,
        s2Value,
        s3Value
      );
      const modulation = computeStokesDegreeModulationDisplayValue(
        parameter,
        s0Value,
        s1Value,
        s2Value,
        s3Value
      );
      const outIndex = pixelIndex * 4;
      out[outIndex + 0] = value;
      out[outIndex + 1] = value;
      out[outIndex + 2] = value;
      out[outIndex + 3] = modulation ?? 1;
    }

    return out;
  }

  const channels = detectRgbStokesChannels(layer.channelNames);
  if (!channels) {
    return fillDisplayTexture(out, 0, 0, 0);
  }

  const splitComponent = selection ? resolveRgbStokesSplitComponent(channels, selection) : null;
  if (splitComponent) {
    const component = resolveStokesChannelArrays(layer, splitComponent.channels);
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const s0Value = readChannelValue(component.s0, pixelIndex);
      const s1Value = readChannelValue(component.s1, pixelIndex);
      const s2Value = readChannelValue(component.s2, pixelIndex);
      const s3Value = readChannelValue(component.s3, pixelIndex);
      const value = computeStokesDisplayValue(parameter, s0Value, s1Value, s2Value, s3Value);
      const modulation = computeStokesDegreeModulationDisplayValue(
        parameter,
        s0Value,
        s1Value,
        s2Value,
        s3Value
      );
      const outIndex = pixelIndex * 4;
      out[outIndex + 0] = value;
      out[outIndex + 1] = value;
      out[outIndex + 2] = value;
      out[outIndex + 3] = modulation ?? 1;
    }

    return out;
  }

  const r = resolveStokesChannelArrays(layer, channels.r);
  const g = resolveStokesChannelArrays(layer, channels.g);
  const b = resolveStokesChannelArrays(layer, channels.b);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const mono = computeRgbStokesMonoValues(r, g, b, pixelIndex);
    const value = computeStokesDisplayValue(parameter, mono.s0, mono.s1, mono.s2, mono.s3);
    const modulation = computeStokesDegreeModulationDisplayValue(
      parameter,
      mono.s0,
      mono.s1,
      mono.s2,
      mono.s3
    );
    const outIndex = pixelIndex * 4;
    out[outIndex + 0] = value;
    out[outIndex + 1] = value;
    out[outIndex + 2] = value;
    out[outIndex + 3] = modulation ?? 1;
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

  for (const channelName of layer.channelNames) {
    const channel = layer.channelData.get(channelName);
    if (!channel) {
      continue;
    }
    values[channelName] = channel[flatIndex];
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
  selection: DisplaySelection
): PixelSample | null {
  const sample = samplePixelValues(layer, width, height, pixel);
  if (!sample || !isStokesDisplaySelection(selection) || !isStokesDisplayAvailable(layer.channelNames, selection)) {
    return sample;
  }

  const flatIndex = pixel.iy * width + pixel.ix;
  appendStokesSampleValues(layer, flatIndex, selection, sample.values);
  return sample;
}

function getChannel(layer: DecodedLayer, channelName: string): Float32Array | null {
  if (channelName === ZERO_CHANNEL) {
    return null;
  }

  return layer.channelData.get(channelName) ?? null;
}

function resolveStokesChannelArrays(
  layer: DecodedLayer,
  channels: ScalarStokesChannels
): { s0: Float32Array | null; s1: Float32Array | null; s2: Float32Array | null; s3: Float32Array | null } {
  return {
    s0: getChannel(layer, channels.s0),
    s1: getChannel(layer, channels.s1),
    s2: getChannel(layer, channels.s2),
    s3: getChannel(layer, channels.s3)
  };
}

function readChannelValue(channel: Float32Array | null, pixelIndex: number): number {
  return channel ? channel[pixelIndex] ?? 0 : 0;
}

function computeRgbStokesMonoValues(
  r: { s0: Float32Array | null; s1: Float32Array | null; s2: Float32Array | null; s3: Float32Array | null },
  g: { s0: Float32Array | null; s1: Float32Array | null; s2: Float32Array | null; s3: Float32Array | null },
  b: { s0: Float32Array | null; s1: Float32Array | null; s2: Float32Array | null; s3: Float32Array | null },
  pixelIndex: number
): { s0: number; s1: number; s2: number; s3: number } {
  return {
    s0: computeLuminance(
      readChannelValue(r.s0, pixelIndex),
      readChannelValue(g.s0, pixelIndex),
      readChannelValue(b.s0, pixelIndex)
    ),
    s1: computeLuminance(
      readChannelValue(r.s1, pixelIndex),
      readChannelValue(g.s1, pixelIndex),
      readChannelValue(b.s1, pixelIndex)
    ),
    s2: computeLuminance(
      readChannelValue(r.s2, pixelIndex),
      readChannelValue(g.s2, pixelIndex),
      readChannelValue(b.s2, pixelIndex)
    ),
    s3: computeLuminance(
      readChannelValue(r.s3, pixelIndex),
      readChannelValue(g.s3, pixelIndex),
      readChannelValue(b.s3, pixelIndex)
    )
  };
}

function computeLuminance(r: number, g: number, b: number): number {
  return LUMINANCE_WEIGHTS.r * r + LUMINANCE_WEIGHTS.g * g + LUMINANCE_WEIGHTS.b * b;
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

function appendStokesSampleValues(
  layer: DecodedLayer,
  flatIndex: number,
  selection: DisplaySelection & {
    displaySource: Exclude<DisplaySourceKind, 'channels'>;
    stokesParameter: StokesParameter;
  },
  values: Record<string, number>
): void {
  const label = getStokesParameterLabel(selection.stokesParameter);

  if (selection.displaySource === 'stokesScalar') {
    const channels = detectScalarStokesChannels(layer.channelNames);
    if (!channels) {
      return;
    }

    const s0 = getChannel(layer, channels.s0);
    const s1 = getChannel(layer, channels.s1);
    const s2 = getChannel(layer, channels.s2);
    const s3 = getChannel(layer, channels.s3);
    const s0Value = readChannelValue(s0, flatIndex);
    const s1Value = readChannelValue(s1, flatIndex);
    const s2Value = readChannelValue(s2, flatIndex);
    const s3Value = readChannelValue(s3, flatIndex);
    values[label] = computeStokesDisplayValue(
      selection.stokesParameter,
      s0Value,
      s1Value,
      s2Value,
      s3Value
    );
    appendStokesDegreeModulationSampleValue(
      selection.stokesParameter,
      s0Value,
      s1Value,
      s2Value,
      s3Value,
      values
    );
    return;
  }

  const channels = detectRgbStokesChannels(layer.channelNames);
  if (!channels) {
    return;
  }

  const splitComponent = resolveRgbStokesSplitComponent(channels, selection);
  if (splitComponent) {
    const componentChannels = resolveStokesChannelArrays(layer, splitComponent.channels);
    const s0Value = readChannelValue(componentChannels.s0, flatIndex);
    const s1Value = readChannelValue(componentChannels.s1, flatIndex);
    const s2Value = readChannelValue(componentChannels.s2, flatIndex);
    const s3Value = readChannelValue(componentChannels.s3, flatIndex);
    values[`${label}.${splitComponent.component}`] = computeStokesDisplayValue(
      selection.stokesParameter,
      s0Value,
      s1Value,
      s2Value,
      s3Value
    );
    appendStokesDegreeModulationSampleValue(
      selection.stokesParameter,
      s0Value,
      s1Value,
      s2Value,
      s3Value,
      values,
      splitComponent.component
    );
    return;
  }

  const r = resolveStokesChannelArrays(layer, channels.r);
  const g = resolveStokesChannelArrays(layer, channels.g);
  const b = resolveStokesChannelArrays(layer, channels.b);
  const mono = computeRgbStokesMonoValues(r, g, b, flatIndex);
  values[label] = computeStokesDisplayValue(selection.stokesParameter, mono.s0, mono.s1, mono.s2, mono.s3);
  appendStokesDegreeModulationSampleValue(
    selection.stokesParameter,
    mono.s0,
    mono.s1,
    mono.s2,
    mono.s3,
    values
  );
}

function appendStokesDegreeModulationSampleValue(
  parameter: StokesParameter,
  s0: number,
  s1: number,
  s2: number,
  s3: number,
  values: Record<string, number>,
  component: RgbStokesComponent | null = null
): void {
  const label = getStokesDegreeModulationLabel(parameter);
  if (!label) {
    return;
  }

  const value = computeStokesDegreeModulationValue(parameter, s0, s1, s2, s3);
  if (value !== null) {
    values[component ? `${label}.${component}` : label] = value;
  }
}
