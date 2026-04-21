import {
  getDisplaySelectionDegreeModulationValueLabel,
  getDisplaySelectionValueLabel,
  getDisplaySelectionOptionLabel,
  getStokesDegreeModulationLabel,
  getStokesParameterLabel,
  isStokesAngleParameter,
  isStokesAngleSelection,
  isStokesDegreeModulationParameter,
  isStokesSelection,
  sameDisplaySelection,
  type DisplaySelection,
  type StokesDegreeModulationState,
  type StokesParameter,
  type StokesSelection
} from './display-model';
import { DisplayChannelMapping, DisplayLuminanceRange } from './types';

export type StokesColormapDefaultGroup = 'aolp' | 'degree' | 'cop' | 'top' | 'normalized';
export type RgbStokesComponent = 'R' | 'G' | 'B';

export interface StokesColormapDefault {
  colormapLabel: string;
  range: DisplayLuminanceRange;
  zeroCentered: boolean;
}

export interface StokesDisplayOptionsConfig {
  includeRgbGroups?: boolean;
  includeSplitChannels?: boolean;
}

export interface ScalarStokesChannels {
  s0: string;
  s1: string;
  s2: string;
  s3: string;
}

export interface RgbStokesChannels {
  r: ScalarStokesChannels;
  g: ScalarStokesChannels;
  b: ScalarStokesChannels;
}

export interface StokesDisplayOption {
  key: string;
  label: string;
  selection: StokesSelection;
  mapping: DisplayChannelMapping;
  component: RgbStokesComponent | null;
}

const STOKES_PARAMETER_ORDER: StokesParameter[] = [
  's1_over_s0',
  's2_over_s0',
  's3_over_s0',
  'aolp',
  'dop',
  'dolp',
  'docp',
  'cop',
  'top'
];

export const DEFAULT_STOKES_DEGREE_MODULATION: StokesDegreeModulationState = {
  aolp: false,
  cop: true,
  top: true
};

export function createDefaultStokesDegreeModulation(): StokesDegreeModulationState {
  return { ...DEFAULT_STOKES_DEGREE_MODULATION };
}

export function detectScalarStokesChannels(channelNames: string[]): ScalarStokesChannels | null {
  const channels = new Set(channelNames);
  return channels.has('S0') && channels.has('S1') && channels.has('S2') && channels.has('S3')
    ? { s0: 'S0', s1: 'S1', s2: 'S2', s3: 'S3' }
    : null;
}

export function detectRgbStokesChannels(channelNames: string[]): RgbStokesChannels | null {
  const channels = new Set(channelNames);
  const build = (suffix: RgbStokesComponent): ScalarStokesChannels | null => {
    const s0 = `S0.${suffix}`;
    const s1 = `S1.${suffix}`;
    const s2 = `S2.${suffix}`;
    const s3 = `S3.${suffix}`;
    return channels.has(s0) && channels.has(s1) && channels.has(s2) && channels.has(s3)
      ? { s0, s1, s2, s3 }
      : null;
  };

  const r = build('R');
  const g = build('G');
  const b = build('B');
  return r && g && b ? { r, g, b } : null;
}

export function buildScalarStokesSelection(parameter: StokesParameter): StokesSelection {
  return isStokesAngleParameter(parameter)
    ? { kind: 'stokesAngle', parameter, source: { kind: 'scalar' } }
    : { kind: 'stokesScalar', parameter, source: { kind: 'scalar' } };
}

export function buildRgbStokesLuminanceSelection(parameter: StokesParameter): StokesSelection {
  return isStokesAngleParameter(parameter)
    ? { kind: 'stokesAngle', parameter, source: { kind: 'rgbLuminance' } }
    : { kind: 'stokesScalar', parameter, source: { kind: 'rgbLuminance' } };
}

export function buildRgbStokesSplitSelection(
  parameter: StokesParameter,
  component: RgbStokesComponent
): StokesSelection {
  return isStokesAngleParameter(parameter)
    ? { kind: 'stokesAngle', parameter, source: { kind: 'rgbComponent', component } }
    : { kind: 'stokesScalar', parameter, source: { kind: 'rgbComponent', component } };
}

export function buildScalarStokesMapping(channels: ScalarStokesChannels): DisplayChannelMapping {
  return {
    displayR: channels.s0,
    displayG: channels.s1,
    displayB: channels.s2,
    displayA: null
  };
}

export function buildRgbStokesLuminanceMapping(channels: RgbStokesChannels): DisplayChannelMapping {
  return {
    displayR: channels.r.s0,
    displayG: channels.g.s0,
    displayB: channels.b.s0,
    displayA: null
  };
}

export function buildRgbStokesComponentMapping(channels: ScalarStokesChannels): DisplayChannelMapping {
  return {
    displayR: channels.s0,
    displayG: channels.s0,
    displayB: channels.s0,
    displayA: null
  };
}

export function getStokesDisplayOptions(
  channelNames: string[],
  config: StokesDisplayOptionsConfig = {}
): StokesDisplayOption[] {
  const options: StokesDisplayOption[] = [];
  const includeRgbGroups = config.includeRgbGroups ?? true;
  const includeSplitChannels = config.includeSplitChannels ?? false;
  const scalarChannels = detectScalarStokesChannels(channelNames);
  if (scalarChannels) {
    for (const parameter of STOKES_PARAMETER_ORDER) {
      options.push(buildScalarStokesDisplayOption(parameter, scalarChannels));
    }
  }

  const rgbChannels = detectRgbStokesChannels(channelNames);
  if (rgbChannels) {
    for (const parameter of STOKES_PARAMETER_ORDER) {
      if (includeRgbGroups) {
        options.push(buildRgbStokesGroupDisplayOption(parameter, rgbChannels));
      }

      if (includeSplitChannels) {
        options.push(
          buildRgbStokesSplitDisplayOption(parameter, 'R', rgbChannels.r),
          buildRgbStokesSplitDisplayOption(parameter, 'G', rgbChannels.g),
          buildRgbStokesSplitDisplayOption(parameter, 'B', rgbChannels.b)
        );
      }
    }
  }

  return options;
}

export function findSelectedStokesDisplayOption(
  options: StokesDisplayOption[],
  selected: DisplaySelection | null
): StokesDisplayOption | null {
  if (!isStokesSelection(selected)) {
    return null;
  }

  return options.find((option) => sameDisplaySelection(option.selection, selected)) ?? null;
}

export function isStokesDisplaySelection(selection: DisplaySelection | null): selection is StokesSelection {
  return isStokesSelection(selection);
}

export function getStokesColormapDefaultGroup(
  parameter: StokesParameter | null
): StokesColormapDefaultGroup | null {
  if (!parameter) {
    return null;
  }

  if (parameter === 'dolp' || parameter === 'dop' || parameter === 'docp') {
    return 'degree';
  }

  if (parameter === 's1_over_s0' || parameter === 's2_over_s0' || parameter === 's3_over_s0') {
    return 'normalized';
  }

  return parameter;
}

export function getStokesColormapDefault(parameter: StokesParameter | null): StokesColormapDefault | null {
  if (!parameter) {
    return null;
  }

  if (parameter === 'aolp') {
    return { colormapLabel: 'HSV', range: { min: 0, max: Math.PI }, zeroCentered: false };
  }

  if (parameter === 'cop') {
    return {
      colormapLabel: 'Yellow-Black-Blue',
      range: { min: -Math.PI / 4, max: Math.PI / 4 },
      zeroCentered: true
    };
  }

  if (parameter === 'top') {
    return {
      colormapLabel: 'Yellow-Cyan-Yellow',
      range: { min: -Math.PI / 4, max: Math.PI / 4 },
      zeroCentered: false
    };
  }

  if (parameter === 's1_over_s0' || parameter === 's2_over_s0' || parameter === 's3_over_s0') {
    return { colormapLabel: 'RdBu', range: { min: -1, max: 1 }, zeroCentered: true };
  }

  return { colormapLabel: 'Black-Red', range: { min: 0, max: 1 }, zeroCentered: false };
}

export function getStokesDisplayColormapDefault(
  selection: DisplaySelection | null
): StokesColormapDefault | null {
  return isStokesSelection(selection)
    ? getStokesColormapDefault(selection.parameter)
    : null;
}

export function isStokesDisplayAvailable(
  channelNames: string[],
  selection: DisplaySelection | null
): boolean {
  if (!isStokesSelection(selection)) {
    return true;
  }

  return selection.source.kind === 'scalar'
    ? Boolean(detectScalarStokesChannels(channelNames))
    : Boolean(detectRgbStokesChannels(channelNames));
}

export {
  getDisplaySelectionDegreeModulationValueLabel as getStokesDegreeModulationDisplayValueLabel,
  getDisplaySelectionValueLabel as getStokesDisplayValueLabel,
  getStokesDegreeModulationLabel,
  getStokesParameterLabel,
  isStokesDegreeModulationParameter
};

export function isStokesDegreeModulationEnabled(
  selection: DisplaySelection | null,
  modulation: StokesDegreeModulationState
): boolean {
  return isStokesAngleSelection(selection) && modulation[selection.parameter];
}

export function clampStokesDegreeModulationValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function computeStokesAolp(s1: number, s2: number): number {
  if (!Number.isFinite(s1) || !Number.isFinite(s2)) {
    return 0;
  }

  const aolp = 0.5 * Math.atan2(s2, s1);
  return aolp < 0 ? aolp + Math.PI : aolp;
}

export function computeStokesDolp(s0: number, s1: number, s2: number): number {
  if (!Number.isFinite(s0) || !Number.isFinite(s1) || !Number.isFinite(s2) || s0 === 0) {
    return 0;
  }

  const dolp = Math.sqrt(s1 ** 2 + s2 ** 2) / s0;
  return Number.isFinite(dolp) ? dolp : 0;
}

export function computeStokesDop(s0: number, s1: number, s2: number, s3: number): number {
  if (
    !Number.isFinite(s0) ||
    !Number.isFinite(s1) ||
    !Number.isFinite(s2) ||
    !Number.isFinite(s3) ||
    s0 === 0
  ) {
    return 0;
  }

  const dop = Math.sqrt(s1 ** 2 + s2 ** 2 + s3 ** 2) / s0;
  return Number.isFinite(dop) ? dop : 0;
}

export function computeStokesDocp(s0: number, s3: number): number {
  if (!Number.isFinite(s0) || !Number.isFinite(s3) || s0 === 0) {
    return 0;
  }

  const docp = Math.abs(s3) / s0;
  return Number.isFinite(docp) ? docp : 0;
}

export function computeStokesEang(s1: number, s2: number, s3: number): number {
  if (!Number.isFinite(s1) || !Number.isFinite(s2) || !Number.isFinite(s3)) {
    return 0;
  }

  return 0.5 * Math.atan2(s3, Math.sqrt(s1 ** 2 + s2 ** 2));
}

export function computeStokesNormalizedComponent(s0: number, component: number): number {
  if (!Number.isFinite(s0) || !Number.isFinite(component) || s0 === 0) {
    return 0;
  }

  const normalized = component / s0;
  return Number.isFinite(normalized) ? normalized : 0;
}

export function computeStokesDisplayValue(
  parameter: StokesParameter,
  s0: number,
  s1: number,
  s2: number,
  s3: number
): number {
  switch (parameter) {
    case 'aolp':
      return computeStokesAolp(s1, s2);
    case 'dolp':
      return computeStokesDolp(s0, s1, s2);
    case 'dop':
      return computeStokesDop(s0, s1, s2, s3);
    case 'docp':
      return computeStokesDocp(s0, s3);
    case 'cop':
    case 'top':
      return computeStokesEang(s1, s2, s3);
    case 's1_over_s0':
      return computeStokesNormalizedComponent(s0, s1);
    case 's2_over_s0':
      return computeStokesNormalizedComponent(s0, s2);
    case 's3_over_s0':
      return computeStokesNormalizedComponent(s0, s3);
  }
}

export function computeStokesDegreeModulationValue(
  parameter: StokesParameter,
  s0: number,
  s1: number,
  s2: number,
  s3: number
): number | null {
  switch (parameter) {
    case 'aolp':
      return computeStokesDolp(s0, s1, s2);
    case 'cop':
      return computeStokesDocp(s0, s3);
    case 'top':
      return computeStokesDop(s0, s1, s2, s3);
    case 'dolp':
    case 'dop':
    case 'docp':
    case 's1_over_s0':
    case 's2_over_s0':
    case 's3_over_s0':
      return null;
  }
}

export function computeStokesDegreeModulationDisplayValue(
  parameter: StokesParameter,
  s0: number,
  s1: number,
  s2: number,
  s3: number
): number | null {
  const value = computeStokesDegreeModulationValue(parameter, s0, s1, s2, s3);
  return value === null ? null : clampStokesDegreeModulationValue(value);
}

function buildScalarStokesDisplayOption(
  parameter: StokesParameter,
  channels: ScalarStokesChannels
): StokesDisplayOption {
  const selection = buildScalarStokesSelection(parameter);
  return {
    key: `stokesScalar:${parameter}`,
    label: getDisplaySelectionOptionLabel(selection),
    selection,
    mapping: buildScalarStokesMapping(channels),
    component: null
  };
}

function buildRgbStokesGroupDisplayOption(
  parameter: StokesParameter,
  channels: RgbStokesChannels
): StokesDisplayOption {
  const selection = buildRgbStokesLuminanceSelection(parameter);
  return {
    key: `stokesRgb:${parameter}:group`,
    label: getDisplaySelectionOptionLabel(selection),
    selection,
    mapping: buildRgbStokesLuminanceMapping(channels),
    component: null
  };
}

function buildRgbStokesSplitDisplayOption(
  parameter: StokesParameter,
  component: RgbStokesComponent,
  channels: ScalarStokesChannels
): StokesDisplayOption {
  const selection = buildRgbStokesSplitSelection(parameter, component);
  return {
    key: `stokesRgb:${parameter}:${component}`,
    label: getDisplaySelectionOptionLabel(selection),
    selection,
    mapping: buildRgbStokesComponentMapping(channels),
    component
  };
}
