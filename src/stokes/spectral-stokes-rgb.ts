import { computeRec709Luminance } from '../color';
import {
  getDisplaySelectionDegreeModulationValueLabel,
  getDisplaySelectionValueLabel,
  getStokesParameterLabel,
  type StokesParameter,
  type StokesSelection
} from '../display-model';
import {
  buildSpectralStokesComponentChannels,
  detectSpectralStokesChannelGroups,
  type SpectralStokesComponent
} from '../spectral';
import {
  buildReflectanceSpectralRgbCoefficients,
  readSignedSpectralRgbSampleAtIndex,
  resolveSpectralRgbChannels,
  type ResolvedSpectralRgbChannel,
  type SpectralRgbSample
} from '../spectral-color';
import {
  computeStokesDegreeModulationValue,
  computeStokesDisplayValue
} from '../stokes';
import type { DecodedLayer, VisualizationMode } from '../types';
import { computeRawStokesDisplayValue, type StokesSample } from './stokes-display';

export interface ResolvedSpectralStokesRgbChannels {
  s0: ResolvedSpectralRgbChannel[];
  s1: ResolvedSpectralRgbChannel[];
  s2: ResolvedSpectralRgbChannel[];
  s3: ResolvedSpectralRgbChannel[];
}

export interface SpectralStokesRgbSample {
  s0: SpectralRgbSample;
  s1: SpectralRgbSample;
  s2: SpectralRgbSample;
  s3: SpectralRgbSample;
}

type SpectralRgbComponent = keyof SpectralRgbSample;

const SPECTRAL_STOKES_COMPONENTS: readonly SpectralStokesComponent[] = ['S0', 'S1', 'S2', 'S3'];

export function resolveSpectralStokesRgbChannelArrays(
  layer: DecodedLayer
): ResolvedSpectralStokesRgbChannels {
  const groups = detectSpectralStokesChannelGroups(layer.channelNames);
  return {
    s0: resolveSpectralStokesComponentChannels(layer, 'S0', groups),
    s1: resolveSpectralStokesComponentChannels(layer, 'S1', groups),
    s2: resolveSpectralStokesComponentChannels(layer, 'S2', groups),
    s3: resolveSpectralStokesComponentChannels(layer, 'S3', groups)
  };
}

export function readSpectralStokesRgbSampleAtIndex(
  channels: ResolvedSpectralStokesRgbChannels,
  pixelIndex: number,
  output?: SpectralStokesRgbSample
): SpectralStokesRgbSample {
  const out = output ?? createSpectralStokesRgbSample();
  readSignedSpectralRgbSampleAtIndex(channels.s0, pixelIndex, out.s0);
  readSignedSpectralRgbSampleAtIndex(channels.s1, pixelIndex, out.s1);
  readSignedSpectralRgbSampleAtIndex(channels.s2, pixelIndex, out.s2);
  readSignedSpectralRgbSampleAtIndex(channels.s3, pixelIndex, out.s3);
  return out;
}

export function computeSpectralStokesRgbDisplayValues(
  parameter: StokesParameter,
  channels: ResolvedSpectralStokesRgbChannels,
  pixelIndex: number
): SpectralRgbSample {
  const sample = readSpectralStokesRgbSampleAtIndex(channels, pixelIndex);
  return {
    r: computeStokesDisplayValueForRgbComponent(parameter, sample, 'r'),
    g: computeStokesDisplayValueForRgbComponent(parameter, sample, 'g'),
    b: computeStokesDisplayValueForRgbComponent(parameter, sample, 'b')
  };
}

export function computeRawSpectralStokesRgbDisplayValues(
  parameter: StokesParameter,
  channels: ResolvedSpectralStokesRgbChannels,
  pixelIndex: number
): SpectralRgbSample {
  const sample = readSpectralStokesRgbSampleAtIndex(channels, pixelIndex);
  return {
    r: computeRawStokesDisplayValueForRgbComponent(parameter, sample, 'r'),
    g: computeRawStokesDisplayValueForRgbComponent(parameter, sample, 'g'),
    b: computeRawStokesDisplayValueForRgbComponent(parameter, sample, 'b')
  };
}

export function computeSpectralStokesRgbDisplayValueForComponent(
  parameter: StokesParameter,
  channels: ResolvedSpectralStokesRgbChannels,
  pixelIndex: number,
  component: SpectralRgbComponent
): number {
  return computeStokesDisplayValueForRgbComponent(
    parameter,
    readSpectralStokesRgbSampleAtIndex(channels, pixelIndex),
    component
  );
}

export function computeRawSpectralStokesRgbDisplayValueForComponent(
  parameter: StokesParameter,
  channels: ResolvedSpectralStokesRgbChannels,
  pixelIndex: number,
  component: SpectralRgbComponent
): number {
  return computeRawStokesDisplayValueForRgbComponent(
    parameter,
    readSpectralStokesRgbSampleAtIndex(channels, pixelIndex),
    component
  );
}

export function computeSpectralStokesRgbMonoValues(
  channels: ResolvedSpectralStokesRgbChannels,
  pixelIndex: number
): StokesSample {
  const sample = readSpectralStokesRgbSampleAtIndex(channels, pixelIndex);
  return {
    s0: computeSpectralRgbLuminance(sample.s0),
    s1: computeSpectralRgbLuminance(sample.s1),
    s2: computeSpectralRgbLuminance(sample.s2),
    s3: computeSpectralRgbLuminance(sample.s3)
  };
}

export function appendSpectralStokesRgbSampleValues(
  layer: DecodedLayer,
  flatIndex: number,
  selection: StokesSelection,
  values: Record<string, number>,
  visualizationMode: VisualizationMode
): void {
  if (selection.source.kind !== 'spectralRgb') {
    return;
  }

  const channels = resolveSpectralStokesRgbChannelArrays(layer);
  const valueLabel = getDisplaySelectionValueLabel(selection) ?? `${getStokesParameterLabel(selection.parameter)} Spectral RGB`;
  const degreeLabel = getDisplaySelectionDegreeModulationValueLabel(selection);

  if (visualizationMode === 'rgb') {
    const sample = readSpectralStokesRgbSampleAtIndex(channels, flatIndex);
    const componentValues: Array<[string, SpectralRgbComponent]> = [
      ['R', 'r'],
      ['G', 'g'],
      ['B', 'b']
    ];
    for (const [label, component] of componentValues) {
      values[`${valueLabel}.${label}`] = computeStokesDisplayValueForRgbComponent(
        selection.parameter,
        sample,
        component
      );
      if (degreeLabel) {
        const degreeValue = computeStokesDegreeModulationValueForRgbComponent(
          selection.parameter,
          sample,
          component
        );
        if (degreeValue !== null) {
          values[`${degreeLabel}.${label}`] = degreeValue;
        }
      }
    }
    return;
  }

  const monoSample = computeSpectralStokesRgbMonoValues(channels, flatIndex);
  values[valueLabel] = computeStokesDisplayValue(
    selection.parameter,
    monoSample.s0,
    monoSample.s1,
    monoSample.s2,
    monoSample.s3
  );
  if (degreeLabel) {
    const degreeValue = computeStokesDegreeModulationValue(
      selection.parameter,
      monoSample.s0,
      monoSample.s1,
      monoSample.s2,
      monoSample.s3
    );
    if (degreeValue !== null) {
      values[degreeLabel] = degreeValue;
    }
  }
}

function resolveSpectralStokesComponentChannels(
  layer: DecodedLayer,
  component: SpectralStokesComponent,
  groups: ReturnType<typeof detectSpectralStokesChannelGroups>
): ResolvedSpectralRgbChannel[] {
  if (!SPECTRAL_STOKES_COMPONENTS.includes(component)) {
    return [];
  }

  return resolveSpectralRgbChannels(
    layer,
    buildReflectanceSpectralRgbCoefficients(buildSpectralStokesComponentChannels(groups, component))
  );
}

function createSpectralStokesRgbSample(): SpectralStokesRgbSample {
  return {
    s0: createSpectralRgbSample(),
    s1: createSpectralRgbSample(),
    s2: createSpectralRgbSample(),
    s3: createSpectralRgbSample()
  };
}

function createSpectralRgbSample(): SpectralRgbSample {
  return { r: 0, g: 0, b: 0 };
}

function computeStokesDisplayValueForRgbComponent(
  parameter: StokesParameter,
  sample: SpectralStokesRgbSample,
  component: SpectralRgbComponent
): number {
  return computeStokesDisplayValue(
    parameter,
    sample.s0[component],
    sample.s1[component],
    sample.s2[component],
    sample.s3[component]
  );
}

function computeRawStokesDisplayValueForRgbComponent(
  parameter: StokesParameter,
  sample: SpectralStokesRgbSample,
  component: SpectralRgbComponent
): number {
  return computeRawStokesDisplayValue(
    parameter,
    sample.s0[component],
    sample.s1[component],
    sample.s2[component],
    sample.s3[component]
  );
}

function computeStokesDegreeModulationValueForRgbComponent(
  parameter: StokesParameter,
  sample: SpectralStokesRgbSample,
  component: SpectralRgbComponent
): number | null {
  return computeStokesDegreeModulationValue(
    parameter,
    sample.s0[component],
    sample.s1[component],
    sample.s2[component],
    sample.s3[component]
  );
}

function computeSpectralRgbLuminance(sample: SpectralRgbSample): number {
  return computeRec709Luminance(sample.r, sample.g, sample.b);
}
