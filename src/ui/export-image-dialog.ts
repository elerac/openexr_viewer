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
import {
  buildScaledScreenshotRegion,
  cloneScreenshotRegionCrop,
  getScreenshotRegionAspectRatio,
  getScreenshotRegionCropSize,
  serializeScreenshotRegionCrop
} from '../export/screenshot-region';
import { DisposableBag, isAbortError, type Disposable } from '../lifecycle';
import {
  DEFAULT_PNG_COMPRESSION_LEVEL,
  type ExportImagePreviewRequest,
  type ExportProgressUpdate,
  type ExportImageRequest,
  type ExportScreenshotRegionItem,
  type ExportScreenshotRegionsRequest,
  type ExportImageTarget
} from '../types';
import { bindDialogBackdropDismiss } from './dialog-backdrop';
import type { ExportImageDialogElements } from './elements';

const EXPORT_IMAGE_PREVIEW_LOADING_MESSAGE = 'Loading preview...';
const PNG_COMPRESSION_VALIDATION_MESSAGE = 'PNG compression must be an integer from 0 to 9.';
const EXPORT_PROGRESS_REVEAL_DELAY_MS = 300;

interface ExportImageDialogCallbacks {
  onExportImage: (request: ExportImageRequest, onProgress?: (update: ExportProgressUpdate) => void) => Promise<void>;
  onExportScreenshotRegions: (
    request: ExportScreenshotRegionsRequest,
    onProgress?: (update: ExportProgressUpdate) => void
  ) => Promise<void>;
  onCancel?: (target: ExportImageTarget | null) => void;
  onScreenshotOutputSizeChange?: (size: { width: number; height: number }) => void;
  onScreenshotOutputScaleChange?: (scale: number) => void;
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
  private exportProgressRevealTimeoutHandle: number | null = null;
  private exportProgressVisible = false;
  private exportProgressUpdate: ExportProgressUpdate | null = null;
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
    this.resetExportProgress();
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
    this.resetExportProgress();
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
    this.applyDialogChrome(target);
    this.elements.exportFilenameInput.value = target.filename;
    this.elements.exportCompressionInput.value = String(DEFAULT_PNG_COMPRESSION_LEVEL);
    if (isScreenshotRegionsTarget(target)) {
      this.elements.exportSizeField.classList.remove('hidden');
      this.elements.exportSizeFieldLabel.textContent = 'Scale';
      this.elements.exportWidthFieldLabel.textContent = 'Percent';
      this.elements.exportHeightFieldLabel.textContent = 'Height';
      this.elements.exportWidthInput.value = String(Math.max(1, Math.round((target.outputScale ?? 1) * 100)));
      this.elements.exportHeightInput.value = '';
      this.elements.exportHeightInput.closest('.app-dialog-inline-field')?.classList.add('hidden');
      this.elements.exportReproductionMetadataField.classList.remove('hidden');
      this.elements.exportReproductionMetadataCheckbox.checked = false;
      this.clearPreviewStage();
      this.setPreviewStatus(formatScreenshotRegionsStatus(target.regions, target.outputScale ?? 1));
    } else if (isScreenshotTarget(target)) {
      const size = buildDefaultScreenshotOutputSize(target);
      this.elements.exportSizeField.classList.remove('hidden');
      this.elements.exportSizeFieldLabel.textContent = 'Size';
      this.elements.exportWidthFieldLabel.textContent = 'Width';
      this.elements.exportHeightFieldLabel.textContent = 'Height';
      this.elements.exportHeightInput.closest('.app-dialog-inline-field')?.classList.remove('hidden');
      this.elements.exportReproductionMetadataField.classList.remove('hidden');
      this.elements.exportReproductionMetadataCheckbox.checked = false;
      this.elements.exportWidthInput.value = String(size.width);
      this.elements.exportHeightInput.value = String(size.height);
    } else {
      this.elements.exportSizeField.classList.add('hidden');
      this.elements.exportSizeFieldLabel.textContent = 'Size';
      this.elements.exportWidthFieldLabel.textContent = 'Width';
      this.elements.exportHeightFieldLabel.textContent = 'Height';
      this.elements.exportHeightInput.closest('.app-dialog-inline-field')?.classList.remove('hidden');
      this.elements.exportReproductionMetadataField.classList.add('hidden');
      this.elements.exportReproductionMetadataCheckbox.checked = false;
      this.elements.exportWidthInput.value = '';
      this.elements.exportHeightInput.value = '';
    }
  }

  private applyDialogChrome(target: ExportImageTarget): void {
    if (isScreenshotRegionsTarget(target)) {
      this.elements.exportDialogTitle.textContent = 'Export Screenshot Regions';
      this.elements.exportDialogSubtitle.textContent = 'Export selected screenshot regions as a ZIP of PNG images.';
      this.elements.exportFilenameFieldLabel.textContent = 'Archive';
      return;
    }

    this.elements.exportDialogTitle.textContent = isScreenshotTarget(target) ? 'Export Screenshot' : 'Export Image';
    this.elements.exportDialogSubtitle.textContent = isScreenshotTarget(target)
      ? 'Export the selected screenshot region as a PNG.'
      : 'Export the current display as a PNG.';
    this.elements.exportFilenameFieldLabel.textContent = 'Filename';
  }

  private resetInputs(): void {
    this.elements.exportFilenameInput.value = '';
    this.applyDialogChrome({ filename: 'image.png' });
    this.elements.exportCompressionInput.value = String(DEFAULT_PNG_COMPRESSION_LEVEL);
    this.elements.exportSizeField.classList.add('hidden');
    this.elements.exportSizeFieldLabel.textContent = 'Size';
    this.elements.exportWidthFieldLabel.textContent = 'Width';
    this.elements.exportHeightFieldLabel.textContent = 'Height';
    this.elements.exportHeightInput.closest('.app-dialog-inline-field')?.classList.remove('hidden');
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

    const filename = isScreenshotRegionsTarget(target)
      ? normalizeExportArchiveFilename(this.elements.exportFilenameInput.value)
      : normalizeExportFilename(this.elements.exportFilenameInput.value);
    if (!filename) {
      this.setError(isScreenshotRegionsTarget(target) ? 'Enter an archive filename.' : 'Enter a filename.');
      this.elements.exportFilenameInput.focus();
      return;
    }

    const pngCompressionLevel = parsePngCompressionLevel(this.elements.exportCompressionInput.value);
    if (pngCompressionLevel === null) {
      this.setError(PNG_COMPRESSION_VALIDATION_MESSAGE);
      this.elements.exportCompressionInput.focus();
      return;
    }

    if (isScreenshotRegionsTarget(target)) {
      const outputScale = parsePositiveScalePercent(this.elements.exportWidthInput.value);
      if (outputScale === null) {
        this.setError('Enter a positive scale percentage.');
        this.elements.exportWidthInput.focus();
        return;
      }

      const request: ExportScreenshotRegionsRequest = {
        archiveFilename: filename,
        baseFilename: target.baseFilename,
        format: 'png-zip',
        mode: 'screenshot-regions',
        outputScale,
        regions: buildScaledScreenshotRegions(target.regions, outputScale),
        pngCompressionLevel,
        ...(this.elements.exportReproductionMetadataCheckbox.checked ? { includeReproductionMetadata: true } : {})
      };
      this.elements.exportFilenameInput.value = request.archiveFilename;
      this.setError(null);
      const exportRequestId = this.takeRequestId();
      this.exportResource = pendingResource('export-image', exportRequestId);
      this.syncBusyControls();
      const reportProgress = this.startExportProgress();

      try {
        await this.callbacks.onExportScreenshotRegions(request, reportProgress);
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
          this.resetExportProgress();
          this.syncBusyControls();
        }
      }
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
    const reportProgress = this.startExportProgress();

    try {
      await this.callbacks.onExportImage(request, reportProgress);
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
        this.resetExportProgress();
        this.syncBusyControls();
      }
    }
  }

  private handleScreenshotSizeInput(source: 'width' | 'height'): void {
    if (this.disposed || this.syncingScreenshotSize) {
      return;
    }

    const target = this.dialogTarget ?? this.exportTarget;
    if (isScreenshotRegionsTarget(target)) {
      const outputScale = parsePositiveScalePercent(this.elements.exportWidthInput.value);
      if (outputScale === null) {
        this.cancelPreview();
        this.clearPreviewStage();
        this.setPreviewStatus('Enter a positive scale percentage.');
        return;
      }

      this.callbacks.onScreenshotOutputScaleChange?.(outputScale);
      if (this.open) {
        void this.refreshPreview();
      } else {
        this.clearPreviewStage();
        this.setPreviewStatus(formatScreenshotRegionsStatus(target.regions, outputScale));
      }
      return;
    }

    if (!isScreenshotTarget(target)) {
      return;
    }

    const aspectRatio = getScreenshotRegionAspectRatio(target);
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
    if (isScreenshotRegionsTarget(target)) {
      const outputScale = parsePositiveScalePercent(this.elements.exportWidthInput.value);
      if (outputScale === null) {
        this.clearPreviewStage();
        this.setPreviewStatus('Enter a positive scale percentage.');
        return;
      }

      await this.refreshScreenshotRegionsPreview(target, outputScale);
      return;
    }

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
    this.clearPreviewStage();
    this.setPreviewStatus(null);
  }

  private renderPreview(pixels: ExportImagePixels): void {
    this.clearScreenshotRegionPreviewGrid();
    renderPixelsToCanvas(this.elements.exportPreviewCanvas, pixels);
    this.elements.exportPreviewCanvas.classList.remove('hidden');
    this.setPreviewStatus(null);
  }

  private async refreshScreenshotRegionsPreview(
    target: Extract<ExportImageTarget, { kind: 'screenshot-regions' }>,
    outputScale: number
  ): Promise<void> {
    const regions = buildScaledScreenshotRegions(target.regions, outputScale);
    const requestKey = serializeScreenshotRegionsPreviewRequest(regions);
    const requestId = this.takeRequestId();
    const abortController = new AbortController();
    this.exportImagePreviewAbortController = abortController;
    this.previewResource = pendingResource(requestKey, requestId);

    this.renderScreenshotRegionsPreviewPlaceholders(regions);
    this.setPreviewStatus(formatScreenshotRegionsStatus(regions, outputScale));

    let failed = false;
    await Promise.all(regions.map(async (region) => {
      const previewKey = serializeScreenshotRegionPreviewKey(region);
      try {
        const pixels = await this.callbacks.onResolveExportImagePreview({
          mode: 'screenshot',
          ...cloneScreenshotRegionCrop(region),
          outputWidth: region.outputWidth,
          outputHeight: region.outputHeight
        }, abortController.signal);
        if (
          this.disposed ||
          !this.open ||
          abortController.signal.aborted ||
          !isPendingMatch(this.previewResource, requestKey, requestId)
        ) {
          return;
        }

        this.updateScreenshotRegionPreviewFrame(previewKey, pixels, false);
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

        failed = true;
        this.updateScreenshotRegionPreviewFrame(previewKey, null, false);
      }
    }));

    if (
      !this.disposed &&
      this.open &&
      !abortController.signal.aborted &&
      isPendingMatch(this.previewResource, requestKey, requestId)
    ) {
      this.previewResource = idleResource();
      this.setPreviewStatus(
        failed
          ? `Some previews failed. ${formatScreenshotRegionsStatus(regions, outputScale)}`
          : formatScreenshotRegionsStatus(regions, outputScale)
      );
    }

    if (this.exportImagePreviewAbortController === abortController) {
      this.exportImagePreviewAbortController = null;
    }
  }

  private renderScreenshotRegionsPreviewPlaceholders(regions: ExportScreenshotRegionItem[]): void {
    this.clearPreviewStage();

    const grid = document.createElement('div');
    grid.className = 'export-screenshot-region-preview-grid';
    grid.setAttribute('aria-label', 'Screenshot region previews');

    for (const region of regions) {
      const previewKey = serializeScreenshotRegionPreviewKey(region);
      const card = document.createElement('figure');
      card.className = 'export-screenshot-region-preview-card';

      const caption = document.createElement('figcaption');
      caption.className = 'export-screenshot-region-preview-caption';

      const label = document.createElement('span');
      label.className = 'export-screenshot-region-preview-label';
      label.textContent = region.label;

      const size = document.createElement('span');
      size.className = 'export-screenshot-region-preview-size';
      size.textContent = formatOutputSize(region.outputWidth, region.outputHeight);

      const frame = document.createElement('div');
      frame.className = 'export-screenshot-region-preview-frame is-loading';
      frame.dataset.previewKey = previewKey;
      updateScreenshotRegionPreviewFrame(frame, null, true);

      caption.append(label, size);
      card.append(caption, frame);
      grid.append(card);
    }

    this.elements.exportPreviewStage.append(grid);
  }

  private updateScreenshotRegionPreviewFrame(
    previewKey: string,
    pixels: ExportImagePixels | null,
    isPending: boolean
  ): void {
    for (const frame of this.elements.exportPreviewStage.querySelectorAll<HTMLElement>(
      '.export-screenshot-region-preview-frame'
    )) {
      if (frame.dataset.previewKey === previewKey) {
        updateScreenshotRegionPreviewFrame(frame, pixels, isPending);
      }
    }
  }

  private clearPreviewStage(): void {
    this.hidePreviewCanvas();
    this.clearScreenshotRegionPreviewGrid();
  }

  private hidePreviewCanvas(): void {
    this.elements.exportPreviewCanvas.classList.add('hidden');
    this.elements.exportPreviewCanvas.width = 0;
    this.elements.exportPreviewCanvas.height = 0;
  }

  private clearScreenshotRegionPreviewGrid(): void {
    for (const element of this.elements.exportPreviewStage.querySelectorAll('.export-screenshot-region-preview-grid')) {
      element.remove();
    }
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

  private startExportProgress(): (update: ExportProgressUpdate) => void {
    this.resetExportProgress();
    this.exportProgressRevealTimeoutHandle = window.setTimeout(() => {
      this.exportProgressRevealTimeoutHandle = null;
      if (this.disposed || !this.open || !this.isExportPending()) {
        return;
      }

      this.exportProgressVisible = true;
      this.elements.exportProgress.classList.remove('hidden');
      this.renderExportProgress();
    }, EXPORT_PROGRESS_REVEAL_DELAY_MS);

    return (update) => {
      this.handleExportProgress(update);
    };
  }

  private handleExportProgress(update: ExportProgressUpdate): void {
    if (this.disposed) {
      return;
    }

    this.exportProgressUpdate = { ...update };
    if (this.exportProgressVisible) {
      this.renderExportProgress();
    }
  }

  private renderExportProgress(): void {
    const update = this.exportProgressUpdate ?? {
      completed: 0,
      total: 1,
      stage: 'preparing',
      indeterminate: true
    } satisfies ExportProgressUpdate;
    this.elements.exportProgressBar.max = Math.max(1, update.total);
    if (update.indeterminate) {
      this.elements.exportProgressBar.removeAttribute('value');
    } else {
      this.elements.exportProgressBar.value = clampProgressValue(update.completed, update.total);
    }
    this.elements.exportProgressLabel.textContent = formatSingleExportProgress(update);
  }

  private resetExportProgress(): void {
    if (this.exportProgressRevealTimeoutHandle !== null) {
      window.clearTimeout(this.exportProgressRevealTimeoutHandle);
      this.exportProgressRevealTimeoutHandle = null;
    }

    this.exportProgressVisible = false;
    this.exportProgressUpdate = null;
    this.elements.exportProgress.classList.add('hidden');
    this.elements.exportProgressBar.max = 1;
    this.elements.exportProgressBar.removeAttribute('value');
    this.elements.exportProgressLabel.textContent = '';
  }

  private takeRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}

function formatSingleExportProgress(update: ExportProgressUpdate): string {
  if (update.total > 1 && update.currentFilename) {
    const activeIndex = Math.min(clampProgressValue(update.completed, update.total) + 1, update.total);
    return `Exporting ${activeIndex} of ${update.total}: ${update.currentFilename}`;
  }

  if (update.total > 1 && update.stage === 'packaging') {
    return `Packaging ${update.total} images...`;
  }

  switch (update.stage) {
    case 'rendering':
      return 'Rendering image...';
    case 'encoding':
      return 'Encoding PNG...';
    case 'packaging':
      return 'Finishing export...';
    default:
      return 'Preparing export...';
  }
}

function clampProgressValue(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.min(Math.max(value, 0), total);
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

export function normalizeExportArchiveFilename(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.toLocaleLowerCase().endsWith('.zip') ? trimmed : `${trimmed}.zip`;
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
      ...cloneScreenshotRegionCrop(target),
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
    ...cloneScreenshotRegionCrop(target),
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

  const cropSize = getScreenshotRegionCropSize(target);
  return {
    width: Math.max(1, Math.round(cropSize.width)),
    height: Math.max(1, Math.round(cropSize.height))
  };
}

function cloneExportImageTarget(target: ExportImageTarget | null): ExportImageTarget | null {
  if (!target) {
    return null;
  }

  if (isScreenshotRegionsTarget(target)) {
    return {
      filename: target.filename,
      baseFilename: target.baseFilename,
      kind: 'screenshot-regions',
      outputScale: target.outputScale,
      regions: target.regions.map((region) => ({
        ...region,
        ...cloneScreenshotRegionCrop(region)
      }))
    };
  }

  if (isScreenshotTarget(target)) {
    return {
      filename: target.filename,
      kind: 'screenshot',
      ...cloneScreenshotRegionCrop(target),
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

function isScreenshotRegionsTarget(
  target: ExportImageTarget | null | undefined
): target is Extract<ExportImageTarget, { kind: 'screenshot-regions' }> {
  return target?.kind === 'screenshot-regions';
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parsePositiveScalePercent(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed / 100;
}

function buildScaledScreenshotRegions(
  regions: ExportScreenshotRegionItem[],
  outputScale: number
): ExportScreenshotRegionItem[] {
  return regions.map((region) => ({
    ...region,
    ...buildScaledScreenshotRegion(region, outputScale)
  }));
}

function formatScreenshotRegionsStatus(regions: ExportScreenshotRegionItem[], outputScale: number): string {
  const count = regions.length;
  const percent = Math.max(1, Math.round(outputScale * 100));
  return `${count} ${count === 1 ? 'region' : 'regions'} selected. ${count} PNG ${count === 1 ? 'image' : 'images'} will be exported at ${percent}%.`;
}

function updateScreenshotRegionPreviewFrame(
  frame: HTMLElement,
  pixels: ExportImagePixels | null,
  isPending: boolean
): void {
  frame.classList.toggle('is-loading', isPending);
  frame.classList.toggle('is-unavailable', !isPending && !pixels);

  if (pixels) {
    const canvas = document.createElement('canvas');
    canvas.className = 'export-screenshot-region-preview-canvas';
    renderPixelsToCanvas(canvas, pixels);
    frame.replaceChildren(canvas);
    return;
  }

  const placeholder = document.createElement('span');
  placeholder.className = 'export-screenshot-region-preview-placeholder';
  frame.replaceChildren(placeholder);
}

function serializeScreenshotRegionsPreviewRequest(regions: ExportScreenshotRegionItem[]): string {
  return JSON.stringify(regions.map((region) => ({
    id: region.id,
    index: region.index,
    crop: serializeScreenshotRegionCrop(region),
    outputWidth: region.outputWidth,
    outputHeight: region.outputHeight
  })));
}

function serializeScreenshotRegionPreviewKey(region: ExportScreenshotRegionItem): string {
  return JSON.stringify({
    id: region.id,
    index: region.index,
    outputWidth: region.outputWidth,
    outputHeight: region.outputHeight
  });
}

function formatOutputSize(width: number, height: number): string {
  return `${width} x ${height} px`;
}

function serializeExportImagePreviewRequest(request: ExportImagePreviewRequest): string {
  return JSON.stringify(request);
}
