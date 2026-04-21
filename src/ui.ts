import { ColormapLut, sampleColormapRgbBytes } from './colormaps';
import {
  DisplayChannelMapping,
  DisplaySelection,
  DisplayLuminanceRange,
  ExrMetadataEntry,
  PixelSample,
  VisualizationMode
} from './types';
import { ProbeColorPreview, ProbeDisplayValue } from './probe';
import {
  buildChannelDisplayOptions,
  buildZeroCenteredColormapRange,
  areDisplayChannelsAvailable,
  extractRgbChannelGroups,
  findMergedSelectionForSplitDisplay,
  findSelectedChannelDisplayOption,
  findSelectedStokesDisplayOption,
  findSplitSelectionForMergedDisplay,
  formatScientific,
  getStokesDisplayOptions
} from './state';

const OPENED_IMAGES_MAX_VISIBLE_ROWS = 10;
const CHANNEL_OPTIONS_MAX_VISIBLE_ROWS = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE = 1e-16;
const COLORMAP_GRADIENT_STOP_COUNT = 16;
const DEFAULT_COLORMAP_GRADIENT = 'linear-gradient(90deg, #d95656 0%, #05070a 50%, #59d884 100%)';
const PANEL_SPLIT_STORAGE_KEY = 'openexr-viewer:panel-splits:v1';
const PANEL_SPLIT_KEYBOARD_STEP = 16;
const PANEL_SPLIT_KEYBOARD_LARGE_STEP = 64;
const IMAGE_PANEL_MIN_WIDTH = 160;
const IMAGE_PANEL_MAX_WIDTH = 420;
const RIGHT_PANEL_MIN_WIDTH = 240;
const RIGHT_PANEL_MAX_WIDTH = 520;
const VIEWER_MIN_WIDTH = 360;
const LOADING_OVERLAY_SUBTLE_DELAY_MS = 200;
const LOADING_OVERLAY_DARKENING_DELAY_MS = 1000;
const LOADING_OVERLAY_MESSAGE_DELAY_MS = 1500;
const LOADING_OVERLAY_SUBTLE_CLASS = 'loading-overlay--subtle';
const LOADING_OVERLAY_DARKENING_CLASS = 'loading-overlay--darkening';
const LOADING_OVERLAY_MESSAGE_CLASS = 'loading-overlay--message';
const DEFAULT_PANEL_SPLIT_SIZES = {
  imagePanelWidth: 220,
  rightPanelWidth: 320
};

export type LoadingOverlayPhase = 'hidden' | 'subtle' | 'darkening' | 'message';

export class ProgressiveLoadingOverlayDisclosure {
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

export interface UiCallbacks {
  onOpenFileClick: () => void;
  onFileSelected: (file: File) => void;
  onFilesDropped: (files: File[]) => void;
  onGalleryImageSelected: (galleryId: string) => void;
  onReloadAllOpenedImages: () => void;
  onReloadSelectedOpenedImage: (sessionId: string) => void;
  onCloseSelectedOpenedImage: (sessionId: string) => void;
  onCloseAllOpenedImages: () => void;
  onOpenedImageSelected: (sessionId: string) => void;
  onReorderOpenedImage: (draggedSessionId: string, targetSessionId: string) => void;
  onDisplayCacheBudgetChange: (mb: number) => void;
  onToggleOpenedImagePin: (sessionId: string) => void;
  onExposureChange: (value: number) => void;
  onLayerChange: (layerIndex: number) => void;
  onRgbGroupChange: (mapping: DisplaySelection) => void;
  onVisualizationModeChange: (mode: VisualizationMode) => void;
  onColormapChange: (colormapId: string) => void;
  onColormapRangeChange: (range: DisplayLuminanceRange) => void;
  onColormapAutoRange: () => void;
  onColormapZeroCenterToggle: () => void;
  onStokesDegreeModulationToggle: () => void;
  onResetView: () => void;
}

interface Elements {
  mainLayout: HTMLElement;
  rightStack: HTMLElement;
  sidePanel: HTMLElement;
  imagePanel: HTMLElement;
  imagePanelResizer: HTMLElement;
  rightPanelResizer: HTMLElement;
  fileMenuButton: HTMLButtonElement;
  fileMenu: HTMLElement;
  galleryMenuButton: HTMLButtonElement;
  galleryMenu: HTMLElement;
  settingsMenuButton: HTMLButtonElement;
  settingsMenu: HTMLElement;
  galleryCboxRgbButton: HTMLButtonElement;
  openFileButton: HTMLButtonElement;
  fileInput: HTMLInputElement;
  resetViewButton: HTMLButtonElement;
  visualizationNoneButton: HTMLButtonElement;
  colormapToggleButton: HTMLButtonElement;
  colormapRangeControl: HTMLDivElement;
  colormapSelect: HTMLSelectElement;
  stokesDegreeModulationControl: HTMLDivElement;
  stokesDegreeModulationButton: HTMLButtonElement;
  colormapAutoRangeButton: HTMLButtonElement;
  colormapZeroCenterButton: HTMLButtonElement;
  colormapRangeSlider: HTMLDivElement;
  colormapVminSlider: HTMLInputElement;
  colormapVmaxSlider: HTMLInputElement;
  colormapVminInput: HTMLInputElement;
  colormapVmaxInput: HTMLInputElement;
  exposureControl: HTMLDivElement;
  exposureSlider: HTMLInputElement;
  exposureValue: HTMLInputElement;
  errorBanner: HTMLDivElement;
  viewerContainer: HTMLElement;
  dropOverlay: HTMLDivElement;
  loadingOverlay: HTMLDivElement;
  openedImagesSelect: HTMLSelectElement;
  openedFilesToggle: HTMLButtonElement;
  openedFilesList: HTMLElement;
  openedFilesCount: HTMLElement;
  displayCacheControl: HTMLDivElement;
  displayCacheBudgetInput: HTMLSelectElement;
  displayCacheUsage: HTMLElement;
  reloadAllOpenedImagesButton: HTMLButtonElement;
  closeAllOpenedImagesButton: HTMLButtonElement;
  layerControl: HTMLDivElement;
  layerSelect: HTMLSelectElement;
  partsLayersToggle: HTMLButtonElement;
  partsLayersList: HTMLElement;
  partsLayersCount: HTMLElement;
  rgbSplitToggleButton: HTMLButtonElement;
  rgbGroupSelect: HTMLSelectElement;
  channelViewToggle: HTMLButtonElement;
  channelViewList: HTMLElement;
  channelViewCount: HTMLElement;
  probeMode: HTMLElement;
  probeCoords: HTMLElement;
  probeColorPreview: HTMLDivElement;
  probeColorSwatch: HTMLElement;
  probeColorValues: HTMLElement;
  probeValues: HTMLElement;
  probeMetadata: HTMLElement;
  glCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
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
  pinned?: boolean;
}

export interface LayerOptionItem {
  index: number;
  label: string;
  channelCount?: number;
  selectable?: boolean;
}

interface ChannelViewRowItem {
  value: string;
  label: string;
  meta: string;
  swatches: string[];
}

export interface PanelSplitSizes {
  imagePanelWidth: number;
  rightPanelWidth: number;
}

export interface PanelSplitMetrics {
  mainWidth: number;
  imageResizerWidth: number;
  rightResizerWidth: number;
}

export type PanelSplitSizeKey = keyof PanelSplitSizes;

export type PanelSplitKeyboardAction =
  | { type: 'delta'; delta: number }
  | { type: 'snap'; target: 'min' | 'max' };

interface PanelResizeDragState {
  key: PanelSplitSizeKey;
  pointerId: number;
  startX: number;
  startY: number;
  startSizes: PanelSplitSizes;
  resizer: HTMLElement;
}

interface ProbeCoordinateImageSize {
  width: number;
  height: number;
}

interface TopMenuElements {
  button: HTMLButtonElement;
  menu: HTMLElement;
}

export class ViewerUi {
  private readonly elements: Elements;
  private readonly rgbGroupMappings = new Map<string, DisplaySelection>();
  private readonly panelSplitResizeObserver: ResizeObserver;
  private readonly loadingOverlayDisclosure: ProgressiveLoadingOverlayDisclosure;
  private isLoading = false;
  private isRgbViewLoading = false;
  private openedImageCount = 0;
  private hasMultipleLayers = false;
  private openedImagesActiveId: string | null = null;
  private openedImageItems: OpenedImageOptionItem[] = [];
  private layerItems: LayerOptionItem[] = [];
  private activeLayerIndex = 0;
  private channelViewItems: ChannelViewRowItem[] = [];
  private restoreRgbGroupFocusAfterLoading = false;
  private suppressOpenedImageSelectionUntilMs = 0;
  private openedImageDragState:
    | {
        sessionId: string;
        startY: number;
        lastTargetSessionId: string | null;
        isDragging: boolean;
      }
    | null = null;
  private restoreOpenedFilesFocusAfterLoading = false;
  private restoreChannelViewFocusAfterLoading = false;
  private hasRgbGroups = false;
  private hasRgbSplitOptions = false;
  private includeSplitRgbChannels = false;
  private displayCacheBudgetMb = 256;
  private currentRgbChannelNames: string[] = [];
  private currentRgbSelection: DisplaySelection | null = null;
  private currentColormapRange: DisplayLuminanceRange | null = null;
  private currentAutoColormapRange: DisplayLuminanceRange | null = null;
  private currentColormapZeroCentered = false;
  private isColormapEnabled = false;
  private hasColormapOptions = false;
  private panelSplitSizes: PanelSplitSizes = { ...DEFAULT_PANEL_SPLIT_SIZES };
  private activePanelResize: PanelResizeDragState | null = null;

  constructor(private readonly callbacks: UiCallbacks) {
    this.elements = resolveElements();
    this.loadingOverlayDisclosure = new ProgressiveLoadingOverlayDisclosure((phase) => {
      this.renderLoadingOverlayPhase(phase);
    });
    this.panelSplitResizeObserver = new ResizeObserver(() => {
      this.reclampPanelSplits();
    });
    this.bindEvents();
    this.initializePanelSplits();
    this.panelSplitResizeObserver.observe(this.elements.mainLayout);
    this.panelSplitResizeObserver.observe(this.elements.rightStack);
    this.elements.openedImagesSelect.disabled = true;
    this.elements.openedImagesSelect.title = 'Click and drag filename rows to reorder.';
    this.elements.displayCacheBudgetInput.disabled = false;
    this.elements.reloadAllOpenedImagesButton.disabled = true;
    this.elements.closeAllOpenedImagesButton.disabled = true;
    this.elements.visualizationNoneButton.disabled = true;
    this.elements.colormapToggleButton.disabled = true;
    this.elements.colormapSelect.disabled = true;
    this.elements.stokesDegreeModulationButton.disabled = true;
    this.setColormapRangeControlsDisabled(true);
    this.elements.layerSelect.disabled = true;
    this.elements.rgbSplitToggleButton.disabled = true;
    this.elements.rgbGroupSelect.disabled = true;
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

  setError(message: string | null): void {
    if (!message) {
      this.elements.errorBanner.classList.add('hidden');
      this.elements.errorBanner.textContent = '';
      return;
    }

    this.elements.errorBanner.classList.remove('hidden');
    this.elements.errorBanner.textContent = message;
  }

  setLoading(loading: boolean): void {
    if (loading) {
      this.finishOpenedImagesDrag();
      this.restoreRgbGroupFocusAfterLoading = document.activeElement === this.elements.rgbGroupSelect;
      this.restoreOpenedFilesFocusAfterLoading = isFocusWithinElement(this.elements.openedFilesList);
      this.restoreChannelViewFocusAfterLoading = isFocusWithinElement(this.elements.channelViewList);
    }

    this.isLoading = loading;
    this.elements.openFileButton.disabled = loading;
    this.elements.galleryCboxRgbButton.disabled = loading;
    this.elements.resetViewButton.disabled = loading;
    this.setVisualizationModeButtonsDisabled(loading || this.openedImageCount === 0);
    this.setColormapRangeControlsDisabled(loading || this.openedImageCount === 0);
    this.elements.exposureValue.disabled = loading;
    this.elements.openedImagesSelect.disabled = loading || this.openedImageCount === 0;
    this.elements.displayCacheBudgetInput.disabled = loading;
    this.elements.reloadAllOpenedImagesButton.disabled = loading || this.openedImageCount === 0;
    this.elements.closeAllOpenedImagesButton.disabled = loading || this.openedImageCount === 0;
    this.elements.layerSelect.disabled = loading || !this.hasMultipleLayers;
    this.elements.rgbGroupSelect.disabled = loading || !this.hasRgbGroups;
    this.renderOpenedFileRows();
    this.renderLayerRows();
    this.renderChannelViewRows();
    this.updateRgbSplitToggleState();
    this.updateStokesDegreeModulationDisabled();

    if (!loading && this.restoreRgbGroupFocusAfterLoading && !this.elements.rgbGroupSelect.disabled) {
      this.elements.rgbGroupSelect.focus();
    }
    if (!loading) {
      if (this.restoreOpenedFilesFocusAfterLoading) {
        focusSelectedImageBrowserRow(this.elements.openedFilesList);
      }
      if (this.restoreChannelViewFocusAfterLoading) {
        focusSelectedImageBrowserRow(this.elements.channelViewList);
      }
      this.restoreRgbGroupFocusAfterLoading = false;
      this.restoreOpenedFilesFocusAfterLoading = false;
      this.restoreChannelViewFocusAfterLoading = false;
    }

    this.updateLoadingOverlayVisibility();
  }

  setRgbViewLoading(loading: boolean): void {
    this.isRgbViewLoading = loading;
    this.updateRgbSplitToggleState();
    this.updateLoadingOverlayVisibility();
  }

  setDisplayCacheBudget(mb: number): void {
    this.displayCacheBudgetMb = Math.max(0, Math.round(mb));
    this.elements.displayCacheBudgetInput.value = String(this.displayCacheBudgetMb);
  }

  setDisplayCacheUsage(usedBytes: number, budgetBytes: number): void {
    const state = getDisplayCacheUsageState(usedBytes, budgetBytes);
    this.elements.displayCacheUsage.textContent = state.text;
    this.elements.displayCacheUsage.setAttribute(
      'title',
      `Retained display cache: ${formatFileSizeMb(usedBytes)} / ${formatFileSizeMb(budgetBytes)}`
    );
    this.elements.displayCacheControl.classList.toggle('is-over-budget', state.overBudget);
    this.elements.displayCacheUsage.classList.toggle('is-over-budget', state.overBudget);
  }

  private updateLoadingOverlayVisibility(): void {
    this.loadingOverlayDisclosure.setLoading(this.isLoading || this.isRgbViewLoading);
  }

  private renderLoadingOverlayPhase(phase: LoadingOverlayPhase): void {
    this.elements.loadingOverlay.classList.toggle('hidden', phase === 'hidden');
    this.elements.loadingOverlay.classList.toggle(LOADING_OVERLAY_SUBTLE_CLASS, phase === 'subtle');
    this.elements.loadingOverlay.classList.toggle(LOADING_OVERLAY_DARKENING_CLASS, phase === 'darkening');
    this.elements.loadingOverlay.classList.toggle(LOADING_OVERLAY_MESSAGE_CLASS, phase === 'message');
  }

  private getTopMenus(): TopMenuElements[] {
    return [
      { button: this.elements.fileMenuButton, menu: this.elements.fileMenu },
      { button: this.elements.galleryMenuButton, menu: this.elements.galleryMenu },
      { button: this.elements.settingsMenuButton, menu: this.elements.settingsMenu }
    ];
  }

  private isTopMenuOpen(menu: TopMenuElements): boolean {
    return !menu.menu.classList.contains('hidden');
  }

  private openTopMenu(menu: TopMenuElements, focusTarget: 'first' | 'last' | null = null): void {
    this.closeAllTopMenus(false, menu);
    menu.menu.classList.remove('hidden');
    menu.button.setAttribute('aria-expanded', 'true');

    if (focusTarget) {
      this.focusTopMenuItem(menu, focusTarget);
    }
  }

  private closeTopMenu(menu: TopMenuElements, restoreFocus = false): void {
    menu.menu.classList.add('hidden');
    menu.button.setAttribute('aria-expanded', 'false');

    if (restoreFocus) {
      menu.button.focus();
    }
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

    this.openTopMenu(menu);
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

  setExposure(exposureEv: number): void {
    this.elements.exposureSlider.value = exposureEv.toFixed(1);
    this.elements.exposureValue.value = exposureEv.toFixed(1);
  }

  setVisualizationMode(mode: VisualizationMode): void {
    this.isColormapEnabled = mode === 'colormap';
    this.elements.visualizationNoneButton.setAttribute('aria-pressed', mode === 'rgb' ? 'true' : 'false');
    this.elements.colormapToggleButton.setAttribute('aria-pressed', this.isColormapEnabled ? 'true' : 'false');
    this.elements.colormapToggleButton.setAttribute('aria-expanded', this.isColormapEnabled ? 'true' : 'false');
    this.elements.colormapRangeControl.classList.toggle('hidden', !this.isColormapEnabled);
    this.elements.exposureControl.classList.toggle('hidden', this.isColormapEnabled);
    this.setColormapRangeControlsDisabled(this.isLoading || this.openedImageCount === 0 || !this.currentColormapRange);
    this.updateStokesDegreeModulationDisabled();
  }

  setColormapOptions(items: Array<{ id: string; label: string }>, activeId: string): void {
    this.hasColormapOptions = items.length > 0;
    const hadFocus = document.activeElement === this.elements.colormapSelect;
    this.elements.colormapSelect.innerHTML = '';

    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      this.elements.colormapSelect.append(option);
    }

    this.setActiveColormap(activeId);
    this.setColormapRangeControlsDisabled(
      this.isLoading || this.openedImageCount === 0 || !this.currentColormapRange
    );

    if (hadFocus && !this.elements.colormapSelect.disabled) {
      this.elements.colormapSelect.focus();
    }
  }

  setActiveColormap(activeId: string): void {
    if (!this.hasColormapOptions) {
      this.elements.colormapSelect.value = '';
      return;
    }

    const hasOption = Array.from(this.elements.colormapSelect.options).some(
      (option) => option.value === activeId
    );
    this.elements.colormapSelect.value = hasOption ? activeId : this.elements.colormapSelect.options[0]?.value ?? '';
  }

  setColormapGradient(lut: ColormapLut | null): void {
    this.elements.colormapRangeSlider.style.setProperty(
      '--colormap-gradient',
      lut ? buildColormapCssGradient(lut) : DEFAULT_COLORMAP_GRADIENT
    );
  }

  setColormapRange(
    range: DisplayLuminanceRange | null,
    autoRange: DisplayLuminanceRange | null,
    alwaysAuto = false,
    zeroCentered = false
  ): void {
    this.currentColormapRange = cloneRange(range);
    this.currentAutoColormapRange = cloneRange(autoRange);
    this.currentColormapZeroCentered = zeroCentered;
    this.elements.colormapAutoRangeButton.setAttribute('aria-pressed', alwaysAuto ? 'true' : 'false');
    this.elements.colormapZeroCenterButton.setAttribute('aria-pressed', zeroCentered ? 'true' : 'false');

    const controlsDisabled = this.isLoading || this.openedImageCount === 0 || !range;
    this.setColormapRangeControlsDisabled(controlsDisabled);

    if (!range) {
      this.setColormapRangeValues({ min: 0, max: 1 }, { min: 0, max: 1 });
      return;
    }

    this.setColormapRangeValues(range, autoRange ?? range);
  }

  setStokesDegreeModulationControl(label: string | null, enabled = false): void {
    const visible = Boolean(label);
    this.elements.stokesDegreeModulationControl.classList.toggle('hidden', !visible);
    if (label) {
      this.elements.stokesDegreeModulationButton.textContent = `${label} Modulation`;
    }
    this.elements.stokesDegreeModulationButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    this.updateStokesDegreeModulationDisabled();
  }

  setOpenedImageOptions(items: OpenedImageOptionItem[], activeId: string | null): void {
    this.openedImageCount = items.length;
    this.openedImageItems = items.map((item) => ({ ...item }));
    this.elements.openedImagesSelect.innerHTML = '';
    this.applyListboxRowSizing(this.elements.openedImagesSelect, items.length, OPENED_IMAGES_MAX_VISIBLE_ROWS);
    this.openedImagesActiveId = null;

    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      this.elements.openedImagesSelect.append(option);
    }

    if (activeId && items.some((item) => item.id === activeId)) {
      this.elements.openedImagesSelect.value = activeId;
      this.openedImagesActiveId = activeId;
    } else if (items.length > 0) {
      this.elements.openedImagesSelect.value = items[0].id;
      this.openedImagesActiveId = items[0].id;
    }

    this.renderOpenedFileRows();
    this.elements.openedImagesSelect.disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.reloadAllOpenedImagesButton.disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.closeAllOpenedImagesButton.disabled = this.isLoading || this.openedImageCount === 0;
    this.setVisualizationModeButtonsDisabled(this.isLoading || this.openedImageCount === 0);
    this.setColormapRangeControlsDisabled(this.isLoading || this.openedImageCount === 0 || !this.currentColormapRange);
    this.updateStokesDegreeModulationDisabled();
    this.renderOpenedFileRows();
  }

  setLayerOptions(items: LayerOptionItem[], activeIndex: number): void {
    this.hasMultipleLayers = items.length > 1;
    this.layerItems = items.map((item) => ({ ...item }));
    this.activeLayerIndex = Math.min(Math.max(0, Math.floor(activeIndex)), Math.max(0, items.length - 1));
    this.elements.layerSelect.innerHTML = '';
    this.elements.layerControl.classList.toggle('hidden', !this.hasMultipleLayers);

    if (!this.hasMultipleLayers) {
      this.elements.layerSelect.disabled = true;
      this.elements.layerSelect.size = 1;
      this.elements.layerSelect.classList.remove('single-row-listbox');
      this.renderLayerRows();
      return;
    }

    this.applyListboxRowSizing(this.elements.layerSelect, items.length, items.length);

    for (const item of items) {
      const option = document.createElement('option');
      option.value = String(item.index);
      option.textContent = item.label;
      this.elements.layerSelect.append(option);
    }

    const resolvedIndex = Math.min(items.length - 1, Math.max(0, Math.floor(activeIndex)));
    this.elements.layerSelect.value = String(resolvedIndex);
    this.elements.layerSelect.disabled = this.isLoading;
    this.activeLayerIndex = resolvedIndex;
    this.renderLayerRows();
  }

  setRgbGroupOptions(
    channelNames: string[],
    selected: DisplaySelection
  ): void {
    const hadFocus = document.activeElement === this.elements.rgbGroupSelect;
    const nextChannelNames = [...channelNames];
    if (!this.hasMultipleLayers) {
      this.layerItems = buildPartLayerItemsFromChannelNames(nextChannelNames);
      this.activeLayerIndex = 0;
      this.renderLayerRows();
    }

    const expandedSelection = this.includeSplitRgbChannels
      ? findSplitSelectionForMergedDisplay(nextChannelNames, selected)
      : null;
    const collapsedSelection = !this.includeSplitRgbChannels
      ? findMergedSelectionForSplitDisplay(nextChannelNames, selected)
      : null;
    const effectiveSelected = expandedSelection ?? collapsedSelection ?? selected;
    const rgbGroups = extractRgbChannelGroups(nextChannelNames);
    const channelOptions = buildChannelDisplayOptions(nextChannelNames, {
      includeRgbGroups: !this.includeSplitRgbChannels,
      includeSplitChannels: this.includeSplitRgbChannels
    });
    const stokesOptions = getStokesDisplayOptions(nextChannelNames, {
      includeRgbGroups: !this.includeSplitRgbChannels,
      includeSplitChannels: this.includeSplitRgbChannels
    });
    const selectedChannelOption = findSelectedChannelDisplayOption(
      channelOptions,
      effectiveSelected.displayR,
      effectiveSelected.displayG,
      effectiveSelected.displayB,
      effectiveSelected.displayA ?? null
    );
    const selectedStokesOption = findSelectedStokesDisplayOption(stokesOptions, effectiveSelected);
    const showCurrentChannelOption =
      effectiveSelected.displaySource === 'channels' &&
      !selectedChannelOption &&
      nextChannelNames.length > 0 &&
      areDisplayChannelsAvailable(nextChannelNames, effectiveSelected);
    const optionCount = channelOptions.length + stokesOptions.length + (showCurrentChannelOption ? 1 : 0);

    this.currentRgbChannelNames = nextChannelNames;
    this.currentRgbSelection = { ...effectiveSelected };
    this.hasRgbGroups = optionCount > 0;
    this.hasRgbSplitOptions = rgbGroups.length > 0;
    this.updateRgbSplitToggleState();
    this.rgbGroupMappings.clear();
    this.elements.rgbGroupSelect.innerHTML = '';
    this.channelViewItems = [];
    this.applyListboxRowSizing(this.elements.rgbGroupSelect, optionCount, CHANNEL_OPTIONS_MAX_VISIBLE_ROWS);

    let selectedValue = optionCount > 0 ? 'channels-0' : '';

    if (showCurrentChannelOption) {
      const value = 'channels-current';
      this.rgbGroupMappings.set(value, {
        ...effectiveSelected,
        displaySource: 'channels',
        stokesParameter: null
      });

      const option = document.createElement('option');
      option.value = value;
      option.textContent = formatCurrentChannelOptionLabel(selected);
      this.elements.rgbGroupSelect.append(option);
      this.channelViewItems.push(createChannelViewRowItem(value, option.textContent, effectiveSelected));
      selectedValue = value;
    }

    channelOptions.forEach((channelOption, index) => {
      const value = `channels-${index}`;
      this.rgbGroupMappings.set(value, {
        displaySource: 'channels',
        stokesParameter: null,
        ...channelOption.mapping
      });

      const option = document.createElement('option');
      option.value = value;
      option.textContent = channelOption.label;
      this.elements.rgbGroupSelect.append(option);
      this.channelViewItems.push(createChannelViewRowItem(value, channelOption.label, {
        displaySource: 'channels',
        stokesParameter: null,
        ...channelOption.mapping
      }));

      if (selectedChannelOption && selectedChannelOption.key === channelOption.key) {
        selectedValue = value;
      }
    });

    stokesOptions.forEach((stokesOption, index) => {
      const value = `stokes-${index}`;
      this.rgbGroupMappings.set(value, {
        displaySource: stokesOption.displaySource,
        stokesParameter: stokesOption.stokesParameter,
        ...stokesOption.mapping
      });

      const option = document.createElement('option');
      option.value = value;
      option.textContent = stokesOption.label;
      this.elements.rgbGroupSelect.append(option);
      this.channelViewItems.push(createChannelViewRowItem(value, stokesOption.label, {
        displaySource: stokesOption.displaySource,
        stokesParameter: stokesOption.stokesParameter,
        ...stokesOption.mapping
      }));

      if (
        selectedStokesOption && selectedStokesOption.key === stokesOption.key
      ) {
        selectedValue = value;
      }
    });

    this.elements.rgbGroupSelect.value = selectedValue;
    this.elements.rgbGroupSelect.disabled = this.isLoading || !this.hasRgbGroups;
    this.renderChannelViewRows();
    if (hadFocus && !this.elements.rgbGroupSelect.disabled) {
      this.elements.rgbGroupSelect.focus();
    }

    const remappedSelection = expandedSelection ?? collapsedSelection;
    if (remappedSelection) {
      this.callbacks.onRgbGroupChange(remappedSelection);
    }
  }

  setProbeReadout(
    mode: 'Hover' | 'Locked',
    sample: PixelSample | null,
    colorPreview: ProbeColorPreview | null,
    imageSize: ProbeCoordinateImageSize | null = null
  ): void {
    this.elements.probeMode.textContent = mode;

    if (!sample) {
      this.elements.probeCoords.textContent = formatProbeCoordinates(null, imageSize);
      this.elements.probeColorPreview.classList.add('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = 'transparent';
      this.renderProbeDisplayValues(createEmptyProbeDisplayValues());
      this.elements.probeValues.innerHTML = '';
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
    this.elements.probeValues.innerHTML = '';

    for (const [channelName, channelValue] of channelEntries) {
      const row = document.createElement('div');
      row.className = 'probe-row';

      const key = document.createElement('span');
      key.className = 'probe-key';
      key.textContent = channelName;

      const value = document.createElement('span');
      value.className = 'probe-value';
      value.textContent = formatScientific(channelValue);

      row.append(key, value);
      this.elements.probeValues.append(row);
    }
  }

  setProbeMetadata(metadata: ExrMetadataEntry[] | null): void {
    this.elements.probeMetadata.innerHTML = '';

    if (!metadata || metadata.length === 0) {
      this.elements.probeMetadata.classList.add('hidden');
      return;
    }

    this.elements.probeMetadata.classList.remove('hidden');
    for (const item of metadata) {
      const row = document.createElement('div');
      row.className = 'probe-metadata-row';

      const key = document.createElement('span');
      key.className = 'probe-metadata-key';
      key.textContent = item.label;

      const value = document.createElement('span');
      value.className = 'probe-metadata-value';
      value.textContent = item.value;

      row.append(key, value);
      this.elements.probeMetadata.append(row);
    }
  }

  private renderProbeDisplayValues(displayValues: ProbeDisplayValue[]): void {
    this.elements.probeColorValues.innerHTML = '';

    for (const item of displayValues) {
      const row = document.createElement('div');
      row.className = 'probe-color-row';

      const channel = document.createElement('span');
      channel.className = 'probe-color-channel';
      channel.textContent = `${item.label}:`;

      const value = document.createElement('span');
      value.className = 'probe-color-number';
      value.textContent = item.value;

      row.append(channel, value);
      this.elements.probeColorValues.append(row);
    }
  }

  showDropOverlay(show: boolean): void {
    if (show) {
      this.elements.dropOverlay.classList.remove('hidden');
      return;
    }
    this.elements.dropOverlay.classList.add('hidden');
  }

  private renderOpenedFileRows(): void {
    const disabled = this.isLoading || this.openedImageCount === 0;
    const shouldRestoreFocus = !disabled && isFocusWithinElement(this.elements.openedFilesList);
    this.elements.openedFilesCount.textContent = String(this.openedImageItems.length);
    this.elements.openedFilesList.innerHTML = '';
    this.elements.openedFilesList.classList.toggle('is-disabled', disabled);

    if (this.openedImageItems.length === 0) {
      this.elements.openedFilesList.append(createEmptyListMessage('No open files'));
      return;
    }

    for (const item of this.openedImageItems) {
      const sizeText = formatFileSizeMb(item.sizeBytes ?? null);
      const row = createOpenedFileRow({
        label: item.label,
        sourceDetail: item.sourceDetail ?? item.label,
        sizeText,
        thumbnailDataUrl: item.thumbnailDataUrl ?? null,
        pinned: item.pinned ?? false,
        selected: item.id === this.openedImagesActiveId,
        disabled,
        sessionId: item.id,
        onTogglePin: () => {
          this.callbacks.onToggleOpenedImagePin(item.id);
        },
        onReload: () => {
          this.callbacks.onReloadSelectedOpenedImage(item.id);
        },
        onClose: () => {
          this.callbacks.onCloseSelectedOpenedImage(item.id);
        }
      });
      this.elements.openedFilesList.append(row);
    }

    if (shouldRestoreFocus) {
      focusSelectedImageBrowserRow(this.elements.openedFilesList);
    }
  }

  private renderLayerRows(): void {
    const hasSelectableRows = this.layerItems.some((item) => item.selectable !== false);
    this.elements.partsLayersCount.textContent = String(this.layerItems.length);
    this.elements.partsLayersList.innerHTML = '';
    this.elements.partsLayersList.classList.toggle('is-disabled', this.isLoading);

    if (this.layerItems.length === 0) {
      this.elements.partsLayersList.append(createEmptyListMessage('No parts'));
      return;
    }

    this.layerItems.forEach((item, itemIndex) => {
      const selectable = item.selectable !== false && hasSelectableRows;
      const row = createImageBrowserRow({
        label: item.label,
        meta: formatChannelCount(item.channelCount ?? 0),
        selected: selectable && this.hasMultipleLayers && item.index === this.activeLayerIndex,
        disabled: this.isLoading || !selectable || this.layerItems.length <= 1,
        className: 'layer-row',
        valueAttribute: 'layerItemIndex',
        value: String(itemIndex)
      });
      row.prepend(createLayerRowIcon());
      this.elements.partsLayersList.append(row);
    });
  }

  private renderChannelViewRows(): void {
    const disabled = this.isLoading || !this.hasRgbGroups;
    const shouldRestoreFocus = !disabled && isFocusWithinElement(this.elements.channelViewList);
    this.elements.channelViewCount.textContent = String(this.channelViewItems.length);
    this.elements.channelViewList.innerHTML = '';
    this.elements.channelViewList.classList.toggle('is-disabled', disabled);

    if (this.channelViewItems.length === 0) {
      this.elements.channelViewList.append(createEmptyListMessage('No channels'));
      return;
    }

    const selectedValue = this.elements.rgbGroupSelect.value;
    for (const item of this.channelViewItems) {
      const row = createImageBrowserRow({
        label: item.label,
        meta: item.meta,
        selected: item.value === selectedValue,
        disabled,
        className: 'channel-view-row',
        valueAttribute: 'channelValue',
        value: item.value
      });
      row.prepend(createChannelViewIcon(item.swatches));
      this.elements.channelViewList.append(row);
    }

    if (shouldRestoreFocus) {
      focusSelectedImageBrowserRow(this.elements.channelViewList);
    }
  }

  private chooseOpenedImage(sessionId: string): void {
    if (!sessionId || this.elements.openedImagesSelect.disabled) {
      return;
    }

    this.elements.openedImagesSelect.value = sessionId;
    this.openedImagesActiveId = sessionId;
    this.renderOpenedFileRows();
    this.callbacks.onOpenedImageSelected(sessionId);
  }

  private chooseLayerIndex(layerIndex: number): void {
    if (!Number.isFinite(layerIndex) || this.isLoading || this.layerItems.length === 0) {
      return;
    }

    const resolvedIndex = Math.min(this.layerItems.length - 1, Math.max(0, Math.floor(layerIndex)));
    this.elements.layerSelect.value = String(resolvedIndex);
    this.activeLayerIndex = resolvedIndex;
    this.renderLayerRows();
    this.callbacks.onLayerChange(resolvedIndex);
  }

  private chooseChannelViewValue(value: string): void {
    if (!value || this.elements.rgbGroupSelect.disabled) {
      return;
    }

    const mapping = this.rgbGroupMappings.get(value);
    if (!mapping) {
      return;
    }

    this.elements.rgbGroupSelect.value = value;
    this.currentRgbSelection = { ...mapping };
    this.renderChannelViewRows();
    this.callbacks.onRgbGroupChange(mapping);
  }

  private onImageBrowserListKeyDown(
    event: KeyboardEvent,
    list: HTMLElement,
    activate: (row: HTMLElement) => void
  ): void {
    const rows = getImageBrowserRows(list);
    if (rows.length === 0) {
      return;
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedRow = activeElement ? getFocusedImageBrowserRow(list, activeElement) : null;
    const focusedIndex = focusedRow ? rows.indexOf(focusedRow) : -1;
    const selectedIndex = rows.findIndex(isSelectedRow);
    const currentIndex = Math.max(0, focusedIndex >= 0 ? focusedIndex : selectedIndex);
    let nextIndex = currentIndex;

    if (event.key === 'Enter' || event.key === ' ') {
      if (isNestedInteractiveListControl(event.target, focusedRow)) {
        return;
      }

      event.preventDefault();
      const row = rows[currentIndex];
      if (row) {
        activate(row);
      }
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'Up') {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === 'ArrowDown' || event.key === 'Down') {
      nextIndex = Math.min(rows.length - 1, currentIndex + 1);
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = rows.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextRow = rows[nextIndex];
    if (!nextRow) {
      return;
    }

    nextRow.focus();
    activate(nextRow);
  }

  private bindImageBrowserToggle(toggle: HTMLButtonElement, content: HTMLElement): void {
    toggle.addEventListener('click', () => {
      const collapsed = toggle.getAttribute('aria-expanded') === 'true';
      this.setImageBrowserCollapsed(toggle, content, collapsed);
    });
  }

  private setImageBrowserCollapsed(toggle: HTMLButtonElement, content: HTMLElement, collapsed: boolean): void {
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    content.hidden = collapsed;
    content.closest('.image-browser-section')?.classList.toggle('is-collapsed', collapsed);
  }

  private initializePanelSplits(): void {
    const currentSizes = this.readCurrentPanelSplitSizes();
    const storedSizes = readStoredPanelSplitSizes();
    this.applyPanelSplitSizes({ ...currentSizes, ...storedSizes }, null, false);
  }

  private readCurrentPanelSplitSizes(): PanelSplitSizes {
    if (!this.isDesktopPanelLayout()) {
      return { ...DEFAULT_PANEL_SPLIT_SIZES };
    }

    return {
      imagePanelWidth: readElementSize(this.elements.imagePanel, 'width', DEFAULT_PANEL_SPLIT_SIZES.imagePanelWidth),
      rightPanelWidth: readElementSize(this.elements.rightStack, 'width', DEFAULT_PANEL_SPLIT_SIZES.rightPanelWidth)
    };
  }

  private isDesktopPanelLayout(): boolean {
    return getComputedStyle(this.elements.imagePanelResizer).display !== 'none';
  }

  private reclampPanelSplits(): void {
    if (!this.isDesktopPanelLayout()) {
      return;
    }

    this.applyPanelSplitSizes(this.panelSplitSizes, null, false);
  }

  private bindPanelResizer(resizer: HTMLElement, key: PanelSplitSizeKey): void {
    resizer.addEventListener('pointerdown', (event) => {
      this.beginPanelResize(event, key);
    });
    resizer.addEventListener('pointermove', (event) => {
      this.onPanelResizePointerMove(event);
    });
    resizer.addEventListener('pointerup', (event) => {
      this.finishPanelResize(event);
    });
    resizer.addEventListener('pointercancel', (event) => {
      this.finishPanelResize(event);
    });
    resizer.addEventListener('keydown', (event) => {
      this.onPanelResizerKeyDown(event, key);
    });
  }

  private beginPanelResize(event: PointerEvent, key: PanelSplitSizeKey): void {
    if (event.button !== 0 || !this.isDesktopPanelLayout()) {
      return;
    }

    event.preventDefault();
    const resizer = event.currentTarget as HTMLElement;
    this.activePanelResize = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startSizes: { ...this.panelSplitSizes },
      resizer
    };
    resizer.classList.add('is-resizing');
    document.body.classList.add('is-resizing-panel-columns');
    resizer.setPointerCapture(event.pointerId);
  }

  private onPanelResizePointerMove(event: PointerEvent): void {
    const dragState = this.activePanelResize;
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    event.preventDefault();
    const nextSizes = { ...dragState.startSizes };
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (dragState.key === 'imagePanelWidth') {
      nextSizes.imagePanelWidth = dragState.startSizes.imagePanelWidth + deltaX;
    } else {
      nextSizes.rightPanelWidth = dragState.startSizes.rightPanelWidth - deltaX;
    }

    this.applyPanelSplitSizes(nextSizes, dragState.key, false);
  }

  private finishPanelResize(event?: PointerEvent): void {
    const dragState = this.activePanelResize;
    if (!dragState || (event && event.pointerId !== dragState.pointerId)) {
      return;
    }

    event?.preventDefault();
    if (dragState.resizer.hasPointerCapture(dragState.pointerId)) {
      dragState.resizer.releasePointerCapture(dragState.pointerId);
    }
    dragState.resizer.classList.remove('is-resizing');
    document.body.classList.remove('is-resizing-panel-columns');
    this.activePanelResize = null;
    saveStoredPanelSplitSizes(this.panelSplitSizes);
  }

  private onPanelResizerKeyDown(event: KeyboardEvent, key: PanelSplitSizeKey): void {
    if (!this.isDesktopPanelLayout()) {
      return;
    }

    const action = getPanelSplitKeyboardAction(event.key, event.shiftKey);
    if (!action) {
      return;
    }

    event.preventDefault();
    const nextSizes = { ...this.panelSplitSizes };

    if (action.type === 'snap') {
      const range = getPanelSplitSizeRange(key, this.panelSplitSizes, this.getPanelSplitMetrics());
      nextSizes[key] = action.target === 'min' ? range.min : range.max;
    } else {
      const delta = key === 'rightPanelWidth' ? -action.delta : action.delta;
      nextSizes[key] += delta;
    }

    this.applyPanelSplitSizes(nextSizes, key, true);
  }

  private applyPanelSplitSizes(
    sizes: PanelSplitSizes,
    activeKey: PanelSplitSizeKey | null,
    persist: boolean
  ): void {
    const clampedSizes = clampPanelSplitSizes(sizes, this.getPanelSplitMetrics(), activeKey);
    this.panelSplitSizes = clampedSizes;
    this.elements.mainLayout.style.setProperty('--image-panel-width', `${Math.round(clampedSizes.imagePanelWidth)}px`);
    this.elements.mainLayout.style.setProperty('--right-panel-width', `${Math.round(clampedSizes.rightPanelWidth)}px`);
    this.updatePanelSplitAria();

    if (persist) {
      saveStoredPanelSplitSizes(clampedSizes);
    }
  }

  private getPanelSplitMetrics(): PanelSplitMetrics {
    return {
      mainWidth: readElementSize(this.elements.mainLayout, 'width', window.innerWidth),
      imageResizerWidth: readElementSize(this.elements.imagePanelResizer, 'width', 8),
      rightResizerWidth: readElementSize(this.elements.rightPanelResizer, 'width', 8)
    };
  }

  private updatePanelSplitAria(): void {
    const metrics = this.getPanelSplitMetrics();
    this.updatePanelResizerAria(this.elements.imagePanelResizer, 'imagePanelWidth', metrics);
    this.updatePanelResizerAria(this.elements.rightPanelResizer, 'rightPanelWidth', metrics);
  }

  private updatePanelResizerAria(
    resizer: HTMLElement,
    key: PanelSplitSizeKey,
    metrics: PanelSplitMetrics
  ): void {
    const range = getPanelSplitSizeRange(key, this.panelSplitSizes, metrics);
    resizer.setAttribute('aria-valuemin', String(Math.round(range.min)));
    resizer.setAttribute('aria-valuemax', String(Math.round(range.max)));
    resizer.setAttribute('aria-valuenow', String(Math.round(this.panelSplitSizes[key])));
  }

  private updateRgbSplitToggleState(): void {
    this.elements.rgbSplitToggleButton.classList.toggle('hidden', !this.hasRgbSplitOptions);
    this.elements.rgbSplitToggleButton.disabled = this.isLoading || this.isRgbViewLoading || !this.hasRgbSplitOptions;
    this.elements.rgbSplitToggleButton.setAttribute(
      'aria-pressed',
      this.includeSplitRgbChannels ? 'true' : 'false'
    );
  }

  private bindTopMenu(menu: TopMenuElements): void {
    menu.button.addEventListener('click', () => {
      this.toggleTopMenu(menu);
    });

    menu.button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleTopMenu(menu);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.openTopMenu(menu, 'first');
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.openTopMenu(menu, 'last');
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

    menu.menu.addEventListener('keydown', (event) => {
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
    this.bindPanelResizer(this.elements.imagePanelResizer, 'imagePanelWidth');
    this.bindPanelResizer(this.elements.rightPanelResizer, 'rightPanelWidth');
    this.bindImageBrowserToggle(this.elements.openedFilesToggle, this.elements.openedFilesList);
    this.bindImageBrowserToggle(this.elements.partsLayersToggle, this.elements.partsLayersList);
    this.bindImageBrowserToggle(this.elements.channelViewToggle, this.elements.channelViewList);

    for (const menu of this.getTopMenus()) {
      this.bindTopMenu(menu);
    }

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        this.getTopMenus().some((menu) => menu.button.parentElement?.contains(target))
      ) {
        return;
      }

      this.closeAllTopMenus();
    });

    window.addEventListener('dragover', (event) => {
      if (!hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    });

    window.addEventListener('drop', (event) => {
      if (!hasDroppedFiles(event)) {
        return;
      }

      event.preventDefault();
      this.showDropOverlay(false);

      const files = toFiles(event.dataTransfer?.files);
      if (files.length === 0) {
        return;
      }

      this.callbacks.onFilesDropped(files);
    });

    this.elements.openFileButton.addEventListener('click', () => {
      this.closeAllTopMenus();
      this.callbacks.onOpenFileClick();
    });

    this.elements.galleryCboxRgbButton.addEventListener('click', () => {
      if (this.elements.galleryCboxRgbButton.disabled) {
        return;
      }

      this.closeAllTopMenus();
      this.callbacks.onGalleryImageSelected(this.elements.galleryCboxRgbButton.dataset.galleryId ?? '');
    });

    this.elements.reloadAllOpenedImagesButton.addEventListener('click', () => {
      if (this.elements.reloadAllOpenedImagesButton.disabled) {
        return;
      }

      this.closeAllTopMenus();
      this.callbacks.onReloadAllOpenedImages();
    });

    this.elements.closeAllOpenedImagesButton.addEventListener('click', () => {
      if (this.elements.closeAllOpenedImagesButton.disabled) {
        return;
      }

      this.closeAllTopMenus();
      this.callbacks.onCloseAllOpenedImages();
    });

    this.elements.displayCacheBudgetInput.addEventListener('change', (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        this.setDisplayCacheBudget(this.displayCacheBudgetMb);
        return;
      }

      this.callbacks.onDisplayCacheBudgetChange(value);
    });

    this.elements.fileInput.addEventListener('change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0] ?? null;
      if (!file) {
        return;
      }
      this.callbacks.onFileSelected(file);
      input.value = '';
    });

    this.elements.resetViewButton.addEventListener('click', () => {
      this.callbacks.onResetView();
    });

    this.elements.visualizationNoneButton.addEventListener('click', () => {
      if (this.elements.visualizationNoneButton.disabled) {
        return;
      }

      this.callbacks.onVisualizationModeChange('rgb');
    });

    this.elements.colormapToggleButton.addEventListener('click', () => {
      if (this.elements.colormapToggleButton.disabled) {
        return;
      }

      this.callbacks.onVisualizationModeChange('colormap');
    });

    this.elements.colormapSelect.addEventListener('change', (event) => {
      if (this.elements.colormapSelect.disabled) {
        return;
      }

      const target = event.currentTarget as HTMLSelectElement;
      this.callbacks.onColormapChange(target.value);
    });

    this.elements.colormapAutoRangeButton.addEventListener('click', () => {
      if (this.elements.colormapAutoRangeButton.disabled) {
        return;
      }

      this.callbacks.onColormapAutoRange();
    });

    this.elements.colormapZeroCenterButton.addEventListener('click', () => {
      if (this.elements.colormapZeroCenterButton.disabled) {
        return;
      }

      this.callbacks.onColormapZeroCenterToggle();
    });

    this.elements.stokesDegreeModulationButton.addEventListener('click', () => {
      if (this.elements.stokesDegreeModulationButton.disabled) {
        return;
      }

      this.callbacks.onStokesDegreeModulationToggle();
    });

    this.elements.colormapVminSlider.addEventListener('input', () => {
      this.commitColormapMin(Number(this.elements.colormapVminSlider.value));
    });

    this.elements.colormapVmaxSlider.addEventListener('input', () => {
      this.commitColormapMax(Number(this.elements.colormapVmaxSlider.value));
    });

    this.elements.colormapVminInput.addEventListener('change', () => {
      this.commitColormapMin(Number(this.elements.colormapVminInput.value));
    });

    this.elements.colormapVmaxInput.addEventListener('change', () => {
      this.commitColormapMax(Number(this.elements.colormapVmaxInput.value));
    });

    this.elements.exposureSlider.addEventListener('input', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      this.callbacks.onExposureChange(Number(target.value));
    });

    this.elements.exposureValue.addEventListener('change', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        return;
      }

      const min = Number(this.elements.exposureSlider.min);
      const max = Number(this.elements.exposureSlider.max);
      const clamped = Math.min(max, Math.max(min, value));
      this.callbacks.onExposureChange(clamped);
    });

    const onLayerSelect = (event: Event): void => {
      if (this.elements.layerSelect.disabled) {
        return;
      }

      const target = event.currentTarget as HTMLSelectElement;
      const layerIndex = Number(target.value);
      if (!Number.isFinite(layerIndex)) {
        return;
      }

      this.chooseLayerIndex(layerIndex);
    };
    this.elements.layerSelect.addEventListener('change', onLayerSelect);
    this.elements.layerSelect.addEventListener('input', onLayerSelect);
    this.elements.partsLayersList.addEventListener('click', (event) => {
      const row = findClosestListRow(event.target, 'layerItemIndex');
      const item = row ? this.layerItems[Number(row.dataset.layerItemIndex)] : null;
      if (!row || !item || item.selectable === false || this.isLoading || this.layerItems.length <= 1) {
        return;
      }

      this.chooseLayerIndex(item.index);
    });
    this.elements.partsLayersList.addEventListener('keydown', (event) => {
      this.onImageBrowserListKeyDown(event, this.elements.partsLayersList, (row) => {
        const item = this.layerItems[Number(row.dataset.layerItemIndex)];
        if (!item || item.selectable === false || this.isLoading || this.layerItems.length <= 1) {
          return;
        }
        this.chooseLayerIndex(item.index);
      });
    });

    const onOpenedImagesSelect = (event: Event): void => {
      if (this.openedImageDragState || performance.now() < this.suppressOpenedImageSelectionUntilMs) {
        return;
      }

      const target = event.currentTarget as HTMLSelectElement;
      this.chooseOpenedImage(target.value);
    };
    this.elements.openedImagesSelect.addEventListener('change', onOpenedImagesSelect);
    this.elements.openedImagesSelect.addEventListener('input', onOpenedImagesSelect);
    this.elements.openedImagesSelect.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || this.elements.openedImagesSelect.disabled) {
        return;
      }
      // Use a controlled interaction model; native listbox drag-selection causes unstable row switching.
      event.preventDefault();
      this.elements.openedImagesSelect.focus();

      const sessionId = this.getOpenedImageSessionAtClientY(event.clientY);
      if (!sessionId) {
        return;
      }

      this.elements.openedImagesSelect.value = sessionId;
      if (sessionId !== this.openedImagesActiveId) {
        this.chooseOpenedImage(sessionId);
      }

      this.openedImageDragState = {
        sessionId,
        startY: event.clientY,
        lastTargetSessionId: null,
        isDragging: false
      };
    });
    this.elements.openedFilesList.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || this.elements.openedImagesSelect.disabled) {
        return;
      }

      const row = findClosestListRow(event.target, 'sessionId');
      if (!row) {
        return;
      }

      event.preventDefault();
      row.focus();

      const sessionId = row.dataset.sessionId ?? '';
      this.elements.openedImagesSelect.value = sessionId;
      if (sessionId !== this.openedImagesActiveId) {
        this.chooseOpenedImage(sessionId);
      }

      this.openedImageDragState = {
        sessionId,
        startY: event.clientY,
        lastTargetSessionId: null,
        isDragging: false
      };
    });
    this.elements.openedFilesList.addEventListener('keydown', (event) => {
      this.onImageBrowserListKeyDown(event, this.elements.openedFilesList, (row) => {
        if (this.elements.openedImagesSelect.disabled) {
          return;
        }
        this.chooseOpenedImage(row.dataset.sessionId ?? '');
      });
    });
    window.addEventListener('mousemove', (event) => {
      this.onOpenedImagesMouseMove(event);
    });
    window.addEventListener('mouseup', () => {
      this.finishOpenedImagesDrag();
    });
    window.addEventListener('blur', () => {
      this.finishOpenedImagesDrag();
      this.finishPanelResize();
    });

    this.elements.rgbSplitToggleButton.addEventListener('click', () => {
      if (this.elements.rgbSplitToggleButton.disabled) {
        return;
      }

      this.includeSplitRgbChannels = !this.includeSplitRgbChannels;
      this.updateRgbSplitToggleState();

      const selection = this.currentRgbSelection;
      if (!selection) {
        return;
      }

      this.setRgbGroupOptions(this.currentRgbChannelNames, selection);
    });

    const onRgbGroupSelect = (event: Event): void => {
      const target = event.currentTarget as HTMLSelectElement;
      this.chooseChannelViewValue(target.value);
    };
    this.elements.rgbGroupSelect.addEventListener('change', onRgbGroupSelect);
    this.elements.rgbGroupSelect.addEventListener('input', onRgbGroupSelect);
    this.elements.rgbGroupSelect.addEventListener('keydown', (event) => {
      if (this.elements.rgbGroupSelect.disabled) {
        return;
      }

      const options = this.elements.rgbGroupSelect.options;
      if (options.length === 0) {
        return;
      }

      const currentIndex = Math.max(0, this.elements.rgbGroupSelect.selectedIndex);
      let nextIndex = currentIndex;
      const key = event.key;
      const keyCode = event.keyCode;

      if (key === 'ArrowUp' || key === 'Up' || keyCode === 38) {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (key === 'ArrowDown' || key === 'Down' || keyCode === 40) {
        nextIndex = Math.min(options.length - 1, currentIndex + 1);
      } else if (key === 'Home' || keyCode === 36) {
        nextIndex = 0;
      } else if (key === 'End' || keyCode === 35) {
        nextIndex = options.length - 1;
      } else {
        return;
      }

      if (nextIndex === currentIndex) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      this.elements.rgbGroupSelect.selectedIndex = nextIndex;
      const mapping = this.rgbGroupMappings.get(this.elements.rgbGroupSelect.value);
      if (!mapping) {
        return;
      }
      this.currentRgbSelection = { ...mapping };
      this.renderChannelViewRows();
      this.callbacks.onRgbGroupChange(mapping);
    });
    this.elements.channelViewList.addEventListener('click', (event) => {
      const row = findClosestListRow(event.target, 'channelValue');
      if (!row || this.elements.rgbGroupSelect.disabled) {
        return;
      }

      this.chooseChannelViewValue(row.dataset.channelValue ?? '');
    });
    this.elements.channelViewList.addEventListener('keydown', (event) => {
      this.onImageBrowserListKeyDown(event, this.elements.channelViewList, (row) => {
        if (this.elements.rgbGroupSelect.disabled) {
          return;
        }
        this.chooseChannelViewValue(row.dataset.channelValue ?? '');
      });
    });

    this.elements.viewerContainer.addEventListener('dragover', (event) => {
      if (!hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();
      this.showDropOverlay(true);
    });

    this.elements.viewerContainer.addEventListener('dragleave', (event) => {
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

    this.elements.viewerContainer.addEventListener('drop', (event) => {
      if (!hasDroppedFiles(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.showDropOverlay(false);

      const files = toFiles(event.dataTransfer?.files);
      if (files.length === 0) {
        return;
      }

      this.callbacks.onFilesDropped(files);
    });
  }

  private onOpenedImagesMouseMove(event: MouseEvent): void {
    const dragState = this.openedImageDragState;
    if (!dragState) {
      return;
    }
    event.preventDefault();

    if ((event.buttons & 1) !== 1) {
      this.finishOpenedImagesDrag();
      return;
    }

    if (Math.abs(event.clientY - dragState.startY) < 6) {
      return;
    }

    if (!dragState.isDragging) {
      dragState.isDragging = true;
      this.elements.openedImagesSelect.classList.add('is-reordering');
      this.elements.openedFilesList.classList.add('is-reordering');
    }

    const targetSessionId = this.getOpenedImageSessionAtClientY(event.clientY);
    if (!targetSessionId) {
      return;
    }

    if (targetSessionId === dragState.sessionId) {
      dragState.lastTargetSessionId = null;
      return;
    }

    if (targetSessionId === dragState.lastTargetSessionId) {
      return;
    }

    dragState.lastTargetSessionId = targetSessionId;
    this.callbacks.onReorderOpenedImage(dragState.sessionId, targetSessionId);
  }

  private finishOpenedImagesDrag(): void {
    const dragState = this.openedImageDragState;
    this.openedImageDragState = null;
    this.elements.openedImagesSelect.classList.remove('is-reordering');
    this.elements.openedFilesList.classList.remove('is-reordering');

    const activeId = this.openedImagesActiveId;
    if (dragState?.isDragging && activeId) {
      this.elements.openedImagesSelect.value = activeId;
    }

    if (dragState?.isDragging) {
      this.suppressOpenedImageSelectionUntilMs = performance.now() + 120;
    }
  }

  private getOpenedImageSessionAtClientY(clientY: number): string | null {
    const rowSessionId = getImageBrowserRowValueAtClientY(this.elements.openedFilesList, clientY, 'sessionId');
    if (rowSessionId) {
      return rowSessionId;
    }

    const select = this.elements.openedImagesSelect;
    const options = select.options;
    if (options.length === 0) {
      return null;
    }

    const rect = select.getBoundingClientRect();
    if (rect.height <= 0) {
      return null;
    }

    const top = rect.top + select.clientTop;
    const height = Math.max(1, select.clientHeight);
    const index = getListboxOptionIndexAtClientY(clientY, {
      top,
      height,
      scrollTop: select.scrollTop,
      scrollHeight: select.scrollHeight,
      optionCount: options.length
    });
    if (index < 0) {
      return null;
    }
    return options[index]?.value ?? null;
  }

  private applyListboxRowSizing(select: HTMLSelectElement, optionCount: number, maxRows: number): void {
    if (optionCount <= 0) {
      select.size = 1;
      select.classList.remove('single-row-listbox');
      return;
    }

    if (optionCount === 1) {
      // Keep listbox rendering on browsers that fallback to dropdown at size=1.
      select.size = 2;
      select.classList.add('single-row-listbox');
      return;
    }

    select.size = Math.max(2, Math.min(maxRows, optionCount));
    select.classList.remove('single-row-listbox');
  }

  private setColormapRangeControlsDisabled(disabled: boolean): void {
    const effectiveDisabled = disabled || !this.isColormapEnabled;
    this.elements.colormapSelect.disabled = effectiveDisabled || !this.hasColormapOptions;
    this.elements.colormapAutoRangeButton.disabled = effectiveDisabled || !this.currentAutoColormapRange;
    this.elements.colormapZeroCenterButton.disabled = effectiveDisabled || !this.currentColormapRange;
    this.elements.colormapVminSlider.disabled = effectiveDisabled;
    this.elements.colormapVmaxSlider.disabled = effectiveDisabled;
    this.elements.colormapVminInput.disabled = effectiveDisabled;
    this.elements.colormapVmaxInput.disabled = effectiveDisabled;
  }

  private setVisualizationModeButtonsDisabled(disabled: boolean): void {
    this.elements.visualizationNoneButton.disabled = disabled;
    this.elements.colormapToggleButton.disabled = disabled;
  }

  private updateStokesDegreeModulationDisabled(): void {
    const visible = !this.elements.stokesDegreeModulationControl.classList.contains('hidden');
    this.elements.stokesDegreeModulationButton.disabled =
      !visible || this.isLoading || this.openedImageCount === 0 || !this.isColormapEnabled;
  }

  private setColormapRangeValues(range: DisplayLuminanceRange, autoRange: DisplayLuminanceRange): void {
    const bounds = buildColormapSliderBounds(range, autoRange, this.currentColormapZeroCentered);
    const zeroCenteredFloor = this.currentColormapZeroCentered
      ? Math.min(COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE, bounds.max)
      : 0;
    const step = this.currentColormapZeroCentered
      ? 'any'
      : formatColormapRangeStep(bounds.min, bounds.max);
    const vminSliderMax = this.currentColormapZeroCentered ? -zeroCenteredFloor : bounds.max;
    const vmaxSliderMin = this.currentColormapZeroCentered ? zeroCenteredFloor : bounds.min;
    const vmin = clamp(range.min, bounds.min, vminSliderMax);
    const vmax = clamp(range.max, vmaxSliderMin, bounds.max);
    const span = Math.max(Number.EPSILON, bounds.max - bounds.min);
    const minPct = ((vmin - bounds.min) / span) * 100;
    const maxPct = ((vmax - bounds.min) / span) * 100;

    this.elements.colormapRangeSlider.classList.toggle('zero-centered', this.currentColormapZeroCentered);
    this.elements.colormapVminSlider.min = formatColormapInputValue(bounds.min);
    this.elements.colormapVminSlider.max = formatColormapInputValue(vminSliderMax);
    this.elements.colormapVminSlider.step = step;
    this.elements.colormapVminSlider.value = formatColormapInputValue(vmin);

    this.elements.colormapVmaxSlider.min = formatColormapInputValue(vmaxSliderMin);
    this.elements.colormapVmaxSlider.max = formatColormapInputValue(bounds.max);
    this.elements.colormapVmaxSlider.step = step;
    this.elements.colormapVmaxSlider.value = formatColormapInputValue(vmax);
    this.elements.colormapRangeSlider.style.setProperty('--colormap-vmin-pct', `${minPct}%`);
    this.elements.colormapRangeSlider.style.setProperty('--colormap-vmax-pct', `${maxPct}%`);

    if (document.activeElement !== this.elements.colormapVminInput) {
      this.elements.colormapVminInput.value = formatColormapInputValue(range.min);
    }
    if (document.activeElement !== this.elements.colormapVmaxInput) {
      this.elements.colormapVmaxInput.value = formatColormapInputValue(range.max);
    }
  }

  private commitColormapMin(value: number): void {
    const current = this.currentColormapRange;
    if (!current || !Number.isFinite(value)) {
      this.setColormapRangeValues(current ?? { min: 0, max: 1 }, this.currentAutoColormapRange ?? current ?? { min: 0, max: 1 });
      return;
    }

    if (this.currentColormapZeroCentered) {
      this.callbacks.onColormapRangeChange(
        buildZeroCenteredColormapRange(
          { min: value, max: value },
          COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE
        ) ?? current
      );
      return;
    }

    this.callbacks.onColormapRangeChange({
      min: value,
      max: Math.max(value, current.max)
    });
  }

  private commitColormapMax(value: number): void {
    const current = this.currentColormapRange;
    if (!current || !Number.isFinite(value)) {
      this.setColormapRangeValues(current ?? { min: 0, max: 1 }, this.currentAutoColormapRange ?? current ?? { min: 0, max: 1 });
      return;
    }

    if (this.currentColormapZeroCentered) {
      this.callbacks.onColormapRangeChange(
        buildZeroCenteredColormapRange(
          { min: value, max: value },
          COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE
        ) ?? current
      );
      return;
    }

    this.callbacks.onColormapRangeChange({
      min: Math.min(current.min, value),
      max: value
    });
  }
}

function resolveElements(): Elements {
  return {
    mainLayout: requireElement('main-layout', HTMLElement),
    rightStack: requireElement('right-stack', HTMLElement),
    sidePanel: requireElement('inspector-panel', HTMLElement),
    imagePanel: requireElement('image-panel', HTMLElement),
    imagePanelResizer: requireElement('image-panel-resizer', HTMLElement),
    rightPanelResizer: requireElement('right-panel-resizer', HTMLElement),
    fileMenuButton: requireElement('file-menu-button', HTMLButtonElement),
    fileMenu: requireElement('file-menu', HTMLElement),
    galleryMenuButton: requireElement('gallery-menu-button', HTMLButtonElement),
    galleryMenu: requireElement('gallery-menu', HTMLElement),
    settingsMenuButton: requireElement('settings-menu-button', HTMLButtonElement),
    settingsMenu: requireElement('settings-menu', HTMLElement),
    galleryCboxRgbButton: requireElement('gallery-cbox-rgb-button', HTMLButtonElement),
    openFileButton: requireElement('open-file-button', HTMLButtonElement),
    fileInput: requireElement('file-input', HTMLInputElement),
    resetViewButton: requireElement('reset-view-button', HTMLButtonElement),
    visualizationNoneButton: requireElement('visualization-none-button', HTMLButtonElement),
    colormapToggleButton: requireElement('colormap-toggle-button', HTMLButtonElement),
    colormapRangeControl: requireElement('colormap-range-control', HTMLDivElement),
    colormapSelect: requireElement('colormap-select', HTMLSelectElement),
    stokesDegreeModulationControl: requireElement('stokes-degree-modulation-control', HTMLDivElement),
    stokesDegreeModulationButton: requireElement('stokes-degree-modulation-button', HTMLButtonElement),
    colormapAutoRangeButton: requireElement('colormap-auto-range-button', HTMLButtonElement),
    colormapZeroCenterButton: requireElement('colormap-zero-center-button', HTMLButtonElement),
    colormapRangeSlider: requireElement('colormap-range-slider', HTMLDivElement),
    colormapVminSlider: requireElement('colormap-vmin-slider', HTMLInputElement),
    colormapVmaxSlider: requireElement('colormap-vmax-slider', HTMLInputElement),
    colormapVminInput: requireElement('colormap-vmin-input', HTMLInputElement),
    colormapVmaxInput: requireElement('colormap-vmax-input', HTMLInputElement),
    exposureControl: requireElement('exposure-control', HTMLDivElement),
    exposureSlider: requireElement('exposure-slider', HTMLInputElement),
    exposureValue: requireElement('exposure-value', HTMLInputElement),
    errorBanner: requireElement('error-banner', HTMLDivElement),
    viewerContainer: requireElement('viewer-container', HTMLElement),
    dropOverlay: requireElement('drop-overlay', HTMLDivElement),
    loadingOverlay: requireElement('loading-overlay', HTMLDivElement),
    openedImagesSelect: requireElement('opened-images-select', HTMLSelectElement),
    openedFilesToggle: requireElement('opened-files-toggle', HTMLButtonElement),
    openedFilesList: requireElement('opened-files-list', HTMLElement),
    openedFilesCount: requireElement('opened-files-count', HTMLElement),
    displayCacheControl: requireElement('display-cache-control', HTMLDivElement),
    displayCacheBudgetInput: requireElement('display-cache-budget-input', HTMLSelectElement),
    displayCacheUsage: requireElement('display-cache-usage', HTMLElement),
    reloadAllOpenedImagesButton: requireElement('reload-all-opened-images-button', HTMLButtonElement),
    closeAllOpenedImagesButton: requireElement('close-all-opened-images-button', HTMLButtonElement),
    layerControl: requireElement('layer-control', HTMLDivElement),
    layerSelect: requireElement('layer-select', HTMLSelectElement),
    partsLayersToggle: requireElement('parts-layers-toggle', HTMLButtonElement),
    partsLayersList: requireElement('parts-layers-list', HTMLElement),
    partsLayersCount: requireElement('parts-layers-count', HTMLElement),
    rgbSplitToggleButton: requireElement('rgb-split-toggle-button', HTMLButtonElement),
    rgbGroupSelect: requireElement('rgb-group-select', HTMLSelectElement),
    channelViewToggle: requireElement('channel-view-toggle', HTMLButtonElement),
    channelViewList: requireElement('channel-view-list', HTMLElement),
    channelViewCount: requireElement('channel-view-count', HTMLElement),
    probeMode: requireElement('probe-mode', HTMLElement),
    probeCoords: requireElement('probe-coords', HTMLElement),
    probeColorPreview: requireElement('probe-color-preview', HTMLDivElement),
    probeColorSwatch: requireElement('probe-color-swatch', HTMLElement),
    probeColorValues: requireElement('probe-color-values', HTMLElement),
    probeValues: requireElement('probe-values', HTMLElement),
    probeMetadata: requireElement('probe-metadata', HTMLElement),
    glCanvas: requireElement('gl-canvas', HTMLCanvasElement),
    overlayCanvas: requireElement('overlay-canvas', HTMLCanvasElement)
  };
}

function createEmptyProbeDisplayValues(): ProbeDisplayValue[] {
  return [
    { label: 'R', value: '-' },
    { label: 'G', value: '-' },
    { label: 'B', value: '-' }
  ];
}

function formatCurrentChannelOptionLabel(selected: DisplaySelection): string {
  const channels = [
    selected.displayR,
    selected.displayG,
    selected.displayB,
    ...(selected.displayA ? [selected.displayA] : [])
  ];
  return channels.every((channel) => channel === channels[0])
    ? channels[0] ?? 'Current'
    : channels.join(',');
}

export function buildPartLayerItemsFromChannelNames(channelNames: string[]): LayerOptionItem[] {
  type PartGroup = {
    key: string;
    label: string;
    channelNames: Set<string>;
    firstIndex: number;
  };

  const groups = new Map<string, PartGroup>();
  const consumedRgbChannels = new Set<string>();

  const ensureGroup = (key: string, label: string, firstIndex: number): PartGroup => {
    const existing = groups.get(key);
    if (existing) {
      existing.firstIndex = Math.min(existing.firstIndex, firstIndex);
      return existing;
    }

    const group: PartGroup = {
      key,
      label,
      channelNames: new Set<string>(),
      firstIndex
    };
    groups.set(key, group);
    return group;
  };

  const rgbCandidates = new Map<string, { firstIndex: number; channels: Map<string, string> }>();
  channelNames.forEach((channelName, index) => {
    const parsed = parseRgbChannelName(channelName);
    if (!parsed) {
      return;
    }

    const candidate = rgbCandidates.get(parsed.base) ?? {
      firstIndex: index,
      channels: new Map<string, string>()
    };
    candidate.firstIndex = Math.min(candidate.firstIndex, index);
    candidate.channels.set(parsed.suffix, channelName);
    rgbCandidates.set(parsed.base, candidate);
  });

  for (const [base, candidate] of rgbCandidates.entries()) {
    if (!candidate.channels.has('R') || !candidate.channels.has('G') || !candidate.channels.has('B')) {
      continue;
    }

    const label = base || 'RGB';
    const group = ensureGroup(`rgb:${base}`, label, candidate.firstIndex);
    for (const channelName of candidate.channels.values()) {
      group.channelNames.add(channelName);
      consumedRgbChannels.add(channelName);
    }
  }

  channelNames.forEach((channelName, index) => {
    if (consumedRgbChannels.has(channelName)) {
      return;
    }

    const base = getChannelFamilyName(channelName);
    const group = ensureGroup(`scalar:${base}`, base, index);
    group.channelNames.add(channelName);
  });

  return Array.from(groups.values())
    .sort((a, b) => a.firstIndex - b.firstIndex || a.label.localeCompare(b.label))
    .map((group, index) => ({
      index,
      label: group.label,
      channelCount: group.channelNames.size,
      selectable: false
    }));
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

function parseRgbChannelName(channelName: string): { base: string; suffix: string } | null {
  if (channelName === 'R' || channelName === 'G' || channelName === 'B' || channelName === 'A') {
    return { base: '', suffix: channelName };
  }

  const dotIndex = channelName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= channelName.length - 1) {
    return null;
  }

  const suffix = channelName.slice(dotIndex + 1);
  if (suffix !== 'R' && suffix !== 'G' && suffix !== 'B' && suffix !== 'A') {
    return null;
  }

  return {
    base: channelName.slice(0, dotIndex),
    suffix
  };
}

function getChannelFamilyName(channelName: string): string {
  const dotIndex = channelName.lastIndexOf('.');
  if (dotIndex > 0 && dotIndex < channelName.length - 1) {
    return channelName.slice(0, dotIndex);
  }

  return channelName;
}

function createImageBrowserRow(options: {
  label: string;
  meta: string;
  selected: boolean;
  disabled: boolean;
  className: string;
  valueAttribute: string;
  value: string;
}): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `image-browser-row ${options.className}`;
  row.dataset[options.valueAttribute] = options.value;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', options.selected ? 'true' : 'false');
  row.setAttribute('aria-disabled', options.disabled ? 'true' : 'false');
  row.disabled = options.disabled;

  const label = document.createElement('span');
  label.className = 'image-browser-row-label';
  label.textContent = options.label;

  const meta = document.createElement('span');
  meta.className = 'image-browser-row-meta';
  meta.textContent = options.meta;

  row.append(label, meta);
  return row;
}

function createOpenedFileRow(options: {
  label: string;
  sourceDetail: string;
  sizeText: string;
  thumbnailDataUrl: string | null;
  pinned: boolean;
  selected: boolean;
  disabled: boolean;
  sessionId: string;
  onTogglePin: () => void;
  onReload: () => void;
  onClose: () => void;
}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'image-browser-row opened-file-row';
  row.dataset.sessionId = options.sessionId;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', options.selected ? 'true' : 'false');
  row.setAttribute('aria-disabled', options.disabled ? 'true' : 'false');
  row.tabIndex = options.disabled ? -1 : 0;

  const label = document.createElement('span');
  label.className = 'image-browser-row-label opened-file-label';
  label.textContent = options.label;
  label.title = `Path: ${options.sourceDetail}\nSize: ${options.sizeText}`;

  const actions = document.createElement('span');
  actions.className = 'opened-file-actions';

  actions.append(
    createOpenedFileActionButton({
      iconName: 'pin',
      label: getOpenedFilePinButtonLabel(options.label, options.pinned),
      disabled: options.disabled,
      pressed: options.pinned,
      onClick: options.onTogglePin
    }),
    createOpenedFileActionButton({
      iconName: 'reload',
      label: `Reload ${options.label}`,
      disabled: options.disabled,
      onClick: options.onReload
    }),
    createOpenedFileActionButton({
      iconName: 'close',
      label: `Close ${options.label}`,
      disabled: options.disabled,
      onClick: options.onClose
    })
  );

  row.append(createOpenedFileThumbnail(options.thumbnailDataUrl), label, actions);
  return row;
}

function createOpenedFileActionButton(options: {
  iconName: 'pin' | 'reload' | 'close';
  label: string;
  disabled: boolean;
  pressed?: boolean;
  onClick: () => void;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `opened-file-action-button opened-file-action-button--${options.iconName}`;
  button.disabled = options.disabled;
  button.setAttribute('aria-label', options.label);
  button.title = options.label;
  button.append(createOpenedFileActionIcon(options.iconName, options.pressed ?? false));

  if (options.iconName === 'pin') {
    button.setAttribute('aria-pressed', options.pressed ? 'true' : 'false');
    button.classList.toggle('is-pressed', Boolean(options.pressed));
  }

  button.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (button.disabled) {
      return;
    }
    options.onClick();
  });

  return button;
}

function createOpenedFileActionIcon(
  iconName: 'pin' | 'reload' | 'close',
  pressed = false
): SVGSVGElement {
  const svg = createSvgElement('svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  if (iconName === 'pin') {
    const head = createSvgElement('path');
    head.setAttribute('d', 'M7 4.2h6.2l-.9 3.1 2.3 2.2v1H5.4v-1l2.3-2.2-.7-3.1z');
    head.setAttribute('fill', pressed ? 'currentColor' : 'none');
    head.setAttribute('stroke', 'currentColor');
    head.setAttribute('stroke-linejoin', 'round');
    head.setAttribute('stroke-width', '1.35');

    const stem = createSvgElement('path');
    stem.setAttribute('d', 'M10 10.6v4.9');
    stem.setAttribute('fill', 'none');
    stem.setAttribute('stroke', 'currentColor');
    stem.setAttribute('stroke-linecap', 'round');
    stem.setAttribute('stroke-width', '1.5');

    const tip = createSvgElement('path');
    tip.setAttribute('d', 'M8.7 15.5L10 17l1.3-1.5');
    tip.setAttribute('fill', 'none');
    tip.setAttribute('stroke', 'currentColor');
    tip.setAttribute('stroke-linecap', 'round');
    tip.setAttribute('stroke-linejoin', 'round');
    tip.setAttribute('stroke-width', '1.5');

    svg.append(head, stem, tip);
    return svg;
  }

  if (iconName === 'reload') {
    const path = createSvgElement('path');
    path.setAttribute('d', 'M15.5 7.2A6 6 0 1 0 16 12');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '1.7');

    const arrow = createSvgElement('path');
    arrow.setAttribute('d', 'M15.5 3.6v3.6h-3.6');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor');
    arrow.setAttribute('stroke-linecap', 'round');
    arrow.setAttribute('stroke-linejoin', 'round');
    arrow.setAttribute('stroke-width', '1.7');

    svg.append(path, arrow);
    return svg;
  }

  const first = createSvgElement('path');
  first.setAttribute('d', 'M5.8 5.8l8.4 8.4');
  first.setAttribute('fill', 'none');
  first.setAttribute('stroke', 'currentColor');
  first.setAttribute('stroke-linecap', 'round');
  first.setAttribute('stroke-width', '1.9');

  const second = createSvgElement('path');
  second.setAttribute('d', 'M14.2 5.8l-8.4 8.4');
  second.setAttribute('fill', 'none');
  second.setAttribute('stroke', 'currentColor');
  second.setAttribute('stroke-linecap', 'round');
  second.setAttribute('stroke-width', '1.9');

  svg.append(first, second);
  return svg;
}

function createEmptyListMessage(message: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'image-browser-empty';
  element.textContent = message;
  return element;
}

function createFileRowIcon(): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'file-row-icon';
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function createOpenedFileThumbnail(thumbnailDataUrl: string | null): HTMLElement {
  if (!thumbnailDataUrl) {
    return createFileRowIcon();
  }

  const image = document.createElement('img');
  image.className = 'opened-file-thumbnail';
  image.src = thumbnailDataUrl;
  image.alt = '';
  image.draggable = false;
  image.setAttribute('aria-hidden', 'true');
  return image;
}

function createLayerRowIcon(): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'layer-row-icon';
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function createChannelViewIcon(swatches: string[]): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'channel-view-icon';
  icon.setAttribute('aria-hidden', 'true');

  for (const swatchColor of swatches.slice(0, 3)) {
    const swatch = document.createElement('span');
    swatch.className = 'channel-view-swatch';
    swatch.style.backgroundColor = swatchColor;
    icon.append(swatch);
  }

  if (icon.childElementCount === 0) {
    const swatch = document.createElement('span');
    swatch.className = 'channel-view-swatch';
    swatch.style.backgroundColor = '#9aa4b4';
    icon.append(swatch);
  }

  return icon;
}

function createChannelViewRowItem(value: string, label: string, mapping: DisplaySelection): ChannelViewRowItem {
  const precisionCount = getDisplayMappingChannelCount(mapping);
  return {
    value,
    label: formatChannelViewLabel(label),
    meta: precisionCount > 1 ? `32f x ${precisionCount}` : '32f',
    swatches: getChannelViewSwatches(mapping)
  };
}

function formatChannelViewLabel(label: string): string {
  if (label === 'R,G,B,A') {
    return 'RGBA';
  }
  if (label === 'R,G,B') {
    return 'RGB';
  }

  return label
    .replace(/\.\(R,G,B,A\)/g, '.RGBA')
    .replace(/\.\(R,G,B\)/g, '.RGB');
}

function getDisplayMappingChannelCount(mapping: DisplayChannelMapping): number {
  return new Set([
    mapping.displayR,
    mapping.displayG,
    mapping.displayB,
    ...(mapping.displayA ? [mapping.displayA] : [])
  ]).size;
}

export function getChannelViewSwatches(mapping: DisplayChannelMapping): string[] {
  const displayChannels = [mapping.displayR, mapping.displayG, mapping.displayB];
  if (displayChannels.every((channelName) => channelName === mapping.displayR)) {
    const swatches = [getRepresentativeChannelColor(mapping.displayR)];
    if (mapping.displayA && mapping.displayA !== mapping.displayR) {
      swatches.push(getRepresentativeChannelColor(mapping.displayA));
    }
    return swatches;
  }

  const channels = [
    ...displayChannels,
    ...(mapping.displayA ? [mapping.displayA] : [])
  ];
  const uniqueChannels = Array.from(new Set(channels));
  return uniqueChannels.slice(0, 3).map(getRepresentativeChannelColor);
}

function getRepresentativeChannelColor(channelName: string): string {
  const suffix = channelName.includes('.') ? channelName.slice(channelName.lastIndexOf('.') + 1) : channelName;
  const normalized = suffix.toUpperCase();
  if (normalized === 'R') {
    return '#ff6570';
  }
  if (normalized === 'G') {
    return '#6bd66f';
  }
  if (normalized === 'B') {
    return '#51aefe';
  }
  if (normalized === 'A') {
    return '#c6cbd2';
  }
  if (normalized === 'Z') {
    return '#8f83e6';
  }
  if (normalized === 'Y' || normalized === 'L') {
    return '#d7dde8';
  }
  if (normalized === 'V') {
    return '#11bfb8';
  }
  if (normalized === 'X' || normalized === 'U') {
    return '#f0b85a';
  }

  const palette = ['#11bfb8', '#b48cf2', '#f0719a', '#8bd36f', '#f0b85a', '#7aa7ff'];
  return palette[Math.abs(hashString(channelName)) % palette.length] ?? '#9aa4b4';
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function formatFileSizeMb(sizeBytes: number | null): string {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return '-- MB';
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatChannelCount(channelCount: number): string {
  const count = Math.max(0, Math.floor(channelCount));
  return `${count}ch`;
}

export function getOpenedFilePinButtonLabel(label: string, pinned: boolean): string {
  return `${pinned ? 'Unpin' : 'Pin'} cache for ${label}`;
}

export function formatDisplayCacheUsageText(usedBytes: number, budgetBytes: number): string {
  return `${formatDisplayCacheMegabytes(usedBytes)} / ${formatDisplayCacheMegabytes(budgetBytes)} MB`;
}

export function getDisplayCacheUsageState(
  usedBytes: number,
  budgetBytes: number
): { text: string; overBudget: boolean } {
  return {
    text: formatDisplayCacheUsageText(usedBytes, budgetBytes),
    overBudget: usedBytes > budgetBytes
  };
}

function findClosestListRow(target: EventTarget | null, datasetKey: string): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const row = target.closest<HTMLElement>('.image-browser-row');
  if (!row || !row.dataset[datasetKey]) {
    return null;
  }

  return row;
}

function getImageBrowserRows(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('.image-browser-row')).filter(
    (row) => !(row instanceof HTMLButtonElement && row.disabled) && row.getAttribute('aria-disabled') !== 'true'
  );
}

function getFocusedImageBrowserRow(list: HTMLElement, activeElement: HTMLElement): HTMLElement | null {
  if (!list.contains(activeElement)) {
    return null;
  }

  const row = activeElement.closest<HTMLElement>('.image-browser-row');
  return row && list.contains(row) ? row : null;
}

function isFocusWithinElement(element: HTMLElement): boolean {
  return document.activeElement instanceof HTMLElement && element.contains(document.activeElement);
}

function focusSelectedImageBrowserRow(list: HTMLElement): void {
  const selectedRow = getImageBrowserRows(list).find(isSelectedRow);
  selectedRow?.focus();
}

function isNestedInteractiveListControl(target: EventTarget | null, row: HTMLElement | null): boolean {
  if (!row || !(target instanceof Element)) {
    return false;
  }

  const control = target.closest<HTMLElement>('button, input, select, textarea, a[href], [role="button"]');
  return Boolean(control && control !== row && row.contains(control));
}

function isSelectedRow(row: HTMLElement): boolean {
  return row.getAttribute('aria-selected') === 'true';
}

function getImageBrowserRowValueAtClientY(
  list: HTMLElement,
  clientY: number,
  datasetKey: string
): string | null {
  const rows = getImageBrowserRows(list);
  if (rows.length === 0) {
    return null;
  }

  const listRect = list.getBoundingClientRect();
  if (clientY < listRect.top || clientY > listRect.bottom) {
    return null;
  }

  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return row.dataset[datasetKey] ?? null;
    }
  }

  if (clientY < rows[0].getBoundingClientRect().top) {
    return rows[0].dataset[datasetKey] ?? null;
  }

  return rows[rows.length - 1]?.dataset[datasetKey] ?? null;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName) as SVGElementTagNameMap[K];
}

function requireElement<T extends Element>(id: string, type: { new (): T }): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }

  if (!(element instanceof type)) {
    throw new Error(`Element #${id} is not of expected type.`);
  }

  return element;
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

function cloneRange(range: DisplayLuminanceRange | null): DisplayLuminanceRange | null {
  return range ? { min: range.min, max: range.max } : null;
}

function buildColormapCssGradient(lut: ColormapLut): string {
  const stopCount = Math.min(COLORMAP_GRADIENT_STOP_COUNT, Math.max(2, lut.entryCount));
  const stops: string[] = [];

  for (let index = 0; index < stopCount; index += 1) {
    const t = stopCount === 1 ? 0 : index / (stopCount - 1);
    const [r, g, b] = sampleColormapRgbBytes(lut, t);
    stops.push(`rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(2)}%`);
  }

  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function buildColormapSliderBounds(
  range: DisplayLuminanceRange,
  autoRange: DisplayLuminanceRange,
  zeroCentered = false
): DisplayLuminanceRange {
  if (zeroCentered) {
    return buildZeroCenteredColormapRange({
      min: Math.min(range.min, range.max, autoRange.min, autoRange.max),
      max: Math.max(range.min, range.max, autoRange.min, autoRange.max)
    }) ?? { min: -1, max: 1 };
  }

  let min = Math.min(range.min, range.max, autoRange.min, autoRange.max);
  let max = Math.max(range.min, range.max, autoRange.min, autoRange.max);

  if (max <= min) {
    const margin = Math.max(1, Math.abs(min) * 0.1);
    min -= margin;
    max += margin;
  }

  return { min, max };
}

function formatColormapInputValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return Number(value.toPrecision(7)).toString();
}

function formatColormapRangeStep(min: number, max: number): string {
  const span = Math.abs(max - min);
  if (!Number.isFinite(span) || span <= 0) {
    return 'any';
  }

  return Number((span / 1000).toPrecision(4)).toString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatDisplayCacheMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0';
  }

  return Math.round(bytes / (1024 * 1024)).toString();
}

function readElementSize(element: HTMLElement, axis: 'width' | 'height', fallback: number): number {
  const rect = element.getBoundingClientRect();
  const value = axis === 'width' ? rect.width : rect.height;
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function readStoredPanelSplitSizes(): Partial<PanelSplitSizes> {
  try {
    return parsePanelSplitStorageValue(window.localStorage.getItem(PANEL_SPLIT_STORAGE_KEY));
  } catch {
    return {};
  }
}

function saveStoredPanelSplitSizes(sizes: PanelSplitSizes): void {
  try {
    window.localStorage.setItem(
      PANEL_SPLIT_STORAGE_KEY,
      JSON.stringify({
        imagePanelWidth: Math.round(sizes.imagePanelWidth),
        rightPanelWidth: Math.round(sizes.rightPanelWidth)
      })
    );
  } catch {
    // Storage can be unavailable in private contexts; resizing should still work for the current page.
  }
}

export function parsePanelSplitStorageValue(value: string | null): Partial<PanelSplitSizes> {
  if (!value) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const record = parsed as Record<string, unknown>;
  const sizes: Partial<PanelSplitSizes> = {};
  const keys: PanelSplitSizeKey[] = ['imagePanelWidth', 'rightPanelWidth'];

  for (const key of keys) {
    const item = record[key];
    if (typeof item === 'number' && Number.isFinite(item) && item > 0) {
      sizes[key] = item;
    }
  }

  return sizes;
}

export function getPanelSplitKeyboardAction(
  key: string,
  shiftKey: boolean
): PanelSplitKeyboardAction | null {
  if (key === 'Home') {
    return { type: 'snap', target: 'min' };
  }
  if (key === 'End') {
    return { type: 'snap', target: 'max' };
  }

  const step = shiftKey ? PANEL_SPLIT_KEYBOARD_LARGE_STEP : PANEL_SPLIT_KEYBOARD_STEP;
  if (key === 'ArrowLeft' || key === 'Left') {
    return { type: 'delta', delta: -step };
  }
  if (key === 'ArrowRight' || key === 'Right') {
    return { type: 'delta', delta: step };
  }

  return null;
}

export function clampPanelSplitSizes(
  sizes: PanelSplitSizes,
  metrics: PanelSplitMetrics,
  activeKey: PanelSplitSizeKey | null = null
): PanelSplitSizes {
  const sideWidthLimit = getSidePanelWidthLimit(metrics);
  const clampedSizes: PanelSplitSizes = {
    imagePanelWidth: clampFiniteSize(sizes.imagePanelWidth, IMAGE_PANEL_MIN_WIDTH, IMAGE_PANEL_MAX_WIDTH),
    rightPanelWidth: clampFiniteSize(sizes.rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH)
  };

  let overflow = clampedSizes.imagePanelWidth + clampedSizes.rightPanelWidth - sideWidthLimit;
  if (overflow > 0) {
    const reductionOrder: PanelSplitSizeKey[] =
      activeKey === 'imagePanelWidth'
        ? ['rightPanelWidth', 'imagePanelWidth']
        : activeKey === 'rightPanelWidth'
          ? ['imagePanelWidth', 'rightPanelWidth']
          : ['rightPanelWidth', 'imagePanelWidth'];

    for (const key of reductionOrder) {
      if (overflow <= 0) {
        break;
      }

      const min = key === 'imagePanelWidth' ? IMAGE_PANEL_MIN_WIDTH : RIGHT_PANEL_MIN_WIDTH;
      const reduction = Math.min(overflow, clampedSizes[key] - min);
      clampedSizes[key] -= reduction;
      overflow -= reduction;
    }
  }

  return {
    imagePanelWidth: Math.round(clampedSizes.imagePanelWidth),
    rightPanelWidth: Math.round(clampedSizes.rightPanelWidth)
  };
}

export function getPanelSplitSizeRange(
  key: PanelSplitSizeKey,
  sizes: PanelSplitSizes,
  metrics: PanelSplitMetrics
): { min: number; max: number } {
  if (key === 'imagePanelWidth') {
    const rightWidth = clampFiniteSize(sizes.rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH);
    return {
      min: IMAGE_PANEL_MIN_WIDTH,
      max: Math.max(IMAGE_PANEL_MIN_WIDTH, Math.min(IMAGE_PANEL_MAX_WIDTH, getSidePanelWidthLimit(metrics) - rightWidth))
    };
  }

  if (key === 'rightPanelWidth') {
    const imageWidth = clampFiniteSize(sizes.imagePanelWidth, IMAGE_PANEL_MIN_WIDTH, IMAGE_PANEL_MAX_WIDTH);
    return {
      min: RIGHT_PANEL_MIN_WIDTH,
      max: Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, getSidePanelWidthLimit(metrics) - imageWidth))
    };
  }

  throw new Error(`Unknown panel split size key: ${key}`);
}

function getSidePanelWidthLimit(metrics: PanelSplitMetrics): number {
  const availableWidth =
    metrics.mainWidth - metrics.imageResizerWidth - metrics.rightResizerWidth - VIEWER_MIN_WIDTH;
  return Math.max(IMAGE_PANEL_MIN_WIDTH + RIGHT_PANEL_MIN_WIDTH, Math.floor(availableWidth));
}

function clampFiniteSize(value: number, min: number, max: number): number {
  return clamp(Number.isFinite(value) ? value : min, min, max);
}

export function getListboxOptionIndexAtClientY(clientY: number, metrics: ListboxHitTestMetrics): number {
  if (metrics.optionCount <= 0 || metrics.height <= 0) {
    return -1;
  }

  if (clientY < metrics.top || clientY >= metrics.top + metrics.height) {
    return -1;
  }

  const totalContentHeight = Math.max(metrics.height, metrics.scrollHeight);
  const rowHeight = totalContentHeight / metrics.optionCount;
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
    return -1;
  }

  const relativeY = clientY - metrics.top;
  const position = metrics.scrollTop + relativeY;
  const rawIndex = Math.floor(position / rowHeight);
  return Math.min(metrics.optionCount - 1, Math.max(0, rawIndex));
}
