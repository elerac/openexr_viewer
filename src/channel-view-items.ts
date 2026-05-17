import { cloneDisplaySelection, sameDisplaySelection, serializeDisplaySelectionKey, type DisplaySelection } from './display-model';
import {
  buildChannelDisplayOptions,
  findMergedSelectionForSplitDisplay,
  findSplitSelectionForMergedDisplay
} from './display-selection';
import { getStokesDisplayOptions } from './stokes';
import { getSpectralRgbDisplayOptions, getSpectralRgbSplitChannelNames } from './spectral';
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

export interface ChannelViewStackInfo {
  key: string;
  parentValue: string;
  childValues: string[];
}

export interface ChannelViewStackPresentation {
  key: string;
  parentValue: string;
  childValues: string[];
  role: 'parent' | 'child';
  index: number;
  count: number;
}

export type ChannelViewStackedItem<T extends ChannelViewItem = ChannelViewItem> = T & {
  stack: ChannelViewStackPresentation | null;
};

export type ChannelViewStackedThumbnailItem = ChannelViewStackedItem<ChannelViewThumbnailItem>;

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

export function buildChannelViewStacks(
  channelNames: string[],
  items: readonly ChannelViewItem[]
): ChannelViewStackInfo[] {
  const splitItems = selectVisibleChannelViewItems(items, true);
  const stacks: ChannelViewStackInfo[] = [];

  for (const parent of selectVisibleChannelViewItems(items, false)) {
    const firstSplitSelection = findSplitSelectionForMergedDisplay(channelNames, parent.selection);
    if (!firstSplitSelection) {
      continue;
    }

    const childItems = splitItems
      .filter((child) => {
        const mergedSelection = findMergedSelectionForSplitDisplay(channelNames, child.selection);
        return sameDisplaySelection(mergedSelection, parent.selection);
      })
      .sort((a, b) => compareNullableOrder(a.splitOrder, b.splitOrder));

    if (
      childItems.length < 2 ||
      !childItems.some((child) => sameDisplaySelection(child.selection, firstSplitSelection))
    ) {
      continue;
    }

    stacks.push({
      key: `stack:${parent.value}:${parent.selectionKey}`,
      parentValue: parent.value,
      childValues: childItems.map((child) => child.value)
    });
  }

  return stacks;
}

export function selectStackedChannelViewItems<T extends ChannelViewItem>(
  channelNames: string[],
  items: readonly T[],
  expandedStackKeys: ReadonlySet<string>
): ChannelViewStackedItem<T>[] {
  const stacks = buildChannelViewStacks(channelNames, items);
  const stackByParentValue = new Map(stacks.map((stack) => [stack.parentValue, stack]));
  const itemByValue = new Map(items.map((item) => [item.value, item]));
  const visibleItems: ChannelViewStackedItem<T>[] = [];

  for (const item of selectVisibleChannelViewItems(items, false)) {
    const stack = stackByParentValue.get(item.value);
    if (!stack) {
      visibleItems.push(withoutStack(item));
      continue;
    }

    if (!expandedStackKeys.has(stack.key)) {
      visibleItems.push(withStackPresentation(item, stack, 'parent', 0));
      continue;
    }

    stack.childValues.forEach((childValue, index) => {
      const child = itemByValue.get(childValue);
      if (child) {
        visibleItems.push(withStackPresentation(child, stack, 'child', index));
      }
    });
  }

  return visibleItems;
}

export function pruneExpandedChannelStackKeys(
  channelNames: string[],
  items: readonly ChannelViewItem[],
  expandedStackKeys: ReadonlySet<string>
): Set<string> {
  const validStackKeys = new Set(buildChannelViewStacks(channelNames, items).map((stack) => stack.key));
  return new Set([...expandedStackKeys].filter((key) => validStackKeys.has(key)));
}

export function findChannelViewStackForValue(
  channelNames: string[],
  items: readonly ChannelViewItem[],
  value: string
): ChannelViewStackInfo | null {
  return buildChannelViewStacks(channelNames, items).find((stack) => (
    stack.parentValue === value || stack.childValues.includes(value)
  )) ?? null;
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
  const spectralSplitChannelNames = includeSplitRgbChannels
    ? null
    : getSpectralRgbSplitChannelNames(channelNames);
  const channelOptions = buildChannelDisplayOptions(channelNames, {
    includeRgbGroups: !includeSplitRgbChannels,
    includeSplitChannels: includeSplitRgbChannels
  }).filter((option) => (
    includeSplitRgbChannels ||
    option.selection.kind !== 'channelMono' ||
    !spectralSplitChannelNames?.has(option.selection.channel)
  ));
  const stokesOptions = getStokesDisplayOptions(channelNames, {
    includeRgbGroups: !includeSplitRgbChannels,
    includeSplitChannels: includeSplitRgbChannels
  });
  const spectralOptions = includeSplitRgbChannels ? [] : getSpectralRgbDisplayOptions(channelNames);
  return [...channelOptions, ...spectralOptions, ...stokesOptions].map((option) => ({
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

function withoutStack<T extends ChannelViewItem>(item: T): ChannelViewStackedItem<T> {
  return {
    ...item,
    stack: null
  };
}

function withStackPresentation<T extends ChannelViewItem>(
  item: T,
  stack: ChannelViewStackInfo,
  role: ChannelViewStackPresentation['role'],
  index: number
): ChannelViewStackedItem<T> {
  return {
    ...item,
    stack: {
      key: stack.key,
      parentValue: stack.parentValue,
      childValues: [...stack.childValues],
      role,
      index,
      count: stack.childValues.length
    }
  };
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
