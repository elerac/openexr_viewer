import { DisposableBag, type Disposable } from '../lifecycle';
import {
  formatByteCount,
  type FolderLoadAdmission,
  type FolderLoadLimits
} from '../folder-load-limits';
import { bindDialogBackdropDismiss } from './dialog-backdrop';
import type { FolderLoadDialogElements } from './elements';

export class FolderLoadDialogController implements Disposable {
  private readonly disposables = new DisposableBag();
  private pendingResolve: ((value: boolean) => void) | null = null;
  private restoreFocusTarget: HTMLElement | null = null;
  private open = false;
  private disposed = false;

  constructor(private readonly elements: FolderLoadDialogElements) {
    this.disposables.addDisposable(bindDialogBackdropDismiss(this.elements.folderLoadDialogBackdrop, () => {
      this.close(false, true);
    }));

    this.disposables.addEventListener(this.elements.folderLoadDialogCancelButton, 'click', () => {
      this.close(false, true);
    });

    this.disposables.addEventListener(this.elements.folderLoadDialogForm, 'submit', (event) => {
      event.preventDefault();
      this.close(true, true);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.close(false, false);
    this.disposables.dispose();
  }

  isOpen(): boolean {
    return this.open;
  }

  confirm(admission: FolderLoadAdmission, limits: FolderLoadLimits): Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(false);
    }

    this.close(false, false);
    this.restoreFocusTarget = this.elements.fileMenuButton;
    this.render(admission, limits);
    this.open = true;
    this.elements.folderLoadDialogBackdrop.classList.remove('hidden');
    this.elements.folderLoadDialogCancelButton.focus();

    return new Promise<boolean>((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(confirmed = false, restoreFocus = true): void {
    if (!this.open && this.elements.folderLoadDialogBackdrop.classList.contains('hidden')) {
      return;
    }

    this.open = false;
    this.elements.folderLoadDialogBackdrop.classList.add('hidden');
    this.pendingResolve?.(confirmed);
    this.pendingResolve = null;

    if (restoreFocus) {
      (this.restoreFocusTarget ?? this.elements.fileMenuButton).focus();
    }
    this.restoreFocusTarget = null;
  }

  private render(admission: FolderLoadAdmission, limits: FolderLoadLimits): void {
    const stats = admission.stats;
    const prefix = stats.partial ? 'At least ' : '';
    this.elements.folderLoadDialogSummary.textContent =
      `${prefix}${stats.exrFileCount} EXR files (${formatByteCount(stats.totalBytes)}) exceed the folder load limits.`;

    this.elements.folderLoadDialogStats.replaceChildren(
      createStatTerm('EXR files'),
      createStatValue(`${prefix}${stats.exrFileCount} / ${limits.maxFileCount}`),
      createStatTerm('Total bytes'),
      createStatValue(`${prefix}${formatByteCount(stats.totalBytes)} / ${formatByteCount(limits.maxTotalBytes)}`)
    );

    this.elements.folderLoadDialogWarning.textContent = admission.reasons.length > 0
      ? `${admission.reasons.join('; ')}.`
      : 'This folder is above the configured load limits.';
  }
}

function createStatTerm(label: string): HTMLElement {
  const term = document.createElement('dt');
  term.textContent = label;
  return term;
}

function createStatValue(value: string): HTMLElement {
  const description = document.createElement('dd');
  description.textContent = value;
  return description;
}
