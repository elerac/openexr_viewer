import { DisposableBag, type Disposable } from '../lifecycle';
import type { WindowPreviewElements } from './elements';

const WINDOW_PREVIEW_CLASS = 'is-window-preview';

export class WindowPreviewController implements Disposable {
  private readonly disposables = new DisposableBag();
  private openedImageCount = 0;
  private fullScreenPreviewActive = false;
  private fullScreenPreviewFallbackActive = false;
  private disposed = false;

  constructor(private readonly elements: WindowPreviewElements) {
    this.disposables.addEventListener(document, 'fullscreenchange', () => {
      this.syncState();
    });
    this.updateMenuItems();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  setOpenedImageCount(count: number): void {
    this.openedImageCount = count;
    this.updateMenuItems();
  }

  isActive(): boolean {
    return this.fullScreenPreviewActive;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.enter();
      return;
    }

    await this.exit();
  }

  async enter(): Promise<void> {
    if (this.disposed || this.openedImageCount === 0) {
      return;
    }

    if (this.fullScreenPreviewActive || document.fullscreenElement === this.elements.viewerContainer) {
      this.syncState();
      return;
    }

    const requestFullscreen = this.elements.viewerContainer.requestFullscreen;
    if (typeof requestFullscreen === 'function') {
      try {
        await requestFullscreen.call(this.elements.viewerContainer);
        this.syncState();
        return;
      } catch {
        // Fall back to the in-window preview mode when the browser fullscreen API is unavailable.
      }
    }

    this.setWindowPreviewFallback(true);
    this.syncState();
  }

  async exit(): Promise<void> {
    if (
      this.disposed ||
      (!this.fullScreenPreviewActive &&
        !this.fullScreenPreviewFallbackActive &&
        document.fullscreenElement !== this.elements.viewerContainer)
    ) {
      return;
    }

    if (this.fullScreenPreviewFallbackActive) {
      this.setWindowPreviewFallback(false);
      this.syncState();
      return;
    }

    if (document.fullscreenElement === this.elements.viewerContainer && typeof document.exitFullscreen === 'function') {
      try {
        await document.exitFullscreen();
      } catch {
        // If the browser blocks exit, keep the current state and let fullscreenchange reconcile later.
      }
    }

    this.syncState();
  }

  private updateMenuItems(): void {
    this.elements.windowNormalMenuItem.disabled = false;
    this.elements.windowNormalMenuItem.setAttribute('aria-checked', this.fullScreenPreviewActive ? 'false' : 'true');
    this.elements.windowFullScreenPreviewMenuItem.disabled = this.openedImageCount === 0;
    this.elements.windowFullScreenPreviewMenuItem.setAttribute(
      'aria-checked',
      this.fullScreenPreviewActive ? 'true' : 'false'
    );
  }

  private syncState(): void {
    if (this.disposed) {
      return;
    }

    this.fullScreenPreviewActive =
      document.fullscreenElement === this.elements.viewerContainer || this.fullScreenPreviewFallbackActive;
    if (!this.fullScreenPreviewActive) {
      this.setWindowPreviewFallback(false);
    }
    this.updateMenuItems();
  }

  private setWindowPreviewFallback(active: boolean): void {
    this.fullScreenPreviewFallbackActive = active;
    this.elements.appShell.classList.toggle(WINDOW_PREVIEW_CLASS, active);
  }
}
