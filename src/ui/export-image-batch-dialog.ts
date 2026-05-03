import {
  hasSplitChannelViewItems,
  selectVisibleChannelViewItems
} from '../channel-view-items';
import {
  errorResource,
  getSuccessValue,
  idleResource,
  isPendingMatch,
  pendingResource,
  successResource,
  type AsyncResource
} from '../async-resource';
import { cloneDisplaySelection, sameDisplaySelection } from '../display-model';
import {
  createPngDataUrlFromPixels,
  parsePngCompressionLevel,
  type ExportImagePixels
} from '../export-image';
import { createAbortError, DisposableBag, isAbortError, type Disposable } from '../lifecycle';
import {
  DEFAULT_PNG_COMPRESSION_LEVEL,
  type DisplaySelection,
  type ExportImageBatchChannelTarget,
  type ExportImageBatchEntryRequest,
  type ExportImageBatchPreviewRequest,
  type ExportImageBatchRequest,
  type ExportImageBatchTarget,
  type ExportProgressUpdate,
  type ExportScreenshotRegion,
  type ExportScreenshotRegionItem
} from '../types';
import { bindDialogBackdropDismiss } from './dialog-backdrop';
import type { ExportImageBatchDialogElements } from './elements';

const DEFAULT_BATCH_ARCHIVE_FILENAME = 'openexr-export.zip';
const DEFAULT_SCREENSHOT_BATCH_ARCHIVE_FILENAME = 'openexr-screenshot-export.zip';
const CELL_KEY_SEPARATOR = '\u001f';
const BATCH_EXPORT_RESOURCE_KEY = 'export-batch';
const PNG_COMPRESSION_VALIDATION_MESSAGE = 'PNG compression must be an integer from 0 to 9.';
const BATCH_PREVIEW_IDLE_TIMEOUT_MS = 250;
const BATCH_PREVIEW_IDLE_FALLBACK_DELAY_MS = 64;
const SCREENSHOT_BATCH_PREVIEW_DEBOUNCE_MS = 250;
type ExportBatchDialogMode = 'image' | 'screenshot';
export type ExportBatchFilenameSource = 'openFilesName' | 'sourcePath';

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCallbackLike = (deadline: IdleDeadlineLike) => void;

interface BatchPreviewWindowLike {
  requestIdleCallback?: (callback: IdleCallbackLike, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

interface ExportImageBatchDialogCallbacks {
  onExportImageBatch: (
    request: ExportImageBatchRequest,
    signal: AbortSignal,
    onProgress?: (update: ExportProgressUpdate) => void
  ) => Promise<void>;
  onResolveExportImageBatchPreview: (
    request: ExportImageBatchPreviewRequest,
    signal: AbortSignal
  ) => Promise<ExportImagePixels>;
  onCancel?: (mode: ExportBatchDialogMode) => void;
  onScreenshotOutputSizeChange?: (size: { width: number; height: number }) => void;
  onScreenshotOutputScaleChange?: (scale: number) => void;
}

export interface ExportImageBatchDialogOpenOptions {
  mode?: ExportBatchDialogMode;
  screenshot?: ExportScreenshotRegion;
  screenshots?: ExportScreenshotRegionItem[];
  outputScale?: number;
}

export interface ExportBatchColumn {
  key: string;
  label: string;
  order: number;
}

interface BatchPreviewJob {
  previewKey: string;
  cellKey: string;
  file: ExportImageBatchTarget['files'][number];
  channel: ExportImageBatchChannelTarget;
  screenshot: ExportScreenshotRegionItem | null;
  requestId: number;
  order: number;
}

type ExportBatchRegionSelection = ExportScreenshotRegionItem | null;

export class ExportImageBatchDialogController implements Disposable {
  private readonly disposables = new DisposableBag();
  private target: ExportImageBatchTarget | null = null;
  private checkedCellKeys = new Set<string>();
  private open = false;
  private exportResource: AsyncResource<void> = idleResource();
  private includeSplitRgbChannels = false;
  private dialogMode: ExportBatchDialogMode = 'image';
  private screenshotRegions: ExportScreenshotRegionItem[] = [];
  private screenshotOutputScale = 1;
  private syncingScreenshotSize = false;
  private restoreFocusTarget: HTMLElement | null = null;
  private abortController: AbortController | null = null;
  private previewAbortController: AbortController | null = null;
  private previewGeneration = 0;
  private previewProcessing = false;
  private previewScrollRafHandle: number | null = null;
  private screenshotPreviewDebounceHandle: number | null = null;
  private exportProgressVisible = false;
  private exportProgressUpdate: ExportProgressUpdate | null = null;
  private previewJobSequence = 0;
  private readonly previewJobsByKey = new Map<string, BatchPreviewJob>();
  private readonly previewResourcesByKey = new Map<string, AsyncResource<string | null>>();
  private nextRequestId = 1;
  private disposed = false;

  constructor(
    private readonly elements: ExportImageBatchDialogElements,
    private readonly callbacks: ExportImageBatchDialogCallbacks
  ) {
    this.disposables.addDisposable(bindDialogBackdropDismiss(this.elements.exportBatchDialogBackdrop, () => {
      if (!this.busy) {
        this.cancel(true);
      }
    }));

    this.disposables.addEventListener(this.elements.exportBatchDialogCancelButton, 'click', () => {
      if (this.busy) {
        this.callbacks.onCancel?.(this.dialogMode);
        this.resetExportProgress();
        this.abortController?.abort(createAbortError('Batch export cancelled.'));
        this.setStatus('Canceling export...');
        return;
      }

      this.cancel(true);
    });

    this.disposables.addEventListener(this.elements.exportBatchDialogForm, 'submit', (event) => {
      event.preventDefault();
      void this.handleSubmit();
    });

    this.disposables.addEventListener(this.elements.exportBatchSelectAllButton, 'click', () => {
      this.handleSelectAll();
    });

    this.disposables.addEventListener(this.elements.exportBatchDeselectAllButton, 'click', () => {
      this.handleDeselectAll();
    });

    this.disposables.addEventListener(this.elements.exportBatchSplitToggleButton, 'click', () => {
      this.handleSplitToggle();
    });

    this.disposables.addEventListener(this.elements.exportBatchMatrix, 'change', (event) => {
      this.handleMatrixChange(event);
    });

    this.disposables.addEventListener(this.elements.exportBatchMatrix, 'scroll', () => {
      this.schedulePreviewReprioritization();
    });

    this.disposables.addEventListener(this.elements.exportBatchWidthInput, 'input', () => {
      this.handleScreenshotSizeInput('width');
    });

    this.disposables.addEventListener(this.elements.exportBatchHeightInput, 'input', () => {
      this.handleScreenshotSizeInput('height');
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.abortController?.abort(createAbortError('Batch export dialog has been disposed.'));
    this.abortController = null;
    this.abortPreviewWork({ clearCache: true });
    this.resetExportProgress();
    this.disposables.dispose();
  }

  hasTarget(): boolean {
    return Boolean(this.target && this.target.files.length > 0);
  }

  isOpen(): boolean {
    return this.open;
  }

  isBusy(): boolean {
    return this.busy;
  }

  private get busy(): boolean {
    return this.exportResource.status === 'pending';
  }

  private getPreviewDataUrl(previewKey: string): string | null {
    return getSuccessValue(this.previewResourcesByKey.get(previewKey) ?? idleResource()) ?? null;
  }

  private isPreviewPending(previewKey: string): boolean {
    return this.previewResourcesByKey.get(previewKey)?.status === 'pending';
  }

  private getPreviewPresentation(previewKey: string): { dataUrl: string | null; isPending: boolean } {
    if (!this.hasValidScreenshotOutputSize()) {
      return { dataUrl: null, isPending: false };
    }

    return {
      dataUrl: this.getPreviewDataUrl(previewKey),
      isPending: this.isPreviewPending(previewKey) || !this.previewResourcesByKey.has(previewKey)
    };
  }

  private takeRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }

  setTarget(target: ExportImageBatchTarget | null): void {
    if (this.disposed) {
      return;
    }

    this.target = target ? cloneExportBatchTarget(target) : null;
    if (!this.target) {
      this.abortPreviewWork({ clearCache: true });
      this.close(false);
      this.resetInputs();
      return;
    }

    if (!this.open) {
      this.includeSplitRgbChannels = false;
      this.abortPreviewWork({ clearCache: true });
      this.applyTarget(this.target);
    } else {
      if (!targetHasSplitChannelViews(this.target)) {
        this.includeSplitRgbChannels = false;
      }
      this.abortPreviewWork({ clearCache: true });
      this.checkedCellKeys = buildDefaultExportBatchCheckedCells(
        this.target,
        this.includeSplitRgbChannels,
        this.getSelectionRegions()
      );
      this.renderMatrix();
      this.updateStatus();
    }
  }

  openDialog(options: ExportImageBatchDialogOpenOptions = {}): void {
    if (this.disposed || !this.target || this.elements.exportImageBatchButton.disabled) {
      return;
    }

    this.restoreFocusTarget = this.elements.fileMenuButton;
    this.dialogMode = options.mode ?? 'image';
    const screenshotRegions = options.screenshots?.length
      ? options.screenshots
      : options.screenshot
        ? [buildScreenshotRegionItem(options.screenshot, 0, 1)]
        : [];
    this.screenshotRegions = this.dialogMode === 'screenshot'
      ? cloneScreenshotRegions(screenshotRegions)
      : [];
    this.screenshotOutputScale = options.outputScale ?? 1;
    if (this.dialogMode === 'screenshot' && this.screenshotRegions.length === 0) {
      this.dialogMode = 'image';
    }
    this.includeSplitRgbChannels = false;
    this.elements.exportBatchUseOpenFilesNamesCheckbox.checked = true;
    this.elements.exportBatchReproductionMetadataCheckbox.checked = false;
    this.setBusy(false);
    this.open = true;
    this.abortPreviewWork({ clearCache: true });
    this.applyTarget(this.target);
    this.setError(null);
    this.elements.exportBatchDialogBackdrop.classList.remove('hidden');
    this.elements.exportBatchArchiveFilenameInput.focus();
    this.elements.exportBatchArchiveFilenameInput.select();
  }

  close(restoreFocus = true): void {
    if (this.disposed) {
      return;
    }

    if (!this.open && this.elements.exportBatchDialogBackdrop.classList.contains('hidden')) {
      return;
    }

    this.open = false;
    this.abortController?.abort(createAbortError('Batch export cancelled.'));
    this.abortController = null;
    this.abortPreviewWork({ clearCache: true });
    this.resetExportProgress();
    this.setBusy(false);
    this.setError(null);
    this.elements.exportBatchDialogBackdrop.classList.add('hidden');
    this.dialogMode = 'image';
    this.screenshotRegions = [];
    this.screenshotOutputScale = 1;
    this.syncingScreenshotSize = false;

    if (restoreFocus) {
      (this.restoreFocusTarget ?? this.elements.exportImageBatchButton).focus();
    }
    this.restoreFocusTarget = null;
  }

  private cancel(restoreFocus = true): void {
    if (this.disposed || !this.open) {
      return;
    }

    const mode = this.dialogMode;
    this.close(restoreFocus);
    this.callbacks.onCancel?.(mode);
  }

  private applyTarget(target: ExportImageBatchTarget): void {
    this.applyDialogMode();
    this.elements.exportBatchArchiveFilenameInput.value = this.dialogMode === 'screenshot'
      ? DEFAULT_SCREENSHOT_BATCH_ARCHIVE_FILENAME
      : target.archiveFilename || DEFAULT_BATCH_ARCHIVE_FILENAME;
    this.elements.exportBatchCompressionInput.value = String(DEFAULT_PNG_COMPRESSION_LEVEL);
    if (this.dialogMode === 'screenshot' && this.screenshotRegions.length > 1) {
      this.elements.exportBatchSizeFieldLabel.textContent = 'Scale';
      this.elements.exportBatchWidthFieldLabel.textContent = 'Percent';
      this.elements.exportBatchHeightFieldLabel.textContent = 'Height';
      this.elements.exportBatchHeightInput.closest('.app-dialog-inline-field')?.classList.add('hidden');
      this.elements.exportBatchWidthInput.value = String(Math.max(1, Math.round(this.screenshotOutputScale * 100)));
      this.elements.exportBatchHeightInput.value = '';
      this.elements.exportBatchReproductionMetadataCheckbox.checked = false;
    } else if (this.dialogMode === 'screenshot' && this.screenshotRegions.length === 1) {
      const region = this.screenshotRegions[0]!;
      this.elements.exportBatchSizeFieldLabel.textContent = 'Size';
      this.elements.exportBatchWidthFieldLabel.textContent = 'Width';
      this.elements.exportBatchHeightFieldLabel.textContent = 'Height';
      this.elements.exportBatchHeightInput.closest('.app-dialog-inline-field')?.classList.remove('hidden');
      this.elements.exportBatchWidthInput.value = String(region.outputWidth);
      this.elements.exportBatchHeightInput.value = String(region.outputHeight);
      this.elements.exportBatchReproductionMetadataCheckbox.checked = false;
    } else {
      this.elements.exportBatchSizeFieldLabel.textContent = 'Size';
      this.elements.exportBatchWidthFieldLabel.textContent = 'Width';
      this.elements.exportBatchHeightFieldLabel.textContent = 'Height';
      this.elements.exportBatchHeightInput.closest('.app-dialog-inline-field')?.classList.remove('hidden');
      this.elements.exportBatchWidthInput.value = '';
      this.elements.exportBatchHeightInput.value = '';
      this.elements.exportBatchReproductionMetadataCheckbox.checked = false;
    }
    if (!targetHasSplitChannelViews(target)) {
      this.includeSplitRgbChannels = false;
    }
    this.checkedCellKeys = buildDefaultExportBatchCheckedCells(
      target,
      this.includeSplitRgbChannels,
      this.getSelectionRegions()
    );
    this.renderMatrix();
    this.updateStatus();
  }

  private resetInputs(): void {
    this.abortPreviewWork({ clearCache: true });
    this.applyDialogMode();
    this.elements.exportBatchArchiveFilenameInput.value = '';
    this.elements.exportBatchUseOpenFilesNamesCheckbox.checked = true;
    this.elements.exportBatchCompressionInput.value = String(DEFAULT_PNG_COMPRESSION_LEVEL);
    this.elements.exportBatchWidthInput.value = '';
    this.elements.exportBatchHeightInput.value = '';
    this.elements.exportBatchSizeFieldLabel.textContent = 'Size';
    this.elements.exportBatchWidthFieldLabel.textContent = 'Width';
    this.elements.exportBatchHeightFieldLabel.textContent = 'Height';
    this.elements.exportBatchHeightInput.closest('.app-dialog-inline-field')?.classList.remove('hidden');
    this.elements.exportBatchReproductionMetadataCheckbox.checked = false;
    this.elements.exportBatchMatrix.replaceChildren();
    this.includeSplitRgbChannels = false;
    this.checkedCellKeys.clear();
    this.setStatus('');
    this.updateSelectionActionState();
    this.updateSplitToggleState();
  }

  private applyDialogMode(): void {
    const screenshot = this.dialogMode === 'screenshot' && this.screenshotRegions.length > 0;
    const multiRegion = screenshot && this.screenshotRegions.length > 1;
    this.elements.exportBatchDialogTitle.textContent = multiRegion
      ? 'Export Screenshot Regions Batch'
      : screenshot
        ? 'Export Screenshot Batch'
        : 'Export Batch';
    this.elements.exportBatchDialogSubtitle.textContent = screenshot
      ? multiRegion
        ? 'Export selected file, channel, and screenshot region combinations as a ZIP of PNG images.'
        : 'Export selected file and channel screenshots as a ZIP of PNG images.'
      : 'Export selected file and channel combinations as a ZIP of PNG images.';
    this.elements.exportBatchSizeField.classList.toggle('hidden', !screenshot);
    this.elements.exportBatchReproductionMetadataField.classList.toggle('hidden', !screenshot);
    if (!screenshot) {
      this.elements.exportBatchReproductionMetadataCheckbox.checked = false;
    }
  }

  private setBusy(busy: boolean): void {
    if (this.disposed) {
      return;
    }

    this.exportResource = busy ? pendingResource(BATCH_EXPORT_RESOURCE_KEY, this.takeRequestId()) : idleResource();
    this.syncBusyControls();
  }

  private syncBusyControls(): void {
    const busy = this.busy;
    this.elements.exportBatchArchiveFilenameInput.disabled = busy;
    this.elements.exportBatchUseOpenFilesNamesCheckbox.disabled = busy;
    this.elements.exportBatchCompressionInput.disabled = busy;
    this.elements.exportBatchWidthInput.disabled = busy;
    this.elements.exportBatchHeightInput.disabled = busy;
    this.elements.exportBatchReproductionMetadataCheckbox.disabled = busy;
    this.updateSplitToggleState();
    this.updateSelectionActionState();
    this.elements.exportBatchDialogSubmitButton.disabled =
      busy || this.getSelectedEntryCount() === 0 || !this.hasValidScreenshotOutputSize();
    this.elements.exportBatchDialogSubmitButton.textContent = busy ? 'Exporting...' : 'Export';
    this.elements.exportBatchDialogCancelButton.disabled = false;
    if (!busy && this.open) {
      this.renderMatrix();
    } else {
      this.syncMatrixDisabledState();
    }
  }

  private setError(message: string | null): void {
    if (!message) {
      this.elements.exportBatchDialogError.classList.add('hidden');
      this.elements.exportBatchDialogError.textContent = '';
      return;
    }

    this.elements.exportBatchDialogError.classList.remove('hidden');
    this.elements.exportBatchDialogError.textContent = message;
  }

  private setStatus(message: string): void {
    this.elements.exportBatchDialogStatus.textContent = message;
  }

  private updateStatus(): void {
    if (this.busy) {
      return;
    }

    this.updateSelectionActionState();

    if (!this.hasValidScreenshotOutputSize()) {
      this.setStatus(
        this.dialogMode === 'screenshot' && this.screenshotRegions.length > 1
          ? 'Enter a positive scale percentage.'
          : 'Enter a positive width and height.'
      );
      this.elements.exportBatchDialogSubmitButton.disabled = true;
      return;
    }

    const count = this.getSelectedEntryCount();
    this.setStatus(count === 1 ? '1 image selected.' : `${count} images selected.`);
    this.elements.exportBatchDialogSubmitButton.disabled = count === 0;
  }

  private getSelectedEntryCount(): number {
    return this.target
      ? buildExportBatchEntries(
        this.target,
        this.checkedCellKeys,
        this.includeSplitRgbChannels,
        this.getScreenshotRegionsForRequest()
      ).length
      : 0;
  }

  private hasValidScreenshotOutputSize(): boolean {
    return this.dialogMode !== 'screenshot' || this.getScreenshotRegionsForRequest() !== null;
  }

  private getScreenshotRegionsForRequest(): ExportScreenshotRegionItem[] | null {
    if (this.dialogMode !== 'screenshot' || this.screenshotRegions.length === 0) {
      return null;
    }

    if (this.screenshotRegions.length > 1) {
      const outputScale = parsePositiveScalePercent(this.elements.exportBatchWidthInput.value);
      if (outputScale === null) {
        return null;
      }

      return this.screenshotRegions.map((region) => ({
        ...region,
        rect: { ...region.rect },
        sourceViewport: { ...region.sourceViewport },
        outputWidth: Math.max(1, Math.round(region.rect.width * outputScale)),
        outputHeight: Math.max(1, Math.round(region.rect.height * outputScale))
      }));
    }

    const region = this.screenshotRegions[0]!;
    const outputWidth = parsePositiveInteger(this.elements.exportBatchWidthInput.value);
    const outputHeight = parsePositiveInteger(this.elements.exportBatchHeightInput.value);
    if (!outputWidth || !outputHeight) {
      return null;
    }

    return [{
      ...region,
      rect: { ...region.rect },
      sourceViewport: { ...region.sourceViewport },
      outputWidth,
      outputHeight
    }];
  }

  private isMultiRegionScreenshotMode(): boolean {
    return this.dialogMode === 'screenshot' && this.screenshotRegions.length > 1;
  }

  private getSelectionRegions(): ExportScreenshotRegionItem[] {
    return this.isMultiRegionScreenshotMode() ? this.screenshotRegions : [];
  }

  private getMatrixRegions(): ExportScreenshotRegionItem[] {
    if (!this.isMultiRegionScreenshotMode()) {
      return [];
    }

    return this.getScreenshotRegionsForRequest() ?? this.screenshotRegions;
  }

  private getSingleScreenshotRegionForRequest(): ExportScreenshotRegionItem | null {
    if (this.dialogMode !== 'screenshot' || this.isMultiRegionScreenshotMode()) {
      return null;
    }

    return this.getScreenshotRegionsForRequest()?.[0] ?? null;
  }

  private handleSplitToggle(): void {
    if (this.disposed || this.busy || !this.target || this.elements.exportBatchSplitToggleButton.disabled) {
      return;
    }

    const nextIncludeSplitRgbChannels = !this.includeSplitRgbChannels;
    this.checkedCellKeys = remapExportBatchCheckedCells(
      this.target,
      this.checkedCellKeys,
      this.includeSplitRgbChannels,
      nextIncludeSplitRgbChannels,
      this.getSelectionRegions()
    );
    this.includeSplitRgbChannels = nextIncludeSplitRgbChannels;
    this.abortPreviewWork({ clearCache: true });
    this.renderMatrix();
    this.updateStatus();
  }

  private handleSelectAll(): void {
    if (this.disposed || this.busy || !this.target || this.elements.exportBatchSelectAllButton.disabled) {
      return;
    }

    this.checkedCellKeys = buildVisibleExportBatchCellKeys(
      this.target,
      this.includeSplitRgbChannels,
      this.getSelectionRegions()
    );
    this.renderMatrix();
    this.updateStatus();
  }

  private handleDeselectAll(): void {
    if (this.disposed || this.busy || !this.target || this.elements.exportBatchDeselectAllButton.disabled) {
      return;
    }

    this.checkedCellKeys.clear();
    this.renderMatrix();
    this.updateStatus();
  }

  private handleMatrixChange(event: Event): void {
    if (this.disposed || this.busy || !this.target) {
      return;
    }

    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') {
      return;
    }

    const sessionId = input.dataset.sessionId ?? '';
    const columnKey = input.dataset.columnKey ?? '';
    const regionId = input.dataset.regionId ?? '';
    if (input.dataset.batchToggle === 'row') {
      this.setRowChecked(sessionId, input.checked);
    } else if (input.dataset.batchToggle === 'region-row') {
      this.setRegionRowChecked(sessionId, regionId, input.checked);
    } else if (input.dataset.batchToggle === 'column') {
      this.setColumnChecked(columnKey, input.checked);
    } else if (input.dataset.batchToggle === 'cell') {
      const key = serializeCellKey(sessionId, columnKey, regionId || null);
      if (input.checked) {
        this.checkedCellKeys.add(key);
      } else {
        this.checkedCellKeys.delete(key);
      }
    }

    this.renderMatrix();
    this.updateStatus();
  }

  private handleScreenshotSizeInput(source: 'width' | 'height'): void {
    if (this.disposed || this.syncingScreenshotSize || this.dialogMode !== 'screenshot' || this.screenshotRegions.length === 0) {
      return;
    }

    if (this.screenshotRegions.length > 1) {
      const outputScale = parsePositiveScalePercent(this.elements.exportBatchWidthInput.value);
      if (outputScale === null) {
        this.abortPreviewWork({ clearCache: true });
        this.updateAllPreviewElements();
        this.updateStatus();
        return;
      }

      this.screenshotOutputScale = outputScale;
      this.callbacks.onScreenshotOutputScaleChange?.(outputScale);
      this.abortPreviewWork({ clearCache: true, cancelDebounce: false });
      this.renderMatrix();
      this.updateStatus();
      return;
    }

    const region = this.screenshotRegions[0]!;
    const aspectRatio = region.rect.width / Math.max(region.rect.height, Number.EPSILON);
    const sourceInput = source === 'width' ? this.elements.exportBatchWidthInput : this.elements.exportBatchHeightInput;
    const targetInput = source === 'width' ? this.elements.exportBatchHeightInput : this.elements.exportBatchWidthInput;
    const sourceValue = parsePositiveInteger(sourceInput.value);
    if (!sourceValue) {
      this.abortPreviewWork({ clearCache: true });
      this.updateAllPreviewElements();
      this.updateStatus();
      return;
    }

    const nextTargetValue = source === 'width'
      ? Math.max(1, Math.round(sourceValue / aspectRatio))
      : Math.max(1, Math.round(sourceValue * aspectRatio));

    this.syncingScreenshotSize = true;
    targetInput.value = String(nextTargetValue);
    this.syncingScreenshotSize = false;

    const outputWidth = parsePositiveInteger(this.elements.exportBatchWidthInput.value);
    const outputHeight = parsePositiveInteger(this.elements.exportBatchHeightInput.value);
    if (outputWidth && outputHeight) {
      this.callbacks.onScreenshotOutputSizeChange?.({ width: outputWidth, height: outputHeight });
    }

    this.abortPreviewWork({ clearCache: false, cancelDebounce: false });
    this.updateAllPreviewElements();
    this.scheduleScreenshotPreviewRefresh();
    this.updateStatus();
  }

  private setRowChecked(sessionId: string, checked: boolean): void {
    const target = this.target;
    if (!target) {
      return;
    }

    const file = target.files.find((item) => item.sessionId === sessionId);
    if (!file) {
      return;
    }

    for (const region of expandSelectionRegions(this.getSelectionRegions())) {
      for (const channel of getVisibleBatchChannels(file.channels, this.includeSplitRgbChannels)) {
        const key = serializeCellKey(file.sessionId, getColumnKeyForChannel(channel), region?.id ?? null);
        if (checked) {
          this.checkedCellKeys.add(key);
        } else {
          this.checkedCellKeys.delete(key);
        }
      }
    }
  }

  private setRegionRowChecked(sessionId: string, regionId: string, checked: boolean): void {
    const target = this.target;
    if (!target || !regionId) {
      return;
    }

    const file = target.files.find((item) => item.sessionId === sessionId);
    const region = this.getSelectionRegions().find((item) => item.id === regionId) ?? null;
    if (!file || !region) {
      return;
    }

    for (const channel of getVisibleBatchChannels(file.channels, this.includeSplitRgbChannels)) {
      const key = serializeCellKey(file.sessionId, getColumnKeyForChannel(channel), region.id);
      if (checked) {
        this.checkedCellKeys.add(key);
      } else {
        this.checkedCellKeys.delete(key);
      }
    }
  }

  private setColumnChecked(columnKey: string, checked: boolean): void {
    const target = this.target;
    if (!target) {
      return;
    }

    for (const file of target.files) {
      if (!findChannelForColumn(getVisibleBatchChannels(file.channels, this.includeSplitRgbChannels), columnKey)) {
        continue;
      }

      for (const region of expandSelectionRegions(this.getSelectionRegions())) {
        const key = serializeCellKey(file.sessionId, columnKey, region?.id ?? null);
        if (checked) {
          this.checkedCellKeys.add(key);
        } else {
          this.checkedCellKeys.delete(key);
        }
      }
    }
  }

  private renderMatrix(): void {
    const target = this.target;
    this.updateSplitToggleState();
    if (!target || target.files.length === 0) {
      this.elements.exportBatchMatrix.replaceChildren(createExportBatchEmptyState('No open files'));
      this.updateSelectionActionState();
      return;
    }

    const columns = buildExportBatchColumns(target.files, this.includeSplitRgbChannels);
    if (columns.length === 0) {
      this.elements.exportBatchMatrix.replaceChildren(createExportBatchEmptyState('No exportable channels'));
      this.updateSelectionActionState();
      return;
    }

    const table = document.createElement('table');
    table.className = 'export-batch-table';
    table.append(
      this.createMatrixHeader(columns, target),
      this.createMatrixBody(columns, target)
    );
    this.elements.exportBatchMatrix.replaceChildren(table);
    this.syncMatrixDisabledState();
    this.updateSelectionActionState();
    this.queueVisiblePreviews(columns, target);
  }

  private createMatrixHeader(columns: ExportBatchColumn[], target: ExportImageBatchTarget): HTMLTableSectionElement {
    const thead = document.createElement('thead');
    const row = document.createElement('tr');
    const selectionRegions = this.getSelectionRegions();

    const fileHeading = document.createElement('th');
    fileHeading.className = 'export-batch-file-cell';
    fileHeading.scope = 'col';
    fileHeading.textContent = 'File';
    row.append(fileHeading);

    if (selectionRegions.length > 1) {
      const regionHeading = document.createElement('th');
      regionHeading.className = 'export-batch-region-cell';
      regionHeading.scope = 'col';
      regionHeading.textContent = 'Region';
      row.append(regionHeading);
    }

    for (const column of columns) {
      const th = document.createElement('th');
      th.className = 'export-batch-channel-cell';
      th.scope = 'col';

      const enabledCellCount = target.files.reduce((count, file) => {
        const channel = findChannelForColumn(getVisibleBatchChannels(file.channels, this.includeSplitRgbChannels), column.key);
        return count + (channel ? expandSelectionRegions(selectionRegions).length : 0);
      }, 0);
      const checkedCellCount = target.files.reduce((count, file) => {
        const channel = findChannelForColumn(getVisibleBatchChannels(file.channels, this.includeSplitRgbChannels), column.key);
        if (!channel) {
          return count;
        }

        return count + expandSelectionRegions(selectionRegions).reduce((innerCount, region) => (
          innerCount + (this.checkedCellKeys.has(serializeCellKey(file.sessionId, column.key, region?.id ?? null)) ? 1 : 0)
        ), 0);
      }, 0);

      const label = document.createElement('label');
      label.className = 'export-batch-column-toggle';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.batchToggle = 'column';
      input.dataset.columnKey = column.key;
      input.checked = enabledCellCount > 0 && checkedCellCount === enabledCellCount;
      input.indeterminate = checkedCellCount > 0 && checkedCellCount < enabledCellCount;
      input.disabled = enabledCellCount === 0;

      const text = document.createElement('span');
      text.className = 'export-batch-channel-label';
      text.textContent = column.label;
      text.title = column.label;

      label.append(input, text);
      th.append(label);
      row.append(th);
    }

    thead.append(row);
    return thead;
  }

  private createMatrixBody(columns: ExportBatchColumn[], target: ExportImageBatchTarget): HTMLTableSectionElement {
    const tbody = document.createElement('tbody');
    const regions = this.getMatrixRegions();
    const rowRegions: ExportBatchRegionSelection[] = regions.length > 1 ? regions : [null];

    for (const file of target.files) {
      for (const [regionIndex, region] of rowRegions.entries()) {
        const row = document.createElement('tr');
        if (regionIndex === 0) {
          row.append(this.createFileHeader(file, columns, rowRegions));
        }

        if (region) {
          row.append(this.createRegionHeader(file, columns, region));
        }

        for (const column of columns) {
          const td = document.createElement('td');
          td.className = 'export-batch-channel-cell';
          const channel = findChannelForColumn(getVisibleBatchChannels(file.channels, this.includeSplitRgbChannels), column.key);
          if (channel) {
            td.append(this.createCellToggle(file, column.key, channel, region));
          } else {
            const disabled = document.createElement('span');
            disabled.className = 'export-batch-cell-disabled';
            disabled.textContent = '-';
            td.append(disabled);
          }
          row.append(td);
        }

        tbody.append(row);
      }
    }

    return tbody;
  }

  private createFileHeader(
    file: ExportImageBatchTarget['files'][number],
    columns: ExportBatchColumn[],
    regions: ExportBatchRegionSelection[] = [null]
  ): HTMLTableCellElement {
    const th = document.createElement('th');
    th.className = 'export-batch-file-cell';
    th.scope = regions.length > 1 ? 'rowgroup' : 'row';
    if (regions.length > 1) {
      th.rowSpan = regions.length;
    }

    const enabledKeys = regions.flatMap((region) => columns
      .filter((column) => findChannelForColumn(getVisibleBatchChannels(file.channels, this.includeSplitRgbChannels), column.key))
      .map((column) => serializeCellKey(file.sessionId, column.key, region?.id ?? null)));
    const checkedCount = enabledKeys.reduce((count, key) => count + (this.checkedCellKeys.has(key) ? 1 : 0), 0);

    const label = document.createElement('label');
    label.className = 'export-batch-file-toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.batchToggle = 'row';
    input.dataset.sessionId = file.sessionId;
    input.checked = enabledKeys.length > 0 && checkedCount === enabledKeys.length;
    input.indeterminate = checkedCount > 0 && checkedCount < enabledKeys.length;
    input.disabled = enabledKeys.length === 0;

    label.append(input, createFileLabel(file));
    th.append(label);
    return th;
  }

  private createRegionHeader(
    file: ExportImageBatchTarget['files'][number],
    columns: ExportBatchColumn[],
    region: ExportScreenshotRegionItem
  ): HTMLTableCellElement {
    const th = document.createElement('th');
    th.className = 'export-batch-region-cell';
    th.scope = 'row';

    const enabledKeys = columns
      .filter((column) => findChannelForColumn(getVisibleBatchChannels(file.channels, this.includeSplitRgbChannels), column.key))
      .map((column) => serializeCellKey(file.sessionId, column.key, region.id));
    const checkedCount = enabledKeys.reduce((count, key) => count + (this.checkedCellKeys.has(key) ? 1 : 0), 0);

    const label = document.createElement('label');
    label.className = 'export-batch-region-toggle';
    label.title = `${formatRegionToken(region)} - ${formatOutputSize(region.outputWidth, region.outputHeight)}`;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.batchToggle = 'region-row';
    input.dataset.sessionId = file.sessionId;
    input.dataset.regionId = region.id;
    input.checked = enabledKeys.length > 0 && checkedCount === enabledKeys.length;
    input.indeterminate = checkedCount > 0 && checkedCount < enabledKeys.length;
    input.disabled = enabledKeys.length === 0;

    const text = document.createElement('span');
    text.className = 'export-batch-region-label';
    text.textContent = formatRegionToken(region);

    const size = document.createElement('span');
    size.className = 'export-batch-region-size';
    size.textContent = formatOutputSize(region.outputWidth, region.outputHeight);

    label.append(input, text, size);
    th.append(label);
    return th;
  }

  private createCellToggle(
    file: ExportImageBatchTarget['files'][number],
    columnKey: string,
    channel: ExportImageBatchChannelTarget,
    region: ExportBatchRegionSelection = null
  ): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'export-batch-cell-toggle';
    label.title = region ? `${formatRegionToken(region)} ${channel.label}` : channel.label;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.batchToggle = 'cell';
    input.dataset.sessionId = file.sessionId;
    input.dataset.columnKey = columnKey;
    if (region) {
      input.dataset.regionId = region.id;
    }
    input.checked = this.checkedCellKeys.has(serializeCellKey(file.sessionId, columnKey, region?.id ?? null));

    label.append(input, this.createCellPreview(file, columnKey, channel, region));
    return label;
  }

  private createCellPreview(
    file: ExportImageBatchTarget['files'][number],
    columnKey: string,
    _channel: ExportImageBatchChannelTarget,
    region: ExportBatchRegionSelection = null
  ): HTMLElement {
    const previewKey = this.createPreviewKey(file.sessionId, columnKey, region);
    const { dataUrl, isPending } = this.getPreviewPresentation(previewKey);
    return createBatchCellPreview(previewKey, dataUrl, isPending);
  }

  private createPreviewKey(
    sessionId: string,
    columnKey: string,
    region: ExportBatchRegionSelection = null
  ): string {
    const cellKey = serializeCellKey(sessionId, columnKey, region?.id ?? null);
    return region ? serializeBatchRegionPreviewKey(cellKey, region) : cellKey;
  }

  private queueVisiblePreviews(columns: ExportBatchColumn[], target: ExportImageBatchTarget): void {
    if (this.disposed || this.busy || !this.open || !this.hasValidScreenshotOutputSize()) {
      return;
    }

    let queued = false;
    const regions = this.getMatrixRegions();
    const rowRegions: ExportBatchRegionSelection[] = regions.length > 1 ? regions : [null];
    for (const file of target.files) {
      const visibleChannels = getVisibleBatchChannels(file.channels, this.includeSplitRgbChannels);
      for (const region of rowRegions) {
        for (const column of columns) {
          const channel = findChannelForColumn(visibleChannels, column.key);
          if (!channel) {
            continue;
          }

          const previewKey = this.createPreviewKey(file.sessionId, column.key, region);
          queued = this.queuePreviewJob(
            previewKey,
            serializeCellKey(file.sessionId, column.key, region?.id ?? null),
            file,
            channel,
            region ?? this.getSingleScreenshotRegionForRequest()
          ) || queued;
        }
      }
    }

    if (queued) {
      this.startPreviewProcessing();
    }
  }

  private queuePreviewJob(
    previewKey: string,
    cellKey: string,
    file: ExportImageBatchTarget['files'][number],
    channel: ExportImageBatchChannelTarget,
    screenshot: ExportScreenshotRegionItem | null
  ): boolean {
    if (
      this.disposed ||
      this.busy ||
      !this.open ||
      this.previewResourcesByKey.has(previewKey) ||
      this.previewJobsByKey.has(previewKey)
    ) {
      return false;
    }

    const requestId = this.takeRequestId();
    this.previewResourcesByKey.set(previewKey, pendingResource(previewKey, requestId));
    this.previewJobsByKey.set(previewKey, {
      previewKey,
      cellKey,
      file,
      channel,
      screenshot,
      requestId,
      order: this.previewJobSequence
    });
    this.previewJobSequence += 1;
    this.updatePreviewElements(previewKey);
    return true;
  }

  private queueCurrentPreviews(): void {
    const target = this.target;
    if (!target || target.files.length === 0) {
      return;
    }

    const columns = buildExportBatchColumns(target.files, this.includeSplitRgbChannels);
    if (columns.length === 0) {
      return;
    }

    this.queueVisiblePreviews(columns, target);
  }

  private startPreviewProcessing(): void {
    if (
      this.previewProcessing ||
      this.disposed ||
      this.busy ||
      !this.open ||
      this.previewJobsByKey.size === 0
    ) {
      return;
    }

    const generation = this.previewGeneration;
    const abortController = this.getPreviewAbortController();
    this.previewProcessing = true;
    void this.processPreviewJobs(generation, abortController)
      .finally(() => {
        this.previewProcessing = false;
        if (
          !this.disposed &&
          !this.busy &&
          this.open &&
          this.previewJobsByKey.size > 0
        ) {
          this.startPreviewProcessing();
        }
      });
  }

  private async processPreviewJobs(generation: number, abortController: AbortController): Promise<void> {
    while (this.previewJobsByKey.size > 0) {
      if (
        this.disposed ||
        this.busy ||
        !this.open ||
        generation !== this.previewGeneration ||
        abortController.signal.aborted
      ) {
        return;
      }

      await this.waitForNextPaint(abortController.signal);
      await this.waitForIdleSlot(abortController.signal, BATCH_PREVIEW_IDLE_TIMEOUT_MS);

      if (
        this.disposed ||
        this.busy ||
        !this.open ||
        generation !== this.previewGeneration ||
        abortController.signal.aborted
      ) {
        return;
      }

      const job = this.takeNextPreviewJob();
      if (!job) {
        return;
      }

      if (!isPendingMatch(
        this.previewResourcesByKey.get(job.previewKey) ?? idleResource(),
        job.previewKey,
        job.requestId
      )) {
        continue;
      }

      const request = this.createPreviewRequest(job);
      if (!request) {
        this.previewResourcesByKey.delete(job.previewKey);
        this.updatePreviewElements(job.previewKey);
        continue;
      }

      try {
        const pixels = await this.callbacks.onResolveExportImageBatchPreview(request, abortController.signal);
        if (
          this.disposed ||
          generation !== this.previewGeneration ||
          abortController.signal.aborted ||
          !isPendingMatch(this.previewResourcesByKey.get(job.previewKey) ?? idleResource(), job.previewKey, job.requestId)
        ) {
          continue;
        }

        this.previewResourcesByKey.set(job.previewKey, successResource(job.previewKey, createPngDataUrlFromPixels(pixels)));
      } catch (error) {
        if (
          generation !== this.previewGeneration ||
          abortController.signal.aborted ||
          isAbortError(error) ||
          !isPendingMatch(this.previewResourcesByKey.get(job.previewKey) ?? idleResource(), job.previewKey, job.requestId)
        ) {
          continue;
        }

        this.previewResourcesByKey.set(job.previewKey, errorResource(job.previewKey, error, 'Preview failed.'));
      } finally {
        if (generation === this.previewGeneration) {
          this.updatePreviewElements(job.previewKey);
        }
      }
    }
  }

  private createPreviewRequest(job: BatchPreviewJob): ExportImageBatchPreviewRequest | null {
    if (this.dialogMode === 'screenshot' && !job.screenshot) {
      return null;
    }

    const baseRequest = {
      sessionId: job.file.sessionId,
      activeLayer: job.file.activeLayer,
      displaySelection: cloneDisplaySelection(job.channel.selection) ?? job.channel.selection,
      channelLabel: job.channel.label
    };

    return job.screenshot
      ? {
        ...baseRequest,
        mode: 'screenshot',
        ...job.screenshot
      }
      : baseRequest;
  }

  private takeNextPreviewJob(): BatchPreviewJob | null {
    let selectedJob: BatchPreviewJob | null = null;
    let selectedPriority = Number.POSITIVE_INFINITY;

    for (const job of this.previewJobsByKey.values()) {
      const priority = this.getPreviewJobPriority(job);
      if (
        !selectedJob ||
        priority < selectedPriority ||
        (priority === selectedPriority && job.order < selectedJob.order)
      ) {
        selectedJob = job;
        selectedPriority = priority;
      }
    }

    if (selectedJob) {
      this.previewJobsByKey.delete(selectedJob.previewKey);
    }

    return selectedJob;
  }

  private getPreviewJobPriority(job: BatchPreviewJob): number {
    if (this.checkedCellKeys.has(job.cellKey)) {
      return 0;
    }

    return this.isPreviewCellVisible(job.previewKey) ? 1 : 2;
  }

  private isPreviewCellVisible(previewKey: string): boolean {
    const matrixRect = this.elements.exportBatchMatrix.getBoundingClientRect();
    if (matrixRect.width <= 0 || matrixRect.height <= 0) {
      return true;
    }

    for (const element of this.elements.exportBatchMatrix.querySelectorAll<HTMLElement>('[data-preview-key]')) {
      if (element.dataset.previewKey !== previewKey) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      return (
        rect.bottom >= matrixRect.top &&
        rect.top <= matrixRect.bottom &&
        rect.right >= matrixRect.left &&
        rect.left <= matrixRect.right
      );
    }

    return false;
  }

  private schedulePreviewReprioritization(): void {
    if (this.disposed || this.busy || !this.open || this.previewJobsByKey.size === 0) {
      return;
    }

    if (typeof window.requestAnimationFrame !== 'function') {
      this.startPreviewProcessing();
      return;
    }

    if (this.previewScrollRafHandle !== null) {
      return;
    }

    this.previewScrollRafHandle = window.requestAnimationFrame(() => {
      this.previewScrollRafHandle = null;
      this.startPreviewProcessing();
    });
  }

  private scheduleScreenshotPreviewRefresh(): void {
    if (this.screenshotPreviewDebounceHandle !== null) {
      window.clearTimeout(this.screenshotPreviewDebounceHandle);
    }

    this.screenshotPreviewDebounceHandle = window.setTimeout(() => {
      this.screenshotPreviewDebounceHandle = null;
      if (this.disposed || this.busy || !this.open || this.dialogMode !== 'screenshot') {
        return;
      }

      if (!this.hasValidScreenshotOutputSize()) {
        this.abortPreviewWork({ clearCache: true, cancelDebounce: false });
        this.updateAllPreviewElements();
        this.updateStatus();
        return;
      }

      this.abortPreviewWork({ clearCache: true, cancelDebounce: false });
      this.updateAllPreviewElements();
      this.queueCurrentPreviews();
    }, SCREENSHOT_BATCH_PREVIEW_DEBOUNCE_MS);
  }

  private waitForNextPaint(signal: AbortSignal): Promise<void> {
    if (signal.aborted || typeof window.requestAnimationFrame !== 'function') {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let firstHandle = 0;
      let secondHandle = 0;
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        if (firstHandle) {
          window.cancelAnimationFrame(firstHandle);
        }
        if (secondHandle) {
          window.cancelAnimationFrame(secondHandle);
        }
        cleanup();
        resolve();
      };

      signal.addEventListener('abort', onAbort, { once: true });
      firstHandle = window.requestAnimationFrame(() => {
        firstHandle = 0;
        secondHandle = window.requestAnimationFrame(() => {
          secondHandle = 0;
          cleanup();
          resolve();
        });
      });
    });
  }

  private waitForIdleSlot(signal: AbortSignal, timeoutMs: number): Promise<void> {
    if (signal.aborted) {
      return Promise.resolve();
    }

    const windowLike = window as Window & typeof globalThis & BatchPreviewWindowLike;
    return new Promise((resolve) => {
      const cleanupAbort = () => {
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        resolve();
      };
      let cleanup = cleanupAbort;

      signal.addEventListener('abort', onAbort, { once: true });

      if (typeof windowLike.requestIdleCallback !== 'function') {
        const handle = window.setTimeout(() => {
          cleanupAbort();
          resolve();
        }, BATCH_PREVIEW_IDLE_FALLBACK_DELAY_MS);
        cleanup = () => {
          window.clearTimeout(handle);
          cleanupAbort();
        };
        return;
      }

      const handle = windowLike.requestIdleCallback(() => {
        cleanupAbort();
        resolve();
      }, { timeout: timeoutMs });
      cleanup = () => {
        windowLike.cancelIdleCallback?.(handle);
        cleanupAbort();
      };
    });
  }

  private getPreviewAbortController(): AbortController {
    if (!this.previewAbortController || this.previewAbortController.signal.aborted) {
      this.previewAbortController = new AbortController();
    }
    return this.previewAbortController;
  }

  private abortPreviewWork(options: { clearCache: boolean; cancelDebounce?: boolean }): void {
    this.previewGeneration += 1;
    this.previewAbortController?.abort(createAbortError('Batch export preview cancelled.'));
    this.previewAbortController = null;
    this.previewJobsByKey.clear();
    this.cancelPreviewReprioritization();
    if (options.cancelDebounce !== false) {
      this.cancelScreenshotPreviewRefresh();
    }
    if (options.clearCache) {
      this.previewResourcesByKey.clear();
    } else {
      for (const [previewKey, resource] of this.previewResourcesByKey.entries()) {
        if (resource.status === 'pending') {
          this.previewResourcesByKey.delete(previewKey);
        }
      }
    }
  }

  private cancelPreviewReprioritization(): void {
    if (this.previewScrollRafHandle === null) {
      return;
    }

    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this.previewScrollRafHandle);
    }
    this.previewScrollRafHandle = null;
  }

  private cancelScreenshotPreviewRefresh(): void {
    if (this.screenshotPreviewDebounceHandle === null) {
      return;
    }

    window.clearTimeout(this.screenshotPreviewDebounceHandle);
    this.screenshotPreviewDebounceHandle = null;
  }

  private updatePreviewElements(previewKey: string): void {
    const { dataUrl, isPending } = this.getPreviewPresentation(previewKey);
    for (const element of this.elements.exportBatchMatrix.querySelectorAll<HTMLElement>('[data-preview-key]')) {
      if (element.dataset.previewKey === previewKey) {
        updateBatchPreviewElement(element, dataUrl, isPending);
      }
    }
  }

  private updateAllPreviewElements(): void {
    for (const element of this.elements.exportBatchMatrix.querySelectorAll<HTMLElement>('[data-preview-key]')) {
      const previewKey = element.dataset.previewKey ?? '';
      const { dataUrl, isPending } = this.getPreviewPresentation(previewKey);
      updateBatchPreviewElement(element, dataUrl, isPending);
    }
  }

  private syncMatrixDisabledState(): void {
    const inputs = this.elements.exportBatchMatrix.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    for (const input of inputs) {
      input.disabled = this.busy || input.disabled;
    }
  }

  private updateSplitToggleState(): void {
    const hasSplitChannels = this.target ? targetHasSplitChannelViews(this.target) : false;
    if (!hasSplitChannels && this.includeSplitRgbChannels) {
      this.includeSplitRgbChannels = false;
    }

    this.elements.exportBatchSplitToggleButton.classList.toggle('hidden', !hasSplitChannels);
    this.elements.exportBatchSplitToggleButton.disabled = this.busy || !hasSplitChannels;
    this.elements.exportBatchSplitToggleButton.setAttribute(
      'aria-pressed',
      this.includeSplitRgbChannels ? 'true' : 'false'
    );
  }

  private updateSelectionActionState(): void {
    const visibleCellKeys = this.target
      ? buildVisibleExportBatchCellKeys(this.target, this.includeSplitRgbChannels, this.getSelectionRegions())
      : new Set<string>();
    const visibleCellCount = visibleCellKeys.size;
    let selectedVisibleCellCount = 0;

    for (const key of visibleCellKeys) {
      if (this.checkedCellKeys.has(key)) {
        selectedVisibleCellCount += 1;
      }
    }

    this.elements.exportBatchSelectAllButton.disabled =
      this.busy || visibleCellCount === 0 || selectedVisibleCellCount === visibleCellCount;
    this.elements.exportBatchDeselectAllButton.disabled =
      this.busy || visibleCellCount === 0 || selectedVisibleCellCount === 0;
  }

  private async handleSubmit(): Promise<void> {
    if (this.disposed || this.busy) {
      return;
    }

    const target = this.target;
    if (!target) {
      return;
    }

    const archiveFilename = normalizeExportBatchArchiveFilename(this.elements.exportBatchArchiveFilenameInput.value);
    if (!archiveFilename) {
      this.setError('Enter an archive filename.');
      this.elements.exportBatchArchiveFilenameInput.focus();
      return;
    }

    const pngCompressionLevel = parsePngCompressionLevel(this.elements.exportBatchCompressionInput.value);
    if (pngCompressionLevel === null) {
      this.setError(PNG_COMPRESSION_VALIDATION_MESSAGE);
      this.elements.exportBatchCompressionInput.focus();
      return;
    }

    const screenshots = this.getScreenshotRegionsForRequest();
    if (this.dialogMode === 'screenshot' && !screenshots) {
      this.setError(this.screenshotRegions.length > 1 ? 'Enter a positive scale percentage.' : 'Enter a positive width and height.');
      this.elements.exportBatchWidthInput.focus();
      return;
    }

    const entries = buildExportBatchEntries(
      target,
      this.checkedCellKeys,
      this.includeSplitRgbChannels,
      screenshots,
      this.getFilenameSource()
    );
    if (entries.length === 0) {
      this.setError('Select at least one image.');
      return;
    }

    this.elements.exportBatchArchiveFilenameInput.value = archiveFilename;
    this.setError(null);
    this.setStatus(`Exporting ${entries.length === 1 ? '1 image' : `${entries.length} images`}...`);
    this.abortPreviewWork({ clearCache: false });
    const requestId = this.takeRequestId();
    this.exportResource = pendingResource(BATCH_EXPORT_RESOURCE_KEY, requestId);
    this.syncBusyControls();
    const reportProgress = this.startExportProgress(entries.length);

    const abortController = new AbortController();
    this.abortController = abortController;
    try {
      await this.callbacks.onExportImageBatch({
        archiveFilename,
        entries,
        format: 'png-zip',
        pngCompressionLevel,
        ...(this.dialogMode === 'screenshot' && this.elements.exportBatchReproductionMetadataCheckbox.checked
          ? { includeReproductionMetadata: true }
          : {})
      }, abortController.signal, reportProgress);
      if (this.abortController === abortController) {
        this.abortController = null;
      }
      this.close(true);
    } catch (error) {
      if (abortController.signal.aborted || isAbortError(error)) {
        this.close(true);
        return;
      }

      if (!isPendingMatch(this.exportResource, BATCH_EXPORT_RESOURCE_KEY, requestId)) {
        return;
      }

      this.exportResource = errorResource(BATCH_EXPORT_RESOURCE_KEY, error, 'Batch export failed.');
      this.setError(this.exportResource.status === 'error' ? this.exportResource.error.message : 'Batch export failed.');
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
      if (this.open) {
        if (isPendingMatch(this.exportResource, BATCH_EXPORT_RESOURCE_KEY, requestId)) {
          this.exportResource = idleResource();
        }
        this.resetExportProgress();
        this.syncBusyControls();
        this.updateStatus();
      }
    }
  }

  private getFilenameSource(): ExportBatchFilenameSource {
    return this.elements.exportBatchUseOpenFilesNamesCheckbox.checked ? 'openFilesName' : 'sourcePath';
  }

  private startExportProgress(total: number): (update: ExportProgressUpdate) => void {
    this.resetExportProgress();
    this.exportProgressVisible = true;
    this.exportProgressUpdate = {
      completed: 0,
      total: Math.max(1, total),
      stage: 'preparing'
    };
    this.elements.exportBatchProgress.classList.remove('hidden');
    this.renderExportProgress();
    this.setStatus(formatBatchExportProgress(this.exportProgressUpdate));

    return (update) => {
      this.handleExportProgress(update);
    };
  }

  private handleExportProgress(update: ExportProgressUpdate): void {
    if (this.disposed) {
      return;
    }

    this.exportProgressUpdate = { ...update };
    if (this.busy) {
      this.setStatus(formatBatchExportProgress(update));
    }
    if (this.exportProgressVisible) {
      this.renderExportProgress();
    }
  }

  private renderExportProgress(): void {
    const update = this.exportProgressUpdate ?? {
      completed: 0,
      total: 1,
      stage: 'preparing'
    } satisfies ExportProgressUpdate;
    this.elements.exportBatchProgressBar.max = Math.max(1, update.total);
    if (update.indeterminate) {
      this.elements.exportBatchProgressBar.removeAttribute('value');
    } else {
      this.elements.exportBatchProgressBar.value = clampProgressValue(update.completed, update.total);
    }
    this.elements.exportBatchProgressLabel.textContent = formatBatchExportProgress(update);
  }

  private resetExportProgress(): void {
    this.exportProgressVisible = false;
    this.exportProgressUpdate = null;
    this.elements.exportBatchProgress.classList.add('hidden');
    this.elements.exportBatchProgressBar.max = 1;
    this.elements.exportBatchProgressBar.removeAttribute('value');
    this.elements.exportBatchProgressLabel.textContent = '';
  }
}

function formatBatchExportProgress(update: ExportProgressUpdate): string {
  const total = Math.max(1, update.total);
  const completed = clampProgressValue(update.completed, total);
  if (update.stage === 'packaging') {
    return `Packaging ${total === 1 ? '1 image' : `${total} images`}...`;
  }

  if (update.currentFilename) {
    const activeIndex = Math.min(completed + 1, total);
    return `Exporting ${activeIndex} of ${total}: ${update.currentFilename}`;
  }

  if (completed > 0) {
    return `${completed} of ${total} ${total === 1 ? 'image' : 'images'} exported.`;
  }

  return 'Preparing batch export...';
}

function clampProgressValue(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.min(Math.max(value, 0), total);
}

export function buildExportBatchColumns(
  files: ExportImageBatchTarget['files'],
  includeSplitRgbChannels = false
): ExportBatchColumn[] {
  const columnsByKey = new Map<string, ExportBatchColumn>();
  for (const file of files) {
    for (const [index, channel] of getVisibleBatchChannels(file.channels, includeSplitRgbChannels).entries()) {
      const key = getColumnKeyForChannel(channel);
      const order = (includeSplitRgbChannels ? channel.splitOrder : channel.mergedOrder) ?? index;
      const existing = columnsByKey.get(key);
      if (existing) {
        existing.order = Math.min(existing.order, order);
        continue;
      }

      columnsByKey.set(key, {
        key,
        label: channel.label,
        order
      });
    }
  }

  return [...columnsByKey.values()].sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.label.localeCompare(b.label);
  });
}

export function buildDefaultExportBatchCheckedCells(
  target: ExportImageBatchTarget,
  includeSplitRgbChannels = false,
  screenshotRegions: readonly ExportScreenshotRegionItem[] = []
): Set<string> {
  const checked = new Set<string>();
  const file = target.files.find((item) => item.sessionId === target.activeSessionId) ?? target.files[0] ?? null;
  if (!file) {
    return checked;
  }

  const visibleChannels = getVisibleBatchChannels(file.channels, includeSplitRgbChannels);
  const channel = findCorrespondingChannelForSelection(visibleChannels, file.displaySelection) ??
    visibleChannels[0] ??
    null;
  if (!channel) {
    return checked;
  }

  for (const region of expandSelectionRegions(screenshotRegions)) {
    checked.add(serializeCellKey(file.sessionId, getColumnKeyForChannel(channel), region?.id ?? null));
  }
  return checked;
}

export function buildVisibleExportBatchCellKeys(
  target: ExportImageBatchTarget,
  includeSplitRgbChannels = false,
  screenshotRegions: readonly ExportScreenshotRegionItem[] = []
): Set<string> {
  const checked = new Set<string>();
  const columns = buildExportBatchColumns(target.files, includeSplitRgbChannels);
  const regions = expandSelectionRegions(screenshotRegions);

  for (const file of target.files) {
    const visibleChannels = getVisibleBatchChannels(file.channels, includeSplitRgbChannels);
    for (const region of regions) {
      for (const column of columns) {
        if (findChannelForColumn(visibleChannels, column.key)) {
          checked.add(serializeCellKey(file.sessionId, column.key, region?.id ?? null));
        }
      }
    }
  }

  return checked;
}

export function buildExportBatchEntries(
  target: ExportImageBatchTarget,
  checkedCellKeys: ReadonlySet<string>,
  includeSplitRgbChannels = false,
  screenshots: ExportScreenshotRegion | ExportScreenshotRegionItem[] | null = null,
  filenameSource: ExportBatchFilenameSource = 'openFilesName'
): ExportImageBatchEntryRequest[] {
  const columns = buildExportBatchColumns(target.files, includeSplitRgbChannels);
  const usedFilenames = new Map<string, number>();
  const screenshotRegions = Array.isArray(screenshots)
    ? screenshots
    : screenshots
      ? [buildScreenshotRegionItem(screenshots, 0, 1)]
      : [];
  const regionSelections: ExportBatchRegionSelection[] = screenshotRegions.length > 0 ? screenshotRegions : [null];
  const includeRegionInKey = screenshotRegions.length > 1;
  const entries: ExportImageBatchEntryRequest[] = [];

  for (const file of target.files) {
    const visibleChannels = getVisibleBatchChannels(file.channels, includeSplitRgbChannels);
    const filenameSourceValue = resolveExportBatchFilenameSource(file, filenameSource);
    for (const region of regionSelections) {
      for (const column of columns) {
        const channel = findChannelForColumn(visibleChannels, column.key);
        if (!channel) {
          continue;
        }

        const key = serializeCellKey(file.sessionId, column.key, includeRegionInKey ? region?.id ?? null : null);
        if (!checkedCellKeys.has(key)) {
          continue;
        }

        const baseEntry = {
          sessionId: file.sessionId,
          activeLayer: file.activeLayer,
          displaySelection: channel.selection,
          channelLabel: channel.label
        };

        if (region) {
          entries.push({
            ...baseEntry,
            mode: 'screenshot' as const,
            rect: { ...region.rect },
            sourceViewport: { ...region.sourceViewport },
            outputWidth: region.outputWidth,
            outputHeight: region.outputHeight,
            ...(region.count > 1
              ? {
                screenshotRegionIndex: region.index,
                screenshotRegionLabel: formatRegionToken(region),
                screenshotRegionCount: region.count
              }
              : {}),
            outputFilename: buildExportBatchScreenshotOutputFilename(
              filenameSourceValue,
              channel.label,
              usedFilenames,
              region.count > 1
                ? {
                  index: region.index,
                  count: region.count
                }
                : null
            )
          });
        } else {
          entries.push({
            ...baseEntry,
            outputFilename: buildExportBatchOutputFilename(
              filenameSourceValue,
              channel.label,
              usedFilenames
            )
          });
        }
      }
    }
  }

  return entries;
}

function resolveExportBatchFilenameSource(
  file: ExportImageBatchTarget['files'][number],
  filenameSource: ExportBatchFilenameSource
): string {
  return filenameSource === 'openFilesName'
    ? file.label || file.sourcePath || file.filename
    : file.sourcePath || file.filename || file.label;
}

export function normalizeExportBatchArchiveFilename(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.toLocaleLowerCase().endsWith('.zip') ? trimmed : `${trimmed}.zip`;
}

export function buildExportBatchOutputFilename(
  sourcePath: string,
  channelLabel: string,
  usedFilenames: Map<string, number> = new Map()
): string {
  return buildExportBatchOutputFilenameWithSuffix(sourcePath, channelLabel, '', usedFilenames);
}

export function buildExportBatchScreenshotOutputFilename(
  sourcePath: string,
  channelLabel: string,
  usedFilenames: Map<string, number> = new Map(),
  region: { index: number; count: number } | null = null
): string {
  const regionSuffix = region && region.count > 1
    ? `.${formatRegionIndexToken(region.index)}`
    : '';
  return buildExportBatchOutputFilenameWithSuffix(sourcePath, channelLabel, `-screenshot${regionSuffix}`, usedFilenames);
}

function buildExportBatchOutputFilenameWithSuffix(
  sourcePath: string,
  channelLabel: string,
  basenameSuffix: string,
  usedFilenames: Map<string, number>
): string {
  const normalizedPath = normalizeArchivePath(sourcePath);
  const segments = normalizedPath.split('/').filter((segment) => segment.length > 0);
  const rawBasename = segments.pop() ?? 'image.exr';
  const directory = segments.map(sanitizePathSegment).filter((segment) => segment.length > 0);
  const base = sanitizePathSegment(stripExrExtension(rawBasename)) || 'image';
  const token = buildExportBatchChannelFilenameToken(channelLabel);
  const filename = `${base}${basenameSuffix}.${token}.png`;
  const candidate = [...directory, filename].join('/');
  return uniquifyFilename(candidate, usedFilenames);
}

export function buildExportBatchChannelFilenameToken(label: string): string {
  const readableToken = label
    .trim()
    .replace(/^Stokes\s+/i, '')
    .replace(/\.\(R,G,B,A\)/g, '.RGBA')
    .replace(/\.\(R,G,B\)/g, '.RGB')
    .replace(/R,G,B,A/g, 'RGBA')
    .replace(/R,G,B/g, 'RGB')
    .replace(/\//g, '_over_')
    .replace(/,/g, '_')
    .replace(/\s+/g, '_');
  const token = replaceUnsafeFilenameCharacters(readableToken)
    .replace(/_+/g, '_')
    .replace(/^\.+|\.+$/g, '');

  return token || 'channel';
}

function cloneExportBatchTarget(target: ExportImageBatchTarget): ExportImageBatchTarget {
  return {
    archiveFilename: target.archiveFilename,
    activeSessionId: target.activeSessionId,
    files: target.files.map((file) => ({
      ...file,
      displaySelection: cloneDisplaySelection(file.displaySelection),
      channels: file.channels.map((channel) => ({
        ...channel,
        selection: cloneDisplaySelection(channel.selection) ?? channel.selection,
        swatches: [...channel.swatches]
      }))
    }))
  };
}

function buildScreenshotRegionItem(
  region: ExportScreenshotRegion,
  index: number,
  count: number
): ExportScreenshotRegionItem {
  return {
    id: `screenshot-region-${index + 1}`,
    label: `Region ${index + 1}`,
    index,
    count,
    rect: { ...region.rect },
    sourceViewport: { ...region.sourceViewport },
    outputWidth: region.outputWidth,
    outputHeight: region.outputHeight
  };
}

function cloneScreenshotRegions(regions: ExportScreenshotRegionItem[]): ExportScreenshotRegionItem[] {
  const count = regions.length;
  return regions.map((region, index) => ({
    ...region,
    index,
    count,
    rect: { ...region.rect },
    sourceViewport: { ...region.sourceViewport }
  }));
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

function createExportBatchEmptyState(message: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'app-dialog-preview-status';
  element.textContent = message;
  return element;
}

function createFileLabel(file: ExportImageBatchTarget['files'][number]): HTMLElement {
  const label = document.createElement('span');
  label.className = 'export-batch-file-label';
  label.textContent = file.label;
  label.title = file.sourcePath || file.filename || file.label;
  return label;
}

function createBatchCellPreview(
  previewKey: string,
  dataUrl: string | null | undefined,
  isPending: boolean
): HTMLElement {
  const element = document.createElement('span');
  element.className = 'export-batch-cell-preview';
  element.setAttribute('aria-hidden', 'true');
  element.dataset.previewKey = previewKey;
  updateBatchCellPreview(element, dataUrl, isPending);
  return element;
}

function updateBatchPreviewElement(
  element: HTMLElement,
  dataUrl: string | null | undefined,
  isPending: boolean
): void {
  updateBatchCellPreview(element, dataUrl, isPending);
}

function updateBatchCellPreview(
  element: HTMLElement,
  dataUrl: string | null | undefined,
  isPending: boolean
): void {
  element.classList.toggle('is-loading', isPending);
  element.classList.toggle('is-unavailable', !isPending && !dataUrl);

  if (dataUrl) {
    const image = document.createElement('img');
    image.className = 'export-batch-cell-preview-image';
    image.src = dataUrl;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    element.replaceChildren(image);
    return;
  }

  const placeholder = document.createElement('span');
  placeholder.className = 'export-batch-cell-preview-placeholder';
  element.replaceChildren(placeholder);
}

function targetHasSplitChannelViews(target: ExportImageBatchTarget): boolean {
  return target.files.some((file) => hasSplitChannelViewItems(file.channels));
}

function getVisibleBatchChannels(
  channels: ExportImageBatchChannelTarget[],
  includeSplitRgbChannels: boolean
): ExportImageBatchChannelTarget[] {
  return selectVisibleChannelViewItems(channels, includeSplitRgbChannels);
}

function remapExportBatchCheckedCells(
  target: ExportImageBatchTarget,
  checkedCellKeys: ReadonlySet<string>,
  fromIncludeSplitRgbChannels: boolean,
  toIncludeSplitRgbChannels: boolean,
  screenshotRegions: readonly ExportScreenshotRegionItem[] = []
): Set<string> {
  const nextChecked = new Set<string>();
  const regions = expandSelectionRegions(screenshotRegions);

  for (const file of target.files) {
    const fromChannels = getVisibleBatchChannels(file.channels, fromIncludeSplitRgbChannels);
    const toChannels = getVisibleBatchChannels(file.channels, toIncludeSplitRgbChannels);

    for (const region of regions) {
      for (const channel of fromChannels) {
        const currentKey = serializeCellKey(file.sessionId, getColumnKeyForChannel(channel), region?.id ?? null);
        if (!checkedCellKeys.has(currentKey)) {
          continue;
        }

        const nextChannel = findCorrespondingChannelForSelection(toChannels, channel.selection);
        if (nextChannel) {
          nextChecked.add(serializeCellKey(file.sessionId, getColumnKeyForChannel(nextChannel), region?.id ?? null));
        }
      }
    }
  }

  return nextChecked;
}

function findCorrespondingChannelForSelection(
  channels: ExportImageBatchChannelTarget[],
  selection: DisplaySelection | null
): ExportImageBatchChannelTarget | null {
  if (!selection) {
    return null;
  }

  const exact = channels.find((channel) => sameDisplaySelection(channel.selection, selection));
  if (exact) {
    return exact;
  }

  if (selection.kind === 'channelRgb') {
    return channels.find((channel) => (
      channel.selection.kind === 'channelMono' &&
      channel.selection.channel === selection.r &&
      channel.selection.alpha === null
    )) ?? null;
  }

  if (selection.kind === 'channelMono') {
    if (selection.alpha) {
      return channels.find((channel) => (
        channel.selection.kind === 'channelMono' &&
        channel.selection.channel === selection.channel &&
        channel.selection.alpha === null
      )) ?? null;
    }

    return channels.find((channel) => (
      channel.selection.kind === 'channelRgb' &&
      (
        channel.selection.r === selection.channel ||
        channel.selection.g === selection.channel ||
        channel.selection.b === selection.channel ||
        channel.selection.alpha === selection.channel
      )
    )) ??
      channels.find((channel) => (
        channel.selection.kind === 'channelMono' &&
        channel.selection.channel === selection.channel &&
        channel.selection.alpha !== null
      )) ??
      null;
  }

  if (selection.source.kind === 'rgbLuminance') {
    return channels.find((channel) => (
      channel.selection.kind === selection.kind &&
      channel.selection.parameter === selection.parameter &&
      channel.selection.source.kind === 'rgbComponent' &&
      channel.selection.source.component === 'R'
    )) ?? null;
  }

  if (selection.source.kind === 'rgbComponent') {
    return channels.find((channel) => (
      channel.selection.kind === selection.kind &&
      channel.selection.parameter === selection.parameter &&
      channel.selection.source.kind === 'rgbLuminance'
    )) ?? null;
  }

  return null;
}

function getColumnKeyForChannel(channel: Pick<ExportImageBatchChannelTarget, 'label'>): string {
  return channel.label;
}

function findChannelForColumn(
  channels: ExportImageBatchChannelTarget[],
  columnKey: string
): ExportImageBatchChannelTarget | null {
  return channels.find((channel) => getColumnKeyForChannel(channel) === columnKey) ?? null;
}

function serializeCellKey(sessionId: string, columnKey: string, regionId: string | null = null): string {
  return regionId
    ? `${sessionId}${CELL_KEY_SEPARATOR}${regionId}${CELL_KEY_SEPARATOR}${columnKey}`
    : `${sessionId}${CELL_KEY_SEPARATOR}${columnKey}`;
}

function serializeBatchRegionPreviewKey(cellKey: string, region: ExportScreenshotRegionItem): string {
  return JSON.stringify({
    cellKey,
    regionId: region.id,
    regionIndex: region.index,
    outputWidth: region.outputWidth,
    outputHeight: region.outputHeight
  });
}

function formatOutputSize(width: number, height: number): string {
  return `${width} x ${height} px`;
}

function formatRegionToken(region: Pick<ExportScreenshotRegionItem, 'index'>): string {
  return formatRegionIndexToken(region.index);
}

function formatRegionIndexToken(index: number): string {
  return `R${index + 1}`;
}

function expandSelectionRegions(
  regions: readonly ExportScreenshotRegionItem[]
): ExportBatchRegionSelection[] {
  return regions.length > 1 ? [...regions] : [null];
}

function normalizeArchivePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:\//, '')
    .replace(/^\/+/, '');
}

function stripExrExtension(filename: string): string {
  return filename.replace(/\.exr$/i, '');
}

function sanitizePathSegment(segment: string): string {
  return replaceUnsafeFilenameCharacters(segment.trim())
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '');
}

function replaceUnsafeFilenameCharacters(value: string): string {
  let sanitized = '';
  for (const character of value) {
    sanitized += isUnsafeFilenameCharacter(character) ? '_' : character;
  }
  return sanitized;
}

function isUnsafeFilenameCharacter(character: string): boolean {
  return character.charCodeAt(0) < 32 || '<>:"\\|?*'.includes(character);
}

function uniquifyFilename(filename: string, usedFilenames: Map<string, number>): string {
  const count = usedFilenames.get(filename) ?? 0;
  usedFilenames.set(filename, count + 1);
  if (count === 0) {
    return filename;
  }

  const slashIndex = filename.lastIndexOf('/');
  const directory = slashIndex >= 0 ? filename.slice(0, slashIndex + 1) : '';
  const basename = slashIndex >= 0 ? filename.slice(slashIndex + 1) : filename;
  const extensionIndex = basename.toLocaleLowerCase().lastIndexOf('.png');
  const stem = extensionIndex >= 0 ? basename.slice(0, extensionIndex) : basename;
  const extension = extensionIndex >= 0 ? basename.slice(extensionIndex) : '';
  return `${directory}${stem} (${count + 1})${extension}`;
}
