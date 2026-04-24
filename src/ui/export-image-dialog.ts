import { renderPixelsToCanvas, type ExportImagePixels } from '../export-image';
import { DisposableBag, isAbortError, type Disposable } from '../lifecycle';
import type { ExportImageRequest, ExportImageTarget } from '../types';
import type { ExportImageDialogElements } from './elements';

const EXPORT_IMAGE_PREVIEW_LOADING_MESSAGE = 'Loading preview...';

interface ExportImageDialogCallbacks {
  onExportImage: (request: ExportImageRequest) => Promise<void>;
  onResolveExportImagePreview: (signal: AbortSignal) => Promise<ExportImagePixels>;
}

export class ExportImageDialogController implements Disposable {
  private readonly disposables = new DisposableBag();
  private exportTarget: ExportImageTarget | null = null;
  private open = false;
  private busy = false;
  private restoreFocusTarget: HTMLElement | null = null;
  private exportImagePreviewAbortController: AbortController | null = null;
  private exportImagePreviewRequestToken = 0;
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
    this.cancelPreview();
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
    void this.refreshPreview();
  }

  close(restoreFocus = true): void {
    if (this.disposed) {
      return;
    }

    if (!this.open && this.elements.exportDialogBackdrop.classList.contains('hidden')) {
      return;
    }

    this.open = false;
    this.resetPreview();
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
    this.resetPreview();
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

  private async refreshPreview(): Promise<void> {
    if (this.disposed || !this.open) {
      return;
    }

    this.cancelPreview();
    const abortController = new AbortController();
    this.exportImagePreviewAbortController = abortController;
    const requestToken = ++this.exportImagePreviewRequestToken;

    this.hidePreviewCanvas();
    this.setPreviewStatus(EXPORT_IMAGE_PREVIEW_LOADING_MESSAGE);

    try {
      const pixels = await this.callbacks.onResolveExportImagePreview(abortController.signal);
      if (
        this.disposed ||
        !this.open ||
        abortController.signal.aborted ||
        requestToken !== this.exportImagePreviewRequestToken
      ) {
        return;
      }

      this.renderPreview(pixels);
    } catch (error) {
      if (
        isAbortError(error) ||
        this.disposed ||
        !this.open ||
        abortController.signal.aborted ||
        requestToken !== this.exportImagePreviewRequestToken
      ) {
        return;
      }

      this.hidePreviewCanvas();
      this.setPreviewStatus(error instanceof Error ? error.message : 'Preview failed.');
    } finally {
      if (this.exportImagePreviewAbortController === abortController) {
        this.exportImagePreviewAbortController = null;
      }
    }
  }

  private cancelPreview(): void {
    this.exportImagePreviewRequestToken += 1;
    this.exportImagePreviewAbortController?.abort();
    this.exportImagePreviewAbortController = null;
  }

  private resetPreview(): void {
    this.cancelPreview();
    this.hidePreviewCanvas();
    this.setPreviewStatus(null);
  }

  private renderPreview(pixels: ExportImagePixels): void {
    renderPixelsToCanvas(this.elements.exportPreviewCanvas, pixels);
    this.elements.exportPreviewCanvas.classList.remove('hidden');
    this.setPreviewStatus(null);
  }

  private hidePreviewCanvas(): void {
    this.elements.exportPreviewCanvas.classList.add('hidden');
    this.elements.exportPreviewCanvas.width = 0;
    this.elements.exportPreviewCanvas.height = 0;
  }

  private setPreviewStatus(message: string | null): void {
    if (!message) {
      this.elements.exportPreviewStatus.classList.add('hidden');
      this.elements.exportPreviewStatus.textContent = '';
      return;
    }

    this.elements.exportPreviewStatus.classList.remove('hidden');
    this.elements.exportPreviewStatus.textContent = message;
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
