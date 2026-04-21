import { cloneDisplaySelection } from '../display-model';
import {
  buildChannelDisplayOptions,
  extractRgbChannelGroups,
  findMergedSelectionForSplitDisplay,
  findSelectedChannelDisplayOption,
  findSplitSelectionForMergedDisplay
} from '../display-selection';
import {
  findSelectedStokesDisplayOption,
  getStokesDisplayOptions
} from '../stokes';
import type { DisplayChannelMapping, DisplaySelection } from '../types';
import type { ChannelPanelElements } from './elements';
import {
  applyListboxRowSizing,
  createEmptyListMessage,
  findClosestListRow,
  focusSelectedImageBrowserRow,
  handleImageBrowserListKeyDown,
  isFocusWithinElement,
  renderKeyedChildren,
  syncSelectOptions
} from './render-helpers';

const CHANNEL_OPTIONS_MAX_VISIBLE_ROWS = 10;

interface ChannelPanelCallbacks {
  onRgbGroupChange: (mapping: DisplaySelection) => void;
}

interface ChannelViewRowItem {
  value: string;
  label: string;
  meta: string;
  swatches: string[];
}

export class ChannelPanel {
  private readonly rgbGroupMappings = new Map<string, DisplaySelection>();
  private isLoading = false;
  private isRgbViewLoading = false;
  private hasActiveImage = false;
  private restoreRgbGroupFocusAfterLoading = false;
  private restoreChannelViewFocusAfterLoading = false;
  private hasRgbGroups = false;
  private hasRgbSplitOptions = false;
  private includeSplitRgbChannels = false;
  private currentRgbChannelNames: string[] = [];
  private currentRgbSelection: DisplaySelection | null = null;
  private channelViewItems: ChannelViewRowItem[] = [];

  constructor(
    private readonly elements: ChannelPanelElements,
    private readonly callbacks: ChannelPanelCallbacks
  ) {
    this.elements.rgbSplitToggleButton.disabled = true;
    this.elements.rgbGroupSelect.disabled = true;

    this.elements.rgbSplitToggleButton.addEventListener('click', () => {
      if (this.elements.rgbSplitToggleButton.disabled) {
        return;
      }

      this.includeSplitRgbChannels = !this.includeSplitRgbChannels;
      this.updateRgbSplitToggleState();

      const selection = this.currentRgbSelection;
      if (!selection) {
        return;
      }

      this.setRgbGroupOptions(this.currentRgbChannelNames, selection);
    });

    const onRgbGroupSelect = (event: Event): void => {
      const target = event.currentTarget as HTMLSelectElement;
      this.chooseChannelViewValue(target.value);
    };
    this.elements.rgbGroupSelect.addEventListener('change', onRgbGroupSelect);
    this.elements.rgbGroupSelect.addEventListener('input', onRgbGroupSelect);
    this.elements.rgbGroupSelect.addEventListener('keydown', (event) => {
      if (this.elements.rgbGroupSelect.disabled) {
        return;
      }

      const options = this.elements.rgbGroupSelect.options;
      if (options.length === 0) {
        return;
      }

      const currentIndex = Math.max(0, this.elements.rgbGroupSelect.selectedIndex);
      let nextIndex = currentIndex;
      const key = event.key;
      const keyCode = event.keyCode;

      if (key === 'ArrowUp' || key === 'Up' || keyCode === 38) {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (key === 'ArrowDown' || key === 'Down' || keyCode === 40) {
        nextIndex = Math.min(options.length - 1, currentIndex + 1);
      } else if (key === 'Home' || keyCode === 36) {
        nextIndex = 0;
      } else if (key === 'End' || keyCode === 35) {
        nextIndex = options.length - 1;
      } else {
        return;
      }

      if (nextIndex === currentIndex) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      this.elements.rgbGroupSelect.selectedIndex = nextIndex;
      const mapping = this.rgbGroupMappings.get(this.elements.rgbGroupSelect.value);
      if (!mapping) {
        return;
      }
      this.currentRgbSelection = cloneDisplaySelection(mapping);
      this.renderChannelViewRows();
      this.callbacks.onRgbGroupChange(mapping);
    });

    this.elements.channelViewList.addEventListener('click', (event) => {
      const row = findClosestListRow(event.target, 'channelValue');
      if (!row || this.elements.rgbGroupSelect.disabled) {
        return;
      }

      this.chooseChannelViewValue(row.dataset.channelValue ?? '');
    });
    this.elements.channelViewList.addEventListener('keydown', (event) => {
      handleImageBrowserListKeyDown(event, this.elements.channelViewList, (row) => {
        if (this.elements.rgbGroupSelect.disabled) {
          return;
        }
        this.chooseChannelViewValue(row.dataset.channelValue ?? '');
      });
    });
  }

  setLoading(loading: boolean): void {
    if (loading) {
      this.restoreRgbGroupFocusAfterLoading = document.activeElement === this.elements.rgbGroupSelect;
      this.restoreChannelViewFocusAfterLoading = isFocusWithinElement(this.elements.channelViewList);
    }

    this.isLoading = loading;
    this.elements.rgbGroupSelect.disabled = loading || !this.hasRgbGroups;
    this.renderChannelViewRows();
    this.updateRgbSplitToggleState();

    if (!loading && this.restoreRgbGroupFocusAfterLoading && !this.elements.rgbGroupSelect.disabled) {
      this.elements.rgbGroupSelect.focus();
    }
    if (!loading) {
      if (this.restoreChannelViewFocusAfterLoading) {
        focusSelectedImageBrowserRow(this.elements.channelViewList);
      }
      this.restoreRgbGroupFocusAfterLoading = false;
      this.restoreChannelViewFocusAfterLoading = false;
    }
  }

  setRgbViewLoading(loading: boolean): void {
    this.isRgbViewLoading = loading;
    this.updateRgbSplitToggleState();
  }

  setRgbGroupOptions(channelNames: string[], selected: DisplaySelection | null): void {
    this.hasActiveImage = true;
    const hadFocus = document.activeElement === this.elements.rgbGroupSelect;
    const nextChannelNames = [...channelNames];
    const expandedSelection = this.includeSplitRgbChannels
      ? findSplitSelectionForMergedDisplay(nextChannelNames, selected)
      : null;
    const collapsedSelection = !this.includeSplitRgbChannels
      ? findMergedSelectionForSplitDisplay(nextChannelNames, selected)
      : null;
    const effectiveSelected = expandedSelection ?? collapsedSelection ?? selected;
    const rgbGroups = extractRgbChannelGroups(nextChannelNames);
    const channelOptions = buildChannelDisplayOptions(nextChannelNames, {
      includeRgbGroups: !this.includeSplitRgbChannels,
      includeSplitChannels: this.includeSplitRgbChannels
    });
    const stokesOptions = getStokesDisplayOptions(nextChannelNames, {
      includeRgbGroups: !this.includeSplitRgbChannels,
      includeSplitChannels: this.includeSplitRgbChannels
    });
    const selectedChannelOption = findSelectedChannelDisplayOption(channelOptions, effectiveSelected);
    const selectedStokesOption = findSelectedStokesDisplayOption(stokesOptions, effectiveSelected);
    const optionCount = channelOptions.length + stokesOptions.length;

    this.currentRgbChannelNames = nextChannelNames;
    this.currentRgbSelection = cloneDisplaySelection(effectiveSelected);
    this.hasRgbGroups = optionCount > 0;
    this.hasRgbSplitOptions = rgbGroups.length > 0;
    this.updateRgbSplitToggleState();
    this.rgbGroupMappings.clear();
    this.channelViewItems = [];
    applyListboxRowSizing(this.elements.rgbGroupSelect, optionCount, CHANNEL_OPTIONS_MAX_VISIBLE_ROWS);

    let selectedValue = '';
    const selectOptions: Array<{ value: string; label: string }> = [];

    channelOptions.forEach((channelOption, index) => {
      const value = `channels-${index}`;
      this.rgbGroupMappings.set(value, channelOption.selection);
      selectOptions.push({
        value,
        label: channelOption.label
      });
      this.channelViewItems.push(createChannelViewRowItem(value, channelOption.label, channelOption.mapping));

      if (selectedChannelOption && selectedChannelOption.key === channelOption.key) {
        selectedValue = value;
      }
      if (!selectedValue) {
        selectedValue = value;
      }
    });

    stokesOptions.forEach((stokesOption, index) => {
      const value = `stokes-${index}`;
      this.rgbGroupMappings.set(value, stokesOption.selection);
      selectOptions.push({
        value,
        label: stokesOption.label
      });
      this.channelViewItems.push(createChannelViewRowItem(value, stokesOption.label, stokesOption.mapping));

      if (selectedStokesOption && selectedStokesOption.key === stokesOption.key) {
        selectedValue = value;
      }
      if (!selectedValue) {
        selectedValue = value;
      }
    });

    syncSelectOptions(this.elements.rgbGroupSelect, selectOptions);
    this.elements.rgbGroupSelect.value = selectedValue;
    this.elements.rgbGroupSelect.disabled = this.isLoading || !this.hasRgbGroups;
    this.renderChannelViewRows();
    if (hadFocus && !this.elements.rgbGroupSelect.disabled) {
      this.elements.rgbGroupSelect.focus();
    }

    const remappedSelection = expandedSelection ?? collapsedSelection;
    if (remappedSelection) {
      this.callbacks.onRgbGroupChange(remappedSelection);
    }
  }

  clearForNoImage(): void {
    this.hasActiveImage = false;
    this.hasRgbGroups = false;
    this.hasRgbSplitOptions = false;
    this.currentRgbChannelNames = [];
    this.currentRgbSelection = null;
    this.channelViewItems = [];
    this.rgbGroupMappings.clear();
    syncSelectOptions(this.elements.rgbGroupSelect, []);
    applyListboxRowSizing(this.elements.rgbGroupSelect, 0, CHANNEL_OPTIONS_MAX_VISIBLE_ROWS);
    this.elements.rgbGroupSelect.disabled = true;
    this.renderChannelViewRows();
    this.updateRgbSplitToggleState();
  }

  private renderChannelViewRows(): void {
    const disabled = this.isLoading || !this.hasRgbGroups;
    const shouldRestoreFocus = !disabled && isFocusWithinElement(this.elements.channelViewList);
    this.elements.channelViewCount.textContent = String(this.channelViewItems.length);
    this.elements.channelViewList.classList.toggle('is-disabled', disabled);

    if (this.channelViewItems.length === 0) {
      if (this.hasActiveImage) {
        this.elements.channelViewList.replaceChildren(createEmptyListMessage('No channels'));
      } else {
        this.elements.channelViewList.replaceChildren();
      }
      return;
    }

    const selectedValue = this.elements.rgbGroupSelect.value;
    renderKeyedChildren(
      this.elements.channelViewList,
      this.channelViewItems,
      (item) => item.value,
      (item, existing) => {
        const row =
          existing && existing instanceof HTMLButtonElement
            ? existing
            : createChannelViewRow();

        updateChannelViewRow(row, {
          value: item.value,
          label: item.label,
          meta: item.meta,
          swatches: item.swatches,
          selected: item.value === selectedValue,
          disabled
        });
        return row;
      }
    );

    if (shouldRestoreFocus) {
      focusSelectedImageBrowserRow(this.elements.channelViewList);
    }
  }

  private chooseChannelViewValue(value: string): void {
    if (!value || this.elements.rgbGroupSelect.disabled) {
      return;
    }

    const mapping = this.rgbGroupMappings.get(value);
    if (!mapping) {
      return;
    }

    this.elements.rgbGroupSelect.value = value;
    this.currentRgbSelection = cloneDisplaySelection(mapping);
    this.renderChannelViewRows();
    this.callbacks.onRgbGroupChange(mapping);
  }

  private updateRgbSplitToggleState(): void {
    this.elements.rgbSplitToggleButton.classList.toggle('hidden', !this.hasRgbSplitOptions);
    this.elements.rgbSplitToggleButton.disabled =
      this.isLoading || this.isRgbViewLoading || !this.hasRgbSplitOptions;
    this.elements.rgbSplitToggleButton.setAttribute(
      'aria-pressed',
      this.includeSplitRgbChannels ? 'true' : 'false'
    );
  }
}

function createChannelViewRow(): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'image-browser-row channel-view-row';

  const icon = document.createElement('span');
  icon.className = 'channel-view-icon';
  icon.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'image-browser-row-label';

  const meta = document.createElement('span');
  meta.className = 'image-browser-row-meta';

  row.append(icon, label, meta);
  return row;
}

function updateChannelViewRow(
  row: HTMLButtonElement,
  options: {
    value: string;
    label: string;
    meta: string;
    swatches: string[];
    selected: boolean;
    disabled: boolean;
  }
): void {
  row.dataset.channelValue = options.value;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', options.selected ? 'true' : 'false');
  row.setAttribute('aria-disabled', options.disabled ? 'true' : 'false');
  row.disabled = options.disabled;

  const icon = row.querySelector<HTMLElement>('.channel-view-icon');
  const label = row.querySelector<HTMLElement>('.image-browser-row-label');
  const meta = row.querySelector<HTMLElement>('.image-browser-row-meta');

  if (icon) {
    icon.replaceChildren(...buildChannelViewSwatches(options.swatches));
  }
  if (label) {
    label.textContent = options.label;
  }
  if (meta) {
    meta.textContent = options.meta;
  }
}

function buildChannelViewSwatches(swatches: string[]): HTMLElement[] {
  const colors = swatches.length > 0 ? swatches.slice(0, 3) : ['#9aa4b4'];
  return colors.map((swatchColor) => {
    const swatch = document.createElement('span');
    swatch.className = 'channel-view-swatch';
    swatch.style.backgroundColor = swatchColor;
    return swatch;
  });
}

function createChannelViewRowItem(
  value: string,
  label: string,
  mapping: DisplayChannelMapping
): ChannelViewRowItem {
  const precisionCount = getDisplayMappingChannelCount(mapping);
  return {
    value,
    label: formatChannelViewLabel(label),
    meta: precisionCount > 1 ? `32f x ${precisionCount}` : '32f',
    swatches: getChannelViewSwatches(mapping)
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

function getDisplayMappingChannelCount(mapping: DisplayChannelMapping): number {
  return new Set([
    mapping.displayR,
    mapping.displayG,
    mapping.displayB,
    ...(mapping.displayA ? [mapping.displayA] : [])
  ]).size;
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
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}
