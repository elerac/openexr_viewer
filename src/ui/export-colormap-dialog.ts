import {
  errorResource,
  idleResource,
  isPendingMatch,
  pendingResource,
  successResource,
  type AsyncResource
} from '../async-resource';
import { renderPixelsToCanvas, type ExportImagePixels } from '../export-image';
import { DisposableBag, isAbortError, type Disposable } from '../lifecycle';
import type {
  ExportColormapOrientation,
  ExportColormapPreviewRequest,
  ExportColormapRequest
} from '../types';
import { bindDialogBackdropDismiss } from './dialog-backdrop';
import type { ExportColormapDialogElements } from './elements';
import { syncSelectOptions } from './render-helpers';
import { normalizeExportFilename } from './export-image-dialog';

const DEFAULT_COLORMAP_EXPORT_WIDTH = 256;
const DEFAULT_COLORMAP_EXPORT_HEIGHT = 16;
const DEFAULT_COLORMAP_EXPORT_ORIENTATION: ExportColormapOrientation = 'horizontal';
const COLORMAP_EXPORT_PREVIEW_LOADING_MESSAGE = 'Loading preview...';
const COLORMAP_EXPORT_PREVIEW_INVALID_MESSAGE = 'Enter a valid width and height to preview.';

interface ExportColormapDialogCallbacks {
  onExportColormap: (request: ExportColormapRequest) => Promise<void>;
  onResolveExportColormapPreview: (
    request: ExportColormapPreviewRequest,
    signal: AbortSignal
  ) => Promise<ExportImagePixels>;
}

export class ExportColormapDialogController implements Disposable {
  private readonly disposables = new DisposableBag();
  private colormapExportOptions: Array<{ id: string; label: string }> = [];
  private defaultColormapId = '';
  private activeColormapId = '';
  private open = false;
  private exportResource: AsyncResource<void> = idleResource();
  private previewResource: AsyncResource<ExportImagePixels> = idleResource();
  private restoreFocusTarget: HTMLElement | null = null;
  private exportColormapAutoFilename = '';
  private exportColormapPreviewAbortController: AbortController | null = null;
  private nextRequestId = 1;
  private disposed = false;

  constructor(
    private readonly elements: ExportColormapDialogElements,
    private readonly callbacks: ExportColormapDialogCallbacks
  ) {
    this.disposables.addEventListener(this.elements.exportColormapSelect, 'change', () => {
      if (this.elements.exportColormapSelect.disabled) {
        return;
      }

      this.syncFilenameForSelection(true);
      void this.refreshPreview();
    });

    this.disposables.addEventListener(this.elements.exportColormapOrientationSelect, 'change', () => {
      if (this.elements.exportColormapOrientationSelect.disabled) {
        return;
      }

      void this.refreshPreview();
    });

    this.disposables.addEventListener(this.elements.exportColormapWidthInput, 'input', () => {
      if (this.elements.exportColormapWidthInput.disabled) {
        return;
      }

      void this.refreshPreview();
    });

    this.disposables.addEventListener(this.elements.exportColormapHeightInput, 'input', () => {
      if (this.elements.exportColormapHeightInput.disabled) {
        return;
      }

      void this.refreshPreview();
    });

    this.disposables.addDisposable(bindDialogBackdropDismiss(this.elements.exportColormapDialogBackdrop, () => {
      if (!this.isExportPending()) {
        this.close(true);
      }
    }));

    this.disposables.addEventListener(this.elements.exportColormapDialogCancelButton, 'click', () => {
      if (this.isExportPending()) {
        return;
      }

      this.close(true);
    });

    this.disposables.addEventListener(this.elements.exportColormapDialogForm, 'submit', (event) => {
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

  hasOptions(): boolean {
    return this.colormapExportOptions.length > 0;
  }

  isOpen(): boolean {
    return this.open;
  }

  isBusy(): boolean {
    return this.isExportPending();
  }

  setOptions(items: Array<{ id: string; label: string }>, defaultId: string): void {
    this.colormapExportOptions = items.map((item) => ({ ...item }));
    this.defaultColormapId = defaultId;
    if (this.open) {
      this.syncOptions();
      return;
    }

    if (this.colormapExportOptions.length === 0) {
      this.resetInputs();
    }
  }

  setActiveColormap(activeId: string): void {
    this.activeColormapId = activeId;
  }

  openDialog(): void {
    if (this.disposed) {
      return;
    }

    if (this.elements.exportColormapButton.disabled || this.colormapExportOptions.length === 0) {
      return;
    }

    this.restoreFocusTarget = this.elements.fileMenuButton;
    syncSelectOptions(
      this.elements.exportColormapSelect,
      this.colormapExportOptions.map((item) => ({
        value: item.id,
        label: item.label
      }))
    );
    this.elements.exportColormapSelect.value = this.resolvePreferredId(this.activeColormapId);
    this.elements.exportColormapWidthInput.value = String(DEFAULT_COLORMAP_EXPORT_WIDTH);
    this.elements.exportColormapHeightInput.value = String(DEFAULT_COLORMAP_EXPORT_HEIGHT);
    this.elements.exportColormapOrientationSelect.value = DEFAULT_COLORMAP_EXPORT_ORIENTATION;
    this.syncFilenameForSelection(false);
    this.setError(null);
    this.setBusy(false);
    this.open = true;
    this.elements.exportColormapDialogBackdrop.classList.remove('hidden');
    this.elements.exportColormapSelect.focus();
    void this.refreshPreview();
  }

  close(restoreFocus = true): void {
    if (this.disposed) {
      return;
    }

    if (!this.open && this.elements.exportColormapDialogBackdrop.classList.contains('hidden')) {
      return;
    }

    this.open = false;
    this.resetPreview();
    this.setBusy(false);
    this.setError(null);
    this.elements.exportColormapDialogBackdrop.classList.add('hidden');

    if (restoreFocus) {
      (this.restoreFocusTarget ?? this.elements.exportColormapButton).focus();
    }
    this.restoreFocusTarget = null;
  }

  private syncOptions(): void {
    if (this.colormapExportOptions.length === 0) {
      this.close(false);
      this.resetInputs();
      return;
    }

    const currentSelectionId = this.elements.exportColormapSelect.value;
    syncSelectOptions(
      this.elements.exportColormapSelect,
      this.colormapExportOptions.map((item) => ({
        value: item.id,
        label: item.label
      }))
    );
    this.elements.exportColormapSelect.value = this.resolvePreferredId(currentSelectionId);
    this.syncFilenameForSelection(true);
    void this.refreshPreview();
  }

  private resolvePreferredId(preferredId: string | null | undefined): string {
    const preferred = preferredId ?? '';
    if (preferred && this.colormapExportOptions.some((item) => item.id === preferred)) {
      return preferred;
    }

    if (this.activeColormapId && this.colormapExportOptions.some((item) => item.id === this.activeColormapId)) {
      return this.activeColormapId;
    }

    if (this.defaultColormapId && this.colormapExportOptions.some((item) => item.id === this.defaultColormapId)) {
      return this.defaultColormapId;
    }

    return this.colormapExportOptions[0]?.id ?? '';
  }

  private getSelectedOption(): { id: string; label: string } | null {
    const selectedId = this.elements.exportColormapSelect.value;
    return this.colormapExportOptions.find((item) => item.id === selectedId) ?? null;
  }

  private syncFilenameForSelection(preserveManualEdits: boolean): void {
    const filename = buildDefaultColormapExportFilename(this.getSelectedOption()?.label ?? '');
    const currentFilename = normalizeExportFilename(this.elements.exportColormapFilenameInput.value);
    const previousAutoFilename = normalizeExportFilename(this.exportColormapAutoFilename);
    if (!preserveManualEdits || currentFilename === previousAutoFilename) {
      this.elements.exportColormapFilenameInput.value = filename;
    }
    this.exportColormapAutoFilename = filename;
  }

  private resetInputs(): void {
    this.elements.exportColormapSelect.replaceChildren();
    this.elements.exportColormapWidthInput.value = String(DEFAULT_COLORMAP_EXPORT_WIDTH);
    this.elements.exportColormapHeightInput.value = String(DEFAULT_COLORMAP_EXPORT_HEIGHT);
    this.elements.exportColormapOrientationSelect.value = DEFAULT_COLORMAP_EXPORT_ORIENTATION;
    this.elements.exportColormapFilenameInput.value = '';
    this.exportColormapAutoFilename = '';
    this.resetPreview();
  }

  private setBusy(busy: boolean): void {
    if (this.disposed) {
      return;
    }

    this.exportResource = busy ? pendingResource('export-colormap', this.takeRequestId()) : idleResource();
    this.syncBusyControls();
  }

  private setError(message: string | null): void {
    if (this.disposed) {
      return;
    }

    if (!message) {
      this.elements.exportColormapDialogError.classList.add('hidden');
      this.elements.exportColormapDialogError.textContent = '';
      return;
    }

    this.elements.exportColormapDialogError.classList.remove('hidden');
    this.elements.exportColormapDialogError.textContent = message;
  }

  private async handleSubmit(): Promise<void> {
    if (this.disposed || this.isExportPending()) {
      return;
    }

    const filename = normalizeExportFilename(this.elements.exportColormapFilenameInput.value);
    if (!filename) {
      this.setError('Enter a filename.');
      this.elements.exportColormapFilenameInput.focus();
      return;
    }

    const width = parsePositiveIntegerInput(this.elements.exportColormapWidthInput.value);
    if (width === null) {
      this.setError('Width must be a positive integer.');
      this.elements.exportColormapWidthInput.focus();
      return;
    }

    const height = parsePositiveIntegerInput(this.elements.exportColormapHeightInput.value);
    if (height === null) {
      this.setError('Height must be a positive integer.');
      this.elements.exportColormapHeightInput.focus();
      return;
    }

    const request = parseExportColormapRequest({
      colormapId: this.elements.exportColormapSelect.value,
      width,
      height,
      orientation: this.elements.exportColormapOrientationSelect.value,
      filename,
      format: 'png'
    });
    if (!request) {
      this.setError('Export failed.');
      return;
    }

    this.elements.exportColormapWidthInput.value = String(request.width);
    this.elements.exportColormapHeightInput.value = String(request.height);
    this.elements.exportColormapFilenameInput.value = request.filename;
    this.setError(null);
    const exportRequestId = this.takeRequestId();
    this.exportResource = pendingResource('export-colormap', exportRequestId);
    this.syncBusyControls();

    try {
      await this.callbacks.onExportColormap(request);
      if (!isPendingMatch(this.exportResource, 'export-colormap', exportRequestId)) {
        return;
      }
      this.close(true);
    } catch (error) {
      if (!isPendingMatch(this.exportResource, 'export-colormap', exportRequestId)) {
        return;
      }
      this.exportResource = errorResource('export-colormap', error, 'Export failed.');
      this.setError(this.exportResource.status === 'error' ? this.exportResource.error.message : 'Export failed.');
    } finally {
      if (this.open) {
        if (isPendingMatch(this.exportResource, 'export-colormap', exportRequestId)) {
          this.exportResource = idleResource();
        }
        this.syncBusyControls();
      }
    }
  }

  private getPreviewRequest(): ExportColormapPreviewRequest | null {
    const width = parsePositiveIntegerInput(this.elements.exportColormapWidthInput.value);
    const height = parsePositiveIntegerInput(this.elements.exportColormapHeightInput.value);
    if (width === null || height === null) {
      return null;
    }

    return parseExportColormapPreviewRequest({
      colormapId: this.elements.exportColormapSelect.value,
      width,
      height,
      orientation: this.elements.exportColormapOrientationSelect.value
    });
  }

  private async refreshPreview(): Promise<void> {
    if (this.disposed || !this.open) {
      return;
    }

    const request = this.getPreviewRequest();
    if (!request) {
      this.cancelPreview();
      this.hidePreviewCanvas();
      this.setPreviewStatus(COLORMAP_EXPORT_PREVIEW_INVALID_MESSAGE);
      return;
    }

    this.cancelPreview();
    const abortController = new AbortController();
    this.exportColormapPreviewAbortController = abortController;
    const requestKey = serializeExportColormapPreviewRequest(request);
    const requestId = this.takeRequestId();
    this.previewResource = pendingResource(requestKey, requestId);

    this.hidePreviewCanvas();
    this.setPreviewStatus(COLORMAP_EXPORT_PREVIEW_LOADING_MESSAGE);

    try {
      const pixels = await this.callbacks.onResolveExportColormapPreview(request, abortController.signal);
      if (
        this.disposed ||
        !this.open ||
        abortController.signal.aborted ||
        !isPendingMatch(this.previewResource, requestKey, requestId)
      ) {
        return;
      }

      this.previewResource = successResource(requestKey, pixels);
      this.renderPreview(pixels);
    } catch (error) {
      if (
        isAbortError(error) ||
        this.disposed ||
        !this.open ||
        abortController.signal.aborted ||
        !isPendingMatch(this.previewResource, requestKey, requestId)
      ) {
        return;
      }

      this.previewResource = errorResource(requestKey, error, 'Preview failed.');
      this.hidePreviewCanvas();
      this.setPreviewStatus(this.previewResource.status === 'error' ? this.previewResource.error.message : 'Preview failed.');
    } finally {
      if (this.exportColormapPreviewAbortController === abortController) {
        this.exportColormapPreviewAbortController = null;
      }
    }
  }

  private cancelPreview(): void {
    this.exportColormapPreviewAbortController?.abort();
    this.exportColormapPreviewAbortController = null;
    this.previewResource = idleResource();
  }

  private resetPreview(): void {
    this.cancelPreview();
    this.hidePreviewCanvas();
    this.setPreviewStatus(null);
  }

  private renderPreview(pixels: ExportImagePixels): void {
    renderPixelsToCanvas(this.elements.exportColormapPreviewCanvas, pixels);
    this.elements.exportColormapPreviewCanvas.classList.remove('hidden');
    this.setPreviewStatus(null);
  }

  private hidePreviewCanvas(): void {
    this.elements.exportColormapPreviewCanvas.classList.add('hidden');
    this.elements.exportColormapPreviewCanvas.width = 0;
    this.elements.exportColormapPreviewCanvas.height = 0;
  }

  private setPreviewStatus(message: string | null): void {
    if (!message) {
      this.elements.exportColormapPreviewStatus.classList.add('hidden');
      this.elements.exportColormapPreviewStatus.textContent = '';
      return;
    }

    this.elements.exportColormapPreviewStatus.classList.remove('hidden');
    this.elements.exportColormapPreviewStatus.textContent = message;
  }

  private isExportPending(): boolean {
    return this.exportResource.status === 'pending';
  }

  private syncBusyControls(): void {
    const busy = this.isExportPending();
    this.elements.exportColormapSelect.disabled = busy;
    this.elements.exportColormapWidthInput.disabled = busy;
    this.elements.exportColormapHeightInput.disabled = busy;
    this.elements.exportColormapOrientationSelect.disabled = busy;
    this.elements.exportColormapFilenameInput.disabled = busy;
    this.elements.exportColormapDialogCancelButton.disabled = busy;
    this.elements.exportColormapDialogSubmitButton.disabled = busy;
    this.elements.exportColormapDialogSubmitButton.textContent = busy ? 'Exporting...' : 'Export';
  }

  private takeRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}

export function buildDefaultColormapExportFilename(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return 'colormap.png';
  }

  const sanitized = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');

  return `${sanitized || 'colormap'}.png`;
}

function parseExportColormapRequest(args: {
  colormapId: string;
  width: number;
  height: number;
  orientation: string;
  filename: string;
  format: string;
}): ExportColormapRequest | null {
  const previewRequest = parseExportColormapPreviewRequest(args);
  if (!previewRequest || args.format !== 'png') {
    return null;
  }

  return {
    ...previewRequest,
    filename: args.filename,
    format: 'png'
  };
}

function parseExportColormapPreviewRequest(args: {
  colormapId: string;
  width: number;
  height: number;
  orientation: string;
}): ExportColormapPreviewRequest | null {
  if (!args.colormapId) {
    return null;
  }

  if (args.orientation !== 'horizontal' && args.orientation !== 'vertical') {
    return null;
  }

  if (!Number.isInteger(args.width) || args.width <= 0 || !Number.isInteger(args.height) || args.height <= 0) {
    return null;
  }

  return {
    colormapId: args.colormapId,
    width: args.width,
    height: args.height,
    orientation: args.orientation
  };
}

function parsePositiveIntegerInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function serializeExportColormapPreviewRequest(request: ExportColormapPreviewRequest): string {
  return JSON.stringify(request);
}
