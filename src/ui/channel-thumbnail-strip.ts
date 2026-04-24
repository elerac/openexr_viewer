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
  onCollapsedContentAvailabilityChange: (available: boolean) => void;
}

interface ChannelThumbnailTileRefs {
  preview: HTMLElement;
  label: HTMLSpanElement;
  thumbnailDataUrl: string | null;
}

const tileRefs = new WeakMap<HTMLElement, ChannelThumbnailTileRefs>();
const HOVER_PREVIEW_DELAY_MS = 500;
const HOVER_PREVIEW_GAP_PX = 8;
const HOVER_PREVIEW_VIEWPORT_MARGIN_PX = 8;
const HOVER_PREVIEW_FALLBACK_SIZE_PX = 156;
const DEFAULT_STRIP_PADDING_TOP_PX = 7.2;
const DEFAULT_STRIP_PADDING_BOTTOM_PX = 8.8;
const DEFAULT_TILE_PADDING_PX = 5.12;
const DEFAULT_TILE_GAP_PX = 3.84;
const DEFAULT_TILE_BORDER_PX = 1;

export class ChannelThumbnailStrip implements Disposable {
  private readonly disposables = new DisposableBag();
  private readonly resizeObserver: ResizeObserver;
  private isLoading = false;
  private hasActiveImage = false;
  private restoreFocusAfterLoading = false;
  private items: ChannelViewThumbnailItem[] = [];
  private selectedValue = '';
  private hoverPreviewTimer: number | null = null;
  private hoverPreviewTile: HTMLButtonElement | null = null;
  private hoverPreviewElement: HTMLElement | null = null;
  private hoverPreviewSessionActive = false;
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

      this.endHoverPreviewSession();
      this.chooseValue(row.dataset.channelValue ?? '');
    });
    this.disposables.addEventListener(this.elements.channelThumbnailStrip, 'keydown', (event) => {
      this.handleKeyDown(event);
    });
    this.disposables.addEventListener(this.elements.channelThumbnailStrip, 'mouseover', (event) => {
      this.handleMouseOver(event);
    });
    this.disposables.addEventListener(this.elements.channelThumbnailStrip, 'mouseout', (event) => {
      this.handleMouseOut(event);
    });
    this.disposables.addEventListener(this.elements.channelThumbnailStrip, 'mouseleave', () => {
      this.endHoverPreviewSession();
    });
    this.disposables.addEventListener(this.elements.channelThumbnailStrip, 'scroll', () => {
      this.endHoverPreviewSession();
    });
    this.disposables.addEventListener(window, 'resize', () => {
      this.endHoverPreviewSession();
    });
    this.disposables.addEventListener(document, 'click', () => {
      this.endHoverPreviewSession();
    }, true);
    this.resizeObserver = new ResizeObserver(() => {
      this.syncTileSizing();
      this.endHoverPreviewSession();
    });
    this.resizeObserver.observe(this.elements.channelThumbnailStrip);
    this.disposables.add(() => {
      this.resizeObserver.disconnect();
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.endHoverPreviewSession();
    this.disposables.dispose();
  }

  stepSelection(delta: -1 | 1): boolean {
    if (
      this.disposed ||
      this.isLoading ||
      this.elements.channelThumbnailStrip.hidden ||
      this.items.length === 0
    ) {
      return false;
    }

    const currentIndex = this.items.findIndex((item) => item.value === this.selectedValue);
    const anchorIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(this.items.length - 1, anchorIndex + delta));
    const nextValue = this.items[nextIndex]?.value ?? null;
    if (!nextValue) {
      return false;
    }

    if (nextValue !== this.selectedValue) {
      this.chooseValue(nextValue);
    }

    return true;
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
    this.endHoverPreviewSession();
    const disabled = this.isLoading || this.items.length === 0;
    const shouldRestoreFocus = !disabled && isFocusWithinElement(this.elements.channelThumbnailStrip);
    this.elements.channelThumbnailStrip.classList.toggle('is-disabled', disabled);
    this.callbacks.onCollapsedContentAvailabilityChange(this.items.length > 0);

    if (this.items.length === 0) {
      this.elements.channelThumbnailStrip.replaceChildren(
        createEmptyListMessage(this.hasActiveImage ? 'No channels' : '')
      );
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
    this.syncTileSizing();

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

  private handleMouseOver(event: MouseEvent): void {
    const tile = findClosestListRow(event.target, 'channelValue') as HTMLButtonElement | null;
    if (!tile || tile.disabled || this.isLoading) {
      return;
    }

    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (relatedTarget && tile.contains(relatedTarget)) {
      return;
    }

    this.scheduleHoverPreview(tile);
  }

  private handleMouseOut(event: MouseEvent): void {
    const tile = findClosestListRow(event.target, 'channelValue') as HTMLButtonElement | null;
    if (!tile) {
      return;
    }

    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (relatedTarget && tile.contains(relatedTarget)) {
      return;
    }

    if (relatedTarget && this.elements.channelThumbnailStrip.contains(relatedTarget)) {
      if (!this.hoverPreviewSessionActive && this.hoverPreviewTile === tile) {
        this.clearHoverPreviewTimer();
        this.hoverPreviewTile = null;
      }
      return;
    }

    if (this.hoverPreviewTile === tile) {
      this.endHoverPreviewSession();
    }
  }

  private scheduleHoverPreview(tile: HTMLButtonElement): void {
    this.clearHoverPreviewTimer();
    if (!isCompactChannelThumbnailStrip(this.elements.channelThumbnailStrip)) {
      this.endHoverPreviewSession();
      return;
    }

    const refs = tileRefs.get(tile);
    if (!refs?.thumbnailDataUrl) {
      this.endHoverPreviewSession();
      return;
    }

    this.hoverPreviewTile = tile;
    if (this.hoverPreviewSessionActive) {
      this.showHoverPreview(tile);
      return;
    }

    this.hoverPreviewTimer = window.setTimeout(() => {
      this.hoverPreviewTimer = null;
      if (this.hoverPreviewTile !== tile) {
        return;
      }

      this.showHoverPreview(tile);
    }, HOVER_PREVIEW_DELAY_MS);
  }

  private showHoverPreview(tile: HTMLButtonElement): void {
    if (
      this.disposed ||
      this.isLoading ||
      !tile.isConnected ||
      !isCompactChannelThumbnailStrip(this.elements.channelThumbnailStrip)
    ) {
      this.endHoverPreviewSession();
      return;
    }

    const refs = tileRefs.get(tile);
    if (!refs?.thumbnailDataUrl) {
      this.endHoverPreviewSession();
      return;
    }

    this.removeHoverPreviewElement();

    const preview = document.createElement('div');
    preview.className = 'channel-thumbnail-hover-preview';
    preview.setAttribute('aria-hidden', 'true');

    const image = document.createElement('img');
    image.className = 'channel-thumbnail-hover-preview-image';
    image.src = refs.thumbnailDataUrl;
    image.alt = '';
    image.draggable = false;
    preview.append(image);

    document.body.append(preview);
    positionHoverPreview(tile, preview);
    preview.classList.add('is-visible');
    this.hoverPreviewElement = preview;
    this.hoverPreviewTile = tile;
    this.hoverPreviewSessionActive = true;
  }

  private clearHoverPreviewTimer(): void {
    if (this.hoverPreviewTimer !== null) {
      window.clearTimeout(this.hoverPreviewTimer);
      this.hoverPreviewTimer = null;
    }
  }

  private removeHoverPreviewElement(): void {
    this.hoverPreviewElement?.remove();
    this.hoverPreviewElement = null;
  }

  private endHoverPreviewSession(): void {
    this.clearHoverPreviewTimer();
    this.removeHoverPreviewElement();
    this.hoverPreviewTile = null;
    this.hoverPreviewSessionActive = false;
  }

  private syncTileSizing(): void {
    const strip = this.elements.channelThumbnailStrip;
    if (isCompactChannelThumbnailStrip(strip)) {
      for (const tile of strip.querySelectorAll<HTMLButtonElement>('.channel-thumbnail-tile')) {
        const refs = tileRefs.get(tile);
        tile.style.removeProperty('--channel-thumbnail-tile-width');
        refs?.preview.style.removeProperty('--channel-thumbnail-preview-height');
        refs?.preview.style.removeProperty('--channel-thumbnail-preview-width');
        refs?.label.style.removeProperty('--channel-thumbnail-label-max-width');
      }
      return;
    }

    const stripStyle = getComputedStyle(strip);
    const stripRect = strip.getBoundingClientRect();
    const stripContentHeight = Math.max(
      0,
      stripRect.height -
        readCssPixels(stripStyle.paddingTop, DEFAULT_STRIP_PADDING_TOP_PX) -
        readCssPixels(stripStyle.paddingBottom, DEFAULT_STRIP_PADDING_BOTTOM_PX)
    );

    for (const tile of strip.querySelectorAll<HTMLButtonElement>('.channel-thumbnail-tile')) {
      const refs = tileRefs.get(tile);
      if (!refs) {
        continue;
      }

      const tileStyle = getComputedStyle(tile);
      const borderTop = readCssPixels(tileStyle.borderTopWidth, DEFAULT_TILE_BORDER_PX);
      const borderRight = readCssPixels(tileStyle.borderRightWidth, DEFAULT_TILE_BORDER_PX);
      const borderBottom = readCssPixels(tileStyle.borderBottomWidth, DEFAULT_TILE_BORDER_PX);
      const borderLeft = readCssPixels(tileStyle.borderLeftWidth, DEFAULT_TILE_BORDER_PX);
      const paddingTop = readCssPixels(tileStyle.paddingTop, DEFAULT_TILE_PADDING_PX);
      const paddingRight = readCssPixels(tileStyle.paddingRight, DEFAULT_TILE_PADDING_PX);
      const paddingBottom = readCssPixels(tileStyle.paddingBottom, DEFAULT_TILE_PADDING_PX);
      const paddingLeft = readCssPixels(tileStyle.paddingLeft, DEFAULT_TILE_PADDING_PX);
      const rowGap = readCssPixels(tileStyle.rowGap || tileStyle.gap, DEFAULT_TILE_GAP_PX);
      const labelHeight = refs.label.getBoundingClientRect().height;
      const tileRect = tile.getBoundingClientRect();
      const tileContentHeight = Math.max(
        0,
        (tileRect.height > 0 ? tileRect.height : stripContentHeight + borderTop + borderBottom) -
          borderTop -
          borderBottom
      );
      const previewHeight = Math.max(0, tileContentHeight - paddingTop - paddingBottom - rowGap - labelHeight);
      const previewWidth = previewHeight;
      const tileWidth = previewWidth + paddingLeft + paddingRight + borderLeft + borderRight;

      tile.style.setProperty('--channel-thumbnail-tile-width', formatPixels(tileWidth));
      refs.preview.style.setProperty('--channel-thumbnail-preview-height', formatPixels(previewHeight));
      refs.preview.style.setProperty('--channel-thumbnail-preview-width', formatPixels(previewWidth));
      refs.label.style.setProperty('--channel-thumbnail-label-max-width', formatPixels(previewWidth));
    }
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
  tileRefs.set(tile, { preview, label, thumbnailDataUrl: null });
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
  refs.thumbnailDataUrl = item.thumbnailDataUrl;
  refs.label.textContent = item.label;
}

function createChannelThumbnailPreview(
  thumbnailDataUrl: string | null
): HTMLElement {
  const preview = document.createElement('span');
  preview.className = 'channel-thumbnail-tile-preview';

  if (!thumbnailDataUrl) {
    const placeholder = document.createElement('span');
    placeholder.className = 'channel-thumbnail-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    preview.append(placeholder);
    return preview;
  }

  const image = document.createElement('img');
  image.className = 'channel-thumbnail-image';
  image.src = thumbnailDataUrl;
  image.alt = '';
  image.draggable = false;
  image.setAttribute('aria-hidden', 'true');
  preview.append(image);
  return preview;
}

function samePreview(current: HTMLElement, next: HTMLElement): boolean {
  if (current.tagName !== next.tagName || current.className !== next.className) {
    return false;
  }

  const currentChild = current.firstElementChild;
  const nextChild = next.firstElementChild;
  if (!currentChild || !nextChild) {
    return currentChild === nextChild;
  }

  if (currentChild.tagName !== nextChild.tagName) {
    return false;
  }

  if (currentChild instanceof HTMLImageElement && nextChild instanceof HTMLImageElement) {
    return currentChild.src === nextChild.src;
  }

  return currentChild.className === nextChild.className;
}

function getEnabledTiles(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.channel-thumbnail-tile')).filter((tile) => !tile.disabled);
}

function focusSelectedTile(container: HTMLElement): void {
  const selectedTile = getEnabledTiles(container).find((tile) => tile.getAttribute('aria-selected') === 'true');
  selectedTile?.focus();
}

function positionHoverPreview(tile: HTMLElement, preview: HTMLElement): void {
  const tileRect = tile.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const previewWidth = previewRect.width || HOVER_PREVIEW_FALLBACK_SIZE_PX;
  const previewHeight = previewRect.height || HOVER_PREVIEW_FALLBACK_SIZE_PX;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || previewWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight || previewHeight;
  const maxLeft = Math.max(
    HOVER_PREVIEW_VIEWPORT_MARGIN_PX,
    viewportWidth - previewWidth - HOVER_PREVIEW_VIEWPORT_MARGIN_PX
  );
  const maxTop = Math.max(
    HOVER_PREVIEW_VIEWPORT_MARGIN_PX,
    viewportHeight - previewHeight - HOVER_PREVIEW_VIEWPORT_MARGIN_PX
  );
  const centeredLeft = tileRect.left + tileRect.width / 2 - previewWidth / 2;
  let top = tileRect.top - previewHeight - HOVER_PREVIEW_GAP_PX;

  if (top < HOVER_PREVIEW_VIEWPORT_MARGIN_PX) {
    top = tileRect.bottom + HOVER_PREVIEW_GAP_PX;
  }

  preview.style.left = `${clamp(centeredLeft, HOVER_PREVIEW_VIEWPORT_MARGIN_PX, maxLeft)}px`;
  preview.style.top = `${clamp(top, HOVER_PREVIEW_VIEWPORT_MARGIN_PX, maxTop)}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isCompactChannelThumbnailStrip(strip: HTMLElement): boolean {
  return Boolean(strip.closest('.bottom-panel.is-collapsed'));
}

function readCssPixels(value: string, fallback: number): number {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : fallback;
}

function formatPixels(value: number): string {
  return `${Math.max(0, Math.round(value * 100) / 100)}px`;
}
