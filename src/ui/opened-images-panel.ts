import type { ListboxHitTestMetrics, OpenedImageOptionItem } from '../ui';
import type { OpenedImagesPanelElements } from './elements';
import {
  applyListboxRowSizing,
  createEmptyListMessage,
  findClosestListRow,
  focusSelectedImageBrowserRow,
  getImageBrowserRowValueAtClientY,
  getListboxOptionIndexAtClientY,
  handleImageBrowserListKeyDown,
  isFocusWithinElement,
  renderKeyedChildren,
  syncSelectOptions
} from './render-helpers';

const OPENED_IMAGES_MAX_VISIBLE_ROWS = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

interface OpenedImagesPanelCallbacks {
  onOpenedImageSelected: (sessionId: string) => void;
  onReorderOpenedImage: (draggedSessionId: string, targetSessionId: string) => void;
  onDisplayCacheBudgetChange: (mb: number) => void;
  onToggleOpenedImagePin: (sessionId: string) => void;
  onReloadSelectedOpenedImage: (sessionId: string) => void;
  onCloseSelectedOpenedImage: (sessionId: string) => void;
}

interface OpenedImageDragState {
  sessionId: string;
  startY: number;
  lastTargetSessionId: string | null;
  isDragging: boolean;
}

interface OpenedFileRowRefs {
  thumbnail: HTMLElement;
  label: HTMLSpanElement;
  pinButton: HTMLButtonElement;
  reloadButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
}

const openedFileRowRefs = new WeakMap<HTMLElement, OpenedFileRowRefs>();

export class OpenedImagesPanel {
  private isLoading = false;
  private openedImageCount = 0;
  private openedImagesActiveId: string | null = null;
  private openedImageItems: OpenedImageOptionItem[] = [];
  private suppressOpenedImageSelectionUntilMs = 0;
  private openedImageDragState: OpenedImageDragState | null = null;
  private restoreOpenedFilesFocusAfterLoading = false;
  private displayCacheBudgetMb = 256;

  constructor(
    private readonly elements: OpenedImagesPanelElements,
    private readonly callbacks: OpenedImagesPanelCallbacks
  ) {
    this.elements.openedImagesSelect.disabled = true;
    this.elements.openedImagesSelect.title = 'Click and drag filename rows to reorder.';
    this.elements.displayCacheBudgetInput.disabled = false;
    this.elements.reloadAllOpenedImagesButton.disabled = true;
    this.elements.closeAllOpenedImagesButton.disabled = true;

    const onOpenedImagesSelect = (event: Event): void => {
      if (this.openedImageDragState || performance.now() < this.suppressOpenedImageSelectionUntilMs) {
        return;
      }

      const target = event.currentTarget as HTMLSelectElement;
      this.chooseOpenedImage(target.value);
    };
    this.elements.openedImagesSelect.addEventListener('change', onOpenedImagesSelect);
    this.elements.openedImagesSelect.addEventListener('input', onOpenedImagesSelect);
    this.elements.openedImagesSelect.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || this.elements.openedImagesSelect.disabled) {
        return;
      }
      // Use a controlled interaction model; native listbox drag-selection causes unstable row switching.
      event.preventDefault();
      this.elements.openedImagesSelect.focus();

      const sessionId = this.getOpenedImageSessionAtClientY(event.clientY);
      if (!sessionId) {
        return;
      }

      this.elements.openedImagesSelect.value = sessionId;
      if (sessionId !== this.openedImagesActiveId) {
        this.chooseOpenedImage(sessionId);
      }

      this.openedImageDragState = {
        sessionId,
        startY: event.clientY,
        lastTargetSessionId: null,
        isDragging: false
      };
    });
    this.elements.openedFilesList.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || this.elements.openedImagesSelect.disabled) {
        return;
      }

      const row = findClosestListRow(event.target, 'sessionId');
      if (!row) {
        return;
      }

      event.preventDefault();
      row.focus();

      const sessionId = row.dataset.sessionId ?? '';
      this.elements.openedImagesSelect.value = sessionId;
      if (sessionId !== this.openedImagesActiveId) {
        this.chooseOpenedImage(sessionId);
      }

      this.openedImageDragState = {
        sessionId,
        startY: event.clientY,
        lastTargetSessionId: null,
        isDragging: false
      };
    });
    this.elements.openedFilesList.addEventListener('keydown', (event) => {
      handleImageBrowserListKeyDown(event, this.elements.openedFilesList, (row) => {
        if (this.elements.openedImagesSelect.disabled) {
          return;
        }
        this.chooseOpenedImage(row.dataset.sessionId ?? '');
      });
    });

    this.elements.displayCacheBudgetInput.addEventListener('change', (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        this.setDisplayCacheBudget(this.displayCacheBudgetMb);
        return;
      }

      this.callbacks.onDisplayCacheBudgetChange(value);
    });

    window.addEventListener('mousemove', (event) => {
      this.onOpenedImagesMouseMove(event);
    });
    window.addEventListener('mouseup', () => {
      this.finishOpenedImagesDrag();
    });
    window.addEventListener('blur', () => {
      this.finishOpenedImagesDrag();
    });
  }

  getOpenedImageCount(): number {
    return this.openedImageCount;
  }

  setLoading(loading: boolean): void {
    if (loading) {
      this.finishOpenedImagesDrag();
      this.restoreOpenedFilesFocusAfterLoading = isFocusWithinElement(this.elements.openedFilesList);
    }

    this.isLoading = loading;
    this.updateControlState();
    this.renderOpenedFileRows();

    if (!loading) {
      if (this.restoreOpenedFilesFocusAfterLoading) {
        focusSelectedImageBrowserRow(this.elements.openedFilesList);
      }
      this.restoreOpenedFilesFocusAfterLoading = false;
    }
  }

  setDisplayCacheBudget(mb: number): void {
    this.displayCacheBudgetMb = Math.max(0, Math.round(mb));
    this.elements.displayCacheBudgetInput.value = String(this.displayCacheBudgetMb);
  }

  setDisplayCacheUsage(usedBytes: number, budgetBytes: number): void {
    const state = getDisplayCacheUsageState(usedBytes, budgetBytes);
    this.elements.displayCacheUsage.textContent = state.text;
    this.elements.displayCacheUsage.setAttribute(
      'title',
      `Retained display cache: ${formatFileSizeMb(usedBytes)} / ${formatFileSizeMb(budgetBytes)}`
    );
    this.elements.displayCacheControl.classList.toggle('is-over-budget', state.overBudget);
    this.elements.displayCacheUsage.classList.toggle('is-over-budget', state.overBudget);
  }

  setOpenedImageOptions(items: OpenedImageOptionItem[], activeId: string | null): void {
    this.openedImageCount = items.length;
    this.openedImageItems = items.map((item) => ({ ...item }));
    applyListboxRowSizing(this.elements.openedImagesSelect, items.length, OPENED_IMAGES_MAX_VISIBLE_ROWS);
    syncSelectOptions(
      this.elements.openedImagesSelect,
      items.map((item) => ({
        value: item.id,
        label: item.label
      }))
    );
    this.openedImagesActiveId = null;

    if (activeId && items.some((item) => item.id === activeId)) {
      this.elements.openedImagesSelect.value = activeId;
      this.openedImagesActiveId = activeId;
    } else if (items.length > 0) {
      this.elements.openedImagesSelect.value = items[0].id;
      this.openedImagesActiveId = items[0].id;
    }

    this.updateControlState();
    this.renderOpenedFileRows();
  }

  private updateControlState(): void {
    this.elements.openedImagesSelect.disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.displayCacheBudgetInput.disabled = this.isLoading;
    this.elements.reloadAllOpenedImagesButton.disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.closeAllOpenedImagesButton.disabled = this.isLoading || this.openedImageCount === 0;
  }

  private renderOpenedFileRows(): void {
    const disabled = this.isLoading || this.openedImageCount === 0;
    const shouldRestoreFocus = !disabled && isFocusWithinElement(this.elements.openedFilesList);
    this.elements.openedFilesCount.textContent = String(this.openedImageItems.length);
    this.elements.openedFilesList.classList.toggle('is-disabled', disabled);

    if (this.openedImageItems.length === 0) {
      this.elements.openedFilesList.replaceChildren(createEmptyListMessage('No open files'));
      return;
    }

    renderKeyedChildren(
      this.elements.openedFilesList,
      this.openedImageItems,
      (item) => item.id,
      (item, existing) => {
        const row =
          existing && existing instanceof HTMLDivElement
            ? existing
            : createOpenedFileRow(item, this.callbacks);

        updateOpenedFileRow(row, item, {
          sizeText: formatFileSizeMb(item.sizeBytes ?? null),
          selected: item.id === this.openedImagesActiveId,
          disabled
        });
        return row;
      }
    );

    if (shouldRestoreFocus) {
      focusSelectedImageBrowserRow(this.elements.openedFilesList);
    }
  }

  private chooseOpenedImage(sessionId: string): void {
    if (!sessionId || this.elements.openedImagesSelect.disabled) {
      return;
    }

    this.elements.openedImagesSelect.value = sessionId;
    this.openedImagesActiveId = sessionId;
    this.renderOpenedFileRows();
    this.callbacks.onOpenedImageSelected(sessionId);
  }

  private onOpenedImagesMouseMove(event: MouseEvent): void {
    const dragState = this.openedImageDragState;
    if (!dragState) {
      return;
    }
    event.preventDefault();

    if ((event.buttons & 1) !== 1) {
      this.finishOpenedImagesDrag();
      return;
    }

    if (Math.abs(event.clientY - dragState.startY) < 6) {
      return;
    }

    if (!dragState.isDragging) {
      dragState.isDragging = true;
      this.elements.openedImagesSelect.classList.add('is-reordering');
      this.elements.openedFilesList.classList.add('is-reordering');
    }

    const targetSessionId = this.getOpenedImageSessionAtClientY(event.clientY);
    if (!targetSessionId) {
      return;
    }

    if (targetSessionId === dragState.sessionId) {
      dragState.lastTargetSessionId = null;
      return;
    }

    if (targetSessionId === dragState.lastTargetSessionId) {
      return;
    }

    dragState.lastTargetSessionId = targetSessionId;
    this.callbacks.onReorderOpenedImage(dragState.sessionId, targetSessionId);
  }

  private finishOpenedImagesDrag(): void {
    const dragState = this.openedImageDragState;
    this.openedImageDragState = null;
    this.elements.openedImagesSelect.classList.remove('is-reordering');
    this.elements.openedFilesList.classList.remove('is-reordering');

    const activeId = this.openedImagesActiveId;
    if (dragState?.isDragging && activeId) {
      this.elements.openedImagesSelect.value = activeId;
    }

    if (dragState?.isDragging) {
      this.suppressOpenedImageSelectionUntilMs = performance.now() + 120;
    }
  }

  private getOpenedImageSessionAtClientY(clientY: number): string | null {
    const rowSessionId = getImageBrowserRowValueAtClientY(this.elements.openedFilesList, clientY, 'sessionId');
    if (rowSessionId) {
      return rowSessionId;
    }

    const select = this.elements.openedImagesSelect;
    const options = select.options;
    if (options.length === 0) {
      return null;
    }

    const rect = select.getBoundingClientRect();
    if (rect.height <= 0) {
      return null;
    }

    const top = rect.top + select.clientTop;
    const height = Math.max(1, select.clientHeight);
    const index = getListboxOptionIndexAtClientY(clientY, {
      top,
      height,
      scrollTop: select.scrollTop,
      scrollHeight: select.scrollHeight,
      optionCount: options.length
    } satisfies ListboxHitTestMetrics);
    if (index < 0) {
      return null;
    }
    return options[index]?.value ?? null;
  }
}

export function getOpenedFilePinButtonLabel(label: string, pinned: boolean): string {
  return `${pinned ? 'Unpin' : 'Pin'} cache for ${label}`;
}

export function formatDisplayCacheUsageText(usedBytes: number, budgetBytes: number): string {
  return `${formatDisplayCacheMegabytes(usedBytes)} / ${formatDisplayCacheMegabytes(budgetBytes)} MB`;
}

export function getDisplayCacheUsageState(
  usedBytes: number,
  budgetBytes: number
): { text: string; overBudget: boolean } {
  return {
    text: formatDisplayCacheUsageText(usedBytes, budgetBytes),
    overBudget: usedBytes > budgetBytes
  };
}

function createOpenedFileRow(
  item: OpenedImageOptionItem,
  callbacks: OpenedImagesPanelCallbacks
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'image-browser-row opened-file-row';

  const thumbnail = createOpenedFileThumbnail(item.thumbnailDataUrl ?? null);

  const label = document.createElement('span');
  label.className = 'image-browser-row-label opened-file-label';

  const actions = document.createElement('span');
  actions.className = 'opened-file-actions';

  const pinButton = createOpenedFileActionButton({
    iconName: 'pin',
    onClick: () => {
      callbacks.onToggleOpenedImagePin(item.id);
    }
  });
  const reloadButton = createOpenedFileActionButton({
    iconName: 'reload',
    onClick: () => {
      callbacks.onReloadSelectedOpenedImage(item.id);
    }
  });
  const closeButton = createOpenedFileActionButton({
    iconName: 'close',
    onClick: () => {
      callbacks.onCloseSelectedOpenedImage(item.id);
    }
  });

  actions.append(pinButton, reloadButton, closeButton);
  row.append(thumbnail, label, actions);
  openedFileRowRefs.set(row, { thumbnail, label, pinButton, reloadButton, closeButton });
  return row;
}

function updateOpenedFileRow(
  row: HTMLDivElement,
  item: OpenedImageOptionItem,
  options: {
    sizeText: string;
    selected: boolean;
    disabled: boolean;
  }
): void {
  const refs = openedFileRowRefs.get(row);
  if (!refs) {
    return;
  }

  row.dataset.sessionId = item.id;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', options.selected ? 'true' : 'false');
  row.setAttribute('aria-disabled', options.disabled ? 'true' : 'false');
  row.tabIndex = options.disabled ? -1 : 0;

  refs.label.textContent = item.label;
  refs.label.title = `Path: ${item.sourceDetail ?? item.label}\nSize: ${options.sizeText}`;

  const nextThumbnail = createOpenedFileThumbnail(item.thumbnailDataUrl ?? null);
  if (!sameThumbnail(refs.thumbnail, nextThumbnail)) {
    row.replaceChild(nextThumbnail, refs.thumbnail);
    refs.thumbnail = nextThumbnail;
  }

  updateOpenedFileActionButton(refs.pinButton, {
    iconName: 'pin',
    label: getOpenedFilePinButtonLabel(item.label, item.pinned ?? false),
    disabled: options.disabled,
    pressed: item.pinned ?? false
  });
  updateOpenedFileActionButton(refs.reloadButton, {
    iconName: 'reload',
    label: `Reload ${item.label}`,
    disabled: options.disabled
  });
  updateOpenedFileActionButton(refs.closeButton, {
    iconName: 'close',
    label: `Close ${item.label}`,
    disabled: options.disabled
  });
}

function createOpenedFileActionButton(options: {
  iconName: 'pin' | 'reload' | 'close';
  onClick: () => void;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `opened-file-action-button opened-file-action-button--${options.iconName}`;

  button.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (button.disabled) {
      return;
    }
    options.onClick();
  });

  return button;
}

function updateOpenedFileActionButton(
  button: HTMLButtonElement,
  options: {
    iconName: 'pin' | 'reload' | 'close';
    label: string;
    disabled: boolean;
    pressed?: boolean;
  }
): void {
  button.disabled = options.disabled;
  button.setAttribute('aria-label', options.label);
  button.title = options.label;
  button.replaceChildren(createOpenedFileActionIcon(options.iconName, options.pressed ?? false));

  if (options.iconName === 'pin') {
    button.setAttribute('aria-pressed', options.pressed ? 'true' : 'false');
    button.classList.toggle('is-pressed', Boolean(options.pressed));
    return;
  }

  button.removeAttribute('aria-pressed');
  button.classList.remove('is-pressed');
}

function sameThumbnail(current: HTMLElement, next: HTMLElement): boolean {
  if (current.tagName !== next.tagName) {
    return false;
  }

  if (current instanceof HTMLImageElement && next instanceof HTMLImageElement) {
    return current.src === next.src;
  }

  return current.className === next.className;
}

function createOpenedFileActionIcon(
  iconName: 'pin' | 'reload' | 'close',
  pressed = false
): SVGSVGElement {
  const svg = createSvgElement('svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  if (iconName === 'pin') {
    const head = createSvgElement('path');
    head.setAttribute('d', 'M7 4.2h6.2l-.9 3.1 2.3 2.2v1H5.4v-1l2.3-2.2-.7-3.1z');
    head.setAttribute('fill', pressed ? 'currentColor' : 'none');
    head.setAttribute('stroke', 'currentColor');
    head.setAttribute('stroke-linejoin', 'round');
    head.setAttribute('stroke-width', '1.35');

    const stem = createSvgElement('path');
    stem.setAttribute('d', 'M10 10.6v4.9');
    stem.setAttribute('fill', 'none');
    stem.setAttribute('stroke', 'currentColor');
    stem.setAttribute('stroke-linecap', 'round');
    stem.setAttribute('stroke-width', '1.5');

    const tip = createSvgElement('path');
    tip.setAttribute('d', 'M8.7 15.5L10 17l1.3-1.5');
    tip.setAttribute('fill', 'none');
    tip.setAttribute('stroke', 'currentColor');
    tip.setAttribute('stroke-linecap', 'round');
    tip.setAttribute('stroke-linejoin', 'round');
    tip.setAttribute('stroke-width', '1.5');

    svg.append(head, stem, tip);
    return svg;
  }

  if (iconName === 'reload') {
    const path = createSvgElement('path');
    path.setAttribute('d', 'M15.5 7.2A6 6 0 1 0 16 12');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '1.7');

    const arrow = createSvgElement('path');
    arrow.setAttribute('d', 'M15.5 3.6v3.6h-3.6');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor');
    arrow.setAttribute('stroke-linecap', 'round');
    arrow.setAttribute('stroke-linejoin', 'round');
    arrow.setAttribute('stroke-width', '1.7');

    svg.append(path, arrow);
    return svg;
  }

  const first = createSvgElement('path');
  first.setAttribute('d', 'M5.8 5.8l8.4 8.4');
  first.setAttribute('fill', 'none');
  first.setAttribute('stroke', 'currentColor');
  first.setAttribute('stroke-linecap', 'round');
  first.setAttribute('stroke-width', '1.9');

  const second = createSvgElement('path');
  second.setAttribute('d', 'M14.2 5.8l-8.4 8.4');
  second.setAttribute('fill', 'none');
  second.setAttribute('stroke', 'currentColor');
  second.setAttribute('stroke-linecap', 'round');
  second.setAttribute('stroke-width', '1.9');

  svg.append(first, second);
  return svg;
}

function createOpenedFileThumbnail(thumbnailDataUrl: string | null): HTMLElement {
  if (!thumbnailDataUrl) {
    const icon = document.createElement('span');
    icon.className = 'file-row-icon';
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  const image = document.createElement('img');
  image.className = 'opened-file-thumbnail';
  image.src = thumbnailDataUrl;
  image.alt = '';
  image.draggable = false;
  image.setAttribute('aria-hidden', 'true');
  return image;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName) as SVGElementTagNameMap[K];
}

function formatDisplayCacheMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0';
  }

  return Math.round(bytes / (1024 * 1024)).toString();
}

function formatFileSizeMb(sizeBytes: number | null): string {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return '-- MB';
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
