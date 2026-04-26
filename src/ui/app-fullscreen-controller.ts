import { DisposableBag, type Disposable } from '../lifecycle';
import type { AppFullscreenElements } from './elements';

const ENTER_FULLSCREEN_LABEL = 'Enter app fullscreen';
const EXIT_FULLSCREEN_LABEL = 'Exit app fullscreen';
const FULLSCREEN_UNAVAILABLE_LABEL = 'App fullscreen unavailable';
const ENTER_FULLSCREEN_TOOLTIP = 'Enter fullscreen';
const EXIT_FULLSCREEN_TOOLTIP = 'Exit fullscreen';
const FULLSCREEN_UNAVAILABLE_TOOLTIP = 'Fullscreen unavailable';

interface AppFullscreenControllerCallbacks {
  onBeforeToggle: () => void;
}

export class AppFullscreenController implements Disposable {
  private readonly disposables = new DisposableBag();
  private disposed = false;

  constructor(
    private readonly elements: AppFullscreenElements,
    private readonly callbacks: AppFullscreenControllerCallbacks
  ) {
    this.disposables.addEventListener(this.elements.appFullscreenButton, 'click', () => {
      void this.toggle();
    });
    this.disposables.addEventListener(document, 'fullscreenchange', () => {
      this.syncState();
    });
    this.disposables.addEventListener(document, 'fullscreenerror', () => {
      this.syncState();
    });
    this.syncState();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  private async toggle(): Promise<void> {
    if (this.disposed || !this.isSupported() || this.elements.appFullscreenButton.disabled) {
      return;
    }

    this.callbacks.onBeforeToggle();

    if (document.fullscreenElement === this.elements.appShell) {
      await this.exit();
      return;
    }

    await this.enter();
  }

  private async enter(): Promise<void> {
    const requestFullscreen = this.elements.appShell.requestFullscreen;
    if (typeof requestFullscreen !== 'function') {
      this.syncState();
      return;
    }

    try {
      await requestFullscreen.call(this.elements.appShell);
    } catch {
      // Browser/user-agent rejection is reflected by the next state sync.
    }

    this.syncState();
  }

  private async exit(): Promise<void> {
    if (document.fullscreenElement !== this.elements.appShell || typeof document.exitFullscreen !== 'function') {
      this.syncState();
      return;
    }

    try {
      await document.exitFullscreen();
    } catch {
      // Keep the visible state aligned with the browser's current fullscreen element.
    }

    this.syncState();
  }

  private syncState(): void {
    if (this.disposed) {
      return;
    }

    const supported = this.isSupported();
    const active = document.fullscreenElement === this.elements.appShell;
    const label = supported ? (active ? EXIT_FULLSCREEN_LABEL : ENTER_FULLSCREEN_LABEL) : FULLSCREEN_UNAVAILABLE_LABEL;
    const tooltip = supported
      ? (active ? EXIT_FULLSCREEN_TOOLTIP : ENTER_FULLSCREEN_TOOLTIP)
      : FULLSCREEN_UNAVAILABLE_TOOLTIP;

    this.elements.appFullscreenButton.disabled = !supported;
    this.elements.appFullscreenButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    this.elements.appFullscreenButton.setAttribute('aria-label', label);
    this.elements.appFullscreenButton.dataset.tooltip = tooltip;
    this.elements.appFullscreenButton.title = label;
  }

  private isSupported(): boolean {
    return (
      typeof this.elements.appShell.requestFullscreen === 'function' &&
      typeof document.exitFullscreen === 'function'
    );
  }
}
