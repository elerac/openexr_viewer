import {
  buildRgbStokesLuminanceSelection,
  buildRgbStokesSplitSelection,
  buildScalarStokesSelection,
  buildSpectralStokesRgbSelection,
  detectRgbStokesChannels,
  isStokesDisplayAvailable,
  type StokesParameterVisibilitySettings
} from './stokes';
import {
  buildSpectralRgbSelection,
  detectSpectralStokesChannelGroups,
  findFirstSpectralRgbSplitChannel,
  findSpectralRgbSeriesKeyForChannel,
  isSpectralRgbDisplayAvailable,
  isSpectralStokesRgbDisplayAvailable,
  isSpectralStokesSuffix,
  pickDefaultSpectralRgbSelection
} from './spectral';
import {
  buildMuellerMatrixSelection,
  buildRgbMuellerMatrixSelection,
  detectMuellerMatrixChannelSets,
  detectRgbMuellerMatrixChannels,
  getMuellerMatrixRgbComponentChannels,
  isMuellerMatrixDisplayAvailable
} from './mueller';
import {
  buildRgbGroupLabel,
  type ChannelMonoSelection,
  type ChannelRgbSelection,
  type ChannelSelection,
  type DisplaySelection,
  isAlphaChannel,
  isChannelSelection,
  isGroupedRgbMuellerMatrixSelection,
  isMuellerMatrixSelection,
  isSpectralRgbSelection,
  isStokesSelection,
  parseRgbChannelName,
  sameDisplaySelection
} from './display-model';
import { DisplayChannelMapping } from './types';

export interface RgbChannelGroup {
  key: string;
  label: string;
  r: string;
  g: string;
  b: string;
  a?: string;
}

type ComponentChannelGroupKind = 'rgb' | 'xyz' | 'uv';

interface ComponentChannelGroup {
  kind: ComponentChannelGroupKind;
  optionKey: string;
  key: string;
  label: string;
  r: string;
  g: string;
  b: string | null;
  a?: string;
}

export interface ChannelDisplayOption {
  key: string;
  label: string;
  selection: ChannelSelection;
  mapping: DisplayChannelMapping;
}

export interface ChannelDisplayOptionsConfig {
  includeRgbGroups?: boolean;
  includeSplitChannels?: boolean;
  includeAlphaCompanions?: boolean;
}

export interface DisplaySelectionAvailabilityConfig {
  stokesParameterVisibility?: StokesParameterVisibilitySettings;
  spectralRgbGroupingEnabled?: boolean;
}

export function pickDefaultDisplaySelection(
  channelNames: string[],
  config: DisplaySelectionAvailabilityConfig = {}
): DisplaySelection | null {
  const names = [...channelNames];
  const rgbGroups = extractRgbChannelGroups(names);
  const componentGroups = extractComponentChannelGroups(names);
  const nonMuellerRgbGroups = rgbGroups.filter((group) => !isMuellerMatrixElementName(group.key));
  if (nonMuellerRgbGroups.length > 0) {
    return buildChannelRgbSelection(nonMuellerRgbGroups[0]!);
  }

  const rgbMuellerChannels = detectRgbMuellerMatrixChannels(names);
  if (rgbMuellerChannels) {
    return buildRgbMuellerMatrixSelection();
  }

  if (rgbGroups.length > 0) {
    return buildChannelRgbSelection(rgbGroups[0]!);
  }

  const nonRgbComponentGroup = componentGroups.find((group) => group.kind !== 'rgb');
  if (nonRgbComponentGroup) {
    return buildChannelRgbSelection(nonRgbComponentGroup);
  }

  if (config.spectralRgbGroupingEnabled !== false) {
    const spectralRgbSelection = pickDefaultSpectralRgbSelection(names);
    if (spectralRgbSelection) {
      return spectralRgbSelection;
    }
  }

  const preferredMonoChannel = pickPreferredMonoDisplayChannel(names);
  if (preferredMonoChannel) {
    return buildChannelMonoSelection(channelNames, preferredMonoChannel);
  }

  const grayscaleChannel = pickGrayscaleDisplayChannel(names);
  if (grayscaleChannel) {
    return buildChannelMonoSelection(channelNames, grayscaleChannel);
  }

  const muellerChannels = detectMuellerMatrixChannelSets(names);
  if (muellerChannels.length > 0) {
    return buildMuellerMatrixSelection(muellerChannels[0]?.suffix ?? null);
  }

  const fallbackChannel = names.find((channelName) => !isAlphaChannel(channelName)) ?? names[0] ?? null;
  return fallbackChannel ? buildChannelMonoSelection(channelNames, fallbackChannel) : null;
}

export function resolveDisplaySelectionForLayer(
  channelNames: string[],
  currentSelection: DisplaySelection | null,
  config: DisplaySelectionAvailabilityConfig = {}
): DisplaySelection | null {
  if (!currentSelection) {
    return pickDefaultDisplaySelection(channelNames, config);
  }

  if (isChannelSelection(currentSelection)) {
    const normalized = normalizeChannelSelection(channelNames, currentSelection);
    return normalized ?? pickDefaultDisplaySelection(channelNames, config);
  }

  if (isStokesSelection(currentSelection)) {
    return isStokesDisplayAvailable(
      channelNames,
      currentSelection,
      config.stokesParameterVisibility,
      config.spectralRgbGroupingEnabled !== false
    )
      ? currentSelection
      : pickDefaultDisplaySelection(channelNames, config);
  }

  if (isSpectralRgbSelection(currentSelection)) {
    return config.spectralRgbGroupingEnabled !== false && isSpectralRgbDisplayAvailable(channelNames, currentSelection)
      ? currentSelection
      : pickDefaultDisplaySelection(channelNames, config);
  }

  if (isMuellerMatrixSelection(currentSelection)) {
    return isMuellerMatrixDisplayAvailable(channelNames, currentSelection)
      ? currentSelection
      : pickDefaultDisplaySelection(channelNames, config);
  }

  return pickDefaultDisplaySelection(channelNames, config);
}

export function extractRgbChannelGroups(channelNames: string[]): RgbChannelGroup[] {
  const grouped = new Map<string, Partial<Record<'R' | 'G' | 'B' | 'A', string>>>();

  for (const channelName of channelNames) {
    const parsed = parseRgbChannelName(channelName);
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
  const groupedComponentChannels = new Set<string>();
  const consumedAlphaChannels = new Set<string>();
  const singleChannelOptions = new Set<string>();

  const pushSingleChannelOption = (channelName: string, labelOverride?: string): void => {
    if (singleChannelOptions.has(channelName)) {
      return;
    }

    singleChannelOptions.add(channelName);
    options.push(buildSingleChannelDisplayOption(channelName, channelNames, labelOverride, includeAlphaCompanions));
  };

  for (const group of extractComponentChannelGroups(channelNames)) {
    groupedComponentChannels.add(group.r);
    groupedComponentChannels.add(group.g);
    if (group.b) {
      groupedComponentChannels.add(group.b);
    }
    if (group.a) {
      groupedComponentChannels.add(group.a);
      consumedAlphaChannels.add(group.a);
    }

    if (includeRgbGroups) {
      options.push({
        key: group.optionKey,
        label: group.label,
        selection: buildChannelRgbSelection(group),
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
      if (group.b) {
        pushSingleChannelOption(group.b, group.b);
      }
      if (group.a) {
        pushSingleChannelOption(group.a, group.a);
      }
    }
  }

  for (const channelName of channelNames) {
    if (!includeAlphaCompanions || groupedComponentChannels.has(channelName) || isAlphaChannel(channelName)) {
      continue;
    }

    const alphaChannel = resolveAlphaChannelForChannel(channelNames, channelName);
    if (alphaChannel) {
      consumedAlphaChannels.add(alphaChannel);
    }
  }

  for (const channelName of orderSingleChannelNames(channelNames)) {
    if (groupedComponentChannels.has(channelName) || consumedAlphaChannels.has(channelName)) {
      continue;
    }

    const option = buildSingleChannelDisplayOption(channelName, channelNames, undefined, includeAlphaCompanions);
    if (option.selection.alpha) {
      consumedAlphaChannels.add(option.selection.alpha);
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
  selected: DisplaySelection | null
): ChannelDisplayOption | null {
  if (!isChannelSelection(selected)) {
    return null;
  }

  return options.find((option) => sameDisplaySelection(option.selection, selected)) ?? null;
}

export function findMergedSelectionForSplitDisplay(
  channelNames: string[],
  selected: DisplaySelection | null
): DisplaySelection | null {
  if (!selected) {
    return null;
  }

  const spectralSelection = findMergedSelectionForSplitSpectralChannel(channelNames, selected);
  if (spectralSelection) {
    return spectralSelection;
  }

  const channelSelection = findMergedSelectionForSplitChannel(channelNames, selected);
  if (channelSelection) {
    return channelSelection;
  }

  const spectralStokesSelection = findMergedSelectionForSplitSpectralStokes(channelNames, selected);
  if (spectralStokesSelection) {
    return spectralStokesSelection;
  }

  if (
    isMuellerMatrixSelection(selected) &&
    !selected.rgb &&
    isMuellerMatrixRgbComponentSuffix(selected.suffix)
  ) {
    return detectRgbMuellerMatrixChannels(channelNames)
      ? buildRgbMuellerMatrixSelection()
      : null;
  }

  if (!isStokesSelection(selected) || selected.source.kind !== 'rgbComponent') {
    return null;
  }

  return detectRgbStokesChannels(channelNames)
    ? buildRgbStokesLuminanceSelection(selected.parameter)
    : null;
}

export function findSplitSelectionForMergedDisplay(
  channelNames: string[],
  selected: DisplaySelection | null
): DisplaySelection | null {
  if (!selected) {
    return null;
  }

  const channelSelection = findSplitSelectionForMergedGroup(channelNames, selected);
  if (channelSelection) {
    return channelSelection;
  }

  const spectralSelection = findSplitSelectionForMergedSpectralRgb(channelNames, selected);
  if (spectralSelection) {
    return spectralSelection;
  }

  const spectralStokesSelection = findSplitSelectionForMergedSpectralStokes(channelNames, selected);
  if (spectralStokesSelection) {
    return spectralStokesSelection;
  }

  if (isGroupedRgbMuellerMatrixSelection(selected)) {
    const channels = detectRgbMuellerMatrixChannels(channelNames);
    return channels
      ? buildMuellerMatrixSelection(getMuellerMatrixRgbComponentChannels(channels, 'R').suffix ?? null)
      : null;
  }

  if (!isStokesSelection(selected) || selected.source.kind !== 'rgbLuminance') {
    return null;
  }

  return detectRgbStokesChannels(channelNames)
    ? buildRgbStokesSplitSelection(selected.parameter, 'R')
    : null;
}

export function resolveAlphaChannelForChannel(channelNames: string[], channelName: string): string | null {
  const channels = new Set(channelNames);

  if (isAlphaChannel(channelName)) {
    return null;
  }

  const parsed = parseRgbChannelName(channelName);
  if (parsed?.base) {
    const alphaChannel = `${parsed.base}.A`;
    return channels.has(alphaChannel) ? alphaChannel : null;
  }

  if (channelName.includes('.')) {
    const dotIndex = channelName.lastIndexOf('.');
    const alphaChannel = `${channelName.slice(0, dotIndex)}.A`;
    return channels.has(alphaChannel) ? alphaChannel : null;
  }

  return channels.has('A') ? 'A' : null;
}

function normalizeChannelSelection(
  channelNames: string[],
  selection: ChannelSelection
): ChannelSelection | null {
  if (selection.kind === 'channelMono') {
    return channelNames.includes(selection.channel)
      ? buildChannelMonoSelection(channelNames, selection.channel)
      : null;
  }

  const group = findSelectedComponentChannelGroup(
    extractComponentChannelGroups(channelNames),
    selection.r,
    selection.g,
    selection.b
  );
  return group ? buildChannelRgbSelection(group) : null;
}

function findMergedSelectionForSplitChannel(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  if (!isChannelSelection(selected) || selected.kind !== 'channelMono') {
    return null;
  }

  const selectedChannel = selected.channel;
  for (const group of extractComponentChannelGroups(channelNames)) {
    if (
      selectedChannel !== group.r &&
      selectedChannel !== group.g &&
      selectedChannel !== group.b &&
      selectedChannel !== group.a
    ) {
      continue;
    }

    return buildChannelRgbSelection(group);
  }

  const alphaChannel = resolveAlphaChannelForChannel(channelNames, selectedChannel);
  return alphaChannel
    ? { kind: 'channelMono', channel: selectedChannel, alpha: alphaChannel }
    : null;
}

function findMergedSelectionForSplitSpectralChannel(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  if (!isChannelSelection(selected) || selected.kind !== 'channelMono') {
    return null;
  }

  const seriesKey = findSpectralRgbSeriesKeyForChannel(channelNames, selected.channel);
  return seriesKey === null ? null : buildSpectralRgbSelection(seriesKey);
}

function findMergedSelectionForSplitSpectralStokes(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  if (
    !isStokesSelection(selected) ||
    selected.source.kind !== 'scalar' ||
    !selected.source.suffix ||
    !isSpectralStokesSuffix(selected.source.suffix) ||
    !isSpectralStokesRgbDisplayAvailable(channelNames)
  ) {
    return null;
  }

  return buildSpectralStokesRgbSelection(selected.parameter);
}

function findSplitSelectionForMergedGroup(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  if (!isChannelSelection(selected)) {
    return null;
  }

  if (selected.kind === 'channelRgb') {
    for (const group of extractComponentChannelGroups(channelNames)) {
      if (selected.r !== group.r || selected.g !== group.g || selected.b !== group.b) {
        continue;
      }

      return {
        kind: 'channelMono',
        channel: group.r,
        alpha: null
      };
    }

    return null;
  }

  if (selected.alpha) {
    return {
      kind: 'channelMono',
      channel: selected.channel,
      alpha: null
    };
  }

  return null;
}

function findSplitSelectionForMergedSpectralRgb(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  if (!isSpectralRgbSelection(selected)) {
    return null;
  }

  const channel = findFirstSpectralRgbSplitChannel(channelNames, selected.seriesKey);
  return channel
    ? {
        kind: 'channelMono',
        channel,
        alpha: null
      }
    : null;
}

function findSplitSelectionForMergedSpectralStokes(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  if (
    !isStokesSelection(selected) ||
    selected.source.kind !== 'spectralRgb' ||
    !isSpectralStokesRgbDisplayAvailable(channelNames)
  ) {
    return null;
  }

  const suffix = detectSpectralStokesChannelGroups(channelNames)[0]?.suffix ?? null;
  return suffix ? buildScalarStokesSelection(selected.parameter, suffix) : null;
}

function buildChannelRgbSelection(group: Pick<ComponentChannelGroup, 'r' | 'g' | 'b' | 'a'>): ChannelRgbSelection {
  return {
    kind: 'channelRgb',
    r: group.r,
    g: group.g,
    b: group.b,
    alpha: group.a ?? null
  };
}

function buildChannelMonoSelection(channelNames: string[], channelName: string): ChannelMonoSelection {
  return {
    kind: 'channelMono',
    channel: channelName,
    alpha: resolveAlphaChannelForChannel(channelNames, channelName)
  };
}

function buildSingleChannelDisplayOption(
  channelName: string,
  channelNames: string[],
  labelOverride?: string,
  includeAlphaCompanion = true
): ChannelDisplayOption {
  const selection: ChannelMonoSelection = {
    kind: 'channelMono',
    channel: channelName,
    alpha: includeAlphaCompanion ? resolveAlphaChannelForChannel(channelNames, channelName) : null
  };

  return {
    key: `channel:${channelName}`,
    label: labelOverride ?? (selection.alpha ? `${channelName},${selection.alpha}` : channelName),
    selection,
    mapping: {
      displayR: channelName,
      displayG: channelName,
      displayB: channelName,
      displayA: selection.alpha
    }
  };
}

function extractComponentChannelGroups(channelNames: string[]): ComponentChannelGroup[] {
  return [
    ...extractRgbChannelGroups(channelNames).map((group): ComponentChannelGroup => ({
      kind: 'rgb',
      optionKey: `group:${group.key}`,
      ...group
    })),
    ...extractVectorChannelGroups(channelNames, 'xyz', ['X', 'Y', 'Z']),
    ...extractVectorChannelGroups(channelNames, 'uv', ['U', 'V'])
  ];
}

function extractVectorChannelGroups(
  channelNames: string[],
  kind: Exclude<ComponentChannelGroupKind, 'rgb'>,
  suffixes: readonly string[]
): ComponentChannelGroup[] {
  const grouped = new Map<string, Partial<Record<string, string>>>();
  const recognizedSuffixes = [...suffixes, 'A'];

  for (const channelName of channelNames) {
    const parsed = parseChannelNameSuffix(channelName, recognizedSuffixes);
    if (!parsed) {
      continue;
    }

    const group = grouped.get(parsed.base) ?? {};
    if (!group[parsed.suffix]) {
      group[parsed.suffix] = channelName;
      grouped.set(parsed.base, group);
    }
  }

  const groups: ComponentChannelGroup[] = [];
  for (const [base, channels] of grouped.entries()) {
    const r = channels[suffixes[0]!];
    const g = channels[suffixes[1]!];
    const bSuffix = suffixes[2] ?? null;
    const b = bSuffix ? channels[bSuffix] ?? null : null;
    if (!r || !g || (bSuffix && !b)) {
      continue;
    }

    groups.push({
      kind,
      optionKey: kind === 'xyz' ? `groupXYZ:${base}` : `groupUV:${base}`,
      key: base,
      label: buildComponentGroupLabel(base, suffixes, Boolean(channels.A)),
      r,
      g,
      b,
      a: channels.A
    });
  }

  groups.sort(compareComponentChannelGroups);
  return groups;
}

function findSelectedComponentChannelGroup(
  groups: ComponentChannelGroup[],
  displayR: string,
  displayG: string,
  displayB: string | null
): ComponentChannelGroup | null {
  return groups.find((group) => group.r === displayR && group.g === displayG && group.b === displayB) ?? null;
}

function compareComponentChannelGroups(a: Pick<ComponentChannelGroup, 'key'>, b: Pick<ComponentChannelGroup, 'key'>): number {
  if (a.key.length === 0) {
    return -1;
  }
  if (b.key.length === 0) {
    return 1;
  }
  return a.key.localeCompare(b.key);
}

function buildComponentGroupLabel(base: string, suffixes: readonly string[], hasAlpha: boolean): string {
  const channelsLabel = [...suffixes, ...(hasAlpha ? ['A'] : [])].join(',');
  return base.length > 0 ? `${base}.(${channelsLabel})` : channelsLabel;
}

function parseChannelNameSuffix<T extends string>(
  channelName: string,
  suffixes: readonly T[]
): { base: string; suffix: T } | null {
  const bareSuffix = suffixes.find((suffix) => channelName === suffix);
  if (bareSuffix) {
    return { base: '', suffix: bareSuffix };
  }

  const dotIndex = channelName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= channelName.length - 1) {
    return null;
  }

  const suffixValue = channelName.slice(dotIndex + 1);
  const suffix = suffixes.find((candidate) => candidate === suffixValue);
  if (!suffix) {
    return null;
  }

  return {
    base: channelName.slice(0, dotIndex),
    suffix
  };
}

function pickGrayscaleDisplayChannel(channelNames: string[]): string | null {
  if (channelNames.length === 1) {
    return channelNames[0] ?? null;
  }

  const nonAlphaChannels = channelNames.filter((channelName) => !isAlphaChannel(channelName));
  return nonAlphaChannels.length === 1 ? nonAlphaChannels[0] ?? null : null;
}

function pickPreferredMonoDisplayChannel(channelNames: string[]): string | null {
  return channelNames.includes('Y') ? 'Y' : null;
}

function orderSingleChannelNames(channelNames: string[]): string[] {
  if (!channelNames.includes('Y')) {
    return channelNames;
  }

  return [
    ...channelNames.filter((channelName) => channelName === 'Y'),
    ...channelNames.filter((channelName) => channelName !== 'Y')
  ];
}

function isMuellerMatrixElementName(value: string): boolean {
  return /^M[0-3][0-3]$/.test(value);
}

function isMuellerMatrixRgbComponentSuffix(value: string | undefined): value is 'R' | 'G' | 'B' {
  return value === 'R' || value === 'G' || value === 'B';
}
