import { DisposableBag, type Disposable } from '../lifecycle';
import type { ExportImageRequest, ExportImageTarget } from '../types';
import type { ExportImageDialogElements } from './elements';

interface ExportImageDialogCallbacks {
  onExportImage: (request: ExportImageRequest) => Promise<void>;
}

export class ExportImageDialogController implements Disposable {
  private readonly disposables = new DisposableBag();
  private exportTarget: ExportImageTarget | null = null;
  private open = false;
  private busy = false;
  private restoreFocusTarget: HTMLElement | null = null;
  private disposed = false;

  constructor(
    private readonly elements: ExportImageDialogElements,
    private readonly callbacks: ExportImageDialogCallbacks
  ) {
    this.disposables.addEventListener(this.elements.exportDialogBackdrop, 'click', (event) => {
      if (event.target === this.elements.exportDialogBackdrop && !this.busy) {
        this.close(true);
      }
    });

    this.disposables.addEventListener(this.elements.exportDialogCancelButton, 'click', () => {
      if (this.busy) {
        return;
      }
      this.close(true);
    });

    this.disposables.addEventListener(this.elements.exportDialogForm, 'submit', (event) => {
      event.preventDefault();
      void this.handleSubmit();
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  hasTarget(): boolean {
    return this.exportTarget !== null;
  }

  isOpen(): boolean {
    return this.open;
  }

  isBusy(): boolean {
    return this.busy;
  }

  setTarget(target: ExportImageTarget | null): void {
    if (this.disposed) {
      return;
    }

    this.exportTarget = target ? { ...target } : null;
    if (!this.exportTarget) {
      this.close(false);
      this.resetInputs();
    } else if (!this.open) {
      this.applyTarget(this.exportTarget);
    }
  }

  openDialog(): void {
    if (this.disposed) {
      return;
    }

    if (!this.exportTarget || this.elements.exportImageButton.disabled) {
      return;
    }

    this.restoreFocusTarget = this.elements.fileMenuButton;
    this.applyTarget(this.exportTarget);
    this.setError(null);
    this.setBusy(false);
    this.open = true;
    this.elements.exportDialogBackdrop.classList.remove('hidden');
    this.elements.exportFilenameInput.focus();
    this.elements.exportFilenameInput.select();
  }

  close(restoreFocus = true): void {
    if (this.disposed) {
      return;
    }

    if (!this.open && this.elements.exportDialogBackdrop.classList.contains('hidden')) {
      return;
    }

    this.open = false;
    this.setBusy(false);
    this.setError(null);
    this.elements.exportDialogBackdrop.classList.add('hidden');

    if (restoreFocus) {
      (this.restoreFocusTarget ?? this.elements.exportImageButton).focus();
    }
    this.restoreFocusTarget = null;
  }

  private applyTarget(target: ExportImageTarget): void {
    this.elements.exportFilenameInput.value = target.filename;
  }

  private resetInputs(): void {
    this.elements.exportFilenameInput.value = '';
  }

  private setBusy(busy: boolean): void {
    if (this.disposed) {
      return;
    }

    this.busy = busy;
    this.elements.exportFilenameInput.disabled = busy;
    this.elements.exportDialogCancelButton.disabled = busy;
    this.elements.exportDialogSubmitButton.disabled = busy;
    this.elements.exportDialogSubmitButton.textContent = busy ? 'Exporting...' : 'Export';
    this.elements.exportFormatSelect.disabled = true;
  }

  private setError(message: string | null): void {
    if (this.disposed) {
      return;
    }

    if (!message) {
      this.elements.exportDialogError.classList.add('hidden');
      this.elements.exportDialogError.textContent = '';
      return;
    }

    this.elements.exportDialogError.classList.remove('hidden');
    this.elements.exportDialogError.textContent = message;
  }

  private async handleSubmit(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const target = this.exportTarget;
    if (!target || this.busy) {
      return;
    }

    const filename = normalizeExportFilename(this.elements.exportFilenameInput.value);
    if (!filename) {
      this.setError('Enter a filename.');
      this.elements.exportFilenameInput.focus();
      return;
    }

    const request = parseExportImageRequest({
      filename,
      format: this.elements.exportFormatSelect.value
    });
    if (!request) {
      this.setError('Export failed.');
      return;
    }

    this.elements.exportFilenameInput.value = request.filename;
    this.setError(null);
    this.setBusy(true);

    try {
      await this.callbacks.onExportImage(request);
      this.close(true);
    } catch (error) {
      this.setError(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      if (this.open) {
        this.setBusy(false);
      }
    }
  }
}

export function buildDefaultExportFilename(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return 'image.png';
  }

  const duplicateSuffixMatch = trimmed.match(/ \(\d+\)$/);
  const duplicateSuffix = duplicateSuffixMatch?.[0] ?? '';
  const baseName = duplicateSuffix ? trimmed.slice(0, -duplicateSuffix.length) : trimmed;
  const pathSeparatorIndex = Math.max(baseName.lastIndexOf('/'), baseName.lastIndexOf('\\'));
  const extensionIndex = baseName.lastIndexOf('.');
  const withoutExtension = extensionIndex > pathSeparatorIndex ? baseName.slice(0, extensionIndex) : baseName;

  return `${withoutExtension}${duplicateSuffix}.png`;
}

export function normalizeExportFilename(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.toLocaleLowerCase().endsWith('.png') ? trimmed : `${trimmed}.png`;
}

function parseExportImageRequest(args: { filename: string; format: string }): ExportImageRequest | null {
  if (args.format !== 'png') {
    return null;
  }

  return {
    filename: args.filename,
    format: 'png'
  };
}
