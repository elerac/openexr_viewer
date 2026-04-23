import type { ChannelViewThumbnailItem } from '../channel-view-items';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { ChannelThumbnailStripElements } from './elements';
import {
  createEmptyListMessage,
  findClosestListRow,
  isFocusWithinElement,
  renderKeyedChildren
} from './render-helpers';

interface ChannelThumbnailStripCallbacks {
  onChannelViewChange: (value: string) => void;
}

interface ChannelThumbnailTileRefs {
  preview: HTMLElement;
  label: HTMLSpanElement;
}

const tileRefs = new WeakMap<HTMLElement, ChannelThumbnailTileRefs>();

export class ChannelThumbnailStrip implements Disposable {
  private readonly disposables = new DisposableBag();
  private isLoading = false;
  private hasActiveImage = false;
  private restoreFocusAfterLoading = false;
  private items: ChannelViewThumbnailItem[] = [];
  private selectedValue = '';
  private disposed = false;

  constructor(
    private readonly elements: ChannelThumbnailStripElements,
    private readonly callbacks: ChannelThumbnailStripCallbacks
  ) {
    this.disposables.addEventListener(this.elements.channelThumbnailStrip, 'click', (event) => {
      const row = findClosestListRow(event.target, 'channelValue');
      if (!row || this.isLoading) {
        return;
      }

      this.chooseValue(row.dataset.channelValue ?? '');
    });
    this.disposables.addEventListener(this.elements.channelThumbnailStrip, 'keydown', (event) => {
      this.handleKeyDown(event);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  setLoading(loading: boolean): void {
    if (this.disposed) {
      return;
    }

    if (loading) {
      this.restoreFocusAfterLoading = isFocusWithinElement(this.elements.channelThumbnailStrip);
    }

    this.isLoading = loading;
    this.render();

    if (!loading && this.restoreFocusAfterLoading) {
      focusSelectedTile(this.elements.channelThumbnailStrip);
      this.restoreFocusAfterLoading = false;
    }
  }

  setChannelViewItems(items: ChannelViewThumbnailItem[], selectedValue: string): void {
    if (this.disposed) {
      return;
    }

    this.hasActiveImage = true;
    this.items = [...items];
    this.selectedValue = this.items.some((item) => item.value === selectedValue)
      ? selectedValue
      : (this.items[0]?.value ?? '');
    this.render();
  }

  clearForNoImage(): void {
    if (this.disposed) {
      return;
    }

    this.hasActiveImage = false;
    this.items = [];
    this.selectedValue = '';
    this.render();
  }

  private render(): void {
    const disabled = this.isLoading || this.items.length === 0;
    const shouldRestoreFocus = !disabled && isFocusWithinElement(this.elements.channelThumbnailStrip);
    this.elements.channelThumbnailStrip.classList.toggle('is-disabled', disabled);

    if (this.items.length === 0) {
      const message = this.hasActiveImage
        ? 'No channels'
        : 'Open an image to browse channel thumbnails.';
      this.elements.channelThumbnailStrip.replaceChildren(createEmptyListMessage(message));
      return;
    }

    renderKeyedChildren(
      this.elements.channelThumbnailStrip,
      this.items,
      (item) => item.value,
      (item, existing) => {
        const tile =
          existing && existing instanceof HTMLButtonElement
            ? existing
            : createChannelThumbnailTile();
        updateChannelThumbnailTile(tile, item, {
          selected: item.value === this.selectedValue,
          disabled
        });
        return tile;
      }
    );

    if (shouldRestoreFocus) {
      focusSelectedTile(this.elements.channelThumbnailStrip);
    }
  }

  private chooseValue(value: string): void {
    if (!value || this.isLoading || !this.items.some((item) => item.value === value)) {
      return;
    }

    this.selectedValue = value;
    this.render();
    this.callbacks.onChannelViewChange(value);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const tiles = getEnabledTiles(this.elements.channelThumbnailStrip);
    if (tiles.length === 0) {
      return;
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedTile = activeElement && this.elements.channelThumbnailStrip.contains(activeElement)
      ? activeElement.closest<HTMLElement>('.channel-thumbnail-tile')
      : null;
    const focusedIndex = focusedTile ? tiles.indexOf(focusedTile as HTMLButtonElement) : -1;
    const selectedIndex = tiles.findIndex((tile) => tile.getAttribute('aria-selected') === 'true');
    const currentIndex = Math.max(0, focusedIndex >= 0 ? focusedIndex : selectedIndex);

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const tile = tiles[currentIndex];
      if (tile) {
        this.chooseValue(tile.dataset.channelValue ?? '');
      }
      return;
    }

    let nextIndex = currentIndex;
    if (event.key === 'ArrowLeft' || event.key === 'Left') {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === 'ArrowRight' || event.key === 'Right') {
      nextIndex = Math.min(tiles.length - 1, currentIndex + 1);
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tiles.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTile = tiles[nextIndex];
    if (!nextTile) {
      return;
    }

    nextTile.focus();
    nextTile.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    this.chooseValue(nextTile.dataset.channelValue ?? '');
  }
}

function createChannelThumbnailTile(): HTMLButtonElement {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'channel-thumbnail-tile image-browser-row';

  const preview = document.createElement('span');
  preview.className = 'channel-thumbnail-tile-preview';

  const label = document.createElement('span');
  label.className = 'channel-thumbnail-tile-label';

  tile.append(preview, label);
  tileRefs.set(tile, { preview, label });
  return tile;
}

function updateChannelThumbnailTile(
  tile: HTMLButtonElement,
  item: ChannelViewThumbnailItem,
  options: {
    selected: boolean;
    disabled: boolean;
  }
): void {
  const refs = tileRefs.get(tile);
  if (!refs) {
    return;
  }

  tile.dataset.channelValue = item.value;
  tile.setAttribute('role', 'option');
  tile.setAttribute('aria-selected', options.selected ? 'true' : 'false');
  tile.setAttribute('aria-disabled', options.disabled ? 'true' : 'false');
  tile.disabled = options.disabled;
  tile.title = item.label;

  const nextPreview = createChannelThumbnailPreview(item.thumbnailDataUrl);
  if (!samePreview(refs.preview, nextPreview)) {
    tile.replaceChild(nextPreview, refs.preview);
    refs.preview = nextPreview;
  }
  refs.label.textContent = item.label;
}

function createChannelThumbnailPreview(thumbnailDataUrl: string | null): HTMLElement {
  if (!thumbnailDataUrl) {
    const placeholder = document.createElement('span');
    placeholder.className = 'channel-thumbnail-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    return placeholder;
  }

  const image = document.createElement('img');
  image.className = 'channel-thumbnail-image';
  image.src = thumbnailDataUrl;
  image.alt = '';
  image.draggable = false;
  image.setAttribute('aria-hidden', 'true');
  return image;
}

function samePreview(current: HTMLElement, next: HTMLElement): boolean {
  if (current.tagName !== next.tagName) {
    return false;
  }

  if (current instanceof HTMLImageElement && next instanceof HTMLImageElement) {
    return current.src === next.src;
  }

  return current.className === next.className;
}

function getEnabledTiles(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.channel-thumbnail-tile')).filter((tile) => !tile.disabled);
}

function focusSelectedTile(container: HTMLElement): void {
  const selectedTile = getEnabledTiles(container).find((tile) => tile.getAttribute('aria-selected') === 'true');
  selectedTile?.focus();
}
