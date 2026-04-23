import { ChannelPanel, getChannelViewSwatches } from './ui/channel-panel';
import { ColormapPanel } from './ui/colormap-panel';
import { resolveElements, type Elements } from './ui/elements';
import {
  clampPanelSplitSizes,
  getPanelSplitKeyboardAction,
  LayoutSplitController,
  parsePanelSplitStorageValue
} from './ui/layout-split-controller';
import { buildPartLayerItemsFromChannelNames, LayerPanel } from './ui/layer-panel';
import {
  formatDisplayCacheUsageText,
  getDisplayCacheUsageState,
  OpenedImagesPanel
} from './ui/opened-images-panel';
import { DisposableBag, type Disposable } from './lifecycle';
import { getListboxOptionIndexAtClientY } from './ui/render-helpers';
import { formatOverlayValue } from './value-format';
import type { ColormapLut } from './colormaps';
import type {
  DisplaySelection,
  DisplayLuminanceRange,
  ExrMetadataEntry,
  ExportImageRequest,
  ExportImageTarget,
  ImageRoi,
  OpenedImageDropPlacement,
  PixelSample,
  RoiStats,
  ViewerMode,
  VisualizationMode
} from './types';
import type { ProbeColorPreview, ProbeDisplayValue } from './probe';

const LOADING_OVERLAY_SUBTLE_DELAY_MS = 200;
const LOADING_OVERLAY_DARKENING_DELAY_MS = 1000;
const LOADING_OVERLAY_MESSAGE_DELAY_MS = 1500;
const LOADING_OVERLAY_SUBTLE_CLASS = 'loading-overlay--subtle';
const LOADING_OVERLAY_DARKENING_CLASS = 'loading-overlay--darkening';
const LOADING_OVERLAY_MESSAGE_CLASS = 'loading-overlay--message';

export type LoadingOverlayPhase = 'hidden' | 'subtle' | 'darkening' | 'message';

export interface UiCallbacks {
  onOpenFileClick: () => void;
  onOpenFolderClick: () => void;
  onExportImage: (request: ExportImageRequest) => Promise<void>;
  onFileSelected: (file: File) => void;
  onFolderSelected: (files: File[]) => void;
  onFilesDropped: (files: File[]) => void;
  onGalleryImageSelected: (galleryId: string) => void;
  onReloadAllOpenedImages: () => void;
  onReloadSelectedOpenedImage: (sessionId: string) => void;
  onCloseSelectedOpenedImage: (sessionId: string) => void;
  onCloseAllOpenedImages: () => void;
  onOpenedImageSelected: (sessionId: string) => void;
  onReorderOpenedImage: (
    draggedSessionId: string,
    targetSessionId: string,
    placement: OpenedImageDropPlacement
  ) => void;
  onDisplayCacheBudgetChange: (mb: number) => void;
  onExposureChange: (value: number) => void;
  onViewerModeChange: (mode: ViewerMode) => void;
  onLayerChange: (layerIndex: number) => void;
  onRgbGroupChange: (mapping: DisplaySelection) => void;
  onVisualizationModeChange: (mode: VisualizationMode) => void;
  onColormapChange: (colormapId: string) => void;
  onColormapRangeChange: (range: DisplayLuminanceRange) => void;
  onColormapAutoRange: () => void;
  onColormapZeroCenterToggle: () => void;
  onStokesDegreeModulationToggle: () => void;
  onClearRoi: () => void;
  onResetView: () => void;
}

export interface ListboxHitTestMetrics {
  top: number;
  height: number;
  scrollTop: number;
  scrollHeight: number;
  optionCount: number;
}

export interface OpenedImageOptionItem {
  id: string;
  label: string;
  sizeBytes?: number | null;
  sourceDetail?: string;
  thumbnailDataUrl?: string | null;
}

export interface LayerOptionItem {
  index: number;
  label: string;
  channelCount?: number;
  selectable?: boolean;
}

export interface PanelSplitSizes {
  imagePanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
}

export interface PanelCollapseState {
  imagePanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  bottomPanelCollapsed: boolean;
}

export interface StoredPanelSplitState extends Partial<PanelSplitSizes> {
  imagePanelCollapsed?: boolean;
  rightPanelCollapsed?: boolean;
  bottomPanelCollapsed?: boolean;
}

export interface PanelSplitMetrics {
  mainWidth: number;
  mainHeight: number;
  imagePanelTabWidth: number;
  imageResizerWidth: number;
  rightPanelTabWidth: number;
  rightResizerWidth: number;
  bottomPanelTabHeight: number;
  bottomResizerHeight: number;
}

export type PanelSplitSizeKey = keyof PanelSplitSizes;

export type PanelSplitKeyboardAction =
  | { type: 'delta'; delta: number }
  | { type: 'snap'; target: 'min' | 'max' };

interface ProbeCoordinateImageSize {
  width: number;
  height: number;
}

interface TopMenuElements {
  button: HTMLButtonElement;
  menu: HTMLElement;
}

type TopMenuTrackingMode = 'inactive' | 'pointer';

interface ProbeValueRowElements {
  row: HTMLDivElement;
  key: HTMLSpanElement;
  value: HTMLSpanElement;
}

interface ProbeColorRowElements {
  row: HTMLDivElement;
  channel: HTMLSpanElement;
  value: HTMLSpanElement;
}

interface ReadoutSectionElements {
  toggle: HTMLButtonElement;
  content: HTMLElement;
}

interface FileSystemHandleLike {
  kind: 'file' | 'directory';
  name: string;
}

interface FileSystemFileHandleLike extends FileSystemHandleLike {
  kind: 'file';
  getFile: () => Promise<File>;
}

interface FileSystemDirectoryHandleLike extends FileSystemHandleLike {
  kind: 'directory';
  values: () => AsyncIterable<FileSystemHandleLike>;
}

interface LegacyFileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface LegacyFileSystemFileEntryLike extends LegacyFileSystemEntryLike {
  isFile: true;
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
}

interface LegacyFileSystemDirectoryReaderLike {
  readEntries: (
    success: (entries: LegacyFileSystemEntryLike[]) => void,
    error?: (error: DOMException) => void
  ) => void;
}

interface LegacyFileSystemDirectoryEntryLike extends LegacyFileSystemEntryLike {
  isDirectory: true;
  createReader: () => LegacyFileSystemDirectoryReaderLike;
}

interface DirectoryAwareDataTransferItem extends DataTransferItem {
  getAsEntry?: () => LegacyFileSystemEntryLike | null;
  getAsFileSystemHandle?: () => Promise<FileSystemHandleLike | null>;
  webkitGetAsEntry?: () => LegacyFileSystemEntryLike | null;
}

interface ResolvedDroppedFiles {
  files: File[];
  containsDirectory: boolean;
}

interface CapturedDroppedFileSystemHandle {
  handles: Promise<FileSystemHandleLike | null>[];
}

interface CapturedDroppedEntries {
  entries: Array<LegacyFileSystemEntryLike | null>;
}

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

export class ViewerUi implements Disposable {
  private readonly disposables = new DisposableBag();
  private readonly elements: Elements;
  private readonly loadingOverlayDisclosure: ProgressiveLoadingOverlayDisclosure;
  private readonly openedImagesPanel: OpenedImagesPanel;
  private readonly layerPanel: LayerPanel;
  private readonly channelPanel: ChannelPanel;
  private readonly colormapPanel: ColormapPanel;
  private readonly layoutSplitController: LayoutSplitController;
  private isLoading = false;
  private isRgbViewLoading = false;
  private openedImageCount = 0;
  private exportTarget: ExportImageTarget | null = null;
  private exportDialogOpen = false;
  private exportDialogBusy = false;
  private exportDialogRestoreFocusTarget: HTMLElement | null = null;
  private topMenuTrackingMode: TopMenuTrackingMode = 'inactive';
  private hoverOpenedTopMenuButton: HTMLButtonElement | null = null;
  private readonly probeValueRows = new Map<string, ProbeValueRowElements>();
  private readonly probeDisplayValueRows = new Map<string, ProbeColorRowElements>();
  private disposed = false;

  constructor(private readonly callbacks: UiCallbacks) {
    this.elements = resolveElements();
    this.loadingOverlayDisclosure = new ProgressiveLoadingOverlayDisclosure((phase) => {
      this.renderLoadingOverlayPhase(phase);
    });
    this.openedImagesPanel = new OpenedImagesPanel(this.elements, {
      onOpenedImageSelected: (sessionId) => {
        this.callbacks.onOpenedImageSelected(sessionId);
      },
      onReorderOpenedImage: (draggedSessionId, targetSessionId, placement) => {
        this.callbacks.onReorderOpenedImage(draggedSessionId, targetSessionId, placement);
      },
      onDisplayCacheBudgetChange: (mb) => {
        this.callbacks.onDisplayCacheBudgetChange(mb);
      },
      onReloadSelectedOpenedImage: (sessionId) => {
        this.callbacks.onReloadSelectedOpenedImage(sessionId);
      },
      onCloseSelectedOpenedImage: (sessionId) => {
        this.callbacks.onCloseSelectedOpenedImage(sessionId);
      }
    });
    this.layerPanel = new LayerPanel(this.elements, {
      onLayerChange: (layerIndex) => {
        this.callbacks.onLayerChange(layerIndex);
      }
    });
    this.channelPanel = new ChannelPanel(this.elements, {
      onRgbGroupChange: (mapping) => {
        this.callbacks.onRgbGroupChange(mapping);
      }
    });
    this.colormapPanel = new ColormapPanel(this.elements, {
      onExposureChange: (value) => {
        this.callbacks.onExposureChange(value);
      },
      onVisualizationModeChange: (mode) => {
        this.callbacks.onVisualizationModeChange(mode);
      },
      onColormapChange: (colormapId) => {
        this.callbacks.onColormapChange(colormapId);
      },
      onColormapRangeChange: (range) => {
        this.callbacks.onColormapRangeChange(range);
      },
      onColormapAutoRange: () => {
        this.callbacks.onColormapAutoRange();
      },
      onColormapZeroCenterToggle: () => {
        this.callbacks.onColormapZeroCenterToggle();
      },
      onStokesDegreeModulationToggle: () => {
        this.callbacks.onStokesDegreeModulationToggle();
      }
    });
    this.layoutSplitController = new LayoutSplitController(this.elements);
    this.disposables.addDisposable(this.loadingOverlayDisclosure);
    this.disposables.addDisposable(this.openedImagesPanel);
    this.disposables.addDisposable(this.layerPanel);
    this.disposables.addDisposable(this.channelPanel);
    this.disposables.addDisposable(this.colormapPanel);
    this.disposables.addDisposable(this.layoutSplitController);
    this.setViewerMode('image');
    this.updateViewerModeMenuItemsDisabled();
    this.updateFileMenuItemsDisabled();
    this.bindEvents();
  }

  get viewerContainer(): HTMLElement {
    return this.elements.viewerContainer;
  }

  get glCanvas(): HTMLCanvasElement {
    return this.elements.glCanvas;
  }

  get overlayCanvas(): HTMLCanvasElement {
    return this.elements.overlayCanvas;
  }

  get probeOverlayCanvas(): HTMLCanvasElement {
    return this.elements.probeOverlayCanvas;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.closeExportDialog(false);
    this.closeAllTopMenus(false);
    this.showDropOverlay(false);
    this.disposed = true;
    this.disposables.dispose();
  }

  setError(message: string | null): void {
    if (this.disposed) {
      return;
    }

    if (!message) {
      this.elements.errorBanner.classList.add('hidden');
      this.elements.errorBanner.textContent = '';
      return;
    }

    this.elements.errorBanner.classList.remove('hidden');
    this.elements.errorBanner.textContent = message;
  }

  setLoading(loading: boolean): void {
    if (this.disposed) {
      return;
    }

    this.isLoading = loading;
    this.elements.openFileButton.disabled = loading;
    this.elements.openFolderButton.disabled = loading;
    this.elements.galleryCboxRgbButton.disabled = loading;
    this.elements.resetViewButton.disabled = loading;
    this.openedImagesPanel.setLoading(loading);
    this.layerPanel.setLoading(loading);
    this.channelPanel.setLoading(loading);
    this.colormapPanel.setLoading(loading);
    this.updateFileMenuItemsDisabled();
    this.updateViewerModeMenuItemsDisabled();
    this.updateLoadingOverlayVisibility();
    if (loading) {
      this.closeExportDialog(false);
    }
  }

  setRgbViewLoading(loading: boolean): void {
    if (this.disposed) {
      return;
    }

    this.isRgbViewLoading = loading;
    this.channelPanel.setRgbViewLoading(loading);
    this.updateFileMenuItemsDisabled();
    this.updateLoadingOverlayVisibility();
  }

  setDisplayCacheBudget(mb: number): void {
    if (this.disposed) {
      return;
    }

    this.openedImagesPanel.setDisplayCacheBudget(mb);
  }

  setDisplayCacheUsage(usedBytes: number, budgetBytes: number): void {
    if (this.disposed) {
      return;
    }

    this.openedImagesPanel.setDisplayCacheUsage(usedBytes, budgetBytes);
  }

  setExposure(exposureEv: number): void {
    if (this.disposed) {
      return;
    }

    this.colormapPanel.setExposure(exposureEv);
  }

  setViewerMode(mode: ViewerMode): void {
    if (this.disposed) {
      return;
    }

    this.elements.imageViewerMenuItem.setAttribute('aria-checked', mode === 'image' ? 'true' : 'false');
    this.elements.panoramaViewerMenuItem.setAttribute('aria-checked', mode === 'panorama' ? 'true' : 'false');
  }

  setVisualizationMode(mode: VisualizationMode): void {
    if (this.disposed) {
      return;
    }

    this.colormapPanel.setVisualizationMode(mode);
  }

  setColormapOptions(items: Array<{ id: string; label: string }>, activeId: string): void {
    if (this.disposed) {
      return;
    }

    this.colormapPanel.setColormapOptions(items, activeId);
  }

  setActiveColormap(activeId: string): void {
    if (this.disposed) {
      return;
    }

    this.colormapPanel.setActiveColormap(activeId);
  }

  setColormapGradient(lut: ColormapLut | null): void {
    if (this.disposed) {
      return;
    }

    this.colormapPanel.setColormapGradient(lut);
  }

  setColormapRange(
    range: DisplayLuminanceRange | null,
    autoRange: DisplayLuminanceRange | null,
    alwaysAuto = false,
    zeroCentered = false
  ): void {
    if (this.disposed) {
      return;
    }

    this.colormapPanel.setColormapRange(range, autoRange, alwaysAuto, zeroCentered);
  }

  setStokesDegreeModulationControl(label: string | null, enabled = false): void {
    if (this.disposed) {
      return;
    }

    this.colormapPanel.setStokesDegreeModulationControl(label, enabled);
  }

  setOpenedImageOptions(items: OpenedImageOptionItem[], activeId: string | null): void {
    if (this.disposed) {
      return;
    }

    this.openedImageCount = items.length;
    this.openedImagesPanel.setOpenedImageOptions(items, activeId);
    this.colormapPanel.setOpenedImageCount(this.openedImagesPanel.getOpenedImageCount());
    this.updateViewerModeMenuItemsDisabled();
    this.updateFileMenuItemsDisabled();
    if (items.length === 0) {
      this.setViewerMode('image');
    }
  }

  setExportTarget(target: ExportImageTarget | null): void {
    if (this.disposed) {
      return;
    }

    this.exportTarget = target ? { ...target } : null;
    if (!this.exportTarget) {
      this.closeExportDialog(false);
      this.resetExportDialogInputs();
    } else if (!this.exportDialogOpen) {
      this.applyExportTargetToDialog(this.exportTarget);
    }
    this.updateFileMenuItemsDisabled();
  }

  clearImageBrowserPanels(): void {
    if (this.disposed) {
      return;
    }

    this.layerPanel.clearForNoImage();
    this.channelPanel.clearForNoImage();
  }

  setLayerOptions(items: LayerOptionItem[], activeIndex: number): void {
    if (this.disposed) {
      return;
    }

    this.layerPanel.setLayerOptions(items, activeIndex);
  }

  setRgbGroupOptions(channelNames: string[], selected: DisplaySelection | null): void {
    if (this.disposed) {
      return;
    }

    if (!this.layerPanel.hasMultipleLayers()) {
      this.layerPanel.setFallbackPartLayerItemsFromChannelNames(channelNames);
    }
    this.channelPanel.setRgbGroupOptions(channelNames, selected);
  }

  setProbeReadout(
    mode: 'Hover' | 'Locked',
    sample: PixelSample | null,
    colorPreview: ProbeColorPreview | null,
    imageSize: ProbeCoordinateImageSize | null = null
  ): void {
    if (this.disposed) {
      return;
    }

    this.elements.probeMode.textContent = mode;

    if (!sample) {
      this.elements.probeCoords.textContent = formatProbeCoordinates(null, imageSize);
      this.elements.probeColorPreview.classList.add('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = 'transparent';
      this.renderProbeDisplayValues(createEmptyProbeDisplayValues());
      this.renderProbeValueRows([]);
      return;
    }

    this.elements.probeCoords.textContent = formatProbeCoordinates(sample, imageSize);
    if (colorPreview) {
      this.elements.probeColorPreview.classList.remove('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = colorPreview.cssColor;
      this.renderProbeDisplayValues(colorPreview.displayValues);
    } else {
      this.elements.probeColorPreview.classList.add('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = 'transparent';
      this.renderProbeDisplayValues(createEmptyProbeDisplayValues());
    }

    const channelEntries = Object.entries(sample.values).sort(([a], [b]) => a.localeCompare(b));
    this.renderProbeValueRows(
      channelEntries.map(([channelName, channelValue]) => ({
        key: channelName,
        value: formatOverlayValue(channelValue)
      }))
    );
  }

  setMetadata(metadata: ExrMetadataEntry[] | null): void {
    if (this.disposed) {
      return;
    }

    if (!metadata || metadata.length === 0) {
      this.elements.metadataEmptyState.classList.remove('hidden');
      this.elements.metadataTable.classList.add('hidden');
      this.elements.metadataTable.replaceChildren();
      return;
    }

    this.elements.metadataEmptyState.classList.add('hidden');
    this.elements.metadataTable.classList.remove('hidden');
    this.elements.metadataTable.replaceChildren(
      ...metadata.map((item) => {
        const row = document.createElement('div');
        row.className = 'metadata-row';

        const key = document.createElement('span');
        key.className = 'metadata-key';
        key.textContent = item.label;

        const value = document.createElement('span');
        value.className = 'metadata-value';
        value.textContent = item.value;

        row.append(key, value);
        return row;
      })
    );
  }

  setRoiReadout(readout: { roi: ImageRoi | null; stats: RoiStats | null }): void {
    if (this.disposed) {
      return;
    }

    if (!readout.roi || !readout.stats) {
      this.elements.roiEmptyState.classList.remove('hidden');
      this.elements.roiDetails.classList.add('hidden');
      this.elements.clearRoiButton.disabled = true;
      this.elements.roiBounds.textContent = '';
      this.elements.roiSize.textContent = '';
      this.elements.roiPixelCount.textContent = '';
      this.elements.roiValidCount.textContent = '';
      this.elements.roiStats.replaceChildren();
      return;
    }

    this.elements.roiEmptyState.classList.add('hidden');
    this.elements.roiDetails.classList.remove('hidden');
    this.elements.clearRoiButton.disabled = false;
    this.elements.roiBounds.textContent = formatRoiBounds(readout.roi);
    this.elements.roiSize.textContent = `${readout.stats.width} × ${readout.stats.height} px`;
    this.elements.roiPixelCount.textContent = String(readout.stats.pixelCount);
    this.elements.roiValidCount.textContent = formatRoiValidCounts(readout.stats);
    this.renderRoiStats(readout.stats);
  }

  showDropOverlay(show: boolean): void {
    if (this.disposed) {
      return;
    }

    if (show) {
      this.elements.dropOverlay.classList.remove('hidden');
      return;
    }
    this.elements.dropOverlay.classList.add('hidden');
  }

  private updateLoadingOverlayVisibility(): void {
    if (this.disposed) {
      return;
    }

    this.loadingOverlayDisclosure.setLoading(this.isLoading || this.isRgbViewLoading);
  }

  private renderLoadingOverlayPhase(phase: LoadingOverlayPhase): void {
    if (this.disposed) {
      return;
    }

    this.elements.loadingOverlay.classList.toggle('hidden', phase === 'hidden');
    this.elements.loadingOverlay.classList.toggle(LOADING_OVERLAY_SUBTLE_CLASS, phase === 'subtle');
    this.elements.loadingOverlay.classList.toggle(LOADING_OVERLAY_DARKENING_CLASS, phase === 'darkening');
    this.elements.loadingOverlay.classList.toggle(LOADING_OVERLAY_MESSAGE_CLASS, phase === 'message');
  }

  private updateFileMenuItemsDisabled(): void {
    if (this.disposed) {
      return;
    }

    this.elements.exportImageButton.disabled = this.isLoading || this.isRgbViewLoading || !this.exportTarget;
  }

  private getTopMenus(): TopMenuElements[] {
    return [
      { button: this.elements.fileMenuButton, menu: this.elements.fileMenu },
      { button: this.elements.viewMenuButton, menu: this.elements.viewMenu },
      { button: this.elements.galleryMenuButton, menu: this.elements.galleryMenu },
      { button: this.elements.settingsMenuButton, menu: this.elements.settingsMenu }
    ];
  }

  private updateViewerModeMenuItemsDisabled(): void {
    if (this.disposed) {
      return;
    }

    const disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.imageViewerMenuItem.disabled = disabled;
    this.elements.panoramaViewerMenuItem.disabled = disabled;
  }

  private openExportDialog(): void {
    if (this.disposed) {
      return;
    }

    if (!this.exportTarget || this.elements.exportImageButton.disabled) {
      return;
    }

    this.closeAllTopMenus();
    this.exportDialogRestoreFocusTarget = this.elements.fileMenuButton;
    this.applyExportTargetToDialog(this.exportTarget);
    this.setExportDialogError(null);
    this.setExportDialogBusy(false);
    this.exportDialogOpen = true;
    this.elements.exportDialogBackdrop.classList.remove('hidden');
    this.elements.exportFilenameInput.focus();
    this.elements.exportFilenameInput.select();
  }

  private closeExportDialog(restoreFocus = true): void {
    if (this.disposed) {
      return;
    }

    if (!this.exportDialogOpen && this.elements.exportDialogBackdrop.classList.contains('hidden')) {
      return;
    }

    this.exportDialogOpen = false;
    this.setExportDialogBusy(false);
    this.setExportDialogError(null);
    this.elements.exportDialogBackdrop.classList.add('hidden');

    if (restoreFocus) {
      (this.exportDialogRestoreFocusTarget ?? this.elements.exportImageButton).focus();
    }
    this.exportDialogRestoreFocusTarget = null;
  }

  private applyExportTargetToDialog(target: ExportImageTarget): void {
    this.elements.exportFilenameInput.value = target.filename;
  }

  private resetExportDialogInputs(): void {
    this.elements.exportFilenameInput.value = '';
  }

  private setExportDialogBusy(busy: boolean): void {
    if (this.disposed) {
      return;
    }

    this.exportDialogBusy = busy;
    this.elements.exportFilenameInput.disabled = busy;
    this.elements.exportDialogCancelButton.disabled = busy;
    this.elements.exportDialogSubmitButton.disabled = busy;
    this.elements.exportDialogSubmitButton.textContent = busy ? 'Exporting...' : 'Export';
    this.elements.exportFormatSelect.disabled = true;
  }

  private setExportDialogError(message: string | null): void {
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

  private async handleExportDialogSubmit(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const target = this.exportTarget;
    if (!target || this.exportDialogBusy) {
      return;
    }

    const filename = normalizeExportFilename(this.elements.exportFilenameInput.value);
    if (!filename) {
      this.setExportDialogError('Enter a filename.');
      this.elements.exportFilenameInput.focus();
      return;
    }

    const request = parseExportImageRequest({
      filename,
      format: this.elements.exportFormatSelect.value
    });
    if (!request) {
      this.setExportDialogError('Export failed.');
      return;
    }

    this.elements.exportFilenameInput.value = request.filename;
    this.setExportDialogError(null);
    this.setExportDialogBusy(true);

    try {
      await this.callbacks.onExportImage(request);
      this.closeExportDialog(true);
    } catch (error) {
      this.setExportDialogError(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      if (this.exportDialogOpen) {
        this.setExportDialogBusy(false);
      }
    }
  }

  private isTopMenuOpen(menu: TopMenuElements): boolean {
    return !menu.menu.classList.contains('hidden');
  }

  private openTopMenu(
    menu: TopMenuElements,
    focusTarget: 'first' | 'last' | null = null,
    trackingMode: TopMenuTrackingMode | null = null
  ): void {
    this.closeAllTopMenus(false, menu);
    menu.menu.classList.remove('hidden');
    menu.button.setAttribute('aria-expanded', 'true');
    this.topMenuTrackingMode = trackingMode ?? this.topMenuTrackingMode;

    if (focusTarget) {
      this.focusTopMenuItem(menu, focusTarget);
    }
  }

  private closeTopMenu(menu: TopMenuElements, restoreFocus = false): void {
    menu.menu.classList.add('hidden');
    menu.button.setAttribute('aria-expanded', 'false');
    if (this.hoverOpenedTopMenuButton === menu.button) {
      this.hoverOpenedTopMenuButton = null;
    }
    if (!this.getTopMenus().some((item) => item.menu !== menu.menu && this.isTopMenuOpen(item))) {
      this.topMenuTrackingMode = 'inactive';
    }

    if (restoreFocus) {
      menu.button.focus();
    }
  }

  private suspendTopMenusForTopBarHover(): void {
    for (const menu of this.getTopMenus()) {
      if (!this.isTopMenuOpen(menu)) {
        continue;
      }
      this.closeTopMenu(menu);
    }
    this.topMenuTrackingMode = 'pointer';
  }

  private isPointerWithinTopMenuRegion(target: Node): boolean {
    return this.getTopMenus().some((menu) => menu.button.parentElement?.contains(target));
  }

  private closeAllTopMenus(restoreFocus = false, exceptMenu: TopMenuElements | null = null): void {
    for (const menu of this.getTopMenus()) {
      if (menu.menu === exceptMenu?.menu) {
        continue;
      }
      this.closeTopMenu(menu, restoreFocus && this.isTopMenuOpen(menu));
    }
  }

  private toggleTopMenu(menu: TopMenuElements): void {
    if (this.isTopMenuOpen(menu)) {
      this.closeTopMenu(menu);
      return;
    }

    this.openTopMenu(menu, null, 'pointer');
  }

  private getEnabledTopMenuItems(menu: TopMenuElements): HTMLElement[] {
    return Array.from(menu.menu.querySelectorAll<HTMLElement>('button, input, select, textarea')).filter(
      (element) => !('disabled' in element) || !element.disabled
    );
  }

  private focusTopMenuItem(menu: TopMenuElements, target: 'first' | 'last'): void {
    const items = this.getEnabledTopMenuItems(menu);
    const item = target === 'first' ? items.at(0) : items.at(-1);
    item?.focus();
  }

  private focusNextTopMenuItem(menu: TopMenuElements, delta: -1 | 1): void {
    const items = this.getEnabledTopMenuItems(menu);
    if (items.length === 0) {
      return;
    }

    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : items.length - 1
        : (currentIndex + delta + items.length) % items.length;
    items[nextIndex].focus();
  }

  private bindImageBrowserToggle(toggle: HTMLButtonElement, content: HTMLElement): void {
    this.disposables.addEventListener(toggle, 'click', () => {
      const collapsed = toggle.getAttribute('aria-expanded') === 'true';
      this.setImageBrowserCollapsed(toggle, content, collapsed);
    });
  }

  private setImageBrowserCollapsed(toggle: HTMLButtonElement, content: HTMLElement, collapsed: boolean): void {
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    content.hidden = collapsed;
    content.closest('.image-browser-section')?.classList.toggle('is-collapsed', collapsed);
  }

  private bindReadoutSection(section: ReadoutSectionElements): void {
    this.setReadoutSectionCollapsed(section, false);
    this.disposables.addEventListener(section.toggle, 'click', () => {
      const collapsed = section.toggle.getAttribute('aria-expanded') === 'true';
      this.setReadoutSectionCollapsed(section, collapsed);
    });
  }

  private setReadoutSectionCollapsed(section: ReadoutSectionElements, collapsed: boolean): void {
    section.toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    section.toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${getReadoutSectionName(section.toggle)} section`);
    section.content.hidden = collapsed;
    section.content.closest('.readout-block')?.classList.toggle('is-collapsed', collapsed);
  }

  private bindTopMenu(menu: TopMenuElements): void {
    this.disposables.addEventListener(menu.button, 'click', () => {
      if (this.hoverOpenedTopMenuButton === menu.button && this.isTopMenuOpen(menu)) {
        this.hoverOpenedTopMenuButton = null;
        return;
      }

      this.hoverOpenedTopMenuButton = null;
      this.toggleTopMenu(menu);
    });

    this.disposables.addEventListener(menu.button, 'pointerenter', () => {
      if (this.topMenuTrackingMode !== 'pointer' || this.isTopMenuOpen(menu)) {
        return;
      }

      menu.button.focus();
      this.openTopMenu(menu, null, 'pointer');
      this.hoverOpenedTopMenuButton = menu.button;
    });

    this.disposables.addEventListener(menu.button, 'keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleTopMenu(menu);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.openTopMenu(menu, 'first', 'inactive');
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.openTopMenu(menu, 'last', 'inactive');
        return;
      }

      if (event.key === 'Escape' && this.isTopMenuOpen(menu)) {
        event.preventDefault();
        this.closeTopMenu(menu, true);
        return;
      }

      if (event.key === 'Tab' && this.isTopMenuOpen(menu)) {
        this.closeTopMenu(menu);
      }
    });

    this.disposables.addEventListener(menu.menu, 'keydown', (event) => {
      const target = event.target;
      const shouldPreserveFieldArrowKeys =
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement);

      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeTopMenu(menu, true);
        return;
      }

      if (event.key === 'Tab') {
        this.closeTopMenu(menu);
        return;
      }

      if (event.key === 'ArrowDown' && !shouldPreserveFieldArrowKeys) {
        event.preventDefault();
        this.focusNextTopMenuItem(menu, 1);
        return;
      }

      if (event.key === 'ArrowUp' && !shouldPreserveFieldArrowKeys) {
        event.preventDefault();
        this.focusNextTopMenuItem(menu, -1);
      }
    });
  }

  private bindEvents(): void {
    this.bindImageBrowserToggle(this.elements.openedFilesToggle, this.elements.openedFilesList);
    this.bindImageBrowserToggle(this.elements.partsLayersToggle, this.elements.partsLayersList);
    this.bindImageBrowserToggle(this.elements.channelViewToggle, this.elements.channelViewList);
    this.bindReadoutSection({ toggle: this.elements.metadataToggle, content: this.elements.metadataContent });
    this.bindReadoutSection({ toggle: this.elements.probeToggle, content: this.elements.probeContent });
    this.bindReadoutSection({ toggle: this.elements.roiToggle, content: this.elements.roiContent });

    for (const menu of this.getTopMenus()) {
      this.bindTopMenu(menu);
    }

    this.disposables.addEventListener(this.elements.appMenuBar, 'pointerover', (event) => {
      if (this.topMenuTrackingMode !== 'pointer') {
        return;
      }

      if (
        this.getTopMenus().every((menu) => !this.isTopMenuOpen(menu)) ||
        !(event.target instanceof Node) ||
        this.isPointerWithinTopMenuRegion(event.target)
      ) {
        return;
      }

      this.suspendTopMenusForTopBarHover();
    });

    this.disposables.addEventListener(document, 'click', (event) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        this.getTopMenus().some((menu) => menu.button.parentElement?.contains(target))
      ) {
        return;
      }

      this.closeAllTopMenus();
    });

    this.disposables.addEventListener(window, 'dragover', (event) => {
      if (!hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    });

    this.disposables.addEventListener(window, 'drop', (event) => {
      void this.handleDropEvent(event);
    });

    this.disposables.addEventListener(this.elements.openFileButton, 'click', () => {
      this.closeAllTopMenus();
      this.callbacks.onOpenFileClick();
    });

    this.disposables.addEventListener(this.elements.openFolderButton, 'click', () => {
      this.closeAllTopMenus();
      this.callbacks.onOpenFolderClick();
    });

    this.disposables.addEventListener(this.elements.exportImageButton, 'click', () => {
      if (this.elements.exportImageButton.disabled) {
        return;
      }

      this.openExportDialog();
    });

    this.disposables.addEventListener(this.elements.galleryCboxRgbButton, 'click', () => {
      if (this.elements.galleryCboxRgbButton.disabled) {
        return;
      }

      this.closeAllTopMenus();
      this.callbacks.onGalleryImageSelected(this.elements.galleryCboxRgbButton.dataset.galleryId ?? '');
    });

    this.disposables.addEventListener(this.elements.reloadAllOpenedImagesButton, 'click', () => {
      if (this.elements.reloadAllOpenedImagesButton.disabled) {
        return;
      }

      this.closeAllTopMenus();
      this.callbacks.onReloadAllOpenedImages();
    });

    this.disposables.addEventListener(this.elements.closeAllOpenedImagesButton, 'click', () => {
      if (this.elements.closeAllOpenedImagesButton.disabled) {
        return;
      }

      this.closeAllTopMenus();
      this.callbacks.onCloseAllOpenedImages();
    });

    this.disposables.addEventListener(this.elements.imageViewerMenuItem, 'click', () => {
      if (this.elements.imageViewerMenuItem.disabled) {
        return;
      }

      this.closeAllTopMenus();
      this.callbacks.onViewerModeChange('image');
    });

    this.disposables.addEventListener(this.elements.panoramaViewerMenuItem, 'click', () => {
      if (this.elements.panoramaViewerMenuItem.disabled) {
        return;
      }

      this.closeAllTopMenus();
      this.callbacks.onViewerModeChange('panorama');
    });

    this.disposables.addEventListener(this.elements.fileInput, 'change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0] ?? null;
      if (!file) {
        return;
      }
      this.callbacks.onFileSelected(file);
      input.value = '';
    });

    this.disposables.addEventListener(this.elements.folderInput, 'change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const files = toFiles(input.files);
      if (files.length === 0) {
        return;
      }
      this.callbacks.onFolderSelected(files);
      input.value = '';
    });

    this.disposables.addEventListener(this.elements.resetViewButton, 'click', () => {
      this.callbacks.onResetView();
    });

    this.disposables.addEventListener(this.elements.clearRoiButton, 'click', () => {
      if (this.elements.clearRoiButton.disabled) {
        return;
      }

      this.callbacks.onClearRoi();
    });

    this.disposables.addEventListener(this.elements.exportDialogBackdrop, 'click', (event) => {
      if (event.target === this.elements.exportDialogBackdrop && !this.exportDialogBusy) {
        this.closeExportDialog(true);
      }
    });

    this.disposables.addEventListener(this.elements.exportDialogCancelButton, 'click', () => {
      if (this.exportDialogBusy) {
        return;
      }
      this.closeExportDialog(true);
    });

    this.disposables.addEventListener(this.elements.exportDialogForm, 'submit', (event) => {
      event.preventDefault();
      void this.handleExportDialogSubmit();
    });

    this.disposables.addEventListener(document, 'keydown', (event) => {
      if (event.key === 'Escape' && this.exportDialogOpen && !this.exportDialogBusy) {
        event.preventDefault();
        this.closeExportDialog(true);
      }
    });

    this.disposables.addEventListener(this.elements.viewerContainer, 'dragover', (event) => {
      if (!hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();
      this.showDropOverlay(true);
    });

    this.disposables.addEventListener(this.elements.viewerContainer, 'dragleave', (event) => {
      if (!hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();

      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && this.elements.viewerContainer.contains(nextTarget)) {
        return;
      }
      this.showDropOverlay(false);
    });

    this.disposables.addEventListener(this.elements.viewerContainer, 'drop', (event) => {
      void this.handleDropEvent(event, true);
    });
  }

  private async handleDropEvent(event: DragEvent, stopPropagation = false): Promise<void> {
    if (!hasDroppedFiles(event)) {
      return;
    }

    event.preventDefault();
    if (stopPropagation) {
      event.stopPropagation();
    }
    this.showDropOverlay(false);

    const { files, containsDirectory } = await resolveDroppedFiles(event.dataTransfer);
    if (files.length === 0) {
      return;
    }

    if (containsDirectory) {
      this.callbacks.onFolderSelected(files);
      return;
    }

    this.callbacks.onFilesDropped(files);
  }

  private renderProbeDisplayValues(displayValues: ProbeDisplayValue[]): void {
    if (this.probeDisplayValueRows.size === 0 && this.elements.probeColorValues.childElementCount > 0) {
      this.elements.probeColorValues.replaceChildren();
    }

    const orderedRows = displayValues.map((item) => {
      const existing = this.probeDisplayValueRows.get(item.label);
      if (existing) {
        existing.channel.textContent = `${item.label}:`;
        existing.value.textContent = item.value;
        return existing.row;
      }

      const row = document.createElement('div');
      row.className = 'probe-color-row';

      const channel = document.createElement('span');
      channel.className = 'probe-color-channel';
      channel.textContent = `${item.label}:`;

      const value = document.createElement('span');
      value.className = 'probe-color-number';
      value.textContent = item.value;

      row.append(channel, value);
      this.probeDisplayValueRows.set(item.label, {
        row,
        channel,
        value
      });
      return row;
    });

    pruneKeyedRows(this.probeDisplayValueRows, new Set(displayValues.map((item) => item.label)));
    syncRowOrder(this.elements.probeColorValues, orderedRows);
  }

  private renderProbeValueRows(items: Array<{ key: string; value: string }>): void {
    const orderedRows = items.map((item) => {
      const existing = this.probeValueRows.get(item.key);
      if (existing) {
        existing.key.textContent = item.key;
        existing.value.textContent = item.value;
        return existing.row;
      }

      const row = document.createElement('div');
      row.className = 'probe-row';

      const key = document.createElement('span');
      key.className = 'probe-key';
      key.textContent = item.key;

      const value = document.createElement('span');
      value.className = 'probe-value';
      value.textContent = item.value;

      row.append(key, value);
      this.probeValueRows.set(item.key, {
        row,
        key,
        value
      });
      return row;
    });

    pruneKeyedRows(this.probeValueRows, new Set(items.map((item) => item.key)));
    syncRowOrder(this.elements.probeValues, orderedRows);
  }

  private renderRoiStats(stats: RoiStats): void {
    this.elements.roiStats.replaceChildren(
      buildRoiStatsHeaderRow(),
      ...stats.channels.map((channel) => {
        const row = document.createElement('div');
        row.className = 'roi-stats-row';
        row.append(
          buildRoiStatsCell('roi-stats-cell roi-stats-cell--label', channel.label),
          buildRoiStatsCell('roi-stats-cell', formatRoiStatValue(channel.min)),
          buildRoiStatsCell('roi-stats-cell', formatRoiStatValue(channel.mean)),
          buildRoiStatsCell('roi-stats-cell', formatRoiStatValue(channel.max))
        );
        return row;
      })
    );
  }
}

function createEmptyProbeDisplayValues(): ProbeDisplayValue[] {
  return [
    { label: 'R', value: '-' },
    { label: 'G', value: '-' },
    { label: 'B', value: '-' }
  ];
}

function pruneKeyedRows<T extends { row: HTMLElement }>(rows: Map<string, T>, nextKeys: Set<string>): void {
  for (const [key, value] of rows.entries()) {
    if (nextKeys.has(key)) {
      continue;
    }

    value.row.remove();
    rows.delete(key);
  }
}

function syncRowOrder(container: HTMLElement, orderedRows: HTMLElement[]): void {
  let referenceNode = container.firstChild;
  for (const row of orderedRows) {
    if (row === referenceNode) {
      referenceNode = referenceNode?.nextSibling ?? null;
      continue;
    }

    container.insertBefore(row, referenceNode);
  }
}

function getReadoutSectionName(toggle: HTMLButtonElement): string {
  return toggle.closest('.readout-block')?.querySelector('h2')?.textContent?.trim() ?? 'readout';
}

export function formatProbeCoordinates(
  sample: Pick<PixelSample, 'x' | 'y'> | null,
  imageSize: ProbeCoordinateImageSize | null = null
): string {
  const xWidth = getProbeCoordinateWidth(imageSize?.width);
  const yWidth = getProbeCoordinateWidth(imageSize?.height);
  return `x ${formatProbeCoordinateValue(sample?.x ?? null, xWidth)}   y ${formatProbeCoordinateValue(
    sample?.y ?? null,
    yWidth
  )}`;
}

function getProbeCoordinateWidth(size: number | undefined): number {
  if (!Number.isFinite(size) || size === undefined || size <= 0) {
    return 1;
  }

  return String(Math.max(0, Math.floor(size) - 1)).length;
}

function formatProbeCoordinateValue(value: number | null, width: number): string {
  if (value === null) {
    return '-'.padStart(width, ' ');
  }

  return String(Math.trunc(value)).padStart(width, ' ');
}

function formatRoiBounds(roi: ImageRoi): string {
  return `x ${roi.x0}..${roi.x1}  y ${roi.y0}..${roi.y1}`;
}

function formatRoiValidCounts(stats: RoiStats): string {
  return stats.channels
    .map((channel) => `${channel.label} ${channel.validPixelCount}/${stats.pixelCount}`)
    .join(', ');
}

function formatRoiStatValue(value: number | null): string {
  return value === null ? 'n/a' : formatOverlayValue(value);
}

function buildRoiStatsHeaderRow(): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'roi-stats-row roi-stats-row--header';
  row.append(
    buildRoiStatsCell('roi-stats-cell roi-stats-cell--label', 'Channel'),
    buildRoiStatsCell('roi-stats-cell', 'Min'),
    buildRoiStatsCell('roi-stats-cell', 'Mean'),
    buildRoiStatsCell('roi-stats-cell', 'Max')
  );
  return row;
}

function buildRoiStatsCell(className: string, text: string): HTMLSpanElement {
  const cell = document.createElement('span');
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function hasDroppedFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).includes('Files');
}

function toFiles(files: FileList | null | undefined): File[] {
  if (!files) {
    return [];
  }
  return Array.from(files);
}

async function resolveDroppedFiles(
  dataTransfer: DataTransfer | null | undefined
): Promise<ResolvedDroppedFiles> {
  if (!dataTransfer) {
    return {
      files: [],
      containsDirectory: false
    };
  }

  const fallbackFiles = toFiles(dataTransfer.files);
  const items = Array.from(dataTransfer.items ?? []) as DirectoryAwareDataTransferItem[];
  if (items.length > 0) {
    const capturedHandles = captureDroppedHandlePromises(items);
    const capturedEntries = captureDroppedEntries(items);

    if (capturedHandles) {
      try {
        const handleResolved = await resolveDroppedFilesFromCapturedHandles(capturedHandles);
        if (handleResolved) {
          return handleResolved;
        }
      } catch {
        // Fall through to entry/plain-file resolution.
      }
    }

    if (capturedEntries) {
      try {
        const entryResolved = await resolveDroppedFilesFromCapturedEntries(capturedEntries);
        if (entryResolved) {
          return entryResolved;
        }
      } catch {
        // Fall through to plain-file resolution.
      }
    }
  }

  return {
    files: fallbackFiles,
    containsDirectory: false
  };
}

function captureDroppedHandlePromises(
  items: DirectoryAwareDataTransferItem[]
): CapturedDroppedFileSystemHandle | null {
  const fileItems = items.filter((item) => item.kind === 'file');
  if (fileItems.length === 0 || !fileItems.every((item) => typeof item.getAsFileSystemHandle === 'function')) {
    return null;
  }

  // getAsFileSystemHandle() must be called synchronously during the drop event turn.
  return {
    handles: fileItems.map((item) => item.getAsFileSystemHandle!())
  };
}

async function resolveDroppedFilesFromCapturedHandles(
  captured: CapturedDroppedFileSystemHandle
): Promise<ResolvedDroppedFiles | null> {
  const handles = await Promise.all(captured.handles);
  const files: File[] = [];
  let containsDirectory = false;

  for (const handle of handles) {
    if (!handle) {
      continue;
    }

    if (handle.kind === 'file') {
      files.push(await (handle as FileSystemFileHandleLike).getFile());
      continue;
    }

    containsDirectory = true;
    files.push(...await collectFilesFromDirectoryHandle(handle as FileSystemDirectoryHandleLike, handle.name));
  }

  return {
    files,
    containsDirectory
  };
}

async function collectFilesFromDirectoryHandle(
  directory: FileSystemDirectoryHandleLike,
  relativePrefix: string
): Promise<File[]> {
  const files: File[] = [];

  for await (const handle of directory.values()) {
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandleLike).getFile();
      files.push(withRelativePath(file, `${relativePrefix}/${file.name}`));
      continue;
    }

    files.push(...await collectFilesFromDirectoryHandle(
      handle as FileSystemDirectoryHandleLike,
      `${relativePrefix}/${handle.name}`
    ));
  }

  return files;
}

function captureDroppedEntries(
  items: DirectoryAwareDataTransferItem[]
): CapturedDroppedEntries | null {
  const fileItems = items.filter((item) => item.kind === 'file');
  if (fileItems.length === 0) {
    return null;
  }

  const entries = fileItems.map((item) => getDroppedEntry(item));
  if (entries.every((entry) => entry === null)) {
    return null;
  }

  return {
    entries
  };
}

async function resolveDroppedFilesFromCapturedEntries(
  captured: CapturedDroppedEntries
): Promise<ResolvedDroppedFiles | null> {
  const files: File[] = [];
  let containsDirectory = false;

  for (const entry of captured.entries) {
    if (!entry) {
      continue;
    }

    if (entry.isDirectory) {
      containsDirectory = true;
      files.push(...await collectFilesFromLegacyEntry(
        entry as LegacyFileSystemDirectoryEntryLike,
        entry.name
      ));
      continue;
    }

    files.push(...await collectFilesFromLegacyEntry(
      entry as LegacyFileSystemFileEntryLike,
      null
    ));
  }

  return {
    files,
    containsDirectory
  };
}

function getDroppedEntry(item: DirectoryAwareDataTransferItem): LegacyFileSystemEntryLike | null {
  if (typeof item.getAsEntry === 'function') {
    return item.getAsEntry();
  }

  if (typeof item.webkitGetAsEntry === 'function') {
    return item.webkitGetAsEntry();
  }

  return null;
}

async function collectFilesFromLegacyEntry(
  entry: LegacyFileSystemFileEntryLike | LegacyFileSystemDirectoryEntryLike,
  relativePath: string | null
): Promise<File[]> {
  if (entry.isFile) {
    const file = await getFileFromLegacyEntry(entry);
    return [relativePath ? withRelativePath(file, relativePath) : file];
  }

  const entries = await readAllLegacyDirectoryEntries(entry);
  const files: File[] = [];

  for (const child of entries) {
    const childRelativePath = relativePath ? `${relativePath}/${child.name}` : child.name;
    files.push(...await collectFilesFromLegacyEntry(
      child as LegacyFileSystemFileEntryLike | LegacyFileSystemDirectoryEntryLike,
      childRelativePath
    ));
  }

  return files;
}

function getFileFromLegacyEntry(entry: LegacyFileSystemFileEntryLike): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readAllLegacyDirectoryEntries(
  directory: LegacyFileSystemDirectoryEntryLike
): Promise<LegacyFileSystemEntryLike[]> {
  const reader = directory.createReader();
  const entries: LegacyFileSystemEntryLike[] = [];

  while (true) {
    const batch = await new Promise<LegacyFileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}

function withRelativePath(file: File, relativePath: string): File {
  const normalizedPath = relativePath.trim();
  if (!normalizedPath) {
    return file;
  }

  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: normalizedPath
    });
    return file;
  } catch {
    const clonedFile = new File([file], file.name, {
      type: file.type,
      lastModified: file.lastModified
    });
    Object.defineProperty(clonedFile, 'webkitRelativePath', {
      configurable: true,
      value: normalizedPath
    });
    return clonedFile;
  }
}

function buildDefaultExportFilename(displayName: string): string {
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

function normalizeExportFilename(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.toLocaleLowerCase().endsWith('.png') ? trimmed : `${trimmed}.png`;
}

function parseExportImageRequest(args: {
  filename: string;
  format: string;
}): ExportImageRequest | null {
  if (args.format !== 'png') {
    return null;
  }

  return {
    filename: args.filename,
    format: 'png'
  };
}

export {
  buildPartLayerItemsFromChannelNames,
  buildDefaultExportFilename,
  clampPanelSplitSizes,
  formatDisplayCacheUsageText,
  getChannelViewSwatches,
  getDisplayCacheUsageState,
  getListboxOptionIndexAtClientY,
  getPanelSplitKeyboardAction,
  parsePanelSplitStorageValue
};
