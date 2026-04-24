import type { LoadingOverlayElements } from './elements';
import type { Disposable } from '../lifecycle';

const LOADING_OVERLAY_SUBTLE_DELAY_MS = 200;
const LOADING_OVERLAY_DARKENING_DELAY_MS = 1000;
const LOADING_OVERLAY_MESSAGE_DELAY_MS = 1500;
const LOADING_OVERLAY_SUBTLE_CLASS = 'loading-overlay--subtle';
const LOADING_OVERLAY_DARKENING_CLASS = 'loading-overlay--darkening';
const LOADING_OVERLAY_MESSAGE_CLASS = 'loading-overlay--message';

export type LoadingOverlayPhase = 'hidden' | 'subtle' | 'darkening' | 'message';

export class ProgressiveLoadingOverlayDisclosure implements Disposable {
  private active = false;
  private subtleTimer: ReturnType<typeof setTimeout> | null = null;
  private darkeningTimer: ReturnType<typeof setTimeout> | null = null;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly render: (phase: LoadingOverlayPhase) => void) {}

  setLoading(loading: boolean): void {
    if (this.active === loading) {
      return;
    }

    this.active = loading;
    this.clearTimers();

    if (!loading) {
      this.render('hidden');
      return;
    }

    this.render('hidden');
    this.subtleTimer = setTimeout(() => {
      if (this.active) {
        this.render('subtle');
      }
    }, LOADING_OVERLAY_SUBTLE_DELAY_MS);
    this.darkeningTimer = setTimeout(() => {
      if (this.active) {
        this.render('darkening');
      }
    }, LOADING_OVERLAY_DARKENING_DELAY_MS);
    this.messageTimer = setTimeout(() => {
      if (this.active) {
        this.render('message');
      }
    }, LOADING_OVERLAY_MESSAGE_DELAY_MS);
  }

  dispose(): void {
    this.active = false;
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.subtleTimer !== null) {
      clearTimeout(this.subtleTimer);
      this.subtleTimer = null;
    }
    if (this.darkeningTimer !== null) {
      clearTimeout(this.darkeningTimer);
      this.darkeningTimer = null;
    }
    if (this.messageTimer !== null) {
      clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
  }
}

export function renderLoadingOverlayPhase(
  elements: LoadingOverlayElements,
  phase: LoadingOverlayPhase
): void {
  elements.loadingOverlay.classList.toggle('hidden', phase === 'hidden');
  elements.loadingOverlay.classList.toggle(LOADING_OVERLAY_SUBTLE_CLASS, phase === 'subtle');
  elements.loadingOverlay.classList.toggle(LOADING_OVERLAY_DARKENING_CLASS, phase === 'darkening');
  elements.loadingOverlay.classList.toggle(LOADING_OVERLAY_MESSAGE_CLASS, phase === 'message');
}
