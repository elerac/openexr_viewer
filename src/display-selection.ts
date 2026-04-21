import {
  buildRgbStokesGroupMapping,
  buildRgbStokesSplitMapping,
  detectRgbStokesChannels,
  isStokesDisplayAvailable,
  isStokesDisplaySelection,
  resolveRgbStokesSplitComponent
} from './stokes';
import {
  DisplayChannelMapping,
  DisplaySelection,
  ZERO_CHANNEL
} from './types';

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

type RgbSuffix = 'R' | 'G' | 'B' | 'A';

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
      displayB: firstGroup.b
    };
    return {
      ...mapping,
      displayA: firstGroup.a ?? null
    };
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
    if (
      selectedChannel !== group.r &&
      selectedChannel !== group.g &&
      selectedChannel !== group.b &&
      selectedChannel !== group.a
    ) {
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
