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
import {
  clampScreenshotSelectionRect,
  createDefaultScreenshotSelectionRect,
  type ScreenshotSelectionHandle
} from '../interaction/screenshot-selection';
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
  ExportImagePreviewRequest,
  ExportImageRequest,
  ExportImageTarget,
  ExportScreenshotRegion,
  ImageRoi,
  OpenedImageDropPlacement,
  PixelSample,
  RoiStats,
  StokesAolpDegreeModulationMode,
  ViewerKeyboardNavigationInput,
  ViewerMode,
  ViewportInfo,
  ViewportRect,
  VisualizationMode
} from '../types';
import type { ProbeColorPreview } from '../probe';
import { ProbeReadoutController, type ProbeCoordinateImageSize } from './probe-readout';
import { setRoiReadout } from './roi-readout';
import { ThemeController } from './theme-controller';
import { TopBarTooltipController } from './top-bar-tooltip-controller';
import { TopMenuController } from './top-menu-controller';
import { ViewerBackgroundController } from './viewer-background-controller';
import { WindowPreviewController } from './window-preview-controller';
import type { ViewportClientRect } from '../interaction/image-geometry';
import type { ThemeId } from '../theme';
import {
  DEFAULT_FOLDER_LOAD_LIMITS,
  createFolderLoadAdmission,
  getFolderLoadStats
} from '../folder-load-limits';

const DISPLAY_TOOLBAR_VISIBLE_STORAGE_KEY = 'openexr-viewer:display-toolbar-visible:v1';
const AUTO_FIT_IMAGE_ON_SELECT_STORAGE_KEY = 'openexr-viewer:auto-fit-image-on-select:v1';

export interface UiCallbacks {
  onOpenFileClick: () => void;
  onOpenFolderClick: () => void;
  onExportImage: (request: ExportImageRequest) => Promise<void>;
  onResolveExportImagePreview: (
    request: ExportImagePreviewRequest,
    signal: AbortSignal
  ) => Promise<ExportImagePixels>;
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
  onViewerKeyboardNavigationInputChange: (input: ViewerKeyboardNavigationInput) => void;
  onAutoFitImageOnSelectChange: (enabled: boolean) => void;
  onAutoFitImage: () => void;
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
  private readonly topBarTooltipController: TopBarTooltipController;
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
  private readonly themeController: ThemeController;
  private readonly viewerBackgroundController: ViewerBackgroundController;
  private isLoading = false;
  private isDisplayBusy = false;
  private isDisplayOverlayLoading = false;
  private openedImageCount = 0;
  private activeSessionId: string | null = null;
  private exportTarget: ExportImageTarget | null = null;
  private screenshotSelection: { rect: ViewportRect; hoverHandle: ScreenshotSelectionHandle | null } | null = null;
  private lastScreenshotSelectionRect: ViewportRect | null = null;
  private lastScreenshotOutputSize: { width: number; height: number } | null = null;
  private screenshotSelectionResizeActive = false;
  private screenshotSelectionSquareSnapped = false;
  private includeSplitRgbChannels = false;
  private channelThumbnailItems: ChannelThumbnailOptionItem[] = [];
  private rgbGroupChannelNames: string[] = [];
  private currentChannelSelection: DisplaySelection | null = null;
  private viewerMode: ViewerMode = 'image';
  private autoFitImageOnSelect = false;
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
    this.topBarTooltipController = new TopBarTooltipController(this.elements);
    this.topMenuController = new TopMenuController(this.elements, {
      onBeforeOpenMenu: () => {
        this.clearViewerKeyboardNavigationInput();
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
        this.exportImageDialog.cancel(restoreFocus);
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
      isScreenshotSelectionActive: () => this.isScreenshotSelectionActive(),
      cancelScreenshotSelection: () => {
        this.cancelScreenshotSelection();
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
      onViewerKeyboardNavigationInputChange: (input) => {
        this.callbacks.onViewerKeyboardNavigationInputChange(input);
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
      onExportImage: async (request) => {
        await this.callbacks.onExportImage(request);
        if (request.mode === 'screenshot') {
          this.hideScreenshotSelection();
        }
      },
      onCancel: (target) => {
        if (target?.kind === 'screenshot') {
          this.hideScreenshotSelection();
        }
      },
      onScreenshotOutputSizeChange: (size) => {
        this.lastScreenshotOutputSize = { ...size };
      },
      onResolveExportImagePreview: (request, signal) => {
        return this.callbacks.onResolveExportImagePreview(request, signal);
      }
    });
    this.exportImageBatchDialog = new ExportImageBatchDialogController(this.elements, {
      onExportImageBatch: async (request, signal) => {
        await this.callbacks.onExportImageBatch(request, signal);
        if (request.entries.some((entry) => entry.mode === 'screenshot')) {
          this.hideScreenshotSelection();
        }
      },
      onResolveExportImageBatchPreview: (request, signal) => {
        return this.callbacks.onResolveExportImageBatchPreview(request, signal);
      },
      onCancel: (mode) => {
        if (mode === 'screenshot') {
          this.hideScreenshotSelection();
        }
      },
      onScreenshotOutputSizeChange: (size) => {
        this.lastScreenshotOutputSize = { ...size };
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
    this.viewerBackgroundController = new ViewerBackgroundController({
      appShell: this.elements.appShell,
      mainLayout: this.elements.mainLayout,
      viewerContainer: this.elements.viewerContainer,
      spectrumLatticeCanvas: this.elements.spectrumLatticeCanvas
    });
    this.themeController = new ThemeController(this.elements, {
      onThemeChange: (theme) => {
        this.viewerBackgroundController.setTheme(theme);
      }
    });
    this.disposables.addDisposable(this.loadingOverlayDisclosure);
    this.disposables.addDisposable(this.openedImagesPanel);
    this.disposables.addDisposable(this.layerPanel);
    this.disposables.addDisposable(this.channelPanel);
    this.disposables.addDisposable(this.channelThumbnailStrip);
    this.disposables.addDisposable(this.colormapPanel);
    this.disposables.addDisposable(this.layoutSplitController);
    this.disposables.addDisposable(this.topBarTooltipController);
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
    this.disposables.addDisposable(this.viewerBackgroundController);
    this.disposables.addDisposable(this.themeController);
    this.clearImageBrowserPanels();
    this.setViewerMode('image');
    this.setAutoFitImageOnSelect(readStoredAutoFitImageOnSelect(), false);
    this.callbacks.onAutoFitImageOnSelectChange(this.autoFitImageOnSelect);
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

    this.clearViewerKeyboardNavigationInput();
    this.exportImageDialog.close(false);
    this.exportImageBatchDialog.close(false);
    this.exportColormapDialog.close(false);
    this.clearScreenshotSelectionMemory();
    this.hideScreenshotSelection();
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
    if (this.isLoading === loading) {
      return;
    }

    this.isLoading = loading;
    if (loading) {
      this.clearViewerKeyboardNavigationInput();
      this.hideScreenshotSelection();
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

  setAutoFitImageOnSelect(enabled: boolean, persist = false): void {
    if (this.disposed) {
      return;
    }

    this.autoFitImageOnSelect = enabled;
    this.elements.appAutoFitImageButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    if (persist) {
      saveStoredAutoFitImageOnSelect(enabled);
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
    if (displayBusy) {
      this.hideScreenshotSelection();
    }
    this.channelPanel.setRgbViewLoading(displayBusy);
    if (this.hasActiveChannelImage) {
      this.renderChannelViewControls();
    }
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

  setTheme(theme: ThemeId, persist = true): void {
    if (this.disposed) {
      return;
    }

    this.themeController.setTheme(theme, { persist });
  }

  setViewerViewportRect(rect: ViewportClientRect): void {
    if (this.disposed) {
      return;
    }

    this.viewerBackgroundController.setViewportRect(rect);
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

    if (this.viewerMode !== mode) {
      this.hideScreenshotSelection();
      this.clearViewerKeyboardNavigationInput();
    }
    this.viewerMode = mode;
    this.elements.imageViewerMenuItem.setAttribute('aria-checked', mode === 'image' ? 'true' : 'false');
    this.elements.panoramaViewerMenuItem.setAttribute('aria-checked', mode === 'panorama' ? 'true' : 'false');
    this.updateAutoFitImageButtonDisabled();
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
      this.clearViewerKeyboardNavigationInput();
      this.clearScreenshotSelectionMemory();
      this.hideScreenshotSelection();
    }
    this.activeSessionId = activeId;
    this.openedImageCount = items.length;
    this.openedImagesPanel.setOpenedImageOptions(items, activeId);
    this.colormapPanel.setOpenedImageCount(this.openedImagesPanel.getOpenedImageCount());
    this.windowPreviewController.setOpenedImageCount(items.length);
    this.viewerBackgroundController.setHasOpenImages(items.length > 0);
    this.updateViewerModeMenuItemsDisabled();
    this.updateFileMenuItemsDisabled();
    if (items.length === 0 && this.windowPreviewController.isActive()) {
      void this.windowPreviewController.setEnabled(false);
    }
    if (items.length === 0) {
      this.setViewerMode('image');
    }
    if (this.screenshotSelection) {
      this.renderScreenshotSelectionOverlay();
    }
  }

  setExportTarget(target: ExportImageTarget | null): void {
    if (this.disposed) {
      return;
    }

    this.exportTarget = target ? { ...target } : null;
    this.exportImageDialog.setTarget(target);
    this.updateFileMenuItemsDisabled();
  }

  getScreenshotSelectionInteractionState(): { active: boolean; rect: ViewportRect | null } {
    return {
      active: this.screenshotSelection !== null,
      rect: this.screenshotSelection ? { ...this.screenshotSelection.rect } : null
    };
  }

  setScreenshotSelectionRect(rect: ViewportRect, options: { squareSnapped?: boolean } = {}): void {
    if (this.disposed || !this.screenshotSelection) {
      return;
    }

    const viewport = this.readViewerViewport();
    const previousRect = this.screenshotSelection.rect;
    const nextRect = clampScreenshotSelectionRect(rect, viewport);
    if (!sameViewportRectSize(previousRect, nextRect)) {
      this.lastScreenshotOutputSize = null;
    }
    this.screenshotSelection = {
      ...this.screenshotSelection,
      rect: nextRect
    };
    if (options.squareSnapped !== undefined) {
      this.screenshotSelectionSquareSnapped = options.squareSnapped;
    }
    this.lastScreenshotSelectionRect = { ...nextRect };
    this.renderScreenshotSelectionOverlay();
  }

  setScreenshotSelectionHandle(handle: ScreenshotSelectionHandle | null): void {
    if (this.disposed || !this.screenshotSelection || this.screenshotSelection.hoverHandle === handle) {
      return;
    }

    this.screenshotSelection = {
      ...this.screenshotSelection,
      hoverHandle: handle
    };
    this.renderScreenshotSelectionCursor();
  }

  setScreenshotSelectionResizeActive(active: boolean): void {
    if (this.disposed || this.screenshotSelectionResizeActive === active) {
      return;
    }

    this.screenshotSelectionResizeActive = active;
    if (active && this.screenshotSelection) {
      this.renderScreenshotSelectionOverlay();
    } else {
      this.screenshotSelectionSquareSnapped = false;
      this.elements.screenshotSelectionSize.classList.add('hidden');
      this.renderScreenshotSelectionSquareSnapFeedback();
    }
  }

  setScreenshotSelectionSquareSnapActive(active: boolean): void {
    if (this.disposed || this.screenshotSelectionSquareSnapped === active) {
      return;
    }

    this.screenshotSelectionSquareSnapped = active;
    if (this.screenshotSelectionResizeActive && this.screenshotSelection) {
      this.renderScreenshotSelectionOverlay();
    } else {
      this.renderScreenshotSelectionSquareSnapFeedback();
    }
  }

  isScreenshotSelectionActive(): boolean {
    return this.screenshotSelection !== null;
  }

  cancelScreenshotSelection(): void {
    this.hideScreenshotSelection();
  }

  private clearScreenshotSelectionMemory(): void {
    this.lastScreenshotSelectionRect = null;
    this.lastScreenshotOutputSize = null;
  }

  private hideScreenshotSelection(): void {
    this.elements.appShell.classList.remove('is-screenshot-selecting');
    if (!this.screenshotSelection) {
      return;
    }

    this.screenshotSelection = null;
    this.screenshotSelectionResizeActive = false;
    this.screenshotSelectionSquareSnapped = false;
    this.elements.screenshotSelectionOverlay.classList.add('hidden');
    this.elements.screenshotSelectionSize.classList.add('hidden');
    this.renderScreenshotSelectionSquareSnapFeedback();
    this.elements.viewerContainer.classList.remove(
      'is-screenshot-selecting',
      'is-screenshot-handle-move',
      'is-screenshot-handle-edge-n',
      'is-screenshot-handle-edge-e',
      'is-screenshot-handle-edge-s',
      'is-screenshot-handle-edge-w',
      'is-screenshot-handle-corner-nw',
      'is-screenshot-handle-corner-ne',
      'is-screenshot-handle-corner-se',
      'is-screenshot-handle-corner-sw'
    );
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

  private clearViewerKeyboardNavigationInput(): void {
    this.globalKeyboardController.clearViewerKeyboardNavigationInput();
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

  private startScreenshotSelectionFromAction(): void {
    if (this.elements.exportScreenshotButton.disabled) {
      return;
    }

    this.clearViewerKeyboardNavigationInput();
    this.topMenuController.closeAll();
    this.startScreenshotSelection();
  }

  private startScreenshotSelection(): void {
    if (this.disposed || this.openedImageCount === 0 || this.isLoading || this.isDisplayBusy) {
      return;
    }

    const viewport = this.readViewerViewport();
    const previousRect = this.lastScreenshotSelectionRect;
    const rect = this.lastScreenshotSelectionRect
      ? clampScreenshotSelectionRect(this.lastScreenshotSelectionRect, viewport)
      : createDefaultScreenshotSelectionRect(viewport);
    if (previousRect && !sameViewportRectSize(previousRect, rect)) {
      this.lastScreenshotOutputSize = null;
    }
    this.screenshotSelection = {
      rect,
      hoverHandle: null
    };
    this.screenshotSelectionResizeActive = false;
    this.screenshotSelectionSquareSnapped = false;
    this.lastScreenshotSelectionRect = { ...rect };
    this.exportImageDialog.close(false);
    this.exportImageBatchDialog.close(false);
    this.exportColormapDialog.close(false);
    this.topMenuController.closeAll(false);
    this.elements.screenshotSelectionOverlay.classList.remove('hidden');
    this.elements.appShell.classList.add('is-screenshot-selecting');
    this.elements.viewerContainer.classList.add('is-screenshot-selecting');
    this.renderScreenshotSelectionOverlay();
  }

  private openScreenshotExportDialog(): void {
    if (!this.screenshotSelection || this.elements.exportScreenshotButton.disabled) {
      return;
    }

    const region = this.resolveScreenshotExportRegion();
    if (!region) {
      return;
    }
    this.exportImageDialog.openDialog({
      filename: buildScreenshotExportFilename(this.exportTarget?.filename ?? 'image.png'),
      kind: 'screenshot',
      rect: region.rect,
      sourceViewport: region.sourceViewport,
      outputWidth: region.outputWidth,
      outputHeight: region.outputHeight
    });
  }

  private openScreenshotBatchExportDialog(): void {
    if (!this.screenshotSelection || this.elements.screenshotSelectionExportBatchButton.disabled) {
      return;
    }

    const region = this.resolveScreenshotExportRegion();
    if (!region) {
      return;
    }
    this.exportImageDialog.close(false);
    this.exportColormapDialog.close(false);
    this.exportImageBatchDialog.openDialog({
      mode: 'screenshot',
      screenshot: region
    });
  }

  private resolveScreenshotExportRegion(): ExportScreenshotRegion | null {
    if (!this.screenshotSelection) {
      return null;
    }

    const viewport = this.readViewerViewport();
    const previousRect = this.screenshotSelection.rect;
    const rect = clampScreenshotSelectionRect(this.screenshotSelection.rect, viewport);
    if (!sameViewportRectSize(previousRect, rect)) {
      this.lastScreenshotOutputSize = null;
    }
    this.screenshotSelection = {
      ...this.screenshotSelection,
      rect
    };
    this.lastScreenshotSelectionRect = { ...rect };
    const outputSize = this.lastScreenshotOutputSize ?? {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    };

    return {
      rect,
      sourceViewport: viewport,
      outputWidth: outputSize.width,
      outputHeight: outputSize.height
    };
  }

  private renderScreenshotSelectionOverlay(): void {
    const selection = this.screenshotSelection;
    if (!selection) {
      return;
    }

    const viewport = this.readViewerViewport();
    const previousRect = selection.rect;
    const rect = clampScreenshotSelectionRect(selection.rect, viewport);
    if (!sameViewportRectSize(previousRect, rect)) {
      this.lastScreenshotOutputSize = null;
    }
    this.screenshotSelection = { ...selection, rect };
    this.lastScreenshotSelectionRect = { ...rect };
    const right = Math.max(0, viewport.width - rect.x - rect.width);
    const bottom = Math.max(0, viewport.height - rect.y - rect.height);

    setBoxStyle(this.elements.screenshotSelectionMaskTop, 0, 0, viewport.width, rect.y);
    setBoxStyle(this.elements.screenshotSelectionMaskRight, rect.x + rect.width, rect.y, right, rect.height);
    setBoxStyle(this.elements.screenshotSelectionMaskBottom, 0, rect.y + rect.height, viewport.width, bottom);
    setBoxStyle(this.elements.screenshotSelectionMaskLeft, 0, rect.y, rect.x, rect.height);
    setBoxStyle(this.elements.screenshotSelectionBox, rect.x, rect.y, rect.width, rect.height);
    this.renderScreenshotSelectionSize(rect, viewport);
    this.renderScreenshotSelectionSquareSnapFeedback();

    const controlsWidth = this.elements.screenshotSelectionControls.offsetWidth || 244;
    const controlsHeight = this.elements.screenshotSelectionControls.offsetHeight || 34;
    const controlsX = Math.min(
      Math.max(8, rect.x + rect.width - controlsWidth),
      Math.max(8, viewport.width - controlsWidth - 8)
    );
    const belowY = rect.y + rect.height + 8;
    const controlsY = belowY + controlsHeight <= viewport.height
      ? belowY
      : Math.max(8, rect.y - controlsHeight - 8);
    setBoxStyle(this.elements.screenshotSelectionControls, controlsX, controlsY, controlsWidth, controlsHeight);
    this.renderScreenshotSelectionCursor();
  }

  private renderScreenshotSelectionSize(rect: ViewportRect, viewport: ViewportInfo): void {
    const sizeElement = this.elements.screenshotSelectionSize;
    if (!this.screenshotSelectionResizeActive) {
      sizeElement.classList.add('hidden');
      sizeElement.classList.remove('is-square-snapped');
      return;
    }

    const squareSnapped = this.shouldShowScreenshotSelectionSquareSnapFeedback();
    const prefix = squareSnapped ? '1:1 · ' : '';
    sizeElement.textContent =
      `${prefix}${Math.max(1, Math.round(rect.width))} x ${Math.max(1, Math.round(rect.height))}`;
    sizeElement.classList.toggle('is-square-snapped', squareSnapped);
    sizeElement.classList.remove('hidden');
    const labelWidth = sizeElement.offsetWidth || 72;
    const labelHeight = sizeElement.offsetHeight || 24;
    const x = clamp(
      rect.x + (rect.width - labelWidth) * 0.5,
      8,
      Math.max(8, viewport.width - labelWidth - 8)
    );
    const outsideTop = rect.y - labelHeight - 8;
    const y = outsideTop >= 8
      ? outsideTop
      : clamp(rect.y + 8, 8, Math.max(8, viewport.height - labelHeight - 8));
    setPositionStyle(sizeElement, x, y);
  }

  private renderScreenshotSelectionSquareSnapFeedback(): void {
    const active = this.shouldShowScreenshotSelectionSquareSnapFeedback();
    this.elements.screenshotSelectionBox.classList.toggle('is-square-snapped', active);
    this.elements.screenshotSelectionSize.classList.toggle('is-square-snapped', active);
  }

  private shouldShowScreenshotSelectionSquareSnapFeedback(): boolean {
    return this.screenshotSelectionResizeActive && this.screenshotSelectionSquareSnapped;
  }

  private renderScreenshotSelectionCursor(): void {
    const handle = this.screenshotSelection?.hoverHandle ?? null;
    const handleClassNames = [
      'is-screenshot-handle-move',
      'is-screenshot-handle-edge-n',
      'is-screenshot-handle-edge-e',
      'is-screenshot-handle-edge-s',
      'is-screenshot-handle-edge-w',
      'is-screenshot-handle-corner-nw',
      'is-screenshot-handle-corner-ne',
      'is-screenshot-handle-corner-se',
      'is-screenshot-handle-corner-sw'
    ];

    this.elements.viewerContainer.classList.toggle('is-screenshot-selecting', this.screenshotSelection !== null);
    this.elements.viewerContainer.classList.remove(...handleClassNames);
    if (handle) {
      this.elements.viewerContainer.classList.add(`is-screenshot-handle-${handle}`);
    }
  }

  private readViewerViewport(): ViewportInfo {
    const rect = this.elements.viewerContainer.getBoundingClientRect();
    return {
      width: Math.max(1, Math.floor(Number.isFinite(rect.width) ? rect.width : 1)),
      height: Math.max(1, Math.floor(Number.isFinite(rect.height) ? rect.height : 1))
    };
  }

  private updateFileMenuItemsDisabled(): void {
    if (this.disposed) {
      return;
    }

    const hasExportTarget = this.exportImageDialog.hasTarget();
    const screenshotDisabledByDisplayBusy = !this.isLoading && this.isDisplayBusy && hasExportTarget;

    this.elements.exportImageButton.disabled = this.isLoading || this.isDisplayBusy || !hasExportTarget;
    this.elements.exportScreenshotButton.disabled =
      this.isLoading || this.isDisplayBusy || !hasExportTarget;
    this.elements.appScreenshotButton.disabled = this.elements.exportScreenshotButton.disabled;
    this.elements.appScreenshotButton.classList.toggle('is-display-busy-disabled', screenshotDisabledByDisplayBusy);
    if (screenshotDisabledByDisplayBusy) {
      this.elements.appScreenshotButton.setAttribute('aria-busy', 'true');
    } else {
      this.elements.appScreenshotButton.removeAttribute('aria-busy');
    }
    this.elements.exportImageBatchButton.disabled =
      this.isLoading || this.isDisplayBusy || !this.exportImageBatchDialog.hasTarget();
    this.elements.screenshotSelectionExportBatchButton.disabled = this.elements.exportImageBatchButton.disabled;
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

  private updateAutoFitImageButtonDisabled(): void {
    if (this.disposed) {
      return;
    }

    this.elements.appAutoFitImageButton.disabled = this.viewerMode === 'panorama';
  }

  private bindEvents(): void {
    this.disposables.addEventListener(document, 'pointerdown', this.onScreenshotSelectionPointerGuard, {
      capture: true
    });
    this.disposables.addEventListener(document, 'mousedown', this.onScreenshotSelectionPointerGuard, {
      capture: true
    });
    this.disposables.addEventListener(document, 'click', this.onScreenshotSelectionPointerGuard, {
      capture: true
    });
    this.disposables.addEventListener(document, 'dblclick', this.onScreenshotSelectionPointerGuard, {
      capture: true
    });
    this.disposables.addEventListener(document, 'contextmenu', this.onScreenshotSelectionPointerGuard, {
      capture: true
    });
    this.disposables.addEventListener(document, 'keydown', this.onScreenshotSelectionKeyboardGuard, {
      capture: true
    });

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

      this.clearViewerKeyboardNavigationInput();
      this.exportImageBatchDialog.close(false);
      this.exportColormapDialog.close(false);
      this.topMenuController.closeAll();
      this.exportImageDialog.openDialog();
    });

    this.disposables.addEventListener(this.elements.exportScreenshotButton, 'click', () => {
      this.startScreenshotSelectionFromAction();
    });

    this.disposables.addEventListener(this.elements.appScreenshotButton, 'click', () => {
      this.startScreenshotSelectionFromAction();
    });

    this.disposables.addEventListener(this.elements.appAutoFitImageButton, 'mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
    });

    this.disposables.addEventListener(this.elements.appAutoFitImageButton, 'click', (event) => {
      if (this.elements.appAutoFitImageButton.disabled) {
        return;
      }

      const enabled = !this.autoFitImageOnSelect;
      this.setAutoFitImageOnSelect(enabled, true);
      this.callbacks.onAutoFitImageOnSelectChange(enabled);
      if (enabled) {
        this.callbacks.onAutoFitImage();
      }
      if (event.detail > 0) {
        this.elements.appAutoFitImageButton.blur();
      }
    });

    this.disposables.addEventListener(this.elements.screenshotSelectionCancelButton, 'click', () => {
      this.cancelScreenshotSelection();
    });

    this.disposables.addEventListener(this.elements.screenshotSelectionExportButton, 'click', () => {
      this.openScreenshotExportDialog();
    });

    this.disposables.addEventListener(this.elements.screenshotSelectionExportBatchButton, 'click', () => {
      this.openScreenshotBatchExportDialog();
    });

    this.disposables.addEventListener(this.elements.exportImageBatchButton, 'click', () => {
      if (this.elements.exportImageBatchButton.disabled) {
        return;
      }

      this.clearViewerKeyboardNavigationInput();
      this.exportImageDialog.close(false);
      this.exportColormapDialog.close(false);
      this.topMenuController.closeAll();
      this.exportImageBatchDialog.openDialog();
    });

    this.disposables.addEventListener(this.elements.exportColormapButton, 'click', () => {
      if (this.elements.exportColormapButton.disabled) {
        return;
      }

      this.clearViewerKeyboardNavigationInput();
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
      this.themeController.reset();
      this.callbacks.onResetSettings();
    });

    this.disposables.addEventListener(this.elements.clearRoiButton, 'click', () => {
      if (this.elements.clearRoiButton.disabled) {
        return;
      }

      this.callbacks.onClearRoi();
    });
  }

  private readonly onScreenshotSelectionPointerGuard = (event: Event): void => {
    if (!this.screenshotSelection || this.isAllowedScreenshotSelectionTarget(event.target)) {
      return;
    }

    this.blockScreenshotSelectionEvent(event);
  };

  private readonly onScreenshotSelectionKeyboardGuard = (event: KeyboardEvent): void => {
    if (
      !this.screenshotSelection ||
      event.key === 'Escape' ||
      this.isAllowedScreenshotSelectionTarget(event.target)
    ) {
      return;
    }

    this.blockScreenshotSelectionEvent(event);
  };

  private isAllowedScreenshotSelectionTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) {
      return false;
    }

    if (target instanceof HTMLAnchorElement && target.hasAttribute('download')) {
      return true;
    }

    return (
      this.elements.viewerContainer.contains(target) ||
      (this.exportImageDialog.isOpen() && this.elements.exportDialogBackdrop.contains(target)) ||
      (this.exportImageBatchDialog.isOpen() && this.elements.exportBatchDialogBackdrop.contains(target))
    );
  }

  private blockScreenshotSelectionEvent(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
    this.topMenuController.closeAll(false);
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

function setBoxStyle(element: HTMLElement, x: number, y: number, width: number, height: number): void {
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.width = `${Math.max(0, width)}px`;
  element.style.height = `${Math.max(0, height)}px`;
}

function setPositionStyle(element: HTMLElement, x: number, y: number): void {
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sameViewportRectSize(a: ViewportRect, b: ViewportRect): boolean {
  return a.width === b.width && a.height === b.height;
}

function buildScreenshotExportFilename(filename: string): string {
  const normalized = filename.toLocaleLowerCase().endsWith('.png') ? filename : `${filename}.png`;
  return normalized.replace(/\.png$/i, '-screenshot.png');
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

function readStoredAutoFitImageOnSelect(): boolean {
  try {
    return window.localStorage.getItem(AUTO_FIT_IMAGE_ON_SELECT_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveStoredAutoFitImageOnSelect(enabled: boolean): void {
  try {
    window.localStorage.setItem(AUTO_FIT_IMAGE_ON_SELECT_STORAGE_KEY, String(enabled));
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime state anyway.
  }
}
