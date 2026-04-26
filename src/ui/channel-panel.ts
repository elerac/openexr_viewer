import {
  buildChannelViewItems,
  findSelectedChannelViewItem,
  hasSplitChannelViewItems,
  selectVisibleChannelViewItems,
  type ChannelViewItem
} from '../channel-view-items';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { DisplaySelection } from '../types';
import type { ChannelPanelElements } from './elements';
import {
  applyListboxRowSizing,
  findClosestListRow,
  focusSelectedImageBrowserRow,
  handleImageBrowserListKeyDown,
  isFocusWithinElement,
  renderEmptyListMessage,
  renderKeyedChildren,
  syncSelectOptions
} from './render-helpers';

const CHANNEL_OPTIONS_MAX_VISIBLE_ROWS = 10;

interface ChannelPanelCallbacks {
  onChannelViewChange: (value: string) => void;
  onChannelViewRowClick: () => void;
  onSplitToggle: (includeSplitRgbChannels: boolean) => void;
}

export class ChannelPanel implements Disposable {
  private readonly disposables = new DisposableBag();
  private isLoading = false;
  private isRgbViewLoading = false;
  private restoreRgbGroupFocusAfterLoading = false;
  private restoreChannelViewFocusAfterLoading = false;
  private hasSplitChannelViews = false;
  private includeSplitRgbChannels = false;
  private channelViewItems: ChannelViewItem[] = [];
  private selectedValue = '';
  private disposed = false;

  constructor(
    private readonly elements: ChannelPanelElements,
    private readonly callbacks: ChannelPanelCallbacks
  ) {
    this.elements.rgbSplitToggleButton.disabled = true;
    this.elements.rgbGroupSelect.disabled = true;

    this.disposables.addEventListener(this.elements.rgbSplitToggleButton, 'click', () => {
      if (this.elements.rgbSplitToggleButton.disabled) {
        return;
      }

      this.callbacks.onSplitToggle(!this.includeSplitRgbChannels);
    });

    const onRgbGroupSelect = (event: Event): void => {
      const target = event.currentTarget as HTMLSelectElement;
      this.chooseChannelViewValue(target.value);
    };
    this.disposables.addEventListener(this.elements.rgbGroupSelect, 'change', onRgbGroupSelect);
    this.disposables.addEventListener(this.elements.rgbGroupSelect, 'input', onRgbGroupSelect);
    this.disposables.addEventListener(this.elements.rgbGroupSelect, 'keydown', (event) => {
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
      this.chooseChannelViewValue(this.elements.rgbGroupSelect.value);
    });

    this.disposables.addEventListener(this.elements.channelViewList, 'click', (event) => {
      const row = findClosestListRow(event.target, 'channelValue');
      if (!row || this.elements.rgbGroupSelect.disabled) {
        return;
      }

      this.callbacks.onChannelViewRowClick();
      this.chooseChannelViewValue(row.dataset.channelValue ?? '');
    });
    this.disposables.addEventListener(this.elements.channelViewList, 'keydown', (event) => {
      handleImageBrowserListKeyDown(event, this.elements.channelViewList, (row) => {
        if (this.elements.rgbGroupSelect.disabled) {
          return;
        }
        this.chooseChannelViewValue(row.dataset.channelValue ?? '');
      });
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  stepSelection(delta: -1 | 1): boolean {
    if (
      this.disposed ||
      this.elements.rgbGroupSelect.disabled ||
      this.elements.channelViewList.hidden ||
      this.channelViewItems.length === 0
    ) {
      return false;
    }

    const currentValue = this.selectedValue || this.elements.rgbGroupSelect.value;
    const currentIndex = this.channelViewItems.findIndex((item) => item.value === currentValue);
    const anchorIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(this.channelViewItems.length - 1, anchorIndex + delta));
    const nextValue = this.channelViewItems[nextIndex]?.value ?? null;
    if (!nextValue) {
      return false;
    }

    if (nextValue !== this.selectedValue) {
      this.chooseChannelViewValue(nextValue);
    }

    return true;
  }

  setLoading(loading: boolean): void {
    if (this.disposed) {
      return;
    }

    if (loading) {
      this.restoreRgbGroupFocusAfterLoading = document.activeElement === this.elements.rgbGroupSelect;
      this.restoreChannelViewFocusAfterLoading = isFocusWithinElement(this.elements.channelViewList);
    }

    this.isLoading = loading;
    this.elements.rgbGroupSelect.disabled = loading || this.channelViewItems.length === 0;
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
    if (this.disposed) {
      return;
    }

    this.isRgbViewLoading = loading;
    this.updateRgbSplitToggleState();
  }

  setSplitToggleState(includeSplitRgbChannels: boolean, hasSplitChannelViews: boolean): void {
    if (this.disposed) {
      return;
    }

    this.includeSplitRgbChannels = includeSplitRgbChannels;
    this.hasSplitChannelViews = hasSplitChannelViews;
    this.updateRgbSplitToggleState();
  }

  setChannelViewItems(items: ChannelViewItem[], selectedValue: string): void {
    if (this.disposed) {
      return;
    }

    const hadFocus = document.activeElement === this.elements.rgbGroupSelect;
    this.channelViewItems = [...items];
    this.selectedValue = this.channelViewItems.some((item) => item.value === selectedValue)
      ? selectedValue
      : (this.channelViewItems[0]?.value ?? '');

    syncSelectOptions(this.elements.rgbGroupSelect, this.channelViewItems.map((item) => ({
      value: item.value,
      label: item.label
    })));
    applyListboxRowSizing(this.elements.rgbGroupSelect, this.channelViewItems.length, CHANNEL_OPTIONS_MAX_VISIBLE_ROWS);
    this.syncSelectedChannelViewValue();
    this.elements.rgbGroupSelect.disabled = this.isLoading || this.channelViewItems.length === 0;
    this.renderChannelViewRows();

    if (hadFocus && !this.elements.rgbGroupSelect.disabled) {
      this.elements.rgbGroupSelect.focus();
    }
  }

  setRgbGroupOptions(channelNames: string[], selected: DisplaySelection | null): void {
    if (this.disposed) {
      return;
    }

    const allItems = buildChannelViewItems(channelNames);
    const visibleItems = selectVisibleChannelViewItems(allItems, this.includeSplitRgbChannels);
    const selectedItem = findSelectedChannelViewItem(visibleItems, selected) ?? visibleItems[0] ?? null;
    this.setSplitToggleState(this.includeSplitRgbChannels, hasSplitChannelViewItems(allItems));
    this.setChannelViewItems(visibleItems, selectedItem?.value ?? '');
  }

  clearForNoImage(): void {
    if (this.disposed) {
      return;
    }

    this.channelViewItems = [];
    this.selectedValue = '';
    this.hasSplitChannelViews = false;
    syncSelectOptions(this.elements.rgbGroupSelect, []);
    applyListboxRowSizing(this.elements.rgbGroupSelect, 0, CHANNEL_OPTIONS_MAX_VISIBLE_ROWS);
    this.elements.rgbGroupSelect.disabled = true;
    this.renderChannelViewRows();
    this.updateRgbSplitToggleState();
  }

  private renderChannelViewRows(): void {
    const disabled = this.isLoading || this.channelViewItems.length === 0;
    const shouldRestoreFocus = !disabled && isFocusWithinElement(this.elements.channelViewList);
    this.elements.channelViewCount.textContent = String(this.channelViewItems.length);
    this.elements.channelViewList.classList.toggle('is-disabled', disabled);

    if (this.channelViewItems.length === 0) {
      renderEmptyListMessage(this.elements.channelViewList, 'No channels');
      return;
    }

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
          selected: item.value === this.selectedValue,
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
    if (this.disposed) {
      return;
    }

    if (!value || this.elements.rgbGroupSelect.disabled) {
      return;
    }

    if (!this.channelViewItems.some((item) => item.value === value)) {
      return;
    }

    this.selectedValue = value;
    this.syncSelectedChannelViewValue();
    this.renderChannelViewRows();
    this.callbacks.onChannelViewChange(value);
  }

  private syncSelectedChannelViewValue(): void {
    const options = Array.from(this.elements.rgbGroupSelect.options);
    let selectedIndex = -1;

    for (const [index, option] of options.entries()) {
      const selected = option.value === this.selectedValue;
      option.selected = selected;
      if (selected) {
        selectedIndex = index;
      }
    }

    this.elements.rgbGroupSelect.selectedIndex = selectedIndex;
    if (selectedIndex < 0) {
      this.elements.rgbGroupSelect.value = '';
    }
  }

  private updateRgbSplitToggleState(): void {
    this.elements.rgbSplitToggleButton.classList.toggle('hidden', !this.hasSplitChannelViews);
    this.elements.rgbSplitToggleButton.disabled =
      this.isLoading || this.isRgbViewLoading || !this.hasSplitChannelViews;
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
    icon.replaceChildren(...options.swatches.map((swatchColor) => {
      const swatch = document.createElement('span');
      swatch.className = 'channel-view-swatch';
      swatch.style.backgroundColor = swatchColor;
      return swatch;
    }));
  }
  if (label) {
    label.textContent = options.label;
  }
  if (meta) {
    meta.textContent = options.meta;
  }
}

export { getChannelViewSwatches } from '../channel-view-items';
