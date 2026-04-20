import { DEFAULT_COLORMAP_ID } from './colormaps';
import {
  DecodedExrImage,
  DecodedLayer,
  DisplayChannelMapping,
  DisplaySelection,
  DisplaySourceKind,
  DisplayLuminanceRange,
  ImagePixel,
  PixelSample,
  StokesDegreeModulationParameter,
  StokesDegreeModulationState,
  StokesParameter,
  ViewerState,
  ZERO_CHANNEL
} from './types';

export type HistogramMode = 'luminance' | 'rgb';
export type HistogramXAxisMode = 'ev' | 'linear';
export type HistogramYAxisMode = 'sqrt' | 'log' | 'linear';
export type StokesColormapDefaultGroup = 'aolp' | 'degree' | 'cop' | 'top' | 'normalized';
type RgbSuffix = 'R' | 'G' | 'B' | 'A';
type RgbStokesComponent = 'R' | 'G' | 'B';

export interface StokesColormapDefault {
  colormapLabel: string;
  range: DisplayLuminanceRange;
  zeroCentered: boolean;
}

export interface HistogramBuildOptions {
  bins?: number;
  mode?: HistogramMode;
  xAxis?: HistogramXAxisMode;
  evReference?: number;
}

export interface HistogramViewOptions {
  xAxis: HistogramXAxisMode;
  yAxis: HistogramYAxisMode;
}

export interface HistogramChannelCounts {
  r: number;
  g: number;
  b: number;
}

export interface HistogramData {
  mode: HistogramMode;
  xAxis: HistogramXAxisMode;
  bins: Float32Array;
  nonPositiveCount: number;
  channelBins: { r: Float32Array; g: Float32Array; b: Float32Array } | null;
  channelNonPositiveCounts: HistogramChannelCounts | null;
  min: number;
  max: number;
  mean: number;
  channelMeans: HistogramChannelCounts | null;
  evReference: number;
}

export interface RgbChannelGroup {
  key: string;
  label: string;
  r: string;
  g: string;
  b: string;
  a?: string;
}

export interface ChannelDisplayOption {
  key: string;
  label: string;
  mapping: DisplayChannelMapping;
}

export interface ChannelDisplayOptionsConfig {
  includeRgbGroups?: boolean;
  includeSplitChannels?: boolean;
  includeAlphaCompanions?: boolean;
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

const HISTOGRAM_DEFAULT_EV_REFERENCE = 1;
const HISTOGRAM_EPSILON = 1e-12;
const HISTOGRAM_NORMALIZATION_PERCENTILE = 0.995;
const LUMINANCE_WEIGHTS = { r: 0.2126, g: 0.7152, b: 0.0722 };
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

export function createInitialState(): ViewerState {
  return {
    exposureEv: 0,
    visualizationMode: 'rgb',
    activeColormapId: DEFAULT_COLORMAP_ID,
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    colormapZeroCentered: false,
    stokesDegreeModulation: createDefaultStokesDegreeModulation(),
    zoom: 1,
    panX: 0,
    panY: 0,
    activeLayer: 0,
    displaySource: 'channels',
    stokesParameter: null,
    displayR: ZERO_CHANNEL,
    displayG: ZERO_CHANNEL,
    displayB: ZERO_CHANNEL,
    displayA: null,
    hoveredPixel: null,
    lockedPixel: null
  };
}

export function buildSessionDisplayName(filename: string, existingFilenames: string[]): string {
  const duplicateCount = existingFilenames.reduce((count, current) => {
    return count + (current === filename ? 1 : 0);
  }, 0);

  if (duplicateCount === 0) {
    return filename;
  }

  return `${filename} (${duplicateCount + 1})`;
}

export function pickNextSessionIndexAfterRemoval(removedIndex: number, remainingCount: number): number {
  if (removedIndex < 0 || remainingCount <= 0) {
    return -1;
  }
  return Math.min(removedIndex, remainingCount - 1);
}

export function persistActiveSessionState<T extends { id: string; state: ViewerState }>(
  sessions: T[],
  activeSessionId: string | null,
  state: ViewerState
): void {
  if (!activeSessionId) {
    return;
  }

  const session = sessions.find((item) => item.id === activeSessionId);
  if (!session) {
    return;
  }

  session.state = { ...state };
}

export class ViewerStore {
  private state: ViewerState;
  private listeners = new Set<(state: ViewerState, previous: ViewerState) => void>();

  constructor(initialState: ViewerState) {
    this.state = initialState;
  }

  getState(): ViewerState {
    return this.state;
  }

  setState(patch: Partial<ViewerState>): void {
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state, previous);
    }
  }

  subscribe(listener: (state: ViewerState, previous: ViewerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function pickValidLayerIndex(layerCount: number, requestedIndex: number): number {
  if (layerCount <= 0) {
    return 0;
  }

  const resolvedIndex = Number.isFinite(requestedIndex) ? Math.floor(requestedIndex) : 0;
  return Math.min(layerCount - 1, Math.max(0, resolvedIndex));
}

export function buildViewerStateForLayer(
  currentState: ViewerState,
  decoded: DecodedExrImage,
  requestedLayerIndex: number = currentState.activeLayer
): ViewerState {
  const activeLayer = pickValidLayerIndex(decoded.layers.length, requestedLayerIndex);
  const layer = decoded.layers[activeLayer];
  if (!layer) {
    return {
      ...currentState,
      activeLayer: 0,
      displaySource: 'channels',
      stokesParameter: null,
      displayR: ZERO_CHANNEL,
      displayG: ZERO_CHANNEL,
      displayB: ZERO_CHANNEL,
      displayA: null
    };
  }

  return {
    ...currentState,
    activeLayer,
    ...resolveDisplaySelectionForLayer(layer.channelNames, currentState)
  };
}

export function areDisplayChannelsAvailable(
  channelNames: string[],
  selection: DisplayChannelMapping
): boolean {
  const channels = new Set(channelNames);
  const isAvailable = (channelName: string): boolean => channelName === ZERO_CHANNEL || channels.has(channelName);
  const alphaChannel = selection.displayA ?? null;
  return (
    isAvailable(selection.displayR) &&
    isAvailable(selection.displayG) &&
    isAvailable(selection.displayB) &&
    (alphaChannel === null || channels.has(alphaChannel))
  );
}

export function pickDefaultDisplayChannels(channelNames: string[]): DisplayChannelMapping {
  const names = [...channelNames];
  const rgbGroups = extractRgbChannelGroups(names);
  if (rgbGroups.length > 0) {
    const firstGroup = rgbGroups[0];
    const mapping = {
      displayR: firstGroup.r,
      displayG: firstGroup.g,
      displayB: firstGroup.b,
      displayA: firstGroup.a ?? null
    };
    return mapping;
  }

  const grayscaleChannel = pickGrayscaleDisplayChannel(names);
  if (grayscaleChannel) {
    const mapping = {
      displayR: grayscaleChannel,
      displayG: grayscaleChannel,
      displayB: grayscaleChannel
    };
    return {
      ...mapping,
      displayA: resolveAlphaChannelForMapping(names, mapping)
    };
  }

  const firstNonAlphaChannel = names.find((channelName) => !isAlphaChannel(channelName));
  const fallbackChannel = firstNonAlphaChannel ?? names[0] ?? ZERO_CHANNEL;
  const mapping = {
    displayR: fallbackChannel,
    displayG: fallbackChannel,
    displayB: fallbackChannel
  };
  return {
    ...mapping,
    displayA: resolveAlphaChannelForMapping(names, mapping)
  };
}

export function resolveDisplayChannelsForLayer(
  channelNames: string[],
  currentSelection: DisplayChannelMapping
): DisplayChannelMapping {
  const hasNonZeroSelection =
    currentSelection.displayR !== ZERO_CHANNEL ||
    currentSelection.displayG !== ZERO_CHANNEL ||
    currentSelection.displayB !== ZERO_CHANNEL;

  if (
    hasNonZeroSelection &&
    areDisplayChannelsAvailable(channelNames, currentSelection) &&
    isDisplayChannelSelectionPreservable(channelNames, currentSelection)
  ) {
    const mapping = {
      displayR: currentSelection.displayR,
      displayG: currentSelection.displayG,
      displayB: currentSelection.displayB
    };
    return {
      ...mapping,
      displayA: resolveAlphaChannelForMapping(channelNames, mapping)
    };
  }

  return pickDefaultDisplayChannels(channelNames);
}

export function resolveDisplaySelectionForLayer(
  channelNames: string[],
  currentSelection: DisplaySelection
): DisplaySelection {
  const channelMapping = resolveDisplayChannelsForLayer(channelNames, currentSelection);

  if (isStokesDisplaySelection(currentSelection) && isStokesDisplayAvailable(channelNames, currentSelection)) {
    return {
      ...channelMapping,
      displaySource: currentSelection.displaySource,
      stokesParameter: currentSelection.stokesParameter
    };
  }

  return {
    ...channelMapping,
    displaySource: 'channels',
    stokesParameter: null
  };
}

export function extractRgbChannelGroups(channelNames: string[]): RgbChannelGroup[] {
  const grouped = new Map<string, Partial<Record<RgbSuffix, string>>>();

  for (const channelName of channelNames) {
    const parsed = parseRgbChannel(channelName);
    if (!parsed) {
      continue;
    }

    const group = grouped.get(parsed.base) ?? {};
    if (!group[parsed.suffix]) {
      group[parsed.suffix] = channelName;
      grouped.set(parsed.base, group);
    }
  }

  const groups: RgbChannelGroup[] = [];
  for (const [base, channels] of grouped.entries()) {
    if (!channels.R || !channels.G || !channels.B) {
      continue;
    }

    groups.push({
      key: base,
      label: buildRgbGroupLabel(base, Boolean(channels.A)),
      r: channels.R,
      g: channels.G,
      b: channels.B,
      a: channels.A
    });
  }

  groups.sort((a, b) => {
    if (a.key.length === 0) {
      return -1;
    }
    if (b.key.length === 0) {
      return 1;
    }
    return a.key.localeCompare(b.key);
  });

  return groups;
}

export function findSelectedRgbGroup(
  groups: RgbChannelGroup[],
  displayR: string,
  displayG: string,
  displayB: string
): RgbChannelGroup | null {
  return groups.find((group) => group.r === displayR && group.g === displayG && group.b === displayB) ?? null;
}

export function buildChannelDisplayOptions(
  channelNames: string[],
  config: ChannelDisplayOptionsConfig = {}
): ChannelDisplayOption[] {
  const options: ChannelDisplayOption[] = [];
  const includeRgbGroups = config.includeRgbGroups ?? true;
  const includeSplitChannels = config.includeSplitChannels ?? false;
  const includeAlphaCompanions = config.includeAlphaCompanions ?? !includeSplitChannels;
  const rgbComponentChannels = new Set<string>();
  const consumedAlphaChannels = new Set<string>();
  const singleChannelOptions = new Set<string>();

  const pushSingleChannelOption = (channelName: string, labelOverride?: string): void => {
    if (singleChannelOptions.has(channelName)) {
      return;
    }

    singleChannelOptions.add(channelName);
    options.push(buildSingleChannelDisplayOption(channelName, channelNames, labelOverride, includeAlphaCompanions));
  };

  for (const group of extractRgbChannelGroups(channelNames)) {
    rgbComponentChannels.add(group.r);
    rgbComponentChannels.add(group.g);
    rgbComponentChannels.add(group.b);
    if (group.a) {
      rgbComponentChannels.add(group.a);
      consumedAlphaChannels.add(group.a);
    }

    if (includeRgbGroups) {
      options.push({
        key: `group:${group.key}`,
        label: group.label,
        mapping: {
          displayR: group.r,
          displayG: group.g,
          displayB: group.b,
          displayA: group.a ?? null
        }
      });
    }

    if (includeSplitChannels) {
      pushSingleChannelOption(group.r, group.r);
      pushSingleChannelOption(group.g, group.g);
      pushSingleChannelOption(group.b, group.b);
      if (group.a) {
        pushSingleChannelOption(group.a, group.a);
      }
    }
  }

  for (const channelName of channelNames) {
    if (!includeAlphaCompanions || rgbComponentChannels.has(channelName) || isAlphaChannel(channelName)) {
      continue;
    }

    const alphaChannel = resolveAlphaChannelForMapping(channelNames, {
      displayR: channelName,
      displayG: channelName,
      displayB: channelName
    });
    if (alphaChannel) {
      consumedAlphaChannels.add(alphaChannel);
    }
  }

  for (const channelName of channelNames) {
    if (rgbComponentChannels.has(channelName)) {
      continue;
    }
    if (consumedAlphaChannels.has(channelName)) {
      continue;
    }

    const option = buildSingleChannelDisplayOption(channelName, channelNames, undefined, includeAlphaCompanions);
    if (option.mapping.displayA) {
      consumedAlphaChannels.add(option.mapping.displayA);
    }
    if (isAlphaChannel(channelName) && consumedAlphaChannels.has(channelName)) {
      continue;
    }
    if (singleChannelOptions.has(channelName)) {
      continue;
    }

    singleChannelOptions.add(channelName);
    options.push(option);
  }

  return options;
}

export function findSelectedChannelDisplayOption(
  options: ChannelDisplayOption[],
  displayR: string,
  displayG: string,
  displayB: string,
  displayA: string | null = null
): ChannelDisplayOption | null {
  return options.find((option) => {
    return (
      option.mapping.displayR === displayR &&
      option.mapping.displayG === displayG &&
      option.mapping.displayB === displayB &&
      (option.mapping.displayA ?? null) === displayA
    );
  }) ?? null;
}

function isDisplayChannelSelectionPreservable(
  channelNames: string[],
  selection: DisplayChannelMapping
): boolean {
  if (
    selection.displayR === selection.displayG &&
    selection.displayR === selection.displayB
  ) {
    return true;
  }

  return Boolean(findSelectedRgbGroup(
    extractRgbChannelGroups(channelNames),
    selection.displayR,
    selection.displayG,
    selection.displayB
  ));
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

function buildRgbStokesGroupMapping(channels: RgbStokesChannels): DisplayChannelMapping {
  return {
    displayR: channels.r.s0,
    displayG: channels.g.s0,
    displayB: channels.b.s0,
    displayA: null
  };
}

function buildRgbStokesSplitMapping(channels: ScalarStokesChannels): DisplayChannelMapping {
  return {
    displayR: channels.s0,
    displayG: channels.s0,
    displayB: channels.s0,
    displayA: null
  };
}

function findMergedSelectionForSplitChannel(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  if (
    selected.displaySource !== 'channels' ||
    selected.stokesParameter !== null ||
    selected.displayR !== selected.displayG ||
    selected.displayR !== selected.displayB
  ) {
    return null;
  }

  const selectedChannel = selected.displayR;
  for (const group of extractRgbChannelGroups(channelNames)) {
    if (selectedChannel !== group.r && selectedChannel !== group.g && selectedChannel !== group.b) {
      continue;
    }

    return {
      displaySource: 'channels',
      stokesParameter: null,
      displayR: group.r,
      displayG: group.g,
      displayB: group.b,
      displayA: group.a ?? null
    };
  }

  const displayA = resolveAlphaChannelForMapping(channelNames, {
    displayR: selectedChannel,
    displayG: selectedChannel,
    displayB: selectedChannel
  });
  if (displayA) {
    return {
      displaySource: 'channels',
      stokesParameter: null,
      displayR: selectedChannel,
      displayG: selectedChannel,
      displayB: selectedChannel,
      displayA
    };
  }

  return null;
}

function findSplitSelectionForMergedGroup(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  if (selected.displaySource !== 'channels' || selected.stokesParameter !== null) {
    return null;
  }

  for (const group of extractRgbChannelGroups(channelNames)) {
    if (selected.displayR !== group.r || selected.displayG !== group.g || selected.displayB !== group.b) {
      continue;
    }

    return {
      displaySource: 'channels',
      stokesParameter: null,
      displayR: group.r,
      displayG: group.r,
      displayB: group.r,
      displayA: null
    };
  }

  if (
    selected.displayR === selected.displayG &&
    selected.displayR === selected.displayB &&
    selected.displayA
  ) {
    return {
      displaySource: 'channels',
      stokesParameter: null,
      displayR: selected.displayR,
      displayG: selected.displayR,
      displayB: selected.displayR,
      displayA: null
    };
  }

  return null;
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

export function findMergedSelectionForSplitDisplay(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  const channelSelection = findMergedSelectionForSplitChannel(channelNames, selected);
  if (channelSelection) {
    return channelSelection;
  }

  if (selected.displaySource !== 'stokesRgb' || selected.stokesParameter === null) {
    return null;
  }

  const channels = detectRgbStokesChannels(channelNames);
  if (!channels || !resolveRgbStokesSplitComponent(channels, selected)) {
    return null;
  }

  return {
    displaySource: 'stokesRgb',
    stokesParameter: selected.stokesParameter,
    ...buildRgbStokesGroupMapping(channels)
  };
}

export function findSplitSelectionForMergedDisplay(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  const channelSelection = findSplitSelectionForMergedGroup(channelNames, selected);
  if (channelSelection) {
    return channelSelection;
  }

  if (selected.displaySource !== 'stokesRgb' || selected.stokesParameter === null) {
    return null;
  }

  const channels = detectRgbStokesChannels(channelNames);
  if (!channels || resolveRgbStokesSplitComponent(channels, selected)) {
    return null;
  }

  return {
    displaySource: 'stokesRgb',
    stokesParameter: selected.stokesParameter,
    ...buildRgbStokesSplitMapping(channels.r)
  };
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

export function resolveColormapAutoRange(
  selection: Pick<DisplaySelection, 'displaySource' | 'stokesParameter'>,
  imageRange: DisplayLuminanceRange | null,
  zeroCentered: boolean
): DisplayLuminanceRange | null {
  const stokesDefault = getStokesDisplayColormapDefault(selection);
  const sourceRange = stokesDefault?.range ?? imageRange;

  return zeroCentered
    ? buildZeroCenteredColormapRange(sourceRange)
    : cloneDisplayLuminanceRange(sourceRange);
}

export function shouldPreserveStokesColormapState(
  previous: Pick<DisplaySelection, 'displaySource' | 'stokesParameter'>,
  next: Pick<DisplaySelection, 'displaySource' | 'stokesParameter'>
): boolean {
  if (!isStokesDisplaySelection(previous) || !isStokesDisplaySelection(next)) {
    return false;
  }

  return getStokesColormapDefaultGroup(previous.stokesParameter) ===
    getStokesColormapDefaultGroup(next.stokesParameter);
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

export function computeDisplayTextureLuminanceRange(
  displayTexture: Float32Array
): DisplayLuminanceRange | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;

  for (let i = 0; i < displayTexture.length; i += 4) {
    const r = displayTexture[i + 0];
    const g = displayTexture[i + 1];
    const b = displayTexture[i + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

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

export function buildZeroCenteredColormapRange(
  range: DisplayLuminanceRange | null,
  fallbackMagnitude = 1
): DisplayLuminanceRange | null {
  if (!range) {
    return null;
  }

  const magnitude = Math.max(Math.abs(range.min), Math.abs(range.max));
  const fallback = Number.isFinite(fallbackMagnitude) && fallbackMagnitude > 0 ? fallbackMagnitude : 1;
  const v = Number.isFinite(magnitude) && magnitude > 0 ? magnitude : fallback;
  return { min: -v, max: v };
}

function cloneDisplayLuminanceRange(range: DisplayLuminanceRange | null): DisplayLuminanceRange | null {
  return range ? { min: range.min, max: range.max } : null;
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

export function formatScientific(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return value.toExponential(5);
}

export function buildDisplayHistogram(
  displayTexture: Float32Array,
  options: HistogramBuildOptions = {}
): HistogramData {
  const resolvedOptions = resolveHistogramBuildOptions(options);
  if (resolvedOptions.mode === 'rgb') {
    return buildRgbHistogram(displayTexture, resolvedOptions);
  }
  return buildLuminanceHistogram(displayTexture, resolvedOptions);
}

export function buildLayerDisplayHistogram(
  layer: DecodedLayer,
  width: number,
  height: number,
  displayR: string,
  displayG: string,
  displayB: string,
  options: HistogramBuildOptions = {}
): HistogramData {
  const resolvedOptions = resolveHistogramBuildOptions(options);
  const pixelCount = width * height;
  const channelR = getChannel(layer, displayR);
  const channelG = getChannel(layer, displayG);
  const channelB = getChannel(layer, displayB);

  if (resolvedOptions.mode === 'rgb') {
    return buildRgbHistogramFromChannels(channelR, channelG, channelB, pixelCount, resolvedOptions);
  }

  return buildLuminanceHistogramFromChannels(channelR, channelG, channelB, pixelCount, resolvedOptions);
}

export function computeHistogramRenderCeiling(histogram: HistogramData): number {
  const positiveValues = collectHistogramPositiveCounts(histogram);
  if (positiveValues.length === 0) {
    return 0;
  }

  positiveValues.sort((a, b) => a - b);
  const quantileIndex = Math.max(
    0,
    Math.min(
      positiveValues.length - 1,
      Math.floor((positiveValues.length - 1) * HISTOGRAM_NORMALIZATION_PERCENTILE)
    )
  );
  return positiveValues[quantileIndex] ?? 0;
}

export function scaleHistogramCount(count: number, ceiling: number, mode: HistogramYAxisMode): number {
  if (ceiling <= 0 || count <= 0) {
    return 0;
  }

  const clampedCount = Math.min(count, ceiling);
  if (mode === 'linear') {
    return clampedCount / ceiling;
  }
  if (mode === 'log') {
    return Math.log1p(clampedCount) / Math.log1p(ceiling);
  }
  return Math.sqrt(clampedCount) / Math.sqrt(ceiling);
}

function buildLuminanceHistogram(
  displayTexture: Float32Array,
  options: Required<HistogramBuildOptions>
): HistogramData {
  const histogram = new Float32Array(options.bins);
  let nonPositiveCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  let sum = 0;
  let hasDomainSamples = false;

  for (let i = 0; i < displayTexture.length; i += 4) {
    const r = displayTexture[i + 0];
    const g = displayTexture[i + 1];
    const b = displayTexture[i + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (!Number.isFinite(luminance)) {
      continue;
    }

    finiteCount += 1;
    sum += luminance;

    if (options.xAxis === 'ev') {
      if (luminance <= 0) {
        nonPositiveCount += 1;
        continue;
      }
    }

    const domainValue = mapValueToHistogramDomain(luminance, options);
    if (domainValue < min) {
      min = domainValue;
    }
    if (domainValue > max) {
      max = domainValue;
    }
    hasDomainSamples = true;
  }

  if (finiteCount === 0) {
    return createEmptyHistogramData('luminance', options);
  }

  const flatBucket = Math.floor(histogram.length / 2);
  if (!hasDomainSamples) {
    const fallbackDomain = createFallbackHistogramDomain(options.xAxis);
    min = fallbackDomain.min;
    max = fallbackDomain.max;
  }

  for (let i = 0; i < displayTexture.length; i += 4) {
    const r = displayTexture[i + 0];
    const g = displayTexture[i + 1];
    const b = displayTexture[i + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (!Number.isFinite(luminance)) {
      continue;
    }

    if (options.xAxis === 'ev' && luminance <= 0) {
      continue;
    }

    addValueToBins(luminance, histogram, min, max, flatBucket, options);
  }

  return {
    mode: 'luminance',
    xAxis: options.xAxis,
    bins: histogram,
    nonPositiveCount,
    channelBins: null,
    channelNonPositiveCounts: null,
    min,
    max,
    mean: sum / finiteCount,
    channelMeans: null,
    evReference: options.evReference
  };
}

function buildRgbHistogram(
  displayTexture: Float32Array,
  options: Required<HistogramBuildOptions>
): HistogramData {
  const binsR = new Float32Array(options.bins);
  const binsG = new Float32Array(options.bins);
  const binsB = new Float32Array(options.bins);
  const channelNonPositiveCounts: HistogramChannelCounts = { r: 0, g: 0, b: 0 };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let countR = 0;
  let countG = 0;
  let countB = 0;
  let hasDomainSamples = false;

  for (let i = 0; i < displayTexture.length; i += 4) {
    const r = displayTexture[i + 0];
    const g = displayTexture[i + 1];
    const b = displayTexture[i + 2];

    if (Number.isFinite(r)) {
      finiteCount += 1;
      sumR += r;
      countR += 1;

      if (options.xAxis === 'ev' && r <= 0) {
        channelNonPositiveCounts.r += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(r, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }

    if (Number.isFinite(g)) {
      finiteCount += 1;
      sumG += g;
      countG += 1;

      if (options.xAxis === 'ev' && g <= 0) {
        channelNonPositiveCounts.g += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(g, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }

    if (Number.isFinite(b)) {
      finiteCount += 1;
      sumB += b;
      countB += 1;

      if (options.xAxis === 'ev' && b <= 0) {
        channelNonPositiveCounts.b += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(b, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }
  }

  if (finiteCount === 0) {
    return createEmptyHistogramData('rgb', options);
  }

  const flatBucket = Math.floor(options.bins / 2);
  if (!hasDomainSamples) {
    const fallbackDomain = createFallbackHistogramDomain(options.xAxis);
    min = fallbackDomain.min;
    max = fallbackDomain.max;
  }

  for (let i = 0; i < displayTexture.length; i += 4) {
    const r = displayTexture[i + 0];
    const g = displayTexture[i + 1];
    const b = displayTexture[i + 2];

    if (Number.isFinite(r) && !(options.xAxis === 'ev' && r <= 0)) {
      addValueToBins(r, binsR, min, max, flatBucket, options);
    }
    if (Number.isFinite(g) && !(options.xAxis === 'ev' && g <= 0)) {
      addValueToBins(g, binsG, min, max, flatBucket, options);
    }
    if (Number.isFinite(b) && !(options.xAxis === 'ev' && b <= 0)) {
      addValueToBins(b, binsB, min, max, flatBucket, options);
    }
  }

  const merged = new Float32Array(options.bins);
  for (let i = 0; i < options.bins; i += 1) {
    merged[i] = Math.max(binsR[i], binsG[i], binsB[i]);
  }

  const meanR = countR > 0 ? sumR / countR : 0;
  const meanG = countG > 0 ? sumG / countG : 0;
  const meanB = countB > 0 ? sumB / countB : 0;
  const meanContributors = (countR > 0 ? 1 : 0) + (countG > 0 ? 1 : 0) + (countB > 0 ? 1 : 0);
  const mean = meanContributors > 0 ? (meanR + meanG + meanB) / meanContributors : 0;

  return {
    mode: 'rgb',
    xAxis: options.xAxis,
    bins: merged,
    nonPositiveCount: Math.max(
      channelNonPositiveCounts.r,
      channelNonPositiveCounts.g,
      channelNonPositiveCounts.b
    ),
    channelBins: { r: binsR, g: binsG, b: binsB },
    channelNonPositiveCounts,
    min,
    max,
    mean,
    channelMeans: { r: meanR, g: meanG, b: meanB },
    evReference: options.evReference
  };
}

function buildLuminanceHistogramFromChannels(
  channelR: Float32Array | null,
  channelG: Float32Array | null,
  channelB: Float32Array | null,
  pixelCount: number,
  options: Required<HistogramBuildOptions>
): HistogramData {
  const histogram = new Float32Array(options.bins);
  let nonPositiveCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  let sum = 0;
  let hasDomainSamples = false;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const r = readChannelValue(channelR, pixelIndex);
    const g = readChannelValue(channelG, pixelIndex);
    const b = readChannelValue(channelB, pixelIndex);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (!Number.isFinite(luminance)) {
      continue;
    }

    finiteCount += 1;
    sum += luminance;

    if (options.xAxis === 'ev' && luminance <= 0) {
      nonPositiveCount += 1;
      continue;
    }

    const domainValue = mapValueToHistogramDomain(luminance, options);
    if (domainValue < min) {
      min = domainValue;
    }
    if (domainValue > max) {
      max = domainValue;
    }
    hasDomainSamples = true;
  }

  if (finiteCount === 0) {
    return createEmptyHistogramData('luminance', options);
  }

  const flatBucket = Math.floor(histogram.length / 2);
  if (!hasDomainSamples) {
    const fallbackDomain = createFallbackHistogramDomain(options.xAxis);
    min = fallbackDomain.min;
    max = fallbackDomain.max;
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const r = readChannelValue(channelR, pixelIndex);
    const g = readChannelValue(channelG, pixelIndex);
    const b = readChannelValue(channelB, pixelIndex);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (!Number.isFinite(luminance)) {
      continue;
    }

    if (options.xAxis === 'ev' && luminance <= 0) {
      continue;
    }

    addValueToBins(luminance, histogram, min, max, flatBucket, options);
  }

  return {
    mode: 'luminance',
    xAxis: options.xAxis,
    bins: histogram,
    nonPositiveCount,
    channelBins: null,
    channelNonPositiveCounts: null,
    min,
    max,
    mean: sum / finiteCount,
    channelMeans: null,
    evReference: options.evReference
  };
}

function buildRgbHistogramFromChannels(
  channelR: Float32Array | null,
  channelG: Float32Array | null,
  channelB: Float32Array | null,
  pixelCount: number,
  options: Required<HistogramBuildOptions>
): HistogramData {
  const binsR = new Float32Array(options.bins);
  const binsG = new Float32Array(options.bins);
  const binsB = new Float32Array(options.bins);
  const channelNonPositiveCounts: HistogramChannelCounts = { r: 0, g: 0, b: 0 };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let countR = 0;
  let countG = 0;
  let countB = 0;
  let hasDomainSamples = false;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const r = readChannelValue(channelR, pixelIndex);
    const g = readChannelValue(channelG, pixelIndex);
    const b = readChannelValue(channelB, pixelIndex);

    if (Number.isFinite(r)) {
      finiteCount += 1;
      sumR += r;
      countR += 1;

      if (options.xAxis === 'ev' && r <= 0) {
        channelNonPositiveCounts.r += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(r, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }

    if (Number.isFinite(g)) {
      finiteCount += 1;
      sumG += g;
      countG += 1;

      if (options.xAxis === 'ev' && g <= 0) {
        channelNonPositiveCounts.g += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(g, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }

    if (Number.isFinite(b)) {
      finiteCount += 1;
      sumB += b;
      countB += 1;

      if (options.xAxis === 'ev' && b <= 0) {
        channelNonPositiveCounts.b += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(b, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }
  }

  if (finiteCount === 0) {
    return createEmptyHistogramData('rgb', options);
  }

  const flatBucket = Math.floor(options.bins / 2);
  if (!hasDomainSamples) {
    const fallbackDomain = createFallbackHistogramDomain(options.xAxis);
    min = fallbackDomain.min;
    max = fallbackDomain.max;
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const r = readChannelValue(channelR, pixelIndex);
    const g = readChannelValue(channelG, pixelIndex);
    const b = readChannelValue(channelB, pixelIndex);

    if (Number.isFinite(r) && !(options.xAxis === 'ev' && r <= 0)) {
      addValueToBins(r, binsR, min, max, flatBucket, options);
    }
    if (Number.isFinite(g) && !(options.xAxis === 'ev' && g <= 0)) {
      addValueToBins(g, binsG, min, max, flatBucket, options);
    }
    if (Number.isFinite(b) && !(options.xAxis === 'ev' && b <= 0)) {
      addValueToBins(b, binsB, min, max, flatBucket, options);
    }
  }

  const merged = new Float32Array(options.bins);
  for (let i = 0; i < options.bins; i += 1) {
    merged[i] = Math.max(binsR[i], binsG[i], binsB[i]);
  }

  const meanR = countR > 0 ? sumR / countR : 0;
  const meanG = countG > 0 ? sumG / countG : 0;
  const meanB = countB > 0 ? sumB / countB : 0;
  const meanContributors = (countR > 0 ? 1 : 0) + (countG > 0 ? 1 : 0) + (countB > 0 ? 1 : 0);
  const mean = meanContributors > 0 ? (meanR + meanG + meanB) / meanContributors : 0;

  return {
    mode: 'rgb',
    xAxis: options.xAxis,
    bins: merged,
    nonPositiveCount: Math.max(
      channelNonPositiveCounts.r,
      channelNonPositiveCounts.g,
      channelNonPositiveCounts.b
    ),
    channelBins: { r: binsR, g: binsG, b: binsB },
    channelNonPositiveCounts,
    min,
    max,
    mean,
    channelMeans: { r: meanR, g: meanG, b: meanB },
    evReference: options.evReference
  };
}

function addValueToBins(
  value: number,
  bins: Float32Array,
  min: number,
  max: number,
  flatBucket: number,
  options: Required<HistogramBuildOptions>
): void {
  if (!Number.isFinite(value)) {
    return;
  }

  const bucket = valueToBucket(value, bins.length, min, max, flatBucket, options);
  bins[bucket] += 1;
}

function valueToBucket(
  value: number,
  binCount: number,
  min: number,
  max: number,
  flatBucket: number,
  options: Required<HistogramBuildOptions>
): number {
  if (max - min <= HISTOGRAM_EPSILON) {
    return flatBucket;
  }

  const domainValue = mapValueToHistogramDomain(value, options);
  const unit = clampUnit((domainValue - min) / (max - min));
  const scaled = Math.floor(unit * binCount);
  return Math.min(binCount - 1, Math.max(0, scaled));
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function resolveHistogramBuildOptions(options: HistogramBuildOptions): Required<HistogramBuildOptions> {
  return {
    bins: Math.max(2, Math.floor(options.bins ?? 64)),
    mode: options.mode ?? 'luminance',
    xAxis: options.xAxis ?? 'ev',
    evReference: options.evReference && options.evReference > 0 ? options.evReference : HISTOGRAM_DEFAULT_EV_REFERENCE
  };
}

function mapValueToHistogramDomain(value: number, options: Required<HistogramBuildOptions>): number {
  if (options.xAxis === 'linear') {
    return value;
  }
  return Math.log2(value / options.evReference);
}

function collectHistogramPositiveCounts(histogram: HistogramData): number[] {
  const positiveValues: number[] = [];

  if (histogram.channelBins && histogram.channelNonPositiveCounts) {
    pushPositiveCounts(positiveValues, histogram.channelBins.r);
    pushPositiveCounts(positiveValues, histogram.channelBins.g);
    pushPositiveCounts(positiveValues, histogram.channelBins.b);
    pushPositiveCount(positiveValues, histogram.channelNonPositiveCounts.r);
    pushPositiveCount(positiveValues, histogram.channelNonPositiveCounts.g);
    pushPositiveCount(positiveValues, histogram.channelNonPositiveCounts.b);
    return positiveValues;
  }

  pushPositiveCounts(positiveValues, histogram.bins);
  pushPositiveCount(positiveValues, histogram.nonPositiveCount);
  return positiveValues;
}

function pushPositiveCounts(output: number[], bins: Float32Array): void {
  for (let i = 0; i < bins.length; i += 1) {
    pushPositiveCount(output, bins[i]);
  }
}

function pushPositiveCount(output: number[], value: number): void {
  if (value > 0) {
    output.push(value);
  }
}

function createEmptyHistogramData(
  mode: HistogramMode,
  options: Required<HistogramBuildOptions>
): HistogramData {
  const emptyBins = new Float32Array(options.bins);
  return {
    mode,
    xAxis: options.xAxis,
    bins: emptyBins,
    nonPositiveCount: 0,
    channelBins:
      mode === 'rgb'
        ? {
            r: new Float32Array(options.bins),
            g: new Float32Array(options.bins),
            b: new Float32Array(options.bins)
          }
        : null,
    channelNonPositiveCounts: mode === 'rgb' ? { r: 0, g: 0, b: 0 } : null,
    min: createFallbackHistogramDomain(options.xAxis).min,
    max: createFallbackHistogramDomain(options.xAxis).max,
    mean: 0,
    channelMeans: mode === 'rgb' ? { r: 0, g: 0, b: 0 } : null,
    evReference: options.evReference
  };
}

function createFallbackHistogramDomain(xAxis: HistogramXAxisMode): { min: number; max: number } {
  if (xAxis === 'ev') {
    return { min: -1, max: 1 };
  }
  return { min: 0, max: 1 };
}

export function samePixel(a: ImagePixel | null, b: ImagePixel | null): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.ix === b.ix && a.iy === b.iy;
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

function computeStokesDisplayValue(
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

  return 0;
}

function computeStokesDegreeModulationValue(
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

  return null;
}

function computeStokesDegreeModulationDisplayValue(
  parameter: StokesParameter,
  s0: number,
  s1: number,
  s2: number,
  s3: number
): number | null {
  const value = computeStokesDegreeModulationValue(parameter, s0, s1, s2, s3);
  return value === null ? null : clampStokesDegreeModulationValue(value);
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

function resolveRgbStokesSplitComponent(
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

export function resolveAlphaChannelForMapping(
  channelNames: string[],
  mapping: Pick<DisplayChannelMapping, 'displayR' | 'displayG' | 'displayB'>
): string | null {
  const channels = new Set(channelNames);
  const group = findSelectedRgbGroup(
    extractRgbChannelGroups(channelNames),
    mapping.displayR,
    mapping.displayG,
    mapping.displayB
  );
  if (group) {
    return group.a ?? null;
  }

  if (
    mapping.displayR !== mapping.displayG ||
    mapping.displayR !== mapping.displayB ||
    mapping.displayR === ZERO_CHANNEL
  ) {
    return null;
  }

  const sourceChannel = mapping.displayR;
  if (isAlphaChannel(sourceChannel)) {
    return null;
  }

  const parsed = parseRgbChannel(sourceChannel);
  if (parsed?.base) {
    const alphaChannel = `${parsed.base}.A`;
    return channels.has(alphaChannel) ? alphaChannel : null;
  }

  if (sourceChannel.includes('.')) {
    const dotIndex = sourceChannel.lastIndexOf('.');
    const alphaChannel = `${sourceChannel.slice(0, dotIndex)}.A`;
    return channels.has(alphaChannel) ? alphaChannel : null;
  }

  return channels.has('A') ? 'A' : null;
}

function buildRgbGroupLabel(base: string, hasAlpha: boolean): string {
  const channelsLabel = hasAlpha ? 'R,G,B,A' : 'R,G,B';
  return base.length > 0 ? `${base}.(${channelsLabel})` : channelsLabel;
}

function buildSingleChannelDisplayOption(
  channelName: string,
  channelNames: string[],
  labelOverride?: string,
  includeAlphaCompanion = true
): ChannelDisplayOption {
  const mapping = {
    displayR: channelName,
    displayG: channelName,
    displayB: channelName
  };
  const displayA = includeAlphaCompanion ? resolveAlphaChannelForMapping(channelNames, mapping) : null;

  return {
    key: `channel:${channelName}`,
    label: labelOverride ?? (displayA ? `${channelName},${displayA}` : channelName),
    mapping: {
      ...mapping,
      displayA
    }
  };
}

function pickGrayscaleDisplayChannel(channelNames: string[]): string | null {
  if (channelNames.length === 1) {
    return channelNames[0] ?? null;
  }

  const nonAlphaChannels = channelNames.filter((channelName) => !isAlphaChannel(channelName));
  return nonAlphaChannels.length === 1 ? nonAlphaChannels[0] ?? null : null;
}

function isAlphaChannel(channelName: string): boolean {
  return channelName === 'A' || channelName.endsWith('.A');
}
