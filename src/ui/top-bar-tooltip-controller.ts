import { DisposableBag, type Disposable } from '../lifecycle';
import type { Elements } from './elements';

const TOOLTIP_DELAY_MS = 350;
const TOOLTIP_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

type TooltipButton = HTMLButtonElement & { dataset: { tooltip?: string } };

export class TopBarTooltipController implements Disposable {
  private readonly disposables = new DisposableBag();
  private readonly buttons: TooltipButton[];
  private readonly mutationObserver: MutationObserver | null;
  private activeButton: TooltipButton | null = null;
  private showTimer: number | null = null;
  private disposed = false;

  constructor(private readonly elements: Elements) {
    this.buttons = [
      this.elements.appAutoFitImageButton,
      this.elements.appScreenshotButton,
      this.elements.appFullscreenButton,
      this.elements.settingsDialogButton
    ] as TooltipButton[];
    this.elements.appIconTooltip.hidden = true;

    for (const button of this.buttons) {
      this.disposables.addEventListener(button, 'pointerenter', () => {
        this.scheduleShow(button);
      });
      this.disposables.addEventListener(button, 'pointerleave', () => {
        this.hide();
      });
      this.disposables.addEventListener(button, 'focus', () => {
        this.show(button);
      });
      this.disposables.addEventListener(button, 'blur', () => {
        this.hide();
      });
      this.disposables.addEventListener(button, 'click', () => {
        this.hide();
      });
    }

    this.disposables.addEventListener(document, 'keydown', (event) => {
      if (event.key === 'Escape') {
        this.hide();
      }
    });
    this.disposables.addEventListener(window, 'resize', () => {
      this.reposition();
    });
    this.disposables.addEventListener(window, 'scroll', () => {
      this.reposition();
    }, true);

    this.mutationObserver = typeof MutationObserver === 'function'
      ? new MutationObserver((records) => {
          if (this.activeButton && records.some((record) => record.target === this.activeButton)) {
            this.hide();
          }
        })
      : null;
    for (const button of this.buttons) {
      this.mutationObserver?.observe(button, {
        attributes: true,
        attributeFilter: ['aria-label', 'data-tooltip', 'title', 'disabled']
      });
    }
    this.disposables.add(() => {
      this.mutationObserver?.disconnect();
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.hide();
    this.disposables.dispose();
  }

  private scheduleShow(button: TooltipButton): void {
    this.clearShowTimer();
    this.showTimer = window.setTimeout(() => {
      this.showTimer = null;
      this.show(button);
    }, TOOLTIP_DELAY_MS);
  }

  private show(button: TooltipButton): void {
    if (this.disposed || button.disabled) {
      return;
    }

    const label = button.dataset.tooltip?.trim();
    if (!label) {
      return;
    }

    this.clearShowTimer();
    this.activeButton = button;
    this.elements.appIconTooltip.textContent = label;
    this.elements.appIconTooltip.hidden = false;
    this.elements.appIconTooltip.classList.remove('hidden');
    button.setAttribute('aria-describedby', this.elements.appIconTooltip.id);
    this.reposition();
  }

  private hide(): void {
    this.clearShowTimer();
    if (this.activeButton) {
      this.activeButton.removeAttribute('aria-describedby');
      this.activeButton = null;
    }
    this.elements.appIconTooltip.hidden = true;
    this.elements.appIconTooltip.classList.add('hidden');
    this.elements.appIconTooltip.textContent = '';
  }

  private reposition(): void {
    if (!this.activeButton || this.elements.appIconTooltip.hidden) {
      return;
    }

    const buttonRect = this.activeButton.getBoundingClientRect();
    const tooltipRect = this.elements.appIconTooltip.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const preferredLeft = buttonRect.left + (buttonRect.width - tooltipRect.width) / 2;
    const maxLeft = Math.max(VIEWPORT_MARGIN_PX, viewportWidth - tooltipRect.width - VIEWPORT_MARGIN_PX);
    const left = Math.min(Math.max(VIEWPORT_MARGIN_PX, preferredLeft), maxLeft);
    const top = buttonRect.bottom + TOOLTIP_GAP_PX;

    this.elements.appIconTooltip.style.left = `${left}px`;
    this.elements.appIconTooltip.style.top = `${top}px`;
  }

  private clearShowTimer(): void {
    if (this.showTimer === null) {
      return;
    }

    window.clearTimeout(this.showTimer);
    this.showTimer = null;
  }
}
