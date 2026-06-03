import { formatProbeCoordinates } from '../ui/probe-readout';
import type { ViewerRuntimeUi, ScreenshotSelectionInteractionState } from '../ui/viewer-runtime-ui';
import { ChannelThumbnailStrip } from '../ui/channel-thumbnail-strip';
import {
  buildChannelViewStacks,
  findSelectedChannelViewItem,
  pruneExpandedChannelStackKeys,
  selectStackedChannelViewItems,
  type ChannelViewStackInfo,
  type ChannelViewStackedThumbnailItem
} from '../channel-view-items';
import {
  cloneDisplaySelection,
  sameDisplaySelection
} from '../display-model';
import type { ViewportClientRect } from '../interaction/image-geometry';
import type {
  ScreenshotSelectionHandle,
  ScreenshotSelectionSnapGuide
} from '../interaction/screenshot-selection';
import type { ProbeColorPreview } from '../probe';
import type {
  DisplayLuminanceRange,
  DisplaySelection,
  ExrMetadataEntry,
  ExportImageBatchTarget,
  ExportImageTarget,
  ImageRoi,
  PixelSample,
  RoiStats,
  StokesAolpDegreeModulationMode,
  ViewerMode,
  ViewportRect,
  VisualizationMode
} from '../types';
import type { ColormapLut } from '../colormaps';
import type {
  ImageStatsReadoutModel,
  SpectralPlotReadoutModel,
  ViewerLayerOption,
  ViewerOpenedImageOption,
  ViewerStateReadoutModel
} from '../app/viewer-app-types';
import type {
  StokesColormapDefaultSettings,
  StokesParameterVisibilitySettings
} from '../stokes';
import type { ChannelRecognitionSettings } from '../channel-recognition-settings';
import type { ChannelRecognitionNameRules } from '../channel-recognition-name-rules';
import type {
  ViewerPaneLayoutState,
  ViewerPaneRenderInfo
} from '../viewer-pane-layout';
import type { ChannelThumbnailOptionItem } from '../ui/viewer-ui';
import type { EmbedBottomPanelMode } from './embed-params';
import type { ViewerBackgroundId } from '../viewer-background-settings';

interface EmbedViewerUiCallbacks {
  bottomPanel?: EmbedBottomPanelMode;
  onChannelSelection?: (selection: DisplaySelection) => void;
  onOpenFull: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const EMBED_CHANNEL_PANEL_STOP_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'click',
  'dblclick',
  'contextmenu',
  'wheel',
  'keydown',
  'keyup'
];

function createOpenFullIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const frame = document.createElementNS(SVG_NS, 'path');
  frame.setAttribute('d', 'M8.5 5.5H6A2.5 2.5 0 0 0 3.5 8v6A2.5 2.5 0 0 0 6 16.5h6a2.5 2.5 0 0 0 2.5-2.5v-2.5');
  frame.setAttribute('fill', 'none');
  frame.setAttribute('stroke', 'currentColor');
  frame.setAttribute('stroke-linecap', 'round');
  frame.setAttribute('stroke-linejoin', 'round');
  frame.setAttribute('stroke-width', '1.7');

  const arrow = document.createElementNS(SVG_NS, 'path');
  arrow.setAttribute('d', 'M10.5 3.5h6v6m0-6L9.5 10.5');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('stroke-linejoin', 'round');
  arrow.setAttribute('stroke-width', '1.7');

  svg.append(frame, arrow);
  return svg;
}

export class EmbedViewerUi implements ViewerRuntimeUi {
  readonly viewerContainer: HTMLElement;
  readonly glCanvas: HTMLCanvasElement;
  readonly overlayCanvas: HTMLCanvasElement;
  readonly probeOverlayCanvas: HTMLCanvasElement;
  readonly rulerOverlaySvg: SVGSVGElement;
  readonly rulerLabelOverlay: HTMLElement;

  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly sourceLabel: HTMLElement;
  private readonly probe: HTMLElement;
  private readonly probeSwatch: HTMLElement;
  private readonly probeCoords: HTMLElement;
  private readonly probeValues: HTMLElement;
  private readonly channelPanel: HTMLElement;
  private readonly channelThumbnailStripElement: HTMLElement;
  private readonly channelThumbnailStrip: ChannelThumbnailStrip | null;
  private readonly deferredLoadButton: HTMLButtonElement;
  private readonly openFullButton: HTMLButtonElement;
  private readonly bottomPanelMode: EmbedBottomPanelMode;
  private channelThumbnailItems: ChannelThumbnailOptionItem[] = [];
  private rgbGroupChannelNames: string[] = [];
  private currentChannelSelection: DisplaySelection | null = null;
  private channelStackScopeKey = 'default';
  private readonly expandedChannelStackKeysByScope = new Map<string, Set<string>>();
  private deferredLoadHandler: (() => void | Promise<void>) | null = null;
  private viewport = { width: 1, height: 1 };
  private disposed = false;

  constructor(private readonly callbacks: EmbedViewerUiCallbacks) {
    this.bottomPanelMode = callbacks.bottomPanel ?? 'probe';
    document.body.replaceChildren();
    document.body.classList.add('embed-body');

    this.root = document.createElement('main');
    this.root.className = 'embed-shell';

    this.viewerContainer = document.createElement('section');
    this.viewerContainer.id = 'viewer-container';
    this.viewerContainer.className = 'viewer-container embed-viewer-container';
    this.viewerContainer.setAttribute('aria-label', 'Prismifold image viewer');
    this.viewerContainer.tabIndex = 0;

    this.glCanvas = document.createElement('canvas');
    this.glCanvas.id = 'gl-canvas';
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.id = 'overlay-canvas';
    this.probeOverlayCanvas = document.createElement('canvas');
    this.probeOverlayCanvas.id = 'probe-overlay-canvas';
    this.rulerOverlaySvg = document.createElementNS(SVG_NS, 'svg');
    this.rulerOverlaySvg.id = 'ruler-overlay-svg';
    this.rulerLabelOverlay = document.createElement('div');
    this.rulerLabelOverlay.id = 'ruler-label-overlay';
    this.rulerLabelOverlay.className = 'ruler-label-overlay';

    this.status = document.createElement('div');
    this.status.className = 'embed-status hidden';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    this.deferredLoadButton = document.createElement('button');
    this.deferredLoadButton.className = 'embed-deferred-load-button hidden';
    this.deferredLoadButton.type = 'button';
    this.deferredLoadButton.textContent = 'Click to load image';
    this.deferredLoadButton.addEventListener('pointerdown', stopViewerInteractionEvent);
    this.deferredLoadButton.addEventListener('click', this.handleDeferredLoadClick);

    const toolbar = document.createElement('div');
    toolbar.className = 'embed-toolbar';
    this.sourceLabel = document.createElement('div');
    this.sourceLabel.className = 'embed-source-label hidden';
    this.openFullButton = document.createElement('button');
    this.openFullButton.className = 'embed-open-full-button';
    this.openFullButton.type = 'button';
    this.openFullButton.setAttribute('aria-label', 'Open full viewer');
    this.openFullButton.title = 'Open full viewer';
    this.openFullButton.append(createOpenFullIcon());
    this.openFullButton.disabled = true;
    this.openFullButton.addEventListener('pointerdown', stopViewerInteractionEvent);
    this.openFullButton.addEventListener('click', this.handleOpenFullClick);
    toolbar.append(this.sourceLabel, this.openFullButton);

    this.probe = document.createElement('aside');
    this.probe.className = 'embed-probe is-empty';
    this.probe.setAttribute('aria-label', 'Pixel probe');
    this.probeSwatch = document.createElement('span');
    this.probeSwatch.className = 'embed-probe-swatch';
    this.probeCoords = document.createElement('span');
    this.probeCoords.className = 'embed-probe-coords';
    this.probeCoords.textContent = formatProbeCoordinates(null);
    this.probeValues = document.createElement('span');
    this.probeValues.className = 'embed-probe-values';
    this.probe.append(this.probeSwatch, this.probeCoords, this.probeValues);
    this.probe.classList.toggle('hidden', this.bottomPanelMode !== 'probe');

    this.channelPanel = document.createElement('aside');
    this.channelPanel.className = 'embed-channel-panel bottom-panel is-collapsed hidden';
    this.channelPanel.setAttribute('aria-label', 'Channel selection');
    this.channelThumbnailStripElement = document.createElement('div');
    this.channelThumbnailStripElement.className = 'channel-thumbnail-strip';
    this.channelThumbnailStripElement.setAttribute('role', 'listbox');
    this.channelThumbnailStripElement.setAttribute('aria-label', 'Channel thumbnails');
    this.channelPanel.append(this.channelThumbnailStripElement);
    for (const eventName of EMBED_CHANNEL_PANEL_STOP_EVENTS) {
      this.channelPanel.addEventListener(eventName, stopViewerInteractionEvent);
    }
    this.channelThumbnailStrip = this.bottomPanelMode === 'channels'
      ? new ChannelThumbnailStrip({
          channelThumbnailStrip: this.channelThumbnailStripElement,
          viewerContainer: this.viewerContainer
        }, {
          onChannelViewChange: (value) => {
            this.handleChannelViewValueChange(value);
          },
          onChannelStackToggle: (stackKey) => {
            this.handleChannelStackToggle(stackKey);
          },
          onCollapsedContentAvailabilityChange: (available) => {
            this.channelPanel.classList.toggle('hidden', !available);
          }
        })
      : null;

    this.viewerContainer.append(
      this.glCanvas,
      this.overlayCanvas,
      this.probeOverlayCanvas,
      this.rulerOverlaySvg,
      this.rulerLabelOverlay,
      toolbar,
      this.deferredLoadButton,
      this.status,
      this.probe,
      this.channelPanel
    );
    this.root.append(this.viewerContainer);
    document.body.append(this.root);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.deferredLoadHandler = null;
    this.deferredLoadButton.removeEventListener('pointerdown', stopViewerInteractionEvent);
    this.deferredLoadButton.removeEventListener('click', this.handleDeferredLoadClick);
    this.openFullButton.removeEventListener('pointerdown', stopViewerInteractionEvent);
    this.openFullButton.removeEventListener('click', this.handleOpenFullClick);
    for (const eventName of EMBED_CHANNEL_PANEL_STOP_EVENTS) {
      this.channelPanel.removeEventListener(eventName, stopViewerInteractionEvent);
    }
    this.channelThumbnailStrip?.dispose();
    document.body.classList.remove('embed-body');
  }

  setError(message: string | null): void {
    if (this.disposed) {
      return;
    }

    if (!message) {
      this.status.classList.add('hidden');
      this.status.classList.remove('is-error');
      this.status.textContent = '';
      return;
    }

    this.status.classList.remove('hidden');
    this.status.classList.add('is-error');
    this.status.textContent = message;
  }

  setLoading(loading: boolean, viewerBlocked = loading): void {
    if (this.disposed) {
      return;
    }

    this.channelThumbnailStrip?.setLoading(viewerBlocked);

    if (loading) {
      this.deferredLoadButton.classList.add('hidden');
      this.deferredLoadButton.disabled = true;
    }

    if (!loading) {
      if (!this.status.classList.contains('is-error')) {
        this.status.classList.add('hidden');
        this.status.textContent = '';
      }
      return;
    }

    this.status.classList.remove('hidden', 'is-error');
    this.status.textContent = 'Loading image...';
  }

  setDeferredLoad(handler: (() => void | Promise<void>) | null): void {
    if (this.disposed) {
      return;
    }

    this.deferredLoadHandler = handler;
    this.deferredLoadButton.disabled = false;
    this.deferredLoadButton.classList.toggle('hidden', !handler);
  }

  setRgbViewLoading(displayBusy: boolean, overlayLoading = displayBusy): void {
    if (this.disposed) {
      return;
    }
    if (!overlayLoading) {
      if (this.status.textContent === 'Updating display...' && !this.status.classList.contains('is-error')) {
        this.status.classList.add('hidden');
        this.status.textContent = '';
      }
      return;
    }

    this.status.classList.remove('hidden', 'is-error');
    this.status.textContent = 'Updating display...';
  }

  setDisplayCacheBudget(_mb: number): void {}
  setDisplayCacheUsage(_usedBytes: number, _budgetBytes: number): void {}

  setViewerViewportRect(rect: ViewportClientRect): void {
    this.viewport = {
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height))
    };
    this.viewerContainer.style.setProperty('--viewer-checker-offset-x', `${-rect.left}px`);
    this.viewerContainer.style.setProperty('--viewer-checker-offset-y', `${-rect.top}px`);
  }

  setViewerPaneLayout(_layout: ViewerPaneLayoutState): void {}

  getViewerPaneRenderInfos(): ViewerPaneRenderInfo[] {
    return [this.getActiveViewerPane()];
  }

  getActiveViewerPane(): ViewerPaneRenderInfo {
    return {
      path: [],
      rect: {
        x: 0,
        y: 0,
        width: this.viewport.width,
        height: this.viewport.height
      },
      viewport: { ...this.viewport },
      active: true
    };
  }

  resolveViewerPaneAtPoint(_point: { x: number; y: number }): ViewerPaneRenderInfo | null {
    return this.getActiveViewerPane();
  }

  getScreenshotSelectionInteractionState(): ScreenshotSelectionInteractionState {
    return {
      active: false,
      rect: null,
      activeRegionId: null,
      regions: []
    };
  }

  setScreenshotSelectionRect(
    _rect: ViewportRect,
    _options: { squareSnapped?: boolean; snapGuide?: ScreenshotSelectionSnapGuide } = {}
  ): void {}
  setScreenshotSelectionActiveRegion(_regionId: string): void {}
  setScreenshotSelectionSnapGuide(_guide: ScreenshotSelectionSnapGuide): void {}
  setScreenshotSelectionHandle(_handle: ScreenshotSelectionHandle | null): void {}
  setScreenshotSelectionResizeActive(_active: boolean): void {}
  setScreenshotSelectionSquareSnapActive(_active: boolean): void {}

  setAutoFitImageOnSelect(_enabled: boolean): void {}
  setAutoExposureEnabled(_enabled: boolean): void {}
  setRulersVisible(_enabled: boolean): void {}
  setViewerBackground(_background: ViewerBackgroundId): void {}

  setOpenedImageOptions(items: ViewerOpenedImageOption[], activeId: string | null): void {
    const active = items.find((item) => item.id === activeId) ?? items[0] ?? null;
    this.openFullButton.disabled = !active;
    const showSourceLabel = Boolean(active?.displayNameIsCustom && active.label.trim());
    this.sourceLabel.classList.toggle('hidden', !showSourceLabel);
    this.sourceLabel.textContent = showSourceLabel ? active?.label ?? '' : '';
  }

  setExportTarget(_target: ExportImageTarget | null): void {}
  setExportBatchTarget(_target: ExportImageBatchTarget | null): void {}
  setExposure(_exposureEv: number): void {}
  setDisplayGamma(_displayGamma: number): void {}
  setColormapExposure(_exposureEv: number): void {}
  setColormapGamma(_gamma: number): void {}
  setViewerMode(_mode: ViewerMode): void {}
  setDepthModeAvailable(_available: boolean): void {}
  setVisualizationMode(_mode: VisualizationMode): void {}
  setStokesDegreeModulationControl(
    _label: string | null,
    _enabled = false,
    _showAolpMode = false,
    _aolpMode: StokesAolpDegreeModulationMode = 'value'
  ): void {}
  setActiveColormap(_activeId: string | null): void {}
  setColormapOptions(_items: Array<{ id: string; label: string }>, _activeId: string | null): void {}
  setStokesDefaultSettingsOptions(
    _items: Array<{ id: string; label: string }>,
    _defaults: StokesColormapDefaultSettings,
    _visibility?: StokesParameterVisibilitySettings
  ): void {}
  setMaskInvalidStokesVectors(_enabled: boolean): void {}
  setChannelRecognitionSettings(_settings: ChannelRecognitionSettings): void {}
  setChannelRecognitionNameRules(_rules: ChannelRecognitionNameRules): void {}
  setSpectralRgbGroupingEnabled(_enabled: boolean): void {}
  setInvalidValueWarningEnabled(_enabled: boolean): void {}
  setColormapGradient(_lut: ColormapLut | null, _reversed = false): void {}
  setColormapReversed(_reversed: boolean): void {}
  setColormapRange(
    _range: DisplayLuminanceRange | null,
    _autoRange: DisplayLuminanceRange | null,
    _alwaysAuto = false,
    _zeroCentered = false
  ): void {}
  setLayerOptions(_items: ViewerLayerOption[], _activeIndex: number): void {}
  setMetadata(_metadata: ExrMetadataEntry[] | null): void {}
  setRgbGroupOptions(
    channelNames: string[],
    selected: DisplaySelection | null,
    channelThumbnailItems: ChannelThumbnailOptionItem[] = [],
    channelStackScopeKey = 'default'
  ): void {
    if (this.disposed) {
      return;
    }

    this.rgbGroupChannelNames = [...channelNames];
    this.channelThumbnailItems = [...channelThumbnailItems];
    this.channelStackScopeKey = channelStackScopeKey;
    this.pruneExpandedChannelStackKeys();
    this.expandChannelStackForSelection(selected);
    this.currentChannelSelection = cloneDisplaySelection(selected);
    this.renderChannelViewControls();
  }

  clearImageBrowserPanels(): void {
    if (this.disposed) {
      return;
    }

    this.rgbGroupChannelNames = [];
    this.channelThumbnailItems = [];
    this.currentChannelSelection = null;
    this.channelStackScopeKey = 'default';
    this.channelThumbnailStrip?.clearForNoImage();
    this.channelPanel.classList.add('hidden');
  }

  setProbeReadout(
    mode: 'Hover' | 'Locked',
    sample: PixelSample | null,
    colorPreview: ProbeColorPreview | null,
    imageSize: { width: number; height: number } | null = null
  ): void {
    this.probe.classList.toggle('is-empty', !sample);
    this.probe.dataset.mode = mode;
    this.probeCoords.textContent = formatProbeCoordinates(sample, imageSize);
    this.probeSwatch.style.backgroundColor = colorPreview?.cssColor ?? 'transparent';
    this.probeValues.textContent = colorPreview
      ? colorPreview.displayValues.map((item) => `${item.label} ${item.value}`).join('  ')
      : '';
  }

  setSpectralReadout(_readout: SpectralPlotReadoutModel): void {}
  setRoiReadout(_readout: { roi: ImageRoi | null; stats: RoiStats | null }): void {}
  setViewerStateReadout(_readout: ViewerStateReadoutModel): void {}
  setImageStats(_readout: ImageStatsReadoutModel): void {}

  private handleChannelViewValueChange(value: string): void {
    const item = this.channelThumbnailItems.find((entry) => entry.value === value);
    if (!item) {
      return;
    }

    this.currentChannelSelection = cloneDisplaySelection(item.selection);
    this.renderChannelViewControls();
    this.callbacks.onChannelSelection?.(item.selection);
  }

  private handleChannelStackToggle(stackKey: string): void {
    const stack = this.getChannelViewStacks().find((entry) => entry.key === stackKey);
    if (!stack) {
      return;
    }

    const itemByValue = this.getChannelThumbnailItemsByValue();
    const parent = itemByValue.get(stack.parentValue) ?? null;
    const children = stack.childValues
      .map((value) => itemByValue.get(value) ?? null)
      .filter((item): item is ChannelThumbnailOptionItem => item !== null);
    if (!parent || children.length === 0) {
      return;
    }

    const expandedStackKeys = new Set(this.getExpandedChannelStackKeys());
    const expanded = expandedStackKeys.has(stack.key);
    let remappedSelection: DisplaySelection | null = null;

    if (expanded) {
      expandedStackKeys.delete(stack.key);
      if (children.some((child) => sameDisplaySelection(child.selection, this.currentChannelSelection))) {
        remappedSelection = parent.selection;
      }
    } else {
      expandedStackKeys.add(stack.key);
      if (sameDisplaySelection(parent.selection, this.currentChannelSelection)) {
        remappedSelection = children[0]?.selection ?? null;
      }
    }

    this.setExpandedChannelStackKeys(expandedStackKeys);
    if (remappedSelection) {
      this.currentChannelSelection = cloneDisplaySelection(remappedSelection);
    }
    this.renderChannelViewControls();

    if (remappedSelection) {
      this.callbacks.onChannelSelection?.(remappedSelection);
    }
  }

  private getVisibleChannelViewItems(): ChannelViewStackedThumbnailItem[] {
    return selectStackedChannelViewItems(
      this.rgbGroupChannelNames,
      this.channelThumbnailItems,
      this.getExpandedChannelStackKeys()
    );
  }

  private getChannelViewStacks(): ChannelViewStackInfo[] {
    return buildChannelViewStacks(this.rgbGroupChannelNames, this.channelThumbnailItems);
  }

  private getChannelThumbnailItemsByValue(): Map<string, ChannelThumbnailOptionItem> {
    return new Map(this.channelThumbnailItems.map((item) => [item.value, item]));
  }

  private getExpandedChannelStackKeys(): Set<string> {
    const existing = this.expandedChannelStackKeysByScope.get(this.channelStackScopeKey);
    if (existing) {
      return existing;
    }

    const created = new Set<string>();
    this.expandedChannelStackKeysByScope.set(this.channelStackScopeKey, created);
    return created;
  }

  private setExpandedChannelStackKeys(stackKeys: ReadonlySet<string>): void {
    this.expandedChannelStackKeysByScope.set(this.channelStackScopeKey, new Set(stackKeys));
  }

  private pruneExpandedChannelStackKeys(): void {
    const current = this.getExpandedChannelStackKeys();
    const pruned = pruneExpandedChannelStackKeys(
      this.rgbGroupChannelNames,
      this.channelThumbnailItems,
      current
    );
    if (!sameStringSet(current, pruned)) {
      this.setExpandedChannelStackKeys(pruned);
    }
  }

  private expandChannelStackForSelection(selection: DisplaySelection | null): void {
    if (!selection) {
      return;
    }

    const itemByValue = this.getChannelThumbnailItemsByValue();
    const expandedStackKeys = new Set(this.getExpandedChannelStackKeys());
    for (const stack of this.getChannelViewStacks()) {
      for (const childValue of stack.childValues) {
        const child = itemByValue.get(childValue);
        if (child && sameDisplaySelection(child.selection, selection)) {
          expandedStackKeys.add(stack.key);
          this.setExpandedChannelStackKeys(expandedStackKeys);
          return;
        }
      }
    }
  }

  private renderChannelViewControls(): void {
    this.pruneExpandedChannelStackKeys();
    const visibleItems = this.getVisibleChannelViewItems();
    const selectedItem = findSelectedChannelViewItem(visibleItems, this.currentChannelSelection) ?? visibleItems[0] ?? null;
    const selectedValue = selectedItem?.value ?? '';
    if (!findSelectedChannelViewItem(visibleItems, this.currentChannelSelection) && selectedItem) {
      this.currentChannelSelection = cloneDisplaySelection(selectedItem.selection);
    }

    if (visibleItems.length > 0) {
      this.channelThumbnailStrip?.setChannelViewItems(visibleItems, selectedValue);
    } else {
      this.channelThumbnailStrip?.clearForNoImage();
    }

    this.channelPanel.classList.toggle('hidden', this.bottomPanelMode !== 'channels' || visibleItems.length === 0);
  }

  private readonly handleOpenFullClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.callbacks.onOpenFull();
  };

  private readonly handleDeferredLoadClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const handler = this.deferredLoadHandler;
    if (!handler) {
      return;
    }

    this.deferredLoadButton.disabled = true;
    void Promise.resolve(handler()).catch(() => {
      if (this.disposed || this.deferredLoadHandler !== handler) {
        return;
      }
      this.deferredLoadButton.disabled = false;
      this.deferredLoadButton.classList.remove('hidden');
    });
  };
}

function stopViewerInteractionEvent(event: Event): void {
  event.stopPropagation();
}

function sameStringSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}
