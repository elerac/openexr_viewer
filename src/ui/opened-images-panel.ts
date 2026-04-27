import type { OpenedImageOptionItem } from './image-browser-types';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { OpenedImageDropPlacement } from '../types';
import type { OpenedImagesPanelElements } from './elements';
import {
  applyListboxRowSizing,
  findClosestListRow,
  focusSelectedImageBrowserRow,
  getImageBrowserRows,
  getImageBrowserRowValueAtClientY,
  getListboxOptionIndexAtClientY,
  handleImageBrowserListKeyDown,
  isFocusWithinElement,
  isNestedInteractiveListControl,
  renderEmptyListMessage,
  type ListboxHitTestMetrics,
  renderKeyedChildren,
  syncSelectOptions
} from './render-helpers';

const OPENED_IMAGES_MAX_VISIBLE_ROWS = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

interface OpenedImagesPanelCallbacks {
  onOpenedImageSelected: (sessionId: string) => void;
  onOpenedImageRowClick: () => void;
  onOpenedImageDisplayNameChange: (sessionId: string, displayName: string) => void;
  onReorderOpenedImage: (
    draggedSessionId: string,
    targetSessionId: string,
    placement: OpenedImageDropPlacement
  ) => void;
  onDisplayCacheBudgetChange: (mb: number) => void;
  onReloadSelectedOpenedImage: (sessionId: string) => void;
  onCloseSelectedOpenedImage: (sessionId: string) => void;
}

interface OpenedImageDropTarget {
  sessionId: string;
  placement: OpenedImageDropPlacement;
}

interface OpenedImageDragState {
  sessionId: string;
  startY: number;
  lastTargetKey: string | null;
  dropTarget: OpenedImageDropTarget | null;
  isDragging: boolean;
}

interface OpenedFileRenameState {
  sessionId: string;
  initialLabel: string;
}

interface OpenedFileRowRefs {
  thumbnail: HTMLElement;
  label: HTMLSpanElement;
  renameInput: HTMLInputElement | null;
  reloadButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
}

const openedFileRowRefs = new WeakMap<HTMLElement, OpenedFileRowRefs>();

export class OpenedImagesPanel implements Disposable {
  private readonly disposables = new DisposableBag();
  private isLoading = false;
  private openedImageCount = 0;
  private openedImagesActiveId: string | null = null;
  private openedImageItems: OpenedImageOptionItem[] = [];
  private suppressOpenedImageSelectionUntilMs = 0;
  private openedImageDragState: OpenedImageDragState | null = null;
  private openedFileRenameState: OpenedFileRenameState | null = null;
  private restoreOpenedFilesFocusAfterLoading = false;
  private displayCacheBudgetMb = 256;
  private disposed = false;

  constructor(
    private readonly elements: OpenedImagesPanelElements,
    private readonly callbacks: OpenedImagesPanelCallbacks
  ) {
    this.elements.openedImagesSelect.disabled = true;
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
    this.disposables.addEventListener(this.elements.openedImagesSelect, 'change', onOpenedImagesSelect);
    this.disposables.addEventListener(this.elements.openedImagesSelect, 'input', onOpenedImagesSelect);
    this.disposables.addEventListener(this.elements.openedImagesSelect, 'mousedown', (event) => {
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
        lastTargetKey: null,
        dropTarget: null,
        isDragging: false
      };
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'mousedown', (event) => {
      if (isOpenedFileRenameInput(event.target)) {
        return;
      }

      this.commitActiveOpenedFileRename();

      if (event.button !== 0 || this.elements.openedImagesSelect.disabled) {
        return;
      }

      const row = findClosestListRow(event.target, 'sessionId');
      if (!row) {
        return;
      }

      event.preventDefault();
      row.focus();
      this.callbacks.onOpenedImageRowClick();

      const sessionId = row.dataset.sessionId ?? '';
      this.elements.openedImagesSelect.value = sessionId;
      if (sessionId !== this.openedImagesActiveId) {
        this.chooseOpenedImage(sessionId);
      }

      this.openedImageDragState = {
        sessionId,
        startY: event.clientY,
        lastTargetKey: null,
        dropTarget: null,
        isDragging: false
      };
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'dblclick', (event) => {
      if (isOpenedFileRenameInput(event.target)) {
        return;
      }

      const label =
        event.target instanceof Element ? event.target.closest<HTMLElement>('.opened-file-label') : null;
      if (!label) {
        return;
      }

      const row = findClosestListRow(label, 'sessionId');
      if (
        !row ||
        !row.contains(label) ||
        row.getAttribute('aria-disabled') === 'true' ||
        isNestedInteractiveListControl(event.target, row)
      ) {
        return;
      }

      event.preventDefault();
      if (!this.elements.openedImagesSelect.disabled) {
        const sessionId = row.dataset.sessionId ?? '';
        this.elements.openedImagesSelect.value = sessionId;
        if (sessionId !== this.openedImagesActiveId) {
          this.chooseOpenedImage(sessionId);
        }
        this.startOpenedFileRename(sessionId);
      }
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'keydown', (event) => {
      if (this.handleOpenedFileRenameInputKeyDown(event)) {
        return;
      }

      const reorderDelta = getOpenedFilesKeyboardReorderDelta(event);
      if (reorderDelta !== null) {
        if (this.reorderActiveItem(reorderDelta)) {
          event.preventDefault();
        }
        return;
      }
      if (isOpenedFilesKeyboardReorderCandidate(event)) {
        return;
      }

      if (event.key === 'Enter') {
        const row = findClosestListRow(event.target, 'sessionId');
        if (row && !isNestedInteractiveListControl(event.target, row)) {
          event.preventDefault();
          if (!this.elements.openedImagesSelect.disabled) {
            const sessionId = row.dataset.sessionId ?? '';
            this.elements.openedImagesSelect.value = sessionId;
            if (sessionId !== this.openedImagesActiveId) {
              this.chooseOpenedImage(sessionId);
            }
            this.startOpenedFileRename(sessionId);
          }
          return;
        }
      }

      handleImageBrowserListKeyDown(event, this.elements.openedFilesList, (row) => {
        if (this.elements.openedImagesSelect.disabled) {
          return;
        }
        this.chooseOpenedImage(row.dataset.sessionId ?? '');
      });
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'focusout', (event) => {
      if (isOpenedFileRenameInput(event.target)) {
        this.commitOpenedFileRename(event.target);
      }
    });

    this.disposables.addEventListener(this.elements.displayCacheBudgetInput, 'change', (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        this.setDisplayCacheBudget(this.displayCacheBudgetMb);
        return;
      }

      this.callbacks.onDisplayCacheBudgetChange(value);
    });

    this.disposables.addEventListener(window, 'mousemove', (event) => {
      this.onOpenedImagesMouseMove(event);
    });
    this.disposables.addEventListener(window, 'mouseup', () => {
      this.finishOpenedImagesDrag();
    });
    this.disposables.addEventListener(window, 'blur', () => {
      this.commitActiveOpenedFileRename();
      this.finishOpenedImagesDrag();
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.cancelOpenedFileRename();
    this.finishOpenedImagesDrag();
    this.elements.openedFilesList.replaceChildren();
    this.elements.openedImagesSelect.replaceChildren();
    this.disposables.dispose();
  }

  getOpenedImageCount(): number {
    return this.openedImageCount;
  }

  stepSelection(delta: -1 | 1): boolean {
    if (
      this.disposed ||
      !this.elements.openedFilesList.isConnected ||
      this.elements.openedImagesSelect.disabled ||
      this.elements.openedFilesList.hidden ||
      this.openedImageItems.length === 0
    ) {
      return false;
    }

    const currentId = this.openedImagesActiveId ?? this.elements.openedImagesSelect.value;
    const currentIndex = this.openedImageItems.findIndex((item) => item.id === currentId);
    const anchorIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(this.openedImageItems.length - 1, anchorIndex + delta));
    const nextSessionId = this.openedImageItems[nextIndex]?.id ?? null;
    if (!nextSessionId) {
      return false;
    }

    if (nextSessionId !== this.openedImagesActiveId) {
      this.chooseOpenedImage(nextSessionId);
    }

    return true;
  }

  reorderActiveItem(delta: -1 | 1): boolean {
    if (
      this.disposed ||
      !this.elements.openedFilesList.isConnected ||
      this.elements.openedImagesSelect.disabled ||
      this.elements.openedFilesList.hidden ||
      this.openedImageItems.length === 0
    ) {
      return false;
    }

    const currentId = this.openedImagesActiveId ?? this.elements.openedImagesSelect.value;
    const currentIndex = this.openedImageItems.findIndex((item) => item.id === currentId);
    if (currentIndex < 0) {
      return false;
    }

    const targetIndex = currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= this.openedImageItems.length) {
      return true;
    }

    const targetSessionId = this.openedImageItems[targetIndex]?.id ?? null;
    if (!targetSessionId) {
      return false;
    }

    this.finishOpenedImagesDrag();
    this.openedImagesActiveId = currentId;
    this.elements.openedImagesSelect.value = currentId;
    this.callbacks.onReorderOpenedImage(currentId, targetSessionId, delta < 0 ? 'before' : 'after');
    return true;
  }

  setLoading(loading: boolean): void {
    if (this.disposed) {
      return;
    }

    if (loading) {
      this.finishOpenedImagesDrag();
      this.cancelOpenedFileRename();
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
    if (this.disposed) {
      return;
    }

    this.displayCacheBudgetMb = Math.max(0, Math.round(mb));
    this.elements.displayCacheBudgetInput.value = String(this.displayCacheBudgetMb);
  }

  setDisplayCacheUsage(usedBytes: number, budgetBytes: number): void {
    if (this.disposed) {
      return;
    }

    const state = getDisplayCacheUsageState(usedBytes, budgetBytes);
    this.elements.displayCacheUsage.textContent = state.text;
    this.elements.displayCacheUsage.setAttribute(
      'title',
      `Decoded + retained CPU/GPU residency: ${formatFileSizeMb(usedBytes)} / ${formatFileSizeMb(budgetBytes)}`
    );
    this.elements.displayCacheControl.classList.toggle('is-over-budget', state.overBudget);
    this.elements.displayCacheUsage.classList.toggle('is-over-budget', state.overBudget);
  }

  setOpenedImageOptions(items: OpenedImageOptionItem[], activeId: string | null): void {
    if (this.disposed) {
      return;
    }

    this.openedImageCount = items.length;
    this.openedImageItems = items.map((item) => ({ ...item }));
    if (
      this.openedFileRenameState &&
      !items.some((item) => item.id === this.openedFileRenameState?.sessionId)
    ) {
      this.openedFileRenameState = null;
    }
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
      this.openedFileRenameState = null;
      renderEmptyListMessage(this.elements.openedFilesList, 'No open files');
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
          disabled,
          editing: this.openedFileRenameState?.sessionId === item.id,
          dragging: this.openedImageDragState?.isDragging === true && this.openedImageDragState.sessionId === item.id,
          dropPlacement:
            this.openedImageDragState?.isDragging === true && this.openedImageDragState.dropTarget?.sessionId === item.id
              ? this.openedImageDragState.dropTarget.placement
              : null
        });
        return row;
      }
    );

    this.applyOpenedImageDragState();

    if (shouldRestoreFocus) {
      focusSelectedImageBrowserRow(this.elements.openedFilesList);
    }
  }

  private chooseOpenedImage(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    if (!sessionId || this.elements.openedImagesSelect.disabled) {
      return;
    }

    this.elements.openedImagesSelect.value = sessionId;
    this.openedImagesActiveId = sessionId;
    this.renderOpenedFileRows();
    this.callbacks.onOpenedImageSelected(sessionId);
  }

  private startOpenedFileRename(sessionId: string): void {
    if (this.disposed || !sessionId || this.elements.openedImagesSelect.disabled) {
      return;
    }

    const item = this.openedImageItems.find((current) => current.id === sessionId);
    if (!item) {
      return;
    }

    this.finishOpenedImagesDrag();
    this.openedFileRenameState = {
      sessionId,
      initialLabel: item.label
    };
    this.renderOpenedFileRows();

    const input = this.getOpenedFileRenameInput(sessionId);
    input?.focus();
    input?.select();
  }

  private handleOpenedFileRenameInputKeyDown(event: KeyboardEvent): boolean {
    if (!isOpenedFileRenameInput(event.target)) {
      return false;
    }

    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitOpenedFileRename(event.target);
      return true;
    }

    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      this.cancelOpenedFileRename();
      this.renderOpenedFileRows();
      focusSelectedImageBrowserRow(this.elements.openedFilesList);
      return true;
    }

    return true;
  }

  private commitActiveOpenedFileRename(): void {
    const input = this.elements.openedFilesList.querySelector<HTMLInputElement>('.opened-file-rename-input');
    if (input) {
      this.commitOpenedFileRename(input);
    }
  }

  private commitOpenedFileRename(input: HTMLInputElement): void {
    const renameState = this.openedFileRenameState;
    if (!renameState || input.dataset.sessionId !== renameState.sessionId) {
      return;
    }

    const nextDisplayName = input.value.trim();
    this.openedFileRenameState = null;

    if (nextDisplayName && nextDisplayName !== renameState.initialLabel.trim()) {
      this.callbacks.onOpenedImageDisplayNameChange(renameState.sessionId, nextDisplayName);
    }

    this.renderOpenedFileRows();
  }

  private cancelOpenedFileRename(): void {
    this.openedFileRenameState = null;
  }

  private getOpenedFileRenameInput(sessionId: string): HTMLInputElement | null {
    for (const row of this.elements.openedFilesList.querySelectorAll<HTMLElement>('.opened-file-row')) {
      if (row.dataset.sessionId === sessionId) {
        return row.querySelector<HTMLInputElement>('.opened-file-rename-input');
      }
    }

    return null;
  }

  private onOpenedImagesMouseMove(event: MouseEvent): void {
    if (this.disposed) {
      return;
    }

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
      this.elements.openedFilesList.classList.add('is-reordering');
    }

    const dropTarget = this.getOpenedImageDropTargetAtClientY(event.clientY);
    dragState.dropTarget = dropTarget;
    this.applyOpenedImageDragState();

    if (!dropTarget) {
      dragState.lastTargetKey = null;
      return;
    }

    const targetKey = serializeOpenedImageDropTarget(dropTarget);
    if (targetKey === dragState.lastTargetKey) {
      return;
    }

    dragState.lastTargetKey = targetKey;
    if (dropTarget.sessionId === dragState.sessionId) {
      return;
    }

    this.callbacks.onReorderOpenedImage(dragState.sessionId, dropTarget.sessionId, dropTarget.placement);
  }

  private finishOpenedImagesDrag(): void {
    const dragState = this.openedImageDragState;
    this.openedImageDragState = null;
    this.elements.openedFilesList.classList.remove('is-reordering');
    this.applyOpenedImageDragState();

    const activeId = this.openedImagesActiveId;
    if (dragState?.isDragging && activeId) {
      this.elements.openedImagesSelect.value = activeId;
    }

    if (dragState?.isDragging) {
      this.suppressOpenedImageSelectionUntilMs = performance.now() + 120;
    }
  }

  private applyOpenedImageDragState(): void {
    for (const row of this.elements.openedFilesList.querySelectorAll<HTMLElement>('.opened-file-row')) {
      const sessionId = row.dataset.sessionId ?? null;
      const dropPlacement =
        this.openedImageDragState?.isDragging === true &&
        sessionId &&
        this.openedImageDragState.dropTarget?.sessionId === sessionId
          ? this.openedImageDragState.dropTarget.placement
          : null;

      row.classList.toggle(
        'opened-file-row--dragging',
        this.openedImageDragState?.isDragging === true && sessionId === this.openedImageDragState.sessionId
      );
      row.classList.toggle('opened-file-row--drop-before', dropPlacement === 'before');
      row.classList.toggle('opened-file-row--drop-after', dropPlacement === 'after');
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

  private getOpenedImageDropTargetAtClientY(clientY: number): OpenedImageDropTarget | null {
    const rows = getImageBrowserRows(this.elements.openedFilesList);
    if (rows.length === 0) {
      return null;
    }

    const listRect = this.elements.openedFilesList.getBoundingClientRect();
    if (listRect.height <= 0 || clientY < listRect.top || clientY > listRect.bottom) {
      return null;
    }

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) {
        continue;
      }

      const sessionId = row.dataset.sessionId ?? null;
      if (!sessionId) {
        return null;
      }

      return {
        sessionId,
        placement: clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      };
    }

    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    const firstSessionId = firstRow?.dataset.sessionId ?? null;
    const lastSessionId = lastRow?.dataset.sessionId ?? null;
    if (!firstSessionId || !lastSessionId) {
      return null;
    }

    if (clientY < firstRow.getBoundingClientRect().top) {
      return {
        sessionId: firstSessionId,
        placement: 'before'
      };
    }

    return {
      sessionId: lastSessionId,
      placement: 'after'
    };
  }
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

  const grip = createOpenedFileGrip();
  const thumbnail = createOpenedFileThumbnail(item.thumbnailDataUrl ?? null);

  const label = document.createElement('span');
  label.className = 'image-browser-row-label opened-file-label';

  const actions = document.createElement('span');
  actions.className = 'opened-file-actions';

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

  actions.append(reloadButton, closeButton);
  row.append(grip, thumbnail, label, actions);
  openedFileRowRefs.set(row, { thumbnail, label, renameInput: null, reloadButton, closeButton });
  return row;
}

function updateOpenedFileRow(
  row: HTMLDivElement,
  item: OpenedImageOptionItem,
  options: {
    sizeText: string;
    selected: boolean;
    disabled: boolean;
    editing: boolean;
    dragging: boolean;
    dropPlacement: OpenedImageDropPlacement | null;
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
  row.classList.toggle('opened-file-row--dragging', options.dragging);
  row.classList.toggle('opened-file-row--drop-before', options.dropPlacement === 'before');
  row.classList.toggle('opened-file-row--drop-after', options.dropPlacement === 'after');

  updateOpenedFileLabel(refs, item, options.editing, options.disabled);
  refs.label.title = `Path: ${item.sourceDetail ?? item.label}\nSize: ${options.sizeText}`;

  const nextThumbnail = createOpenedFileThumbnail(item.thumbnailDataUrl ?? null);
  if (!sameThumbnail(refs.thumbnail, nextThumbnail)) {
    row.replaceChild(nextThumbnail, refs.thumbnail);
    refs.thumbnail = nextThumbnail;
  }

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

function updateOpenedFileLabel(
  refs: OpenedFileRowRefs,
  item: OpenedImageOptionItem,
  editing: boolean,
  disabled: boolean
): void {
  refs.label.classList.toggle('opened-file-label--editing', editing);
  if (!editing) {
    refs.renameInput = null;
    refs.label.textContent = item.label;
    return;
  }

  let input = refs.renameInput;
  if (!input || !refs.label.contains(input)) {
    input = createOpenedFileRenameInput(item);
    refs.renameInput = input;
    refs.label.replaceChildren(input);
  }

  input.disabled = disabled;
  input.dataset.sessionId = item.id;
  input.setAttribute('aria-label', `Rename ${item.label}`);
  input.title = `Rename ${item.label}`;
}

function createOpenedFileRenameInput(item: OpenedImageOptionItem): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'opened-file-rename-input';
  input.value = item.label;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.dataset.sessionId = item.id;
  input.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
  input.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  return input;
}

function createOpenedFileGrip(): HTMLSpanElement {
  const grip = document.createElement('span');
  grip.className = 'opened-file-grip';
  grip.setAttribute('aria-hidden', 'true');
  return grip;
}

function createOpenedFileActionButton(options: {
  iconName: 'reload' | 'close';
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
    iconName: 'reload' | 'close';
    label: string;
    disabled: boolean;
  }
): void {
  button.disabled = options.disabled;
  button.setAttribute('aria-label', options.label);
  button.title = options.label;
  button.replaceChildren(createOpenedFileActionIcon(options.iconName));
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

function createOpenedFileActionIcon(iconName: 'reload' | 'close'): SVGSVGElement {
  const svg = createSvgElement('svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

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

function isOpenedFileRenameInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.classList.contains('opened-file-rename-input');
}

function getOpenedFilesKeyboardReorderDelta(event: KeyboardEvent): -1 | 1 | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }

  return getVerticalArrowKeyDelta(event.key);
}

function isOpenedFilesKeyboardReorderCandidate(event: KeyboardEvent): boolean {
  return event.altKey && getVerticalArrowKeyDelta(event.key) !== null;
}

function getVerticalArrowKeyDelta(key: string): -1 | 1 | null {
  if (key === 'ArrowUp' || key === 'Up') {
    return -1;
  }

  if (key === 'ArrowDown' || key === 'Down') {
    return 1;
  }

  return null;
}

function serializeOpenedImageDropTarget(target: OpenedImageDropTarget): string {
  return `${target.sessionId}:${target.placement}`;
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
