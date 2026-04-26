import { DisposableBag, type Disposable } from '../lifecycle';
import { bindDialogBackdropDismiss } from './dialog-backdrop';
import type { SettingsDialogElements } from './elements';

interface SettingsDialogCallbacks {
  onBeforeOpen: () => void;
}

export class SettingsDialogController implements Disposable {
  private readonly disposables = new DisposableBag();
  private open = false;
  private disposed = false;

  constructor(
    private readonly elements: SettingsDialogElements,
    private readonly callbacks: SettingsDialogCallbacks
  ) {
    this.disposables.addDisposable(bindDialogBackdropDismiss(this.elements.settingsDialogBackdrop, () => {
      this.close(true);
    }));

    this.disposables.addEventListener(this.elements.settingsDialogButton, 'click', () => {
      if (this.open) {
        this.close(true);
        return;
      }

      this.openDialog();
    });

    this.disposables.addEventListener(this.elements.settingsDialogCloseButton, 'click', () => {
      this.close(true);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.close(false);
    this.disposed = true;
    this.disposables.dispose();
  }

  isOpen(): boolean {
    return this.open;
  }

  openDialog(): void {
    if (this.disposed || this.open) {
      return;
    }

    this.callbacks.onBeforeOpen();
    this.open = true;
    this.elements.settingsDialogBackdrop.classList.remove('hidden');
    this.elements.settingsDialogButton.setAttribute('aria-expanded', 'true');
    this.elements.themeSelect.focus();
  }

  close(restoreFocus = true): void {
    if (this.disposed) {
      return;
    }

    if (!this.open && this.elements.settingsDialogBackdrop.classList.contains('hidden')) {
      return;
    }

    this.open = false;
    this.elements.settingsDialogBackdrop.classList.add('hidden');
    this.elements.settingsDialogButton.setAttribute('aria-expanded', 'false');

    if (restoreFocus) {
      this.elements.settingsDialogButton.focus();
    }
  }
}
