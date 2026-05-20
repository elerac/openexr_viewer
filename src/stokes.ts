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
  type StokesAolpDegreeModulationMode,
  type StokesDegreeModulationState,
  type StokesParameter,
  type StokesSelection
} from './display-model';
import { DisplayChannelMapping, DisplayLuminanceRange } from './types';

export type StokesColormapDefaultGroup = 'aolp' | 'degree' | 'cop' | 'top' | 'normalized';
export interface StokesColormapDefaultModulation {
  enabled: boolean;
  aolpMode?: StokesAolpDegreeModulationMode;
}
export interface StokesColormapDefaultSetting {
  colormapLabel: string;
  range: DisplayLuminanceRange;
  zeroCentered: boolean;
  modulation: StokesColormapDefaultModulation | null;
}
export type StokesColormapDefaultSettings = Record<StokesColormapDefaultGroup, StokesColormapDefaultSetting>;
export type StokesParameterVisibilitySettings = Record<StokesColormapDefaultGroup, boolean>;
export type RgbStokesComponent = 'R' | 'G' | 'B';

export interface StokesComputationOptions {
  maskInvalidStokesVectors?: boolean;
}

export interface StokesColormapDefault {
  colormapLabel: string;
  range: DisplayLuminanceRange;
  zeroCentered: boolean;
  modulation: StokesColormapDefaultModulation | null;
}

export interface StokesDisplayOptionsConfig {
  includeRgbGroups?: boolean;
  includeSplitChannels?: boolean;
  parameterVisibility?: StokesParameterVisibilitySettings;
}

export interface ScalarStokesChannels {
  s0: string;
  s1: string;
  s2: string;
  s3: string | null;
  suffix?: string;
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

const S3_STOKES_PARAMETERS = new Set<StokesParameter>([
  's3_over_s0',
  'docp',
  'cop',
  'top'
]);

export const DEFAULT_STOKES_DEGREE_MODULATION: StokesDegreeModulationState = {
  aolp: false,
  cop: true,
  top: true
};
export const DEFAULT_STOKES_AOLP_DEGREE_MODULATION_MODE: StokesAolpDegreeModulationMode = 'value';
export const DEFAULT_MASK_INVALID_STOKES_VECTORS = true;
export const STOKES_COLORMAP_DEFAULT_GROUPS: readonly StokesColormapDefaultGroup[] = [
  'aolp',
  'degree',
  'cop',
  'top',
  'normalized'
];

export const DEFAULT_STOKES_COLORMAP_DEFAULT_SETTINGS: StokesColormapDefaultSettings = {
  aolp: {
    colormapLabel: 'HSV',
    range: { min: 0, max: Math.PI },
    zeroCentered: false,
    modulation: { enabled: false, aolpMode: 'value' }
  },
  degree: {
    colormapLabel: 'Black-Red',
    range: { min: 0, max: 1 },
    zeroCentered: false,
    modulation: null
  },
  cop: {
    colormapLabel: 'Yellow-Black-Blue',
    range: { min: -Math.PI / 4, max: Math.PI / 4 },
    zeroCentered: true,
    modulation: { enabled: true }
  },
  top: {
    colormapLabel: 'Yellow-Cyan-Yellow',
    range: { min: -Math.PI / 4, max: Math.PI / 4 },
    zeroCentered: false,
    modulation: { enabled: true }
  },
  normalized: {
    colormapLabel: 'RdBu',
    range: { min: -1, max: 1 },
    zeroCentered: true,
    modulation: null
  }
};
export const DEFAULT_STOKES_PARAMETER_VISIBILITY_SETTINGS: StokesParameterVisibilitySettings = {
  aolp: true,
  degree: true,
  cop: true,
  top: true,
  normalized: true
};

const STOKES_COLORMAP_DEFAULT_GROUP_LABELS: Record<StokesColormapDefaultGroup, string> = {
  aolp: 'AoLP',
  degree: 'Degree',
  cop: 'CoP',
  top: 'ToP',
  normalized: 'Normalized'
};
const RGB_STOKES_SUFFIXES = new Set<string>(['R', 'G', 'B']);

type StokesChannelComponent = 'S0' | 'S1' | 'S2' | 'S3';

interface ScalarStokesChannelGroup {
  suffix: string | null;
  channels: Partial<Record<StokesChannelComponent, string>>;
  firstIndex: number;
}

export function createDefaultStokesDegreeModulation(): StokesDegreeModulationState {
  return { ...DEFAULT_STOKES_DEGREE_MODULATION };
}

export function createDefaultStokesColormapDefaultSettings(): StokesColormapDefaultSettings {
  return cloneStokesColormapDefaultSettings(DEFAULT_STOKES_COLORMAP_DEFAULT_SETTINGS);
}

export function createDefaultStokesParameterVisibilitySettings(): StokesParameterVisibilitySettings {
  return cloneStokesParameterVisibilitySettings(DEFAULT_STOKES_PARAMETER_VISIBILITY_SETTINGS);
}

export function cloneStokesColormapDefaultSetting(
  setting: StokesColormapDefaultSetting
): StokesColormapDefaultSetting {
  return {
    colormapLabel: setting.colormapLabel,
    range: { ...setting.range },
    zeroCentered: setting.zeroCentered,
    modulation: setting.modulation ? { ...setting.modulation } : null
  };
}

export function cloneStokesColormapDefaultSettings(
  settings: StokesColormapDefaultSettings
): StokesColormapDefaultSettings {
  return {
    aolp: cloneStokesColormapDefaultSetting(settings.aolp),
    degree: cloneStokesColormapDefaultSetting(settings.degree),
    cop: cloneStokesColormapDefaultSetting(settings.cop),
    top: cloneStokesColormapDefaultSetting(settings.top),
    normalized: cloneStokesColormapDefaultSetting(settings.normalized)
  };
}

export function cloneStokesParameterVisibilitySettings(
  settings: StokesParameterVisibilitySettings
): StokesParameterVisibilitySettings {
  return {
    aolp: Boolean(settings.aolp),
    degree: Boolean(settings.degree),
    cop: Boolean(settings.cop),
    top: Boolean(settings.top),
    normalized: Boolean(settings.normalized)
  };
}

export function getStokesColormapDefaultGroupLabel(group: StokesColormapDefaultGroup): string {
  return STOKES_COLORMAP_DEFAULT_GROUP_LABELS[group];
}

export function isStokesColormapDefaultGroup(value: string): value is StokesColormapDefaultGroup {
  return STOKES_COLORMAP_DEFAULT_GROUPS.includes(value as StokesColormapDefaultGroup);
}

export function detectScalarStokesChannels(
  channelNames: string[],
  suffix: string | null = null
): ScalarStokesChannels | null {
  const normalizedSuffix = suffix || null;
  return detectScalarStokesChannelSets(channelNames)
    .find((channels) => (channels.suffix ?? null) === normalizedSuffix) ?? null;
}

export function detectScalarStokesChannelSets(channelNames: string[]): ScalarStokesChannels[] {
  const groups = new Map<string, ScalarStokesChannelGroup>();

  channelNames.forEach((channelName, index) => {
    const parsed = parseScalarStokesChannelName(channelName);
    if (!parsed || isRgbStokesScalarSuffix(parsed.suffix)) {
      return;
    }

    const key = parsed.suffix ?? '';
    const group = groups.get(key) ?? {
      suffix: parsed.suffix,
      channels: {},
      firstIndex: index
    };
    group.channels[parsed.component] ??= channelName;
    group.firstIndex = Math.min(group.firstIndex, index);
    groups.set(key, group);
  });

  const completed = [...groups.values()]
    .map(buildScalarStokesChannelsFromGroup)
    .filter((channels): channels is ScalarStokesChannels => channels !== null);
  const bare = completed.find((channels) => !channels.suffix) ?? null;
  const suffixed = completed
    .filter((channels) => channels.suffix)
    .sort((a, b) => (
      (groups.get(a.suffix ?? '')?.firstIndex ?? Number.MAX_SAFE_INTEGER) -
      (groups.get(b.suffix ?? '')?.firstIndex ?? Number.MAX_SAFE_INTEGER)
    ));

  return bare ? [bare, ...suffixed] : suffixed;
}

export function detectRgbStokesChannels(channelNames: string[]): RgbStokesChannels | null {
  const channels = new Set(channelNames);
  const build = (suffix: RgbStokesComponent): ScalarStokesChannels | null => {
    const s0 = `S0.${suffix}`;
    const s1 = `S1.${suffix}`;
    const s2 = `S2.${suffix}`;
    const s3 = `S3.${suffix}`;
    return channels.has(s0) && channels.has(s1) && channels.has(s2)
      ? { s0, s1, s2, s3: channels.has(s3) ? s3 : null }
      : null;
  };

  const r = build('R');
  const g = build('G');
  const b = build('B');
  return r && g && b ? { r, g, b } : null;
}

export function buildScalarStokesSelection(
  parameter: StokesParameter,
  suffix: string | null = null
): StokesSelection {
  const source = suffix ? { kind: 'scalar' as const, suffix } : { kind: 'scalar' as const };
  return isStokesAngleParameter(parameter)
    ? { kind: 'stokesAngle', parameter, source }
    : { kind: 'stokesScalar', parameter, source };
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

export function buildSpectralStokesRgbSelection(parameter: StokesParameter): StokesSelection {
  return isStokesAngleParameter(parameter)
    ? { kind: 'stokesAngle', parameter, source: { kind: 'spectralRgb' } }
    : { kind: 'stokesScalar', parameter, source: { kind: 'spectralRgb' } };
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

export function buildSpectralStokesRgbMapping(parameter: StokesParameter): DisplayChannelMapping {
  const label = `${getStokesParameterLabel(parameter)} Spectral RGB`;
  return {
    displayR: `${label}.R`,
    displayG: `${label}.G`,
    displayB: `${label}.B`,
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
  const parameterVisibility = config.parameterVisibility ?? DEFAULT_STOKES_PARAMETER_VISIBILITY_SETTINGS;
  const spectralStokesCapabilities = getSpectralStokesRgbCapabilitiesForChannelNames(channelNames);
  const hasSpectralStokesRgbOptions = spectralStokesCapabilities.available;
  const scalarChannelSets = detectScalarStokesChannelSets(channelNames);
  for (const scalarChannels of scalarChannelSets) {
    const isSplitSpectralStokesSet = Boolean(
      scalarChannels.suffix &&
      hasSpectralStokesRgbOptions &&
      isSpectralStokesSuffixValue(scalarChannels.suffix)
    );
    if (isSplitSpectralStokesSet && !includeSplitChannels) {
      continue;
    }

    for (const parameter of getAvailableStokesParameters(hasCompleteScalarStokesS3(scalarChannels), parameterVisibility)) {
      options.push(buildScalarStokesDisplayOption(parameter, scalarChannels));
    }
  }

  const rgbChannels = detectRgbStokesChannels(channelNames);
  if (rgbChannels) {
    for (const parameter of getAvailableStokesParameters(hasCompleteRgbStokesS3(rgbChannels), parameterVisibility)) {
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

  if (hasSpectralStokesRgbOptions && includeRgbGroups) {
    for (const parameter of getAvailableStokesParameters(spectralStokesCapabilities.hasS3, parameterVisibility)) {
      options.push(buildSpectralStokesRgbDisplayOption(parameter));
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

export function isStokesParameterVisible(
  parameter: StokesParameter | null,
  settings: StokesParameterVisibilitySettings = DEFAULT_STOKES_PARAMETER_VISIBILITY_SETTINGS
): boolean {
  const group = getStokesColormapDefaultGroup(parameter);
  return group ? settings[group] !== false : true;
}

export function resolveStokesColormapDefaultLabel(
  parameter: StokesParameter | null,
  settings: StokesColormapDefaultSettings = DEFAULT_STOKES_COLORMAP_DEFAULT_SETTINGS
): string | null {
  const group = getStokesColormapDefaultGroup(parameter);
  return group
    ? settings[group]?.colormapLabel ?? DEFAULT_STOKES_COLORMAP_DEFAULT_SETTINGS[group].colormapLabel
    : null;
}

export function getStokesColormapDefault(
  parameter: StokesParameter | null,
  settings: StokesColormapDefaultSettings = DEFAULT_STOKES_COLORMAP_DEFAULT_SETTINGS
): StokesColormapDefault | null {
  if (!parameter) {
    return null;
  }

  const group = getStokesColormapDefaultGroup(parameter);
  return group ? cloneStokesColormapDefaultSetting(
    settings[group] ?? DEFAULT_STOKES_COLORMAP_DEFAULT_SETTINGS[group]
  ) : null;
}

export function getStokesDisplayColormapDefault(
  selection: DisplaySelection | null,
  settings: StokesColormapDefaultSettings = DEFAULT_STOKES_COLORMAP_DEFAULT_SETTINGS
): StokesColormapDefault | null {
  return isStokesSelection(selection)
    ? getStokesColormapDefault(selection.parameter, settings)
    : null;
}

export function isStokesDisplayAvailable(
  channelNames: string[],
  selection: DisplaySelection | null,
  parameterVisibility: StokesParameterVisibilitySettings = DEFAULT_STOKES_PARAMETER_VISIBILITY_SETTINGS
): boolean {
  if (!isStokesSelection(selection)) {
    return true;
  }

  if (!isStokesParameterVisible(selection.parameter, parameterVisibility)) {
    return false;
  }

  if (selection.source.kind === 'scalar') {
    const channels = detectScalarStokesChannels(channelNames, selection.source.suffix ?? null);
    return Boolean(channels && isStokesParameterAvailable(selection.parameter, hasCompleteScalarStokesS3(channels)));
  }

  if (selection.source.kind === 'spectralRgb') {
    const capabilities = getSpectralStokesRgbCapabilitiesForChannelNames(channelNames);
    return capabilities.available && isStokesParameterAvailable(selection.parameter, capabilities.hasS3);
  }

  const rgbChannels = detectRgbStokesChannels(channelNames);
  return Boolean(rgbChannels && isStokesParameterAvailable(selection.parameter, hasCompleteRgbStokesS3(rgbChannels)));
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

export function resolveStokesDegreeModulationMode(
  selection: DisplaySelection | null,
  aolpMode: StokesAolpDegreeModulationMode
): StokesAolpDegreeModulationMode {
  return isStokesAngleSelection(selection) && selection.parameter === 'aolp'
    ? aolpMode
    : 'value';
}

export function clampStokesDegreeModulationValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export const STOKES_VECTOR_VALIDITY_RTOL = 1.0e-8;

export function isPhysicallyValidStokesVector(
  s0: number,
  s1: number,
  s2: number,
  s3: number,
  rtol = STOKES_VECTOR_VALIDITY_RTOL
): boolean {
  if (
    !Number.isFinite(s0) ||
    !Number.isFinite(s1) ||
    !Number.isFinite(s2) ||
    !Number.isFinite(s3) ||
    s0 < 0
  ) {
    return false;
  }

  const s0Squared = s0 ** 2;
  return s0Squared - (s1 ** 2 + s2 ** 2 + s3 ** 2) >= -Math.abs(rtol) * s0Squared;
}

export function shouldMaskInvalidStokesVectors(options: StokesComputationOptions = {}): boolean {
  return options.maskInvalidStokesVectors ?? DEFAULT_MASK_INVALID_STOKES_VECTORS;
}

export function hasFiniteStokesVectorComponents(
  s0: number,
  s1: number,
  s2: number,
  s3: number
): boolean {
  return Number.isFinite(s0) && Number.isFinite(s1) && Number.isFinite(s2) && Number.isFinite(s3);
}

export function shouldRejectStokesVector(
  s0: number,
  s1: number,
  s2: number,
  s3: number,
  options: StokesComputationOptions = {}
): boolean {
  if (!hasFiniteStokesVectorComponents(s0, s1, s2, s3)) {
    return true;
  }

  return shouldMaskInvalidStokesVectors(options) && !isPhysicallyValidStokesVector(s0, s1, s2, s3);
}

export function computeStokesAolp(s1: number, s2: number): number {
  if (!Number.isFinite(s1) || !Number.isFinite(s2)) {
    return Number.NaN;
  }

  if (s1 === 0 && s2 === 0) {
    return Number.NaN;
  }

  const aolp = 0.5 * Math.atan2(s2, s1);
  if (!Number.isFinite(aolp)) {
    return Number.NaN;
  }

  return aolp < 0 ? aolp + Math.PI : aolp;
}

export function computeStokesDolp(s0: number, s1: number, s2: number): number {
  if (!Number.isFinite(s0) || !Number.isFinite(s1) || !Number.isFinite(s2) || s0 === 0) {
    return Number.NaN;
  }

  const dolp = Math.sqrt(s1 ** 2 + s2 ** 2) / s0;
  return Number.isFinite(dolp) ? dolp : Number.NaN;
}

export function computeStokesDop(s0: number, s1: number, s2: number, s3: number): number {
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

export function computeStokesDocp(s0: number, s3: number): number {
  if (!Number.isFinite(s0) || !Number.isFinite(s3) || s0 === 0) {
    return Number.NaN;
  }

  const docp = Math.abs(s3) / s0;
  return Number.isFinite(docp) ? docp : Number.NaN;
}

export function computeStokesEang(s1: number, s2: number, s3: number): number {
  if (!Number.isFinite(s1) || !Number.isFinite(s2) || !Number.isFinite(s3)) {
    return Number.NaN;
  }

  if (s1 === 0 && s2 === 0 && s3 === 0) {
    return Number.NaN;
  }

  const eang = 0.5 * Math.atan2(s3, Math.sqrt(s1 ** 2 + s2 ** 2));
  return Number.isFinite(eang) ? eang : Number.NaN;
}

export function computeStokesNormalizedComponent(s0: number, component: number): number {
  if (!Number.isFinite(s0) || !Number.isFinite(component) || s0 === 0) {
    return Number.NaN;
  }

  const normalized = component / s0;
  return Number.isFinite(normalized) ? normalized : Number.NaN;
}

export function computeStokesDisplayValue(
  parameter: StokesParameter,
  s0: number,
  s1: number,
  s2: number,
  s3: number,
  options: StokesComputationOptions = {}
): number {
  if (shouldRejectStokesVector(s0, s1, s2, s3, options)) {
    return Number.NaN;
  }

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
  s3: number,
  options: StokesComputationOptions = {}
): number | null {
  switch (parameter) {
    case 'aolp':
      if (shouldRejectStokesVector(s0, s1, s2, s3, options)) {
        return Number.NaN;
      }
      return computeStokesDolp(s0, s1, s2);
    case 'cop':
      if (shouldRejectStokesVector(s0, s1, s2, s3, options)) {
        return Number.NaN;
      }
      return computeStokesDocp(s0, s3);
    case 'top':
      if (shouldRejectStokesVector(s0, s1, s2, s3, options)) {
        return Number.NaN;
      }
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
  s3: number,
  options: StokesComputationOptions = {}
): number | null {
  const value = computeStokesDegreeModulationValue(parameter, s0, s1, s2, s3, options);
  return value === null || !Number.isFinite(value)
    ? value
    : clampStokesDegreeModulationValue(value);
}

function buildScalarStokesDisplayOption(
  parameter: StokesParameter,
  channels: ScalarStokesChannels
): StokesDisplayOption {
  const selection = buildScalarStokesSelection(parameter, channels.suffix ?? null);
  return {
    key: channels.suffix ? `stokesScalar:${parameter}:${channels.suffix}` : `stokesScalar:${parameter}`,
    label: getDisplaySelectionOptionLabel(selection),
    selection,
    mapping: buildScalarStokesMapping(channels),
    component: null
  };
}

function parseScalarStokesChannelName(channelName: string): {
  component: StokesChannelComponent;
  suffix: string | null;
} | null {
  const match = channelName.match(/^(S[0-3])(?:\.(.+))?$/);
  if (!match) {
    return null;
  }

  return {
    component: match[1] as StokesChannelComponent,
    suffix: match[2] ?? null
  };
}

function isRgbStokesScalarSuffix(suffix: string | null): boolean {
  return suffix !== null && RGB_STOKES_SUFFIXES.has(suffix);
}

function buildScalarStokesChannelsFromGroup(group: ScalarStokesChannelGroup): ScalarStokesChannels | null {
  const s0 = group.channels.S0;
  const s1 = group.channels.S1;
  const s2 = group.channels.S2;
  if (!s0 || !s1 || !s2) {
    return null;
  }

  const s3 = group.channels.S3 ?? null;
  return group.suffix
    ? { s0, s1, s2, s3, suffix: group.suffix }
    : { s0, s1, s2, s3 };
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

function buildSpectralStokesRgbDisplayOption(parameter: StokesParameter): StokesDisplayOption {
  const selection = buildSpectralStokesRgbSelection(parameter);
  return {
    key: `stokesSpectralRgb:${parameter}:group`,
    label: getDisplaySelectionOptionLabel(selection),
    selection,
    mapping: buildSpectralStokesRgbMapping(parameter),
    component: null
  };
}

function getAvailableStokesParameters(
  hasS3: boolean,
  parameterVisibility: StokesParameterVisibilitySettings
): StokesParameter[] {
  return STOKES_PARAMETER_ORDER.filter((parameter) => (
    isStokesParameterAvailable(parameter, hasS3) &&
    isStokesParameterVisible(parameter, parameterVisibility)
  ));
}

function isStokesParameterAvailable(parameter: StokesParameter, hasS3: boolean): boolean {
  return hasS3 || !S3_STOKES_PARAMETERS.has(parameter);
}

function hasCompleteScalarStokesS3(channels: ScalarStokesChannels): boolean {
  return channels.s3 !== null;
}

function hasCompleteRgbStokesS3(channels: RgbStokesChannels): boolean {
  return channels.r.s3 !== null && channels.g.s3 !== null && channels.b.s3 !== null;
}

function getSpectralStokesRgbCapabilitiesForChannelNames(channelNames: string[]): {
  available: boolean;
  hasS3: boolean;
} {
  const componentsByWavelength = new Map<string, Set<StokesChannelComponent>>();

  for (const channelName of channelNames) {
    const match = channelName.match(/^(S[0-3])\.(\d+(?:,\d+)?(?:[eE][-+]?\d+)?)nm$/i);
    if (!match) {
      continue;
    }

    const wavelength = Number(match[2]?.replace(',', '.'));
    if (!Number.isFinite(wavelength)) {
      continue;
    }

    const key = String(wavelength);
    const components = componentsByWavelength.get(key) ?? new Set<StokesChannelComponent>();
    components.add(match[1]!.toUpperCase() as StokesChannelComponent);
    componentsByWavelength.set(key, components);
  }

  let linearWavelengthCount = 0;
  let fullWavelengthCount = 0;
  for (const components of componentsByWavelength.values()) {
    if (
      components.has('S0') &&
      components.has('S1') &&
      components.has('S2')
    ) {
      linearWavelengthCount += 1;
      if (components.has('S3')) {
        fullWavelengthCount += 1;
      }
    }
  }

  return {
    available: linearWavelengthCount >= 2,
    hasS3: linearWavelengthCount >= 2 && linearWavelengthCount === fullWavelengthCount
  };
}

function isSpectralStokesSuffixValue(value: string | null | undefined): boolean {
  return Boolean(value && /^\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?nm$/i.test(value));
}
