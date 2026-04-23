import { cloneDisplaySelection, sameDisplaySelection, serializeDisplaySelectionKey, type DisplaySelection } from './display-model';
import { buildChannelDisplayOptions } from './display-selection';
import { getStokesDisplayOptions } from './stokes';
import type { DisplayChannelMapping } from './types';

export interface ChannelViewItem {
  value: string;
  label: string;
  meta: string;
  swatches: string[];
  selection: DisplaySelection;
  selectionKey: string;
  mergedOrder: number | null;
  splitOrder: number | null;
}

export interface ChannelViewThumbnailItem extends ChannelViewItem {
  thumbnailDataUrl: string | null;
}

export function buildChannelViewItems(channelNames: string[]): ChannelViewItem[] {
  const mergedItems = buildDisplayItems(channelNames, false);
  const splitItems = buildDisplayItems(channelNames, true);
  const itemsByValue = new Map<string, ChannelViewItem>();
  const buildCollisionKey = (item: Omit<ChannelViewItem, 'mergedOrder' | 'splitOrder'>): string =>
    `${item.value}::${item.selectionKey}`;

  mergedItems.forEach((item, index) => {
    const existing = itemsByValue.get(item.value) ?? itemsByValue.get(buildCollisionKey(item));
    if (existing) {
      existing.mergedOrder = index;
      return;
    }

    itemsByValue.set(item.value, {
      ...item,
      mergedOrder: index,
      splitOrder: null
    });
  });

  splitItems.forEach((item, index) => {
    const existing = itemsByValue.get(item.value);
    if (existing) {
      if (existing.selectionKey !== item.selectionKey) {
        itemsByValue.set(buildCollisionKey(item), {
          ...item,
          value: buildCollisionKey(item),
          mergedOrder: null,
          splitOrder: index
        });
        return;
      }

      existing.splitOrder = index;
      return;
    }

    itemsByValue.set(item.value, {
      ...item,
      mergedOrder: null,
      splitOrder: index
    });
  });

  return Array.from(itemsByValue.values()).sort((a, b) => compareNullableOrder(a.mergedOrder ?? a.splitOrder, b.mergedOrder ?? b.splitOrder));
}

export function selectVisibleChannelViewItems<T extends Pick<ChannelViewItem, 'mergedOrder' | 'splitOrder'>>(
  items: readonly T[],
  includeSplitRgbChannels: boolean
): T[] {
  const visible = items.filter((item) => includeSplitRgbChannels ? item.splitOrder !== null : item.mergedOrder !== null);
  return [...visible].sort((a, b) => compareNullableOrder(
    includeSplitRgbChannels ? a.splitOrder : a.mergedOrder,
    includeSplitRgbChannels ? b.splitOrder : b.mergedOrder
  ));
}

export function hasSplitChannelViewItems(items: readonly Pick<ChannelViewItem, 'mergedOrder' | 'splitOrder'>[]): boolean {
  return items.some((item) => item.mergedOrder === null || item.splitOrder === null);
}

export function findSelectedChannelViewItem<T extends Pick<ChannelViewItem, 'selection'>>(
  items: readonly T[],
  selected: DisplaySelection | null
): T | null {
  if (!selected) {
    return null;
  }

  return items.find((item) => sameDisplaySelection(item.selection, selected)) ?? null;
}

export function getChannelViewSwatches(mapping: DisplayChannelMapping): string[] {
  const displayChannels = [mapping.displayR, mapping.displayG, mapping.displayB];
  if (displayChannels.every((channelName) => channelName === mapping.displayR)) {
    const swatches = [getRepresentativeChannelColor(mapping.displayR)];
    if (mapping.displayA && mapping.displayA !== mapping.displayR) {
      swatches.push(getRepresentativeChannelColor(mapping.displayA));
    }
    return swatches;
  }

  const channels = [
    ...displayChannels,
    ...(mapping.displayA ? [mapping.displayA] : [])
  ];
  const uniqueChannels = Array.from(new Set(channels));
  return uniqueChannels.slice(0, 3).map(getRepresentativeChannelColor);
}

function buildDisplayItems(channelNames: string[], includeSplitRgbChannels: boolean): Omit<ChannelViewItem, 'mergedOrder' | 'splitOrder'>[] {
  const channelOptions = buildChannelDisplayOptions(channelNames, {
    includeRgbGroups: !includeSplitRgbChannels,
    includeSplitChannels: includeSplitRgbChannels
  });
  const stokesOptions = getStokesDisplayOptions(channelNames, {
    includeRgbGroups: !includeSplitRgbChannels,
    includeSplitChannels: includeSplitRgbChannels
  });
  return [...channelOptions, ...stokesOptions].map((option) => ({
    value: option.key,
    label: formatChannelViewLabel(option.label),
    meta: formatChannelViewMeta(option.mapping),
    swatches: getChannelViewSwatches(option.mapping),
    selection: cloneDisplaySelection(option.selection) ?? option.selection,
    selectionKey: serializeDisplaySelectionKey(option.selection)
  }));
}

function compareNullableOrder(a: number | null, b: number | null): number {
  const left = a ?? Number.MAX_SAFE_INTEGER;
  const right = b ?? Number.MAX_SAFE_INTEGER;
  return left - right;
}

function formatChannelViewLabel(label: string): string {
  if (label === 'R,G,B,A') {
    return 'RGBA';
  }
  if (label === 'R,G,B') {
    return 'RGB';
  }

  return label
    .replace(/\.\(R,G,B,A\)/g, '.RGBA')
    .replace(/\.\(R,G,B\)/g, '.RGB');
}

function formatChannelViewMeta(mapping: DisplayChannelMapping): string {
  const precisionCount = getDisplayMappingChannelCount(mapping);
  return precisionCount > 1 ? `32f x ${precisionCount}` : '32f';
}

function getDisplayMappingChannelCount(mapping: DisplayChannelMapping): number {
  return new Set([
    mapping.displayR,
    mapping.displayG,
    mapping.displayB,
    ...(mapping.displayA ? [mapping.displayA] : [])
  ]).size;
}

function getRepresentativeChannelColor(channelName: string): string {
  const suffix = channelName.includes('.') ? channelName.slice(channelName.lastIndexOf('.') + 1) : channelName;
  const normalized = suffix.toUpperCase();
  if (normalized === 'R') {
    return '#ff6570';
  }
  if (normalized === 'G') {
    return '#6bd66f';
  }
  if (normalized === 'B') {
    return '#51aefe';
  }
  if (normalized === 'A') {
    return '#c6cbd2';
  }
  if (normalized === 'Z') {
    return '#8f83e6';
  }
  if (normalized === 'Y' || normalized === 'L') {
    return '#d7dde8';
  }
  if (normalized === 'V') {
    return '#11bfb8';
  }
  if (normalized === 'X' || normalized === 'U') {
    return '#f0b85a';
  }

  const palette = ['#11bfb8', '#b48cf2', '#f0719a', '#8bd36f', '#f0b85a', '#7aa7ff'];
  return palette[Math.abs(hashString(channelName)) % palette.length] ?? '#9aa4b4';
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return hash;
}
