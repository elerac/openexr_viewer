import {
  DisplayChannelMapping,
  DisplayLuminanceRange,
  DisplaySelection,
  DisplaySourceKind,
  StokesDegreeModulationParameter,
  StokesDegreeModulationState,
  StokesParameter
} from './types';

export type StokesColormapDefaultGroup = 'aolp' | 'degree' | 'cop' | 'top' | 'normalized';
type RgbSuffix = 'R' | 'G' | 'B' | 'A';
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
  displaySource: Exclude<DisplaySourceKind, 'channels'>;
  stokesParameter: StokesParameter;
  label: string;
  mapping: DisplayChannelMapping;
  component: RgbStokesComponent | null;
}

const STOKES_PARAMETER_LABELS: Record<StokesParameter, string> = {
  aolp: 'AoLP',
  dolp: 'DoLP',
  dop: 'DoP',
  docp: 'DoCP',
  cop: 'CoP',
  top: 'ToP',
  s1_over_s0: 'S1/S0',
  s2_over_s0: 'S2/S0',
  s3_over_s0: 'S3/S0'
};
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
const STOKES_DEGREE_MODULATION_LABELS: Record<StokesDegreeModulationParameter, string> = {
  aolp: 'DoLP',
  cop: 'DoCP',
  top: 'DoP'
};

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
  const build = (suffix: 'R' | 'G' | 'B'): ScalarStokesChannels | null => {
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

export function buildRgbStokesGroupMapping(channels: RgbStokesChannels): DisplayChannelMapping {
  return {
    displayR: channels.r.s0,
    displayG: channels.g.s0,
    displayB: channels.b.s0,
    displayA: null
  };
}

export function buildRgbStokesSplitMapping(channels: ScalarStokesChannels): DisplayChannelMapping {
  return {
    displayR: channels.s0,
    displayG: channels.s0,
    displayB: channels.s0,
    displayA: null
  };
}

export function resolveRgbStokesSplitComponent(
  channels: RgbStokesChannels,
  selection: DisplayChannelMapping
): { component: RgbStokesComponent; channels: ScalarStokesChannels } | null {
  if (selection.displayR !== selection.displayG || selection.displayR !== selection.displayB) {
    return null;
  }

  const selectedChannel = selection.displayR;
  if (isScalarStokesChannelName(channels.r, selectedChannel)) {
    return { component: 'R', channels: channels.r };
  }
  if (isScalarStokesChannelName(channels.g, selectedChannel)) {
    return { component: 'G', channels: channels.g };
  }
  if (isScalarStokesChannelName(channels.b, selectedChannel)) {
    return { component: 'B', channels: channels.b };
  }

  return null;
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
  selected: DisplaySelection
): StokesDisplayOption | null {
  const matchingOptions = options.filter((option) => {
    return (
      selected.displaySource === option.displaySource &&
      selected.stokesParameter === option.stokesParameter
    );
  });

  if (matchingOptions.length === 0) {
    return null;
  }

  const exactMatch = matchingOptions.find((option) => {
    return areDisplayMappingsEqual(option.mapping, selected);
  });
  if (exactMatch) {
    return exactMatch;
  }

  return matchingOptions.find((option) => option.component === null) ?? matchingOptions[0] ?? null;
}

export function isStokesDisplaySelection(
  selection: Pick<DisplaySelection, 'displaySource' | 'stokesParameter'>
): selection is DisplaySelection & {
  displaySource: Exclude<DisplaySourceKind, 'channels'>;
  stokesParameter: StokesParameter;
} {
  return selection.displaySource !== 'channels' && selection.stokesParameter !== null;
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
  selection: Pick<DisplaySelection, 'displaySource' | 'stokesParameter'>
): StokesColormapDefault | null {
  return isStokesDisplaySelection(selection)
    ? getStokesColormapDefault(selection.stokesParameter)
    : null;
}

export function isStokesDisplayAvailable(
  channelNames: string[],
  selection: Pick<DisplaySelection, 'displaySource' | 'stokesParameter'>
): boolean {
  if (!isStokesDisplaySelection(selection)) {
    return true;
  }

  return selection.displaySource === 'stokesScalar'
    ? Boolean(detectScalarStokesChannels(channelNames))
    : Boolean(detectRgbStokesChannels(channelNames));
}

export function getStokesParameterLabel(parameter: StokesParameter): string {
  return STOKES_PARAMETER_LABELS[parameter];
}

export function getStokesDisplayValueLabel(selection: DisplaySelection): string | null {
  if (selection.displaySource === 'channels' || !selection.stokesParameter) {
    return null;
  }

  const label = getStokesParameterLabel(selection.stokesParameter);
  const component = selection.displaySource === 'stokesRgb'
    ? inferRepeatedRgbComponentFromMapping(selection)
    : null;
  return component ? `${label}.${component}` : label;
}

export function isStokesDegreeModulationParameter(
  parameter: StokesParameter | null
): parameter is StokesDegreeModulationParameter {
  return parameter === 'aolp' || parameter === 'cop' || parameter === 'top';
}

export function getStokesDegreeModulationLabel(
  parameter: StokesParameter | null
): string | null {
  return isStokesDegreeModulationParameter(parameter)
    ? STOKES_DEGREE_MODULATION_LABELS[parameter]
    : null;
}

export function getStokesDegreeModulationDisplayValueLabel(selection: DisplaySelection): string | null {
  if (selection.displaySource === 'channels') {
    return null;
  }

  const label = getStokesDegreeModulationLabel(selection.stokesParameter);
  if (!label) {
    return null;
  }

  const component = selection.displaySource === 'stokesRgb'
    ? inferRepeatedRgbComponentFromMapping(selection)
    : null;
  return component ? `${label}.${component}` : label;
}

export function isStokesDegreeModulationEnabled(
  selection: Pick<DisplaySelection, 'displaySource' | 'stokesParameter'>,
  modulation: StokesDegreeModulationState
): boolean {
  return (
    selection.displaySource !== 'channels' &&
    isStokesDegreeModulationParameter(selection.stokesParameter) &&
    modulation[selection.stokesParameter]
  );
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

function areDisplayMappingsEqual(
  a: DisplayChannelMapping,
  b: DisplayChannelMapping
): boolean {
  return (
    a.displayR === b.displayR &&
    a.displayG === b.displayG &&
    a.displayB === b.displayB &&
    (a.displayA ?? null) === (b.displayA ?? null)
  );
}

function buildScalarStokesDisplayOption(
  parameter: StokesParameter,
  channels: ScalarStokesChannels
): StokesDisplayOption {
  return {
    key: `stokesScalar:${parameter}`,
    displaySource: 'stokesScalar',
    stokesParameter: parameter,
    label: `Stokes ${getStokesParameterLabel(parameter)}`,
    mapping: {
      displayR: channels.s0,
      displayG: channels.s1,
      displayB: channels.s2,
      displayA: null
    },
    component: null
  };
}

function buildRgbStokesGroupDisplayOption(
  parameter: StokesParameter,
  channels: RgbStokesChannels
): StokesDisplayOption {
  const label = getStokesParameterLabel(parameter);
  return {
    key: `stokesRgb:${parameter}:group`,
    displaySource: 'stokesRgb',
    stokesParameter: parameter,
    label: `${label}.(R,G,B)`,
    mapping: buildRgbStokesGroupMapping(channels),
    component: null
  };
}

function buildRgbStokesSplitDisplayOption(
  parameter: StokesParameter,
  component: RgbStokesComponent,
  channels: ScalarStokesChannels
): StokesDisplayOption {
  const label = getStokesParameterLabel(parameter);
  return {
    key: `stokesRgb:${parameter}:${component}`,
    displaySource: 'stokesRgb',
    stokesParameter: parameter,
    label: `${label}.${component}`,
    mapping: buildRgbStokesSplitMapping(channels),
    component
  };
}

function isScalarStokesChannelName(channels: ScalarStokesChannels, channelName: string): boolean {
  return (
    channelName === channels.s0 ||
    channelName === channels.s1 ||
    channelName === channels.s2 ||
    channelName === channels.s3
  );
}

function inferRepeatedRgbComponentFromMapping(selection: DisplayChannelMapping): RgbStokesComponent | null {
  if (selection.displayR !== selection.displayG || selection.displayR !== selection.displayB) {
    return null;
  }

  const parsed = parseRgbChannel(selection.displayR);
  if (!parsed || parsed.suffix === 'A') {
    return null;
  }

  return parsed.suffix;
}

function parseRgbChannel(channelName: string): { base: string; suffix: RgbSuffix } | null {
  if (channelName === 'R' || channelName === 'G' || channelName === 'B' || channelName === 'A') {
    return {
      base: '',
      suffix: channelName
    };
  }

  const dotIndex = channelName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= channelName.length - 1) {
    return null;
  }

  const suffix = channelName.slice(dotIndex + 1);
  if (suffix !== 'R' && suffix !== 'G' && suffix !== 'B' && suffix !== 'A') {
    return null;
  }

  return {
    base: channelName.slice(0, dotIndex),
    suffix
  };
}
