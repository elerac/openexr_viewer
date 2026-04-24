import { DisposableBag, type Disposable } from '../lifecycle';
import type {
  PanoramaKeyboardOrbitDirection,
  PanoramaKeyboardOrbitInput,
  ViewerMode
} from '../types';
import type { GlobalKeyboardControllerElements } from './elements';

export type VerticalNavigationTarget = 'openedFiles' | 'channelView';

interface GlobalKeyboardControllerCallbacks {
  isExportImageDialogOpen: () => boolean;
  isExportImageDialogBusy: () => boolean;
  closeExportImageDialog: (restoreFocus?: boolean) => void;
  isExportColormapDialogOpen: () => boolean;
  isExportColormapDialogBusy: () => boolean;
  closeExportColormapDialog: (restoreFocus?: boolean) => void;
  isWindowPreviewActive: () => boolean;
  setWindowPreviewEnabled: (enabled: boolean) => void;
  hasOpenMenu: () => boolean;
  getViewerMode: () => ViewerMode;
  getOpenedImageCount: () => number;
  onPanoramaKeyboardOrbitInputChange: (input: PanoramaKeyboardOrbitInput) => void;
  routeVerticalNavigation: (target: VerticalNavigationTarget, delta: -1 | 1) => boolean;
  routeHorizontalNavigation: (delta: -1 | 1) => boolean;
  canRouteChannelViewNavigation: () => boolean;
}

export class GlobalKeyboardController implements Disposable {
  private readonly disposables = new DisposableBag();
  private panoramaKeyboardOrbitInput = createPanoramaKeyboardOrbitInput();
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
        this.callbacks.isExportColormapDialogOpen() &&
        !this.callbacks.isExportColormapDialogBusy()
      ) {
        event.preventDefault();
        this.callbacks.closeExportColormapDialog(true);
        return;
      }

      if (event.key === 'Escape' && this.callbacks.isWindowPreviewActive()) {
        event.preventDefault();
        this.callbacks.setWindowPreviewEnabled(false);
        return;
      }

      if (this.handleGlobalPanoramaKeyboardOrbitKeyDown(event)) {
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
      this.handleGlobalPanoramaKeyboardOrbitKeyUp(event);
    });

    this.disposables.addEventListener(window, 'blur', () => {
      this.clearPanoramaKeyboardOrbitInput();
    });

    this.disposables.addEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        this.clearPanoramaKeyboardOrbitInput();
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

  clearPanoramaKeyboardOrbitInput(): void {
    if (!hasPanoramaKeyboardOrbitInput(this.panoramaKeyboardOrbitInput)) {
      return;
    }

    this.panoramaKeyboardOrbitInput = createPanoramaKeyboardOrbitInput();
    this.callbacks.onPanoramaKeyboardOrbitInputChange({
      ...this.panoramaKeyboardOrbitInput
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
      this.callbacks.isExportColormapDialogOpen() ||
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

  private handleGlobalPanoramaKeyboardOrbitKeyDown(event: KeyboardEvent): boolean {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isEditableKeyboardEvent(event) ||
      this.callbacks.isExportImageDialogOpen() ||
      this.callbacks.isExportColormapDialogOpen() ||
      this.callbacks.getViewerMode() !== 'panorama' ||
      this.callbacks.getOpenedImageCount() === 0 ||
      this.callbacks.isWindowPreviewActive() ||
      this.callbacks.hasOpenMenu()
    ) {
      return false;
    }

    const direction = getPanoramaKeyboardOrbitDirection(event.key);
    if (!direction) {
      return false;
    }

    event.preventDefault();
    if (event.repeat) {
      return true;
    }

    this.setPanoramaKeyboardOrbitDirectionPressed(direction, true);
    return true;
  }

  private handleGlobalPanoramaKeyboardOrbitKeyUp(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) {
      return false;
    }

    const direction = getPanoramaKeyboardOrbitDirection(event.key);
    if (!direction || !this.panoramaKeyboardOrbitInput[direction]) {
      return false;
    }

    event.preventDefault();
    this.setPanoramaKeyboardOrbitDirectionPressed(direction, false);
    return true;
  }

  private setPanoramaKeyboardOrbitDirectionPressed(
    direction: PanoramaKeyboardOrbitDirection,
    pressed: boolean
  ): void {
    if (this.panoramaKeyboardOrbitInput[direction] === pressed) {
      return;
    }

    this.panoramaKeyboardOrbitInput = {
      ...this.panoramaKeyboardOrbitInput,
      [direction]: pressed
    };
    this.callbacks.onPanoramaKeyboardOrbitInputChange({
      ...this.panoramaKeyboardOrbitInput
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

function createPanoramaKeyboardOrbitInput(): PanoramaKeyboardOrbitInput {
  return {
    up: false,
    left: false,
    down: false,
    right: false
  };
}

function hasPanoramaKeyboardOrbitInput(input: PanoramaKeyboardOrbitInput): boolean {
  return input.up || input.left || input.down || input.right;
}

function getPanoramaKeyboardOrbitDirection(key: string): PanoramaKeyboardOrbitDirection | null {
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
