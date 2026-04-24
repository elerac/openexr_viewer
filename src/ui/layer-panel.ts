import type { LayerOptionItem } from './image-browser-types';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { LayerPanelElements } from './elements';
import {
  applyListboxRowSizing,
  createEmptyListMessage,
  findClosestListRow,
  handleImageBrowserListKeyDown,
  renderKeyedChildren,
  syncSelectOptions
} from './render-helpers';

interface LayerPanelCallbacks {
  onLayerChange: (layerIndex: number) => void;
}

export class LayerPanel implements Disposable {
  private readonly disposables = new DisposableBag();
  private isLoading = false;
  private hasActiveImage = false;
  private hasMultipleLayersState = false;
  private layerItems: LayerOptionItem[] = [];
  private fallbackPartLayerItems: LayerOptionItem[] | null = null;
  private activeLayerIndex = 0;
  private disposed = false;

  constructor(
    private readonly elements: LayerPanelElements,
    private readonly callbacks: LayerPanelCallbacks
  ) {
    this.elements.layerSelect.disabled = true;
    this.elements.layerSelect.size = 1;
    this.elements.layerSelect.classList.remove('single-row-listbox');

    const onLayerSelect = (event: Event): void => {
      if (this.elements.layerSelect.disabled) {
        return;
      }

      const target = event.currentTarget as HTMLSelectElement;
      const layerIndex = Number(target.value);
      if (!Number.isFinite(layerIndex)) {
        return;
      }

      this.chooseLayerIndex(layerIndex);
    };

    this.disposables.addEventListener(this.elements.layerSelect, 'change', onLayerSelect);
    this.disposables.addEventListener(this.elements.layerSelect, 'input', onLayerSelect);
    this.disposables.addEventListener(this.elements.partsLayersList, 'click', (event) => {
      const row = findClosestListRow(event.target, 'layerItemIndex');
      const item = row ? this.getVisibleItems()[Number(row.dataset.layerItemIndex)] : null;
      if (!row || !item || item.selectable === false || this.isLoading || this.getVisibleItems().length <= 1) {
        return;
      }

      this.chooseLayerIndex(item.index);
    });
    this.disposables.addEventListener(this.elements.partsLayersList, 'keydown', (event) => {
      handleImageBrowserListKeyDown(event, this.elements.partsLayersList, (row) => {
        const item = this.getVisibleItems()[Number(row.dataset.layerItemIndex)];
        if (!item || item.selectable === false || this.isLoading || this.getVisibleItems().length <= 1) {
          return;
        }
        this.chooseLayerIndex(item.index);
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

  hasMultipleLayers(): boolean {
    return this.hasMultipleLayersState;
  }

  setLoading(loading: boolean): void {
    if (this.disposed) {
      return;
    }

    this.isLoading = loading;
    this.updateLayerSelectState();
    this.renderLayerRows();
  }

  setLayerOptions(items: LayerOptionItem[], activeIndex: number): void {
    if (this.disposed) {
      return;
    }

    this.hasActiveImage = true;
    this.hasMultipleLayersState = items.length > 1;
    this.layerItems = items.map((item) => ({ ...item }));
    this.fallbackPartLayerItems = null;
    this.activeLayerIndex = Math.min(Math.max(0, Math.floor(activeIndex)), Math.max(0, items.length - 1));
    this.elements.layerControl.classList.toggle('hidden', !this.hasMultipleLayersState);

    if (!this.hasMultipleLayersState) {
      syncSelectOptions(this.elements.layerSelect, []);
      this.updateLayerSelectState();
      this.renderLayerRows();
      return;
    }

    applyListboxRowSizing(this.elements.layerSelect, items.length, items.length);
    syncSelectOptions(
      this.elements.layerSelect,
      items.map((item) => ({
        value: String(item.index),
        label: item.label
      }))
    );

    const resolvedIndex = Math.min(items.length - 1, Math.max(0, Math.floor(activeIndex)));
    this.elements.layerSelect.value = String(resolvedIndex);
    this.activeLayerIndex = resolvedIndex;
    this.updateLayerSelectState();
    this.renderLayerRows();
  }

  clearForNoImage(): void {
    if (this.disposed) {
      return;
    }

    this.hasActiveImage = false;
    this.hasMultipleLayersState = false;
    this.layerItems = [];
    this.fallbackPartLayerItems = null;
    this.activeLayerIndex = 0;
    this.elements.layerControl.classList.add('hidden');
    syncSelectOptions(this.elements.layerSelect, []);
    this.updateLayerSelectState();
    this.renderLayerRows();
  }

  setFallbackPartLayerItemsFromChannelNames(channelNames: string[]): void {
    if (this.disposed) {
      return;
    }

    if (this.hasMultipleLayersState) {
      return;
    }

    this.fallbackPartLayerItems = buildPartLayerItemsFromChannelNames(channelNames);
    this.renderLayerRows();
  }

  private updateLayerSelectState(): void {
    if (!this.hasMultipleLayersState) {
      this.elements.layerSelect.disabled = true;
      this.elements.layerSelect.size = 1;
      this.elements.layerSelect.classList.remove('single-row-listbox');
      return;
    }

    this.elements.layerSelect.disabled = this.isLoading;
  }

  private chooseLayerIndex(layerIndex: number): void {
    if (this.disposed) {
      return;
    }

    if (!Number.isFinite(layerIndex) || this.isLoading || this.layerItems.length === 0) {
      return;
    }

    const resolvedIndex = Math.min(this.layerItems.length - 1, Math.max(0, Math.floor(layerIndex)));
    this.elements.layerSelect.value = String(resolvedIndex);
    this.activeLayerIndex = resolvedIndex;
    this.renderLayerRows();
    this.callbacks.onLayerChange(resolvedIndex);
  }

  private renderLayerRows(): void {
    const visibleItems = this.getVisibleItems();
    const hasSelectableRows = visibleItems.some((item) => item.selectable !== false);
    const disabled = this.isLoading || visibleItems.length === 0;
    this.elements.partsLayersCount.textContent = String(visibleItems.length);
    this.elements.partsLayersList.classList.toggle('is-disabled', disabled);

    if (visibleItems.length === 0) {
      if (this.hasActiveImage) {
        this.elements.partsLayersList.replaceChildren(createEmptyListMessage('No parts'));
      } else {
        this.elements.partsLayersList.replaceChildren();
      }
      return;
    }

    renderKeyedChildren(
      this.elements.partsLayersList,
      visibleItems.map((item, itemIndex) => ({ item, itemIndex })),
      ({ item, itemIndex }) => `${item.index}:${item.label}:${itemIndex}`,
      ({ item, itemIndex }, existing) => {
        const selectable = item.selectable !== false && hasSelectableRows;
        const row =
          existing && existing instanceof HTMLButtonElement
            ? existing
            : createLayerRow();

        updateLayerRow(row, {
          label: item.label,
          meta: formatChannelCount(item.channelCount ?? 0),
          selected: selectable && this.hasMultipleLayersState && item.index === this.activeLayerIndex,
          disabled: this.isLoading || !selectable || visibleItems.length <= 1,
          itemIndex
        });
        return row;
      }
    );
  }

  private getVisibleItems(): LayerOptionItem[] {
    if (this.hasMultipleLayersState) {
      return this.layerItems;
    }

    return this.fallbackPartLayerItems ?? this.layerItems;
  }
}

export function buildPartLayerItemsFromChannelNames(channelNames: string[]): LayerOptionItem[] {
  type PartGroup = {
    key: string;
    label: string;
    channelNames: Set<string>;
    firstIndex: number;
  };

  const groups = new Map<string, PartGroup>();
  const consumedRgbChannels = new Set<string>();

  const ensureGroup = (key: string, label: string, firstIndex: number): PartGroup => {
    const existing = groups.get(key);
    if (existing) {
      existing.firstIndex = Math.min(existing.firstIndex, firstIndex);
      return existing;
    }

    const group: PartGroup = {
      key,
      label,
      channelNames: new Set<string>(),
      firstIndex
    };
    groups.set(key, group);
    return group;
  };

  const rgbCandidates = new Map<string, { firstIndex: number; channels: Map<string, string> }>();
  channelNames.forEach((channelName, index) => {
    const parsed = parseRgbChannelName(channelName);
    if (!parsed) {
      return;
    }

    const candidate = rgbCandidates.get(parsed.base) ?? {
      firstIndex: index,
      channels: new Map<string, string>()
    };
    candidate.firstIndex = Math.min(candidate.firstIndex, index);
    candidate.channels.set(parsed.suffix, channelName);
    rgbCandidates.set(parsed.base, candidate);
  });

  for (const [base, candidate] of rgbCandidates.entries()) {
    if (!candidate.channels.has('R') || !candidate.channels.has('G') || !candidate.channels.has('B')) {
      continue;
    }

    const label = base || 'RGB';
    const group = ensureGroup(`rgb:${base}`, label, candidate.firstIndex);
    for (const channelName of candidate.channels.values()) {
      group.channelNames.add(channelName);
      consumedRgbChannels.add(channelName);
    }
  }

  channelNames.forEach((channelName, index) => {
    if (consumedRgbChannels.has(channelName)) {
      return;
    }

    const base = getChannelFamilyName(channelName);
    const group = ensureGroup(`scalar:${base}`, base, index);
    group.channelNames.add(channelName);
  });

  return Array.from(groups.values())
    .sort((a, b) => a.firstIndex - b.firstIndex || a.label.localeCompare(b.label))
    .map((group, index) => ({
      index,
      label: group.label,
      channelCount: group.channelNames.size,
      selectable: false
    }));
}

function parseRgbChannelName(channelName: string): { base: string; suffix: string } | null {
  if (channelName === 'R' || channelName === 'G' || channelName === 'B' || channelName === 'A') {
    return { base: '', suffix: channelName };
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

function getChannelFamilyName(channelName: string): string {
  const dotIndex = channelName.lastIndexOf('.');
  if (dotIndex > 0 && dotIndex < channelName.length - 1) {
    return channelName.slice(0, dotIndex);
  }

  return channelName;
}

function createLayerRow(): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'image-browser-row layer-row';

  const icon = document.createElement('span');
  icon.className = 'layer-row-icon';
  icon.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'image-browser-row-label';

  const meta = document.createElement('span');
  meta.className = 'image-browser-row-meta';

  row.append(icon, label, meta);
  return row;
}

function updateLayerRow(
  row: HTMLButtonElement,
  options: {
    label: string;
    meta: string;
    selected: boolean;
    disabled: boolean;
    itemIndex: number;
  }
): void {
  row.dataset.layerItemIndex = String(options.itemIndex);
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', options.selected ? 'true' : 'false');
  row.setAttribute('aria-disabled', options.disabled ? 'true' : 'false');
  row.disabled = options.disabled;

  const label = row.querySelector<HTMLElement>('.image-browser-row-label');
  const meta = row.querySelector<HTMLElement>('.image-browser-row-meta');
  if (label) {
    label.textContent = options.label;
  }
  if (meta) {
    meta.textContent = options.meta;
  }
}

function formatChannelCount(channelCount: number): string {
  const count = Math.max(0, Math.floor(channelCount));
  return `${count}ch`;
}
