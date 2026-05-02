import { computeRec709Luminance } from '../color';
import {
  getChannelReadView,
  readChannelValue,
  type ChannelReadView
} from '../channel-storage';
import type { StokesParameter, StokesSelection } from '../display-model';
import {
  computeStokesDegreeModulationValue,
  computeStokesDisplayValue,
  detectRgbStokesChannels,
  detectScalarStokesChannels,
  getStokesDegreeModulationLabel,
  getStokesParameterLabel,
  type RgbStokesChannels,
  type RgbStokesComponent,
  type ScalarStokesChannels
} from '../stokes';
import type { DecodedLayer, VisualizationMode } from '../types';

export interface StokesSample {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
}

export interface ResolvedScalarStokesChannels {
  s0: ChannelReadView | null;
  s1: ChannelReadView | null;
  s2: ChannelReadView | null;
  s3: ChannelReadView | null;
}

export function resolveStokesChannelArrays(
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

export function resolveStokesChannelArraysFromSlots(
  layer: DecodedLayer,
  slots: Array<string | null>,
  offset: number
): ResolvedScalarStokesChannels {
  return {
    s0: getOptionalChannelReadView(layer, slots[offset + 0] ?? null),
    s1: getOptionalChannelReadView(layer, slots[offset + 1] ?? null),
    s2: getOptionalChannelReadView(layer, slots[offset + 2] ?? null),
    s3: getOptionalChannelReadView(layer, slots[offset + 3] ?? null)
  };
}

export function readScalarStokesSample(
  channels: ResolvedScalarStokesChannels,
  pixelIndex: number
): StokesSample {
  return {
    s0: readChannelValue(channels.s0, pixelIndex),
    s1: readChannelValue(channels.s1, pixelIndex),
    s2: readChannelValue(channels.s2, pixelIndex),
    s3: readChannelValue(channels.s3, pixelIndex)
  };
}

export function computeStokesDisplayValueForChannels(
  parameter: StokesParameter,
  channels: ResolvedScalarStokesChannels,
  pixelIndex: number
): number {
  const sample = readScalarStokesSample(channels, pixelIndex);
  return computeStokesDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
}

export function computeRawStokesDisplayValueForChannels(
  parameter: StokesParameter,
  channels: ResolvedScalarStokesChannels,
  pixelIndex: number
): number {
  const sample = readScalarStokesSample(channels, pixelIndex);
  return computeRawStokesDisplayValue(parameter, sample.s0, sample.s1, sample.s2, sample.s3);
}

export function computeRgbStokesMonoValues(
  r: ResolvedScalarStokesChannels,
  g: ResolvedScalarStokesChannels,
  b: ResolvedScalarStokesChannels,
  pixelIndex: number
): StokesSample {
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

export function computeRawStokesDisplayValue(
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

export function appendStokesSampleValues(
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
    const componentChannels = resolveStokesChannelArrays(
      layer,
      getRgbComponentChannels(channels, selection.source.component)
    );
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
    const componentSamples: Array<[RgbStokesComponent, StokesSample]> = [
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

export function getRgbComponentChannels(
  channels: RgbStokesChannels,
  component: RgbStokesComponent
): ScalarStokesChannels {
  if (component === 'R') {
    return channels.r;
  }
  if (component === 'G') {
    return channels.g;
  }
  return channels.b;
}

function appendStokesDegreeModulationSampleValue(
  parameter: StokesParameter,
  sample: StokesSample,
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

function getOptionalChannelReadView(
  layer: DecodedLayer,
  channelName: string | null
): ChannelReadView | null {
  return channelName ? getChannelReadView(layer, channelName) : null;
}
