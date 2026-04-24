import {
  findSelectedChannelViewItem,
  hasSplitChannelViewItems,
  selectVisibleChannelViewItems,
  type ChannelViewThumbnailItem
} from '../channel-view-items';
import { findMergedSelectionForSplitDisplay, findSplitSelectionForMergedDisplay } from '../display-selection';
import { cloneDisplaySelection, sameDisplaySelection } from '../display-model';
import { AppFullscreenController } from './app-fullscreen-controller';
import { ChannelPanel } from './channel-panel';
import { ChannelThumbnailStrip } from './channel-thumbnail-strip';
import { CollapsibleSectionsController } from './collapsible-sections';
import { ColormapPanel } from './colormap-panel';
import { DragDropController } from './drag-drop';
import { ExportColormapDialogController } from './export-colormap-dialog';
import { ExportImageBatchDialogController } from './export-image-batch-dialog';
import { ExportImageDialogController } from './export-image-dialog';
import { FolderLoadDialogController } from './folder-load-dialog';
import { GlobalKeyboardController } from './global-keyboard-controller';
import { resolveElements, type Elements } from './elements';
import { setMetadata } from './metadata-panel';
import { type LayerOptionItem, type OpenedImageOptionItem } from './image-browser-types';
import { LayoutSplitController } from './layout-split-controller';
import { LayerPanel } from './layer-panel';
import {
  ProgressiveLoadingOverlayDisclosure,
  renderLoadingOverlayPhase,
  type LoadingOverlayPhase
} from './loading-overlay-disclosure';
import { OpenedImagesPanel } from './opened-images-panel';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { ColormapLut } from '../colormaps';
import type { ExportImagePixels } from '../export-image';
import type {
  DisplaySelection,
  DisplayLuminanceRange,
  ExrMetadataEntry,
  ExportColormapPreviewRequest,
  ExportColormapRequest,
  ExportImageBatchPreviewRequest,
  ExportImageBatchRequest,
  ExportImageBatchTarget,
  ExportImageRequest,
  ExportImageTarget,
  ImageRoi,
  OpenedImageDropPlacement,
  PanoramaKeyboardOrbitInput,
  PixelSample,
  RoiStats,
  StokesAolpDegreeModulationMode,
  ViewerMode,
  VisualizationMode
} from '../types';
import type { ProbeColorPreview } from '../probe';
import { ProbeReadoutController, type ProbeCoordinateImageSize } from './probe-readout';
import { setRoiReadout } from './roi-readout';
import { TopMenuController } from './top-menu-controller';
import { WindowPreviewController } from './window-preview-controller';
import {
  DEFAULT_FOLDER_LOAD_LIMITS,
  createFolderLoadAdmission,
  getFolderLoadStats
} from '../folder-load-limits';

const DISPLAY_TOOLBAR_VISIBLE_STORAGE_KEY = 'openexr-viewer:display-toolbar-visible:v1';

export interface UiCallbacks {
  onOpenFileClick: () => void;
  onOpenFolderClick: () => void;
  onExportImage: (request: ExportImageRequest) => Promise<void>;
  onResolveExportImagePreview: (signal: AbortSignal) => Promise<ExportImagePixels>;
  onExportImageBatch: (request: ExportImageBatchRequest, signal: AbortSignal) => Promise<void>;
  onResolveExportImageBatchPreview: (
    request: ExportImageBatchPreviewRequest,
    signal: AbortSignal
  ) => Promise<ExportImagePixels>;
  onExportColormap: (request: ExportColormapRequest) => Promise<void>;
  onResolveExportColormapPreview: (
    request: ExportColormapPreviewRequest,
    signal: AbortSignal
  ) => Promise<ExportImagePixels>;
  onFileSelected: (file: File) => void;
  onFolderSelected: (files: File[], options?: { overrideLimits?: boolean }) => void;
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
  onPanoramaKeyboardOrbitInputChange: (input: PanoramaKeyboardOrbitInput) => void;
  onViewerModeChange: (mode: ViewerMode) => void;
  onLayerChange: (layerIndex: number) => void;
  onRgbGroupChange: (mapping: DisplaySelection) => void;
  onVisualizationModeChange: (mode: VisualizationMode) => void;
  onColormapChange: (colormapId: string) => void;
  onColormapRangeChange: (range: DisplayLuminanceRange) => void;
  onColormapAutoRange: () => void;
  onColormapZeroCenterToggle: () => void;
  onStokesDegreeModulationToggle: () => void;
  onStokesAolpDegreeModulationModeChange: (mode: StokesAolpDegreeModulationMode) => void;
  onClearRoi: () => void;
  onResetSettings: () => void;
  onResetView: () => void;
}

export type ChannelThumbnailOptionItem = ChannelViewThumbnailItem;

export class ViewerUi implements Disposable {
  private readonly disposables = new DisposableBag();
  private readonly elements: Elements;
  private readonly loadingOverlayDisclosure: ProgressiveLoadingOverlayDisclosure;
  private readonly openedImagesPanel: OpenedImagesPanel;
  private readonly layerPanel: LayerPanel;
  private readonly channelPanel: ChannelPanel;
  private readonly channelThumbnailStrip: ChannelThumbnailStrip;
  private readonly colormapPanel: ColormapPanel;
  private readonly layoutSplitController: LayoutSplitController;
  private readonly topMenuController: TopMenuController;
  private readonly appFullscreenController: AppFullscreenController;
  private readonly globalKeyboardController: GlobalKeyboardController;
  private readonly windowPreviewController: WindowPreviewController;
  private readonly exportImageDialog: ExportImageDialogController;
  private readonly exportImageBatchDialog: ExportImageBatchDialogController;
  private readonly exportColormapDialog: ExportColormapDialogController;
  private readonly folderLoadDialog: FolderLoadDialogController;
  private readonly probeReadoutController: ProbeReadoutController;
  private readonly dragDropController: DragDropController;
  private readonly collapsibleSectionsController: CollapsibleSectionsController;
  private isLoading = false;
  private isDisplayBusy = false;
  private isDisplayOverlayLoading = false;
  private openedImageCount = 0;
  private includeSplitRgbChannels = false;
  private channelThumbnailItems: ChannelThumbnailOptionItem[] = [];
  private rgbGroupChannelNames: string[] = [];
  private currentChannelSelection: DisplaySelection | null = null;
  private viewerMode: ViewerMode = 'image';
  private hasActiveChannelImage = false;
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
      onOpenedImageRowClick: () => {
        this.globalKeyboardController.setVerticalNavigationTarget('openedFiles');
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
      onChannelViewChange: (value) => {
        this.handleChannelViewValueChange(value);
      },
      onChannelViewRowClick: () => {
        this.globalKeyboardController.setVerticalNavigationTarget('channelView');
      },
      onSplitToggle: (includeSplitRgbChannels) => {
        this.handleRgbSplitToggle(includeSplitRgbChannels);
      }
    });
    this.channelThumbnailStrip = new ChannelThumbnailStrip(this.elements, {
      onChannelViewChange: (value) => {
        this.handleChannelViewValueChange(value);
      },
      onCollapsedContentAvailabilityChange: (available) => {
        this.layoutSplitController.setBottomCollapsedContentAvailable(available);
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
      },
      onStokesAolpDegreeModulationModeChange: (mode) => {
        this.callbacks.onStokesAolpDegreeModulationModeChange(mode);
      }
    });
    this.layoutSplitController = new LayoutSplitController(this.elements);
    this.topMenuController = new TopMenuController(this.elements, {
      onBeforeOpenMenu: () => {
        this.clearPanoramaKeyboardOrbitInput();
      }
    });
    this.appFullscreenController = new AppFullscreenController(this.elements, {
      onBeforeToggle: () => {
        this.topMenuController.closeAll();
      }
    });
    this.globalKeyboardController = new GlobalKeyboardController(this.elements, {
      isExportImageDialogOpen: () => this.exportImageDialog.isOpen(),
      isExportImageDialogBusy: () => this.exportImageDialog.isBusy(),
      closeExportImageDialog: (restoreFocus) => {
        this.exportImageDialog.close(restoreFocus);
      },
      isExportImageBatchDialogOpen: () => this.exportImageBatchDialog.isOpen(),
      isExportImageBatchDialogBusy: () => this.exportImageBatchDialog.isBusy(),
      closeExportImageBatchDialog: (restoreFocus) => {
        this.exportImageBatchDialog.close(restoreFocus);
      },
      isExportColormapDialogOpen: () => this.exportColormapDialog.isOpen(),
      isExportColormapDialogBusy: () => this.exportColormapDialog.isBusy(),
      closeExportColormapDialog: (restoreFocus) => {
        this.exportColormapDialog.close(restoreFocus);
      },
      isFolderLoadDialogOpen: () => this.folderLoadDialog.isOpen(),
      closeFolderLoadDialog: (restoreFocus) => {
        this.folderLoadDialog.close(false, restoreFocus);
      },
      isWindowPreviewActive: () => this.windowPreviewController.isActive(),
      setWindowPreviewEnabled: (enabled) => {
        void this.windowPreviewController.setEnabled(enabled);
      },
      hasOpenMenu: () => this.topMenuController.hasOpenMenu(),
      getViewerMode: () => this.viewerMode,
      getOpenedImageCount: () => this.openedImageCount,
      onPanoramaKeyboardOrbitInputChange: (input) => {
        this.callbacks.onPanoramaKeyboardOrbitInputChange(input);
      },
      routeVerticalNavigation: (target, delta) => {
        if (target === 'channelView') {
          return this.channelPanel.stepSelection(delta);
        }

        return this.openedImagesPanel.stepSelection(delta);
      },
      routeHorizontalNavigation: (delta) => {
        return this.channelThumbnailStrip.stepSelection(delta);
      },
      canRouteChannelViewNavigation: () => {
        return (
          !this.elements.channelViewList.hidden &&
          !this.elements.rgbGroupSelect.disabled &&
          this.elements.channelViewList.querySelector('.image-browser-row') !== null
        );
      }
    });
    this.windowPreviewController = new WindowPreviewController(this.elements);
    this.exportImageDialog = new ExportImageDialogController(this.elements, {
      onExportImage: (request) => {
        return this.callbacks.onExportImage(request);
      },
      onResolveExportImagePreview: (signal) => {
        return this.callbacks.onResolveExportImagePreview(signal);
      }
    });
    this.exportImageBatchDialog = new ExportImageBatchDialogController(this.elements, {
      onExportImageBatch: (request, signal) => {
        return this.callbacks.onExportImageBatch(request, signal);
      },
      onResolveExportImageBatchPreview: (request, signal) => {
        return this.callbacks.onResolveExportImageBatchPreview(request, signal);
      }
    });
    this.exportColormapDialog = new ExportColormapDialogController(this.elements, {
      onExportColormap: (request) => {
        return this.callbacks.onExportColormap(request);
      },
      onResolveExportColormapPreview: (request, signal) => {
        return this.callbacks.onResolveExportColormapPreview(request, signal);
      }
    });
    this.folderLoadDialog = new FolderLoadDialogController(this.elements);
    this.probeReadoutController = new ProbeReadoutController(this.elements);
    this.dragDropController = new DragDropController(this.elements, {
      onFolderSelected: (files, options) => {
        void this.handleFolderSelected(files, options);
      },
      onFilesDropped: (files) => {
        this.callbacks.onFilesDropped(files);
      },
      confirmLargeFolderLoad: (admission) => {
        return this.folderLoadDialog.confirm(admission, DEFAULT_FOLDER_LOAD_LIMITS);
      }
    });
    this.collapsibleSectionsController = new CollapsibleSectionsController(this.elements);
    this.disposables.addDisposable(this.loadingOverlayDisclosure);
    this.disposables.addDisposable(this.openedImagesPanel);
    this.disposables.addDisposable(this.layerPanel);
    this.disposables.addDisposable(this.channelPanel);
    this.disposables.addDisposable(this.channelThumbnailStrip);
    this.disposables.addDisposable(this.colormapPanel);
    this.disposables.addDisposable(this.layoutSplitController);
    this.disposables.addDisposable(this.topMenuController);
    this.disposables.addDisposable(this.appFullscreenController);
    this.disposables.addDisposable(this.globalKeyboardController);
    this.disposables.addDisposable(this.windowPreviewController);
    this.disposables.addDisposable(this.exportImageDialog);
    this.disposables.addDisposable(this.exportImageBatchDialog);
    this.disposables.addDisposable(this.exportColormapDialog);
    this.disposables.addDisposable(this.folderLoadDialog);
    this.disposables.addDisposable(this.dragDropController);
    this.disposables.addDisposable(this.collapsibleSectionsController);
    this.clearImageBrowserPanels();
    this.setViewerMode('image');
    this.setDisplayToolbarVisible(readStoredDisplayToolbarVisible(), false);
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

    this.clearPanoramaKeyboardOrbitInput();
    this.exportImageDialog.close(false);
    this.exportImageBatchDialog.close(false);
    this.exportColormapDialog.close(false);
    this.folderLoadDialog.close(false, false);
    this.topMenuController.closeAll(false);
    this.dragDropController.showOverlay(false);
    this.elements.appShell.classList.remove('is-window-preview');
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
    if (loading) {
      this.clearPanoramaKeyboardOrbitInput();
    }
    this.elements.openFileButton.disabled = loading;
    this.elements.openFolderButton.disabled = loading;
    this.elements.galleryCboxRgbButton.disabled = loading;
    this.elements.resetViewButton.disabled = loading;
    this.elements.toolbarResetViewButton.disabled = loading;
    this.openedImagesPanel.setLoading(loading);
    this.layerPanel.setLoading(loading);
    this.channelPanel.setLoading(loading);
    this.channelThumbnailStrip.setLoading(loading);
    this.colormapPanel.setLoading(loading);
    this.updateFileMenuItemsDisabled();
    this.updateViewerModeMenuItemsDisabled();
    this.updateLoadingOverlayVisibility();
    if (loading) {
      this.exportImageDialog.close(false);
      this.exportImageBatchDialog.close(false);
      this.exportColormapDialog.close(false);
      this.folderLoadDialog.close(false, false);
    }
  }

  private async handleFolderSelected(files: File[], options: { overrideLimits?: boolean } = {}): Promise<void> {
    if (this.disposed || files.length === 0) {
      return;
    }

    if (!options.overrideLimits) {
      const admission = createFolderLoadAdmission(getFolderLoadStats(files), DEFAULT_FOLDER_LOAD_LIMITS);
      if (admission.exceeded) {
        const confirmed = await this.folderLoadDialog.confirm(admission, DEFAULT_FOLDER_LOAD_LIMITS);
        if (!confirmed || this.disposed) {
          return;
        }
        this.callbacks.onFolderSelected(files, { overrideLimits: true });
        return;
      }
    }

    if (options.overrideLimits) {
      this.callbacks.onFolderSelected(files, { overrideLimits: true });
      return;
    }

    this.callbacks.onFolderSelected(files);
  }

  setRgbViewLoading(displayBusy: boolean, overlayLoading = displayBusy): void {
    if (this.disposed) {
      return;
    }

    this.isDisplayBusy = displayBusy;
    this.isDisplayOverlayLoading = overlayLoading;
    this.channelPanel.setRgbViewLoading(displayBusy);
    this.renderChannelViewControls();
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

    if (mode !== 'panorama') {
      this.clearPanoramaKeyboardOrbitInput();
    }
    this.viewerMode = mode;
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
    this.exportColormapDialog.setOptions(items, activeId);
    this.updateFileMenuItemsDisabled();
  }

  setActiveColormap(activeId: string): void {
    if (this.disposed) {
      return;
    }

    this.colormapPanel.setActiveColormap(activeId);
    this.exportColormapDialog.setActiveColormap(activeId);
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

  setStokesDegreeModulationControl(
    label: string | null,
    enabled = false,
    showAolpMode = false,
    aolpMode: StokesAolpDegreeModulationMode = 'value'
  ): void {
    if (this.disposed) {
      return;
    }

    this.colormapPanel.setStokesDegreeModulationControl(label, enabled, showAolpMode, aolpMode);
  }

  setOpenedImageOptions(items: OpenedImageOptionItem[], activeId: string | null): void {
    if (this.disposed) {
      return;
    }

    if (items.length === 0) {
      this.clearPanoramaKeyboardOrbitInput();
    }
    this.openedImageCount = items.length;
    this.openedImagesPanel.setOpenedImageOptions(items, activeId);
    this.colormapPanel.setOpenedImageCount(this.openedImagesPanel.getOpenedImageCount());
    this.windowPreviewController.setOpenedImageCount(items.length);
    this.updateViewerModeMenuItemsDisabled();
    this.updateFileMenuItemsDisabled();
    if (items.length === 0 && this.windowPreviewController.isActive()) {
      void this.windowPreviewController.setEnabled(false);
    }
    if (items.length === 0) {
      this.setViewerMode('image');
    }
  }

  setExportTarget(target: ExportImageTarget | null): void {
    if (this.disposed) {
      return;
    }

    this.exportImageDialog.setTarget(target);
    this.updateFileMenuItemsDisabled();
  }

  setExportBatchTarget(target: ExportImageBatchTarget | null): void {
    if (this.disposed) {
      return;
    }

    this.exportImageBatchDialog.setTarget(target);
    this.updateFileMenuItemsDisabled();
  }

  clearImageBrowserPanels(): void {
    if (this.disposed) {
      return;
    }

    this.hasActiveChannelImage = false;
    this.rgbGroupChannelNames = [];
    this.channelThumbnailItems = [];
    this.currentChannelSelection = null;
    this.layerPanel.clearForNoImage();
    this.channelPanel.clearForNoImage();
    this.channelThumbnailStrip.clearForNoImage();
    this.globalKeyboardController.normalizeVerticalNavigationTarget();
  }

  setLayerOptions(items: LayerOptionItem[], activeIndex: number): void {
    if (this.disposed) {
      return;
    }

    this.layerPanel.setLayerOptions(items, activeIndex);
  }

  setRgbGroupOptions(
    channelNames: string[],
    selected: DisplaySelection | null,
    channelThumbnailItems: ChannelThumbnailOptionItem[] = []
  ): void {
    if (this.disposed) {
      return;
    }

    if (!this.layerPanel.hasMultipleLayers()) {
      this.layerPanel.setFallbackPartLayerItemsFromChannelNames(channelNames);
    }
    this.hasActiveChannelImage = true;
    this.rgbGroupChannelNames = [...channelNames];
    this.channelThumbnailItems = [...channelThumbnailItems];

    const remappedSelection = this.includeSplitRgbChannels
      ? findSplitSelectionForMergedDisplay(channelNames, selected)
      : findMergedSelectionForSplitDisplay(channelNames, selected);
    const shouldNotifyRemap = Boolean(
      remappedSelection && !sameDisplaySelection(remappedSelection, this.currentChannelSelection)
    );
    this.currentChannelSelection = cloneDisplaySelection(remappedSelection ?? selected);
    this.renderChannelViewControls();

    if (shouldNotifyRemap && remappedSelection) {
      this.callbacks.onRgbGroupChange(remappedSelection);
    }
  }

  private handleChannelViewValueChange(value: string): void {
    const item = this.channelThumbnailItems.find((entry) => entry.value === value);
    if (!item) {
      return;
    }

    this.currentChannelSelection = cloneDisplaySelection(item.selection);
    this.renderChannelViewControls();
    this.callbacks.onRgbGroupChange(item.selection);
  }

  private handleRgbSplitToggle(includeSplitRgbChannels: boolean): void {
    if (this.includeSplitRgbChannels === includeSplitRgbChannels) {
      return;
    }

    this.includeSplitRgbChannels = includeSplitRgbChannels;
    const remappedSelection = includeSplitRgbChannels
      ? findSplitSelectionForMergedDisplay(this.rgbGroupChannelNames, this.currentChannelSelection)
      : findMergedSelectionForSplitDisplay(this.rgbGroupChannelNames, this.currentChannelSelection);
    if (remappedSelection) {
      this.currentChannelSelection = cloneDisplaySelection(remappedSelection);
    }
    this.renderChannelViewControls();

    if (remappedSelection) {
      this.callbacks.onRgbGroupChange(remappedSelection);
    }
  }

  private renderChannelViewControls(): void {
    const visibleItems = selectVisibleChannelViewItems(this.channelThumbnailItems, this.includeSplitRgbChannels);
    const selectedItem = findSelectedChannelViewItem(visibleItems, this.currentChannelSelection) ?? visibleItems[0] ?? null;
    const selectedValue = selectedItem?.value ?? '';
    if (!findSelectedChannelViewItem(visibleItems, this.currentChannelSelection) && selectedItem) {
      this.currentChannelSelection = cloneDisplaySelection(selectedItem.selection);
    }

    this.channelPanel.setSplitToggleState(
      this.includeSplitRgbChannels,
      hasSplitChannelViewItems(this.channelThumbnailItems)
    );
    this.channelPanel.setChannelViewItems(visibleItems, selectedValue);

    if (this.hasActiveChannelImage) {
      this.channelThumbnailStrip.setChannelViewItems(visibleItems, selectedValue);
    } else {
      this.channelThumbnailStrip.clearForNoImage();
    }

    this.globalKeyboardController.normalizeVerticalNavigationTarget();
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

    this.probeReadoutController.setProbeReadout(mode, sample, colorPreview, imageSize);
  }

  setMetadata(metadata: ExrMetadataEntry[] | null): void {
    if (this.disposed) {
      return;
    }

    setMetadata(this.elements, metadata);
  }

  setRoiReadout(readout: { roi: ImageRoi | null; stats: RoiStats | null }): void {
    if (this.disposed) {
      return;
    }

    setRoiReadout(this.elements, readout);
  }

  showDropOverlay(show: boolean): void {
    if (this.disposed) {
      return;
    }

    this.dragDropController.showOverlay(show);
  }

  private clearPanoramaKeyboardOrbitInput(): void {
    this.globalKeyboardController.clearPanoramaKeyboardOrbitInput();
  }

  private updateLoadingOverlayVisibility(): void {
    if (this.disposed) {
      return;
    }

    this.loadingOverlayDisclosure.setLoading(this.isLoading || this.isDisplayOverlayLoading);
  }

  private renderLoadingOverlayPhase(phase: LoadingOverlayPhase): void {
    if (this.disposed) {
      return;
    }

    renderLoadingOverlayPhase(this.elements, phase);
  }

  private updateFileMenuItemsDisabled(): void {
    if (this.disposed) {
      return;
    }

    this.elements.exportImageButton.disabled = this.isLoading || this.isDisplayBusy || !this.exportImageDialog.hasTarget();
    this.elements.exportImageBatchButton.disabled =
      this.isLoading || this.isDisplayBusy || !this.exportImageBatchDialog.hasTarget();
    this.elements.exportColormapButton.disabled = this.isLoading || !this.exportColormapDialog.hasOptions();
  }

  private updateViewerModeMenuItemsDisabled(): void {
    if (this.disposed) {
      return;
    }

    const disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.imageViewerMenuItem.disabled = disabled;
    this.elements.panoramaViewerMenuItem.disabled = disabled;
  }

  private bindEvents(): void {
    this.disposables.addEventListener(this.elements.openFileButton, 'click', () => {
      this.topMenuController.closeAll();
      this.callbacks.onOpenFileClick();
    });

    this.disposables.addEventListener(this.elements.openFolderButton, 'click', () => {
      this.topMenuController.closeAll();
      this.callbacks.onOpenFolderClick();
    });

    this.disposables.addEventListener(this.elements.exportImageButton, 'click', () => {
      if (this.elements.exportImageButton.disabled) {
        return;
      }

      this.clearPanoramaKeyboardOrbitInput();
      this.exportImageBatchDialog.close(false);
      this.exportColormapDialog.close(false);
      this.topMenuController.closeAll();
      this.exportImageDialog.openDialog();
    });

    this.disposables.addEventListener(this.elements.exportImageBatchButton, 'click', () => {
      if (this.elements.exportImageBatchButton.disabled) {
        return;
      }

      this.clearPanoramaKeyboardOrbitInput();
      this.exportImageDialog.close(false);
      this.exportColormapDialog.close(false);
      this.topMenuController.closeAll();
      this.exportImageBatchDialog.openDialog();
    });

    this.disposables.addEventListener(this.elements.exportColormapButton, 'click', () => {
      if (this.elements.exportColormapButton.disabled) {
        return;
      }

      this.clearPanoramaKeyboardOrbitInput();
      this.exportImageDialog.close(false);
      this.exportImageBatchDialog.close(false);
      this.topMenuController.closeAll();
      this.exportColormapDialog.openDialog();
    });

    this.disposables.addEventListener(this.elements.galleryCboxRgbButton, 'click', () => {
      if (this.elements.galleryCboxRgbButton.disabled) {
        return;
      }

      this.topMenuController.closeAll();
      this.callbacks.onGalleryImageSelected(this.elements.galleryCboxRgbButton.dataset.galleryId ?? '');
    });

    this.disposables.addEventListener(this.elements.reloadAllOpenedImagesButton, 'click', () => {
      if (this.elements.reloadAllOpenedImagesButton.disabled) {
        return;
      }

      this.topMenuController.closeAll();
      this.callbacks.onReloadAllOpenedImages();
    });

    this.disposables.addEventListener(this.elements.closeAllOpenedImagesButton, 'click', () => {
      if (this.elements.closeAllOpenedImagesButton.disabled) {
        return;
      }

      this.topMenuController.closeAll();
      this.callbacks.onCloseAllOpenedImages();
    });

    this.disposables.addEventListener(this.elements.imageViewerMenuItem, 'click', () => {
      if (this.elements.imageViewerMenuItem.disabled) {
        return;
      }

      this.topMenuController.closeAll();
      this.callbacks.onViewerModeChange('image');
    });

    this.disposables.addEventListener(this.elements.panoramaViewerMenuItem, 'click', () => {
      if (this.elements.panoramaViewerMenuItem.disabled) {
        return;
      }

      this.topMenuController.closeAll();
      this.callbacks.onViewerModeChange('panorama');
    });

    this.disposables.addEventListener(this.elements.windowNormalMenuItem, 'click', () => {
      this.topMenuController.closeAll();
      void this.windowPreviewController.setEnabled(false);
    });

    this.disposables.addEventListener(this.elements.windowFullScreenPreviewMenuItem, 'click', () => {
      if (this.elements.windowFullScreenPreviewMenuItem.disabled) {
        return;
      }

      this.topMenuController.closeAll();
      void this.windowPreviewController.setEnabled(true);
    });

    this.disposables.addEventListener(this.elements.windowToolbarMenuItem, 'click', () => {
      this.setDisplayToolbarVisible(this.elements.displayToolbar.classList.contains('hidden'));
      this.topMenuController.closeAll();
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
      void this.handleFolderSelected(files);
      input.value = '';
    });

    this.bindResetViewButton(this.elements.resetViewButton);
    this.bindResetViewButton(this.elements.toolbarResetViewButton);

    this.disposables.addEventListener(this.elements.resetSettingsButton, 'click', () => {
      this.layoutSplitController.resetToDefaults();
      this.callbacks.onResetSettings();
    });

    this.disposables.addEventListener(this.elements.clearRoiButton, 'click', () => {
      if (this.elements.clearRoiButton.disabled) {
        return;
      }

      this.callbacks.onClearRoi();
    });
  }

  private bindResetViewButton(button: HTMLButtonElement): void {
    this.disposables.addEventListener(button, 'click', () => {
      if (button.disabled) {
        return;
      }

      this.callbacks.onResetView();
    });
  }

  private setDisplayToolbarVisible(visible: boolean, persist = true): void {
    this.elements.displayToolbar.classList.toggle('hidden', !visible);
    this.elements.windowToolbarMenuItem.setAttribute('aria-checked', visible ? 'true' : 'false');
    if (persist) {
      saveStoredDisplayToolbarVisible(visible);
    }
  }
}

function toFiles(files: FileList | null | undefined): File[] {
  if (!files) {
    return [];
  }
  return Array.from(files);
}

function readStoredDisplayToolbarVisible(): boolean {
  try {
    return window.localStorage.getItem(DISPLAY_TOOLBAR_VISIBLE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveStoredDisplayToolbarVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(DISPLAY_TOOLBAR_VISIBLE_STORAGE_KEY, String(visible));
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime toolbar state anyway.
  }
}
