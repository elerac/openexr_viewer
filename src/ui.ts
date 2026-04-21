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
  getOpenedFilePinButtonLabel,
  OpenedImagesPanel
} from './ui/opened-images-panel';
import { getListboxOptionIndexAtClientY } from './ui/render-helpers';
import { formatOverlayValue } from './value-format';
import type { ColormapLut } from './colormaps';
import type { DisplaySelection, DisplayLuminanceRange, ExrMetadataEntry, PixelSample, VisualizationMode } from './types';
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

interface ProbeCoordinateImageSize {
  width: number;
  height: number;
}

interface TopMenuElements {
  button: HTMLButtonElement;
  menu: HTMLElement;
}

type TopMenuTrackingMode = 'inactive' | 'pointer';

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

export class ViewerUi {
  private readonly elements: Elements;
  private readonly loadingOverlayDisclosure: ProgressiveLoadingOverlayDisclosure;
  private readonly openedImagesPanel: OpenedImagesPanel;
  private readonly layerPanel: LayerPanel;
  private readonly channelPanel: ChannelPanel;
  private readonly colormapPanel: ColormapPanel;
  private readonly layoutSplitController: LayoutSplitController;
  private isLoading = false;
  private isRgbViewLoading = false;
  private topMenuTrackingMode: TopMenuTrackingMode = 'inactive';
  private hoverOpenedTopMenuButton: HTMLButtonElement | null = null;

  constructor(private readonly callbacks: UiCallbacks) {
    this.elements = resolveElements();
    this.loadingOverlayDisclosure = new ProgressiveLoadingOverlayDisclosure((phase) => {
      this.renderLoadingOverlayPhase(phase);
    });
    this.openedImagesPanel = new OpenedImagesPanel(this.elements, {
      onOpenedImageSelected: (sessionId) => {
        this.callbacks.onOpenedImageSelected(sessionId);
      },
      onReorderOpenedImage: (draggedSessionId, targetSessionId) => {
        this.callbacks.onReorderOpenedImage(draggedSessionId, targetSessionId);
      },
      onDisplayCacheBudgetChange: (mb) => {
        this.callbacks.onDisplayCacheBudgetChange(mb);
      },
      onToggleOpenedImagePin: (sessionId) => {
        this.callbacks.onToggleOpenedImagePin(sessionId);
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
    this.isLoading = loading;
    this.elements.openFileButton.disabled = loading;
    this.elements.galleryCboxRgbButton.disabled = loading;
    this.elements.resetViewButton.disabled = loading;
    this.openedImagesPanel.setLoading(loading);
    this.layerPanel.setLoading(loading);
    this.channelPanel.setLoading(loading);
    this.colormapPanel.setLoading(loading);
    this.updateLoadingOverlayVisibility();
  }

  setRgbViewLoading(loading: boolean): void {
    this.isRgbViewLoading = loading;
    this.channelPanel.setRgbViewLoading(loading);
    this.updateLoadingOverlayVisibility();
  }

  setDisplayCacheBudget(mb: number): void {
    this.openedImagesPanel.setDisplayCacheBudget(mb);
  }

  setDisplayCacheUsage(usedBytes: number, budgetBytes: number): void {
    this.openedImagesPanel.setDisplayCacheUsage(usedBytes, budgetBytes);
  }

  setExposure(exposureEv: number): void {
    this.colormapPanel.setExposure(exposureEv);
  }

  setVisualizationMode(mode: VisualizationMode): void {
    this.colormapPanel.setVisualizationMode(mode);
  }

  setColormapOptions(items: Array<{ id: string; label: string }>, activeId: string): void {
    this.colormapPanel.setColormapOptions(items, activeId);
  }

  setActiveColormap(activeId: string): void {
    this.colormapPanel.setActiveColormap(activeId);
  }

  setColormapGradient(lut: ColormapLut | null): void {
    this.colormapPanel.setColormapGradient(lut);
  }

  setColormapRange(
    range: DisplayLuminanceRange | null,
    autoRange: DisplayLuminanceRange | null,
    alwaysAuto = false,
    zeroCentered = false
  ): void {
    this.colormapPanel.setColormapRange(range, autoRange, alwaysAuto, zeroCentered);
  }

  setStokesDegreeModulationControl(label: string | null, enabled = false): void {
    this.colormapPanel.setStokesDegreeModulationControl(label, enabled);
  }

  setOpenedImageOptions(items: OpenedImageOptionItem[], activeId: string | null): void {
    this.openedImagesPanel.setOpenedImageOptions(items, activeId);
    this.colormapPanel.setOpenedImageCount(this.openedImagesPanel.getOpenedImageCount());
  }

  clearImageBrowserPanels(): void {
    this.layerPanel.clearForNoImage();
    this.channelPanel.clearForNoImage();
  }

  setLayerOptions(items: LayerOptionItem[], activeIndex: number): void {
    this.layerPanel.setLayerOptions(items, activeIndex);
  }

  setRgbGroupOptions(channelNames: string[], selected: DisplaySelection | null): void {
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
    this.elements.probeMode.textContent = mode;

    if (!sample) {
      this.elements.probeCoords.textContent = formatProbeCoordinates(null, imageSize);
      this.elements.probeColorPreview.classList.add('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = 'transparent';
      this.renderProbeDisplayValues(createEmptyProbeDisplayValues());
      this.elements.probeValues.replaceChildren();
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
    this.elements.probeValues.replaceChildren(
      ...channelEntries.map(([channelName, channelValue]) => {
        const row = document.createElement('div');
        row.className = 'probe-row';

        const key = document.createElement('span');
        key.className = 'probe-key';
        key.textContent = channelName;

        const value = document.createElement('span');
        value.className = 'probe-value';
        value.textContent = formatOverlayValue(channelValue);

        row.append(key, value);
        return row;
      })
    );
  }

  setProbeMetadata(metadata: ExrMetadataEntry[] | null): void {
    if (!metadata || metadata.length === 0) {
      this.elements.probeMetadata.classList.add('hidden');
      this.elements.probeMetadata.replaceChildren();
      return;
    }

    this.elements.probeMetadata.classList.remove('hidden');
    this.elements.probeMetadata.replaceChildren(
      ...metadata.map((item) => {
        const row = document.createElement('div');
        row.className = 'probe-metadata-row';

        const key = document.createElement('span');
        key.className = 'probe-metadata-key';
        key.textContent = item.label;

        const value = document.createElement('span');
        value.className = 'probe-metadata-value';
        value.textContent = item.value;

        row.append(key, value);
        return row;
      })
    );
  }

  showDropOverlay(show: boolean): void {
    if (show) {
      this.elements.dropOverlay.classList.remove('hidden');
      return;
    }
    this.elements.dropOverlay.classList.add('hidden');
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

  private bindTopMenu(menu: TopMenuElements): void {
    menu.button.addEventListener('click', () => {
      if (this.hoverOpenedTopMenuButton === menu.button && this.isTopMenuOpen(menu)) {
        this.hoverOpenedTopMenuButton = null;
        return;
      }

      this.hoverOpenedTopMenuButton = null;
      this.toggleTopMenu(menu);
    });

    menu.button.addEventListener('pointerenter', () => {
      if (this.topMenuTrackingMode !== 'pointer' || this.isTopMenuOpen(menu)) {
        return;
      }

      menu.button.focus();
      this.openTopMenu(menu, null, 'pointer');
      this.hoverOpenedTopMenuButton = menu.button;
    });

    menu.button.addEventListener('keydown', (event) => {
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

  private renderProbeDisplayValues(displayValues: ProbeDisplayValue[]): void {
    this.elements.probeColorValues.replaceChildren(
      ...displayValues.map((item) => {
        const row = document.createElement('div');
        row.className = 'probe-color-row';

        const channel = document.createElement('span');
        channel.className = 'probe-color-channel';
        channel.textContent = `${item.label}:`;

        const value = document.createElement('span');
        value.className = 'probe-color-number';
        value.textContent = item.value;

        row.append(channel, value);
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

export {
  buildPartLayerItemsFromChannelNames,
  clampPanelSplitSizes,
  formatDisplayCacheUsageText,
  getChannelViewSwatches,
  getDisplayCacheUsageState,
  getListboxOptionIndexAtClientY,
  getOpenedFilePinButtonLabel,
  getPanelSplitKeyboardAction,
  parsePanelSplitStorageValue
};
