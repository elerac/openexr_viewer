import {
  buildRgbStokesLuminanceSelection,
  buildRgbStokesSplitSelection,
  detectRgbStokesChannels,
  isStokesDisplayAvailable
} from './stokes';
import {
  buildRgbGroupLabel,
  type ChannelMonoSelection,
  type ChannelRgbSelection,
  type ChannelSelection,
  type DisplaySelection,
  isAlphaChannel,
  isChannelSelection,
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

export function pickDefaultDisplaySelection(channelNames: string[]): DisplaySelection | null {
  const names = [...channelNames];
  const rgbGroups = extractRgbChannelGroups(names);
  if (rgbGroups.length > 0) {
    return buildChannelRgbSelection(rgbGroups[0]);
  }

  const grayscaleChannel = pickGrayscaleDisplayChannel(names);
  if (grayscaleChannel) {
    return buildChannelMonoSelection(channelNames, grayscaleChannel);
  }

  const fallbackChannel = names.find((channelName) => !isAlphaChannel(channelName)) ?? names[0] ?? null;
  return fallbackChannel ? buildChannelMonoSelection(channelNames, fallbackChannel) : null;
}

export function resolveDisplaySelectionForLayer(
  channelNames: string[],
  currentSelection: DisplaySelection | null
): DisplaySelection | null {
  if (!currentSelection) {
    return pickDefaultDisplaySelection(channelNames);
  }

  if (isChannelSelection(currentSelection)) {
    const normalized = normalizeChannelSelection(channelNames, currentSelection);
    return normalized ?? pickDefaultDisplaySelection(channelNames);
  }

  return isStokesDisplayAvailable(channelNames, currentSelection)
    ? currentSelection
    : pickDefaultDisplaySelection(channelNames);
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

    const alphaChannel = resolveAlphaChannelForChannel(channelNames, channelName);
    if (alphaChannel) {
      consumedAlphaChannels.add(alphaChannel);
    }
  }

  for (const channelName of channelNames) {
    if (rgbComponentChannels.has(channelName) || consumedAlphaChannels.has(channelName)) {
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

  const channelSelection = findMergedSelectionForSplitChannel(channelNames, selected);
  if (channelSelection) {
    return channelSelection;
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

  const group = findSelectedRgbGroup(
    extractRgbChannelGroups(channelNames),
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
  for (const group of extractRgbChannelGroups(channelNames)) {
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

function findSplitSelectionForMergedGroup(
  channelNames: string[],
  selected: DisplaySelection
): DisplaySelection | null {
  if (!isChannelSelection(selected)) {
    return null;
  }

  if (selected.kind === 'channelRgb') {
    for (const group of extractRgbChannelGroups(channelNames)) {
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

function buildChannelRgbSelection(group: RgbChannelGroup): ChannelRgbSelection {
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

function pickGrayscaleDisplayChannel(channelNames: string[]): string | null {
  if (channelNames.length === 1) {
    return channelNames[0] ?? null;
  }

  const nonAlphaChannels = channelNames.filter((channelName) => !isAlphaChannel(channelName));
  return nonAlphaChannels.length === 1 ? nonAlphaChannels[0] ?? null : null;
}
