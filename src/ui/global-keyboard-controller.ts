import { DisposableBag, type Disposable } from '../lifecycle';
import type {
  ViewerKeyboardNavigationDirection,
  ViewerKeyboardNavigationInput,
  ViewerMode
} from '../types';
import type { GlobalKeyboardControllerElements } from './elements';

export type VerticalNavigationTarget = 'openedFiles' | 'channelView';

interface GlobalKeyboardControllerCallbacks {
  isExportImageDialogOpen: () => boolean;
  isExportImageDialogBusy: () => boolean;
  closeExportImageDialog: (restoreFocus?: boolean) => void;
  isExportImageBatchDialogOpen: () => boolean;
  isExportImageBatchDialogBusy: () => boolean;
  closeExportImageBatchDialog: (restoreFocus?: boolean) => void;
  isExportColormapDialogOpen: () => boolean;
  isExportColormapDialogBusy: () => boolean;
  closeExportColormapDialog: (restoreFocus?: boolean) => void;
  isScreenshotSelectionActive: () => boolean;
  cancelScreenshotSelection: () => void;
  isFolderLoadDialogOpen: () => boolean;
  closeFolderLoadDialog: (restoreFocus?: boolean) => void;
  isSettingsDialogOpen: () => boolean;
  closeSettingsDialog: (restoreFocus?: boolean) => void;
  isWindowPreviewActive: () => boolean;
  setWindowPreviewEnabled: (enabled: boolean) => void;
  hasOpenMenu: () => boolean;
  openExportImageDialog: () => void;
  getViewerMode: () => ViewerMode;
  getOpenedImageCount: () => number;
  onViewerKeyboardNavigationInputChange: (input: ViewerKeyboardNavigationInput) => void;
  routeVerticalNavigation: (target: VerticalNavigationTarget, delta: -1 | 1) => boolean;
  routeOpenedFilesReorder: (delta: -1 | 1) => boolean;
  routeHorizontalNavigation: (delta: -1 | 1) => boolean;
  canRouteChannelViewNavigation: () => boolean;
}

export class GlobalKeyboardController implements Disposable {
  private readonly disposables = new DisposableBag();
  private viewerKeyboardNavigationInput = createViewerKeyboardNavigationInput();
  private verticalNavigationTarget: VerticalNavigationTarget = 'openedFiles';
  private disposed = false;

  constructor(
    private readonly elements: GlobalKeyboardControllerElements,
    private readonly callbacks: GlobalKeyboardControllerCallbacks
  ) {
    this.disposables.addEventListener(document, 'keydown', (event) => {
      if (event.key === 'Escape' && this.callbacks.isExportImageDialogOpen() && !this.callbacks.isExportImageDialogBusy()) {
        event.preventDefault();
        this.callbacks.closeExportImageDialog(true);
        return;
      }

      if (
        event.key === 'Escape' &&
        this.callbacks.isExportImageBatchDialogOpen() &&
        !this.callbacks.isExportImageBatchDialogBusy()
      ) {
        event.preventDefault();
        this.callbacks.closeExportImageBatchDialog(true);
        return;
      }

      if (
        event.key === 'Escape' &&
        this.callbacks.isExportColormapDialogOpen() &&
        !this.callbacks.isExportColormapDialogBusy()
      ) {
        event.preventDefault();
        this.callbacks.closeExportColormapDialog(true);
        return;
      }

      if (event.key === 'Escape' && this.callbacks.isFolderLoadDialogOpen()) {
        event.preventDefault();
        this.callbacks.closeFolderLoadDialog(true);
        return;
      }

      if (event.key === 'Escape' && this.callbacks.isSettingsDialogOpen()) {
        event.preventDefault();
        this.callbacks.closeSettingsDialog(true);
        return;
      }

      if (event.key === 'Escape' && this.callbacks.isWindowPreviewActive()) {
        event.preventDefault();
        this.callbacks.setWindowPreviewEnabled(false);
        return;
      }

      if (event.key === 'Escape' && this.callbacks.isScreenshotSelectionActive()) {
        event.preventDefault();
        this.callbacks.cancelScreenshotSelection();
        return;
      }

      if (isPrimarySaveKeyboardEvent(event)) {
        event.preventDefault();
        if (!this.isDialogOpen()) {
          this.callbacks.openExportImageDialog();
        }
        return;
      }

      if (this.handleGlobalViewerKeyboardNavigationKeyDown(event)) {
        return;
      }

      if (this.handleGlobalOpenedFilesReorderKeyDown(event)) {
        return;
      }

      if (this.handleGlobalPanelNavigationKeyDown(event)) {
        return;
      }

      if (
        (event.key === 'f' || event.key === 'F') &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !isEditableKeyboardEvent(event) &&
        this.callbacks.getOpenedImageCount() > 0
      ) {
        event.preventDefault();
        this.callbacks.setWindowPreviewEnabled(!this.callbacks.isWindowPreviewActive());
      }
    });

    this.disposables.addEventListener(document, 'keyup', (event) => {
      this.handleGlobalViewerKeyboardNavigationKeyUp(event);
    });

    this.disposables.addEventListener(window, 'blur', () => {
      this.clearViewerKeyboardNavigationInput();
    });

    this.disposables.addEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        this.clearViewerKeyboardNavigationInput();
      }
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  clearViewerKeyboardNavigationInput(): void {
    if (!hasViewerKeyboardNavigationInput(this.viewerKeyboardNavigationInput)) {
      return;
    }

    this.viewerKeyboardNavigationInput = createViewerKeyboardNavigationInput();
    this.callbacks.onViewerKeyboardNavigationInputChange({
      ...this.viewerKeyboardNavigationInput
    });
  }

  setVerticalNavigationTarget(target: VerticalNavigationTarget): void {
    this.verticalNavigationTarget = target;
  }

  normalizeVerticalNavigationTarget(): VerticalNavigationTarget {
    if (this.verticalNavigationTarget === 'channelView' && !this.callbacks.canRouteChannelViewNavigation()) {
      this.verticalNavigationTarget = 'openedFiles';
    }

    return this.verticalNavigationTarget;
  }

  private handleGlobalPanelNavigationKeyDown(event: KeyboardEvent): boolean {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      this.isLocalKeyboardNavigationEvent(event) ||
      isEditableKeyboardEvent(event) ||
      this.callbacks.isExportImageDialogOpen() ||
      this.callbacks.isExportImageBatchDialogOpen() ||
      this.callbacks.isExportColormapDialogOpen() ||
      this.callbacks.isSettingsDialogOpen() ||
      this.callbacks.isScreenshotSelectionActive() ||
      this.callbacks.isWindowPreviewActive() ||
      this.callbacks.hasOpenMenu()
    ) {
      return false;
    }

    if (event.key === 'ArrowUp' || event.key === 'Up') {
      if (!this.routeVerticalNavigation(-1)) {
        return false;
      }
      event.preventDefault();
      return true;
    }

    if (event.key === 'ArrowDown' || event.key === 'Down') {
      if (!this.routeVerticalNavigation(1)) {
        return false;
      }
      event.preventDefault();
      return true;
    }

    if (event.key === 'ArrowLeft' || event.key === 'Left') {
      if (!this.callbacks.routeHorizontalNavigation(-1)) {
        return false;
      }
      event.preventDefault();
      return true;
    }

    if (event.key === 'ArrowRight' || event.key === 'Right') {
      if (!this.callbacks.routeHorizontalNavigation(1)) {
        return false;
      }
      event.preventDefault();
      return true;
    }

    return false;
  }

  private handleGlobalOpenedFilesReorderKeyDown(event: KeyboardEvent): boolean {
    const delta = getOpenedFilesKeyboardReorderDelta(event);
    if (
      event.defaultPrevented ||
      delta === null ||
      this.isLocalKeyboardNavigationEvent(event) ||
      isEditableKeyboardEvent(event) ||
      this.callbacks.isExportImageDialogOpen() ||
      this.callbacks.isExportImageBatchDialogOpen() ||
      this.callbacks.isExportColormapDialogOpen() ||
      this.callbacks.isFolderLoadDialogOpen() ||
      this.callbacks.isSettingsDialogOpen() ||
      this.callbacks.isScreenshotSelectionActive() ||
      this.callbacks.isWindowPreviewActive() ||
      this.callbacks.hasOpenMenu()
    ) {
      return false;
    }

    if (this.normalizeVerticalNavigationTarget() !== 'openedFiles') {
      return false;
    }

    if (!this.callbacks.routeOpenedFilesReorder(delta)) {
      return false;
    }

    event.preventDefault();
    return true;
  }

  private handleGlobalViewerKeyboardNavigationKeyDown(event: KeyboardEvent): boolean {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isEditableKeyboardEvent(event) ||
      this.callbacks.isExportImageDialogOpen() ||
      this.callbacks.isExportImageBatchDialogOpen() ||
      this.callbacks.isExportColormapDialogOpen() ||
      this.callbacks.isSettingsDialogOpen() ||
      this.callbacks.isScreenshotSelectionActive() ||
      this.callbacks.getOpenedImageCount() === 0 ||
      this.callbacks.isWindowPreviewActive() ||
      this.callbacks.hasOpenMenu()
    ) {
      return false;
    }

    const viewerMode = this.callbacks.getViewerMode();
    if (viewerMode !== 'image' && viewerMode !== 'panorama') {
      return false;
    }

    const direction = getViewerKeyboardNavigationDirection(event.key);
    if (!direction) {
      return false;
    }

    event.preventDefault();
    if (event.repeat) {
      return true;
    }

    this.setViewerKeyboardNavigationDirectionPressed(direction, true);
    return true;
  }

  private handleGlobalViewerKeyboardNavigationKeyUp(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) {
      return false;
    }

    const direction = getViewerKeyboardNavigationDirection(event.key);
    if (!direction || !this.viewerKeyboardNavigationInput[direction]) {
      return false;
    }

    event.preventDefault();
    this.setViewerKeyboardNavigationDirectionPressed(direction, false);
    return true;
  }

  private setViewerKeyboardNavigationDirectionPressed(
    direction: ViewerKeyboardNavigationDirection,
    pressed: boolean
  ): void {
    if (this.viewerKeyboardNavigationInput[direction] === pressed) {
      return;
    }

    this.viewerKeyboardNavigationInput = {
      ...this.viewerKeyboardNavigationInput,
      [direction]: pressed
    };
    this.callbacks.onViewerKeyboardNavigationInputChange({
      ...this.viewerKeyboardNavigationInput
    });
  }

  private routeVerticalNavigation(delta: -1 | 1): boolean {
    const target = this.normalizeVerticalNavigationTarget();
    return this.callbacks.routeVerticalNavigation(target, delta);
  }

  private isLocalKeyboardNavigationEvent(event: KeyboardEvent): boolean {
    const target = event.target;
    if (!(target instanceof Node)) {
      return false;
    }

    if (
      this.elements.imagePanelResizer.contains(target) ||
      this.elements.rightPanelResizer.contains(target) ||
      this.elements.bottomPanelResizer.contains(target) ||
      this.elements.appMenuBar.contains(target)
    ) {
      return true;
    }

    if (event.key === 'ArrowUp' || event.key === 'Up' || event.key === 'ArrowDown' || event.key === 'Down') {
      return (
        this.elements.openedFilesList.contains(target) ||
        this.elements.partsLayersList.contains(target) ||
        this.elements.channelViewList.contains(target)
      );
    }

    if (event.key === 'ArrowLeft' || event.key === 'Left' || event.key === 'ArrowRight' || event.key === 'Right') {
      return this.elements.channelThumbnailStrip.contains(target);
    }

    return false;
  }

  private isDialogOpen(): boolean {
    return (
      this.callbacks.isExportImageDialogOpen() ||
      this.callbacks.isExportImageBatchDialogOpen() ||
      this.callbacks.isExportColormapDialogOpen() ||
      this.callbacks.isFolderLoadDialogOpen() ||
      this.callbacks.isSettingsDialogOpen()
    );
  }
}

function isPrimarySaveKeyboardEvent(event: KeyboardEvent): boolean {
  return (
    (event.key === 's' || event.key === 'S') &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) {
    return false;
  }

  const element = target instanceof HTMLElement ? target : target.parentElement;
  if (!element) {
    return false;
  }

  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable ||
    element.closest('[contenteditable], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null
  );
}

function isEditableKeyboardEvent(event: KeyboardEvent): boolean {
  if (isEditableEventTarget(event.target) || isEditableEventTarget(document.activeElement)) {
    return true;
  }

  return typeof event.composedPath === 'function' && event.composedPath().some((target) => isEditableEventTarget(target));
}

function createViewerKeyboardNavigationInput(): ViewerKeyboardNavigationInput {
  return {
    up: false,
    left: false,
    down: false,
    right: false
  };
}

function hasViewerKeyboardNavigationInput(input: ViewerKeyboardNavigationInput): boolean {
  return input.up || input.left || input.down || input.right;
}

function getOpenedFilesKeyboardReorderDelta(event: KeyboardEvent): -1 | 1 | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }

  if (event.key === 'ArrowUp' || event.key === 'Up') {
    return -1;
  }

  if (event.key === 'ArrowDown' || event.key === 'Down') {
    return 1;
  }

  return null;
}

function getViewerKeyboardNavigationDirection(key: string): ViewerKeyboardNavigationDirection | null {
  switch (key) {
    case 'w':
    case 'W':
      return 'up';
    case 'a':
    case 'A':
      return 'left';
    case 's':
    case 'S':
      return 'down';
    case 'd':
    case 'D':
      return 'right';
    default:
      return null;
  }
}
