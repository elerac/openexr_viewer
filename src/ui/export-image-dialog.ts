import {
  errorResource,
  idleResource,
  isPendingMatch,
  pendingResource,
  successResource,
  type AsyncResource
} from '../async-resource';
import {
  parsePngCompressionLevel,
  renderPixelsToCanvas,
  type ExportImagePixels
} from '../export-image';
import { DisposableBag, isAbortError, type Disposable } from '../lifecycle';
import {
  DEFAULT_PNG_COMPRESSION_LEVEL,
  type ExportImagePreviewRequest,
  type ExportImageRequest,
  type ExportImageTarget
} from '../types';
import { bindDialogBackdropDismiss } from './dialog-backdrop';
import type { ExportImageDialogElements } from './elements';

const EXPORT_IMAGE_PREVIEW_LOADING_MESSAGE = 'Loading preview...';
const PNG_COMPRESSION_VALIDATION_MESSAGE = 'PNG compression must be an integer from 0 to 9.';

interface ExportImageDialogCallbacks {
  onExportImage: (request: ExportImageRequest) => Promise<void>;
  onCancel?: (target: ExportImageTarget | null) => void;
  onScreenshotOutputSizeChange?: (size: { width: number; height: number }) => void;
  onResolveExportImagePreview: (
    request: ExportImagePreviewRequest,
    signal: AbortSignal
  ) => Promise<ExportImagePixels>;
}

export class ExportImageDialogController implements Disposable {
  private readonly disposables = new DisposableBag();
  private exportTarget: ExportImageTarget | null = null;
  private dialogTarget: ExportImageTarget | null = null;
  private open = false;
  private exportResource: AsyncResource<void> = idleResource();
  private previewResource: AsyncResource<ExportImagePixels> = idleResource();
  private restoreFocusTarget: HTMLElement | null = null;
  private exportImagePreviewAbortController: AbortController | null = null;
  private nextRequestId = 1;
  private syncingScreenshotSize = false;
  private disposed = false;

  constructor(
    private readonly elements: ExportImageDialogElements,
    private readonly callbacks: ExportImageDialogCallbacks
  ) {
    this.disposables.addDisposable(bindDialogBackdropDismiss(this.elements.exportDialogBackdrop, () => {
      if (!this.isExportPending()) {
        this.cancel(true);
      }
    }));

    this.disposables.addEventListener(this.elements.exportDialogCancelButton, 'click', () => {
      if (this.isExportPending()) {
        return;
      }
      this.cancel(true);
    });

    this.disposables.addEventListener(this.elements.exportDialogForm, 'submit', (event) => {
      event.preventDefault();
      void this.handleSubmit();
    });

    this.disposables.addEventListener(this.elements.exportWidthInput, 'input', () => {
      this.handleScreenshotSizeInput('width');
    });

    this.disposables.addEventListener(this.elements.exportHeightInput, 'input', () => {
      this.handleScreenshotSizeInput('height');
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
    return this.isExportPending();
  }

  setTarget(target: ExportImageTarget | null): void {
    if (this.disposed) {
      return;
    }

    this.exportTarget = cloneExportImageTarget(target);
    if (!this.exportTarget) {
      this.close(false);
      this.resetInputs();
    } else if (!this.open) {
      this.applyTarget(this.exportTarget);
    }
  }

  openDialog(targetOverride: ExportImageTarget | null = null): void {
    if (this.disposed) {
      return;
    }

    const target = cloneExportImageTarget(targetOverride ?? this.exportTarget);
    if (!target || (!targetOverride && this.elements.exportImageButton.disabled)) {
      return;
    }

    this.restoreFocusTarget = this.elements.fileMenuButton;
    this.dialogTarget = target;
    this.applyTarget(target);
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
    this.dialogTarget = null;
    this.resetPreview();
    this.setBusy(false);
    this.setError(null);
    this.elements.exportDialogBackdrop.classList.add('hidden');

    if (restoreFocus) {
      (this.restoreFocusTarget ?? this.elements.exportImageButton).focus();
    }
    this.restoreFocusTarget = null;
  }

  cancel(restoreFocus = true): void {
    if (this.disposed || this.isExportPending() || !this.open) {
      return;
    }

    const target = cloneExportImageTarget(this.dialogTarget ?? this.exportTarget);
    this.close(restoreFocus);
    this.callbacks.onCancel?.(target);
  }

  private applyTarget(target: ExportImageTarget): void {
    this.elements.exportFilenameInput.value = target.filename;
    this.elements.exportCompressionInput.value = String(DEFAULT_PNG_COMPRESSION_LEVEL);
    if (isScreenshotTarget(target)) {
      const size = buildDefaultScreenshotOutputSize(target);
      this.elements.exportSizeField.classList.remove('hidden');
      this.elements.exportReproductionMetadataField.classList.remove('hidden');
      this.elements.exportReproductionMetadataCheckbox.checked = false;
      this.elements.exportWidthInput.value = String(size.width);
      this.elements.exportHeightInput.value = String(size.height);
    } else {
      this.elements.exportSizeField.classList.add('hidden');
      this.elements.exportReproductionMetadataField.classList.add('hidden');
      this.elements.exportReproductionMetadataCheckbox.checked = false;
      this.elements.exportWidthInput.value = '';
      this.elements.exportHeightInput.value = '';
    }
  }

  private resetInputs(): void {
    this.elements.exportFilenameInput.value = '';
    this.elements.exportCompressionInput.value = String(DEFAULT_PNG_COMPRESSION_LEVEL);
    this.elements.exportSizeField.classList.add('hidden');
    this.elements.exportReproductionMetadataField.classList.add('hidden');
    this.elements.exportReproductionMetadataCheckbox.checked = false;
    this.elements.exportWidthInput.value = '';
    this.elements.exportHeightInput.value = '';
    this.resetPreview();
  }

  private setBusy(busy: boolean): void {
    if (this.disposed) {
      return;
    }

    this.exportResource = busy ? pendingResource('export-image', this.takeRequestId()) : idleResource();
    this.syncBusyControls();
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

    const target = this.dialogTarget ?? this.exportTarget;
    if (!target || this.isExportPending()) {
      return;
    }

    const filename = normalizeExportFilename(this.elements.exportFilenameInput.value);
    if (!filename) {
      this.setError('Enter a filename.');
      this.elements.exportFilenameInput.focus();
      return;
    }

    const pngCompressionLevel = parsePngCompressionLevel(this.elements.exportCompressionInput.value);
    if (pngCompressionLevel === null) {
      this.setError(PNG_COMPRESSION_VALIDATION_MESSAGE);
      this.elements.exportCompressionInput.focus();
      return;
    }

    const request = parseExportImageRequest(target, {
      filename,
      format: this.elements.exportFormatSelect.value,
      width: this.elements.exportWidthInput.value,
      height: this.elements.exportHeightInput.value,
      pngCompressionLevel,
      includeReproductionMetadata: this.elements.exportReproductionMetadataCheckbox.checked
    });
    if (!request) {
      this.setError(isScreenshotTarget(target) ? 'Enter a positive width and height.' : 'Export failed.');
      return;
    }

    this.elements.exportFilenameInput.value = request.filename;
    this.setError(null);
    const exportRequestId = this.takeRequestId();
    this.exportResource = pendingResource('export-image', exportRequestId);
    this.syncBusyControls();

    try {
      await this.callbacks.onExportImage(request);
      if (!isPendingMatch(this.exportResource, 'export-image', exportRequestId)) {
        return;
      }
      this.close(true);
    } catch (error) {
      if (isAbortError(error)) {
        this.close(true);
        return;
      }

      if (!isPendingMatch(this.exportResource, 'export-image', exportRequestId)) {
        return;
      }
      this.exportResource = errorResource('export-image', error, 'Export failed.');
      this.setError(this.exportResource.status === 'error' ? this.exportResource.error.message : 'Export failed.');
    } finally {
      if (this.open) {
        if (isPendingMatch(this.exportResource, 'export-image', exportRequestId)) {
          this.exportResource = idleResource();
        }
        this.syncBusyControls();
      }
    }
  }

  private handleScreenshotSizeInput(source: 'width' | 'height'): void {
    if (this.disposed || this.syncingScreenshotSize) {
      return;
    }

    const target = this.dialogTarget ?? this.exportTarget;
    if (!isScreenshotTarget(target)) {
      return;
    }

    const aspectRatio = target.rect.width / Math.max(target.rect.height, Number.EPSILON);
    const sourceInput = source === 'width' ? this.elements.exportWidthInput : this.elements.exportHeightInput;
    const targetInput = source === 'width' ? this.elements.exportHeightInput : this.elements.exportWidthInput;
    const sourceValue = parsePositiveInteger(sourceInput.value);
    if (!sourceValue) {
      this.resetPreview();
      this.setPreviewStatus('Enter a positive width and height.');
      return;
    }

    const nextTargetValue = source === 'width'
      ? Math.max(1, Math.round(sourceValue / aspectRatio))
      : Math.max(1, Math.round(sourceValue * aspectRatio));

    this.syncingScreenshotSize = true;
    targetInput.value = String(nextTargetValue);
    this.syncingScreenshotSize = false;

    const outputWidth = parsePositiveInteger(this.elements.exportWidthInput.value);
    const outputHeight = parsePositiveInteger(this.elements.exportHeightInput.value);
    if (outputWidth && outputHeight) {
      this.callbacks.onScreenshotOutputSizeChange?.({ width: outputWidth, height: outputHeight });
    }

    if (this.open) {
      void this.refreshPreview();
    }
  }

  private async refreshPreview(): Promise<void> {
    if (this.disposed || !this.open) {
      return;
    }

    this.cancelPreview();
    const target = this.dialogTarget ?? this.exportTarget;
    const previewRequest = target ? parseExportImagePreviewRequest(target, {
      width: this.elements.exportWidthInput.value,
      height: this.elements.exportHeightInput.value
    }) : null;
    if (!previewRequest) {
      this.hidePreviewCanvas();
      this.setPreviewStatus('Enter a positive width and height.');
      return;
    }

    const abortController = new AbortController();
    this.exportImagePreviewAbortController = abortController;
    const requestKey = serializeExportImagePreviewRequest(previewRequest);
    const requestId = this.takeRequestId();
    this.previewResource = pendingResource(requestKey, requestId);

    this.hidePreviewCanvas();
    this.setPreviewStatus(EXPORT_IMAGE_PREVIEW_LOADING_MESSAGE);

    try {
      const pixels = await this.callbacks.onResolveExportImagePreview(previewRequest, abortController.signal);
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
      if (this.exportImagePreviewAbortController === abortController) {
        this.exportImagePreviewAbortController = null;
      }
    }
  }

  private cancelPreview(): void {
    this.exportImagePreviewAbortController?.abort();
    this.exportImagePreviewAbortController = null;
    this.previewResource = idleResource();
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

  private isExportPending(): boolean {
    return this.exportResource.status === 'pending';
  }

  private syncBusyControls(): void {
    const busy = this.isExportPending();
    this.elements.exportFilenameInput.disabled = busy;
    this.elements.exportCompressionInput.disabled = busy;
    this.elements.exportWidthInput.disabled = busy;
    this.elements.exportHeightInput.disabled = busy;
    this.elements.exportReproductionMetadataCheckbox.disabled = busy;
    this.elements.exportDialogCancelButton.disabled = busy;
    this.elements.exportDialogSubmitButton.disabled = busy;
    this.elements.exportDialogSubmitButton.textContent = busy ? 'Exporting...' : 'Export';
    this.elements.exportFormatSelect.disabled = true;
  }

  private takeRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
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

function parseExportImageRequest(
  target: ExportImageTarget,
  args: {
    filename: string;
    format: string;
    width: string;
    height: string;
    pngCompressionLevel: ExportImageRequest['pngCompressionLevel'];
    includeReproductionMetadata: boolean;
  }
): ExportImageRequest | null {
  if (args.format !== 'png') {
    return null;
  }

  if (isScreenshotTarget(target)) {
    const outputWidth = parsePositiveInteger(args.width);
    const outputHeight = parsePositiveInteger(args.height);
    if (!outputWidth || !outputHeight) {
      return null;
    }

    return {
      filename: args.filename,
      format: 'png',
      mode: 'screenshot',
      rect: { ...target.rect },
      sourceViewport: { ...target.sourceViewport },
      outputWidth,
      outputHeight,
      pngCompressionLevel: args.pngCompressionLevel,
      ...(args.includeReproductionMetadata ? { includeReproductionMetadata: true } : {})
    };
  }

  return {
    filename: args.filename,
    format: 'png',
    pngCompressionLevel: args.pngCompressionLevel
  };
}

function parseExportImagePreviewRequest(
  target: ExportImageTarget,
  args: { width: string; height: string }
): ExportImagePreviewRequest | null {
  if (!isScreenshotTarget(target)) {
    return { mode: 'image' };
  }

  const outputWidth = parsePositiveInteger(args.width);
  const outputHeight = parsePositiveInteger(args.height);
  if (!outputWidth || !outputHeight) {
    return null;
  }

  return {
    mode: 'screenshot',
    rect: { ...target.rect },
    sourceViewport: { ...target.sourceViewport },
    outputWidth,
    outputHeight
  };
}

function buildDefaultScreenshotOutputSize(
  target: Extract<ExportImageTarget, { kind: 'screenshot' }>
): { width: number; height: number } {
  const outputWidth = target.outputWidth;
  const outputHeight = target.outputHeight;
  if (
    typeof outputWidth === 'number' &&
    Number.isInteger(outputWidth) &&
    outputWidth > 0 &&
    typeof outputHeight === 'number' &&
    Number.isInteger(outputHeight) &&
    outputHeight > 0
  ) {
    return {
      width: outputWidth,
      height: outputHeight
    };
  }

  return {
    width: Math.max(1, Math.round(target.rect.width)),
    height: Math.max(1, Math.round(target.rect.height))
  };
}

function cloneExportImageTarget(target: ExportImageTarget | null): ExportImageTarget | null {
  if (!target) {
    return null;
  }

  if (isScreenshotTarget(target)) {
    return {
      filename: target.filename,
      kind: 'screenshot',
      rect: { ...target.rect },
      sourceViewport: { ...target.sourceViewport },
      outputWidth: target.outputWidth,
      outputHeight: target.outputHeight
    };
  }

  return { ...target };
}

function isScreenshotTarget(
  target: ExportImageTarget | null | undefined
): target is Extract<ExportImageTarget, { kind: 'screenshot' }> {
  return target?.kind === 'screenshot';
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function serializeExportImagePreviewRequest(request: ExportImagePreviewRequest): string {
  return JSON.stringify(request);
}
