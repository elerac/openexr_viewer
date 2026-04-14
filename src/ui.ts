import { ColormapLut, sampleColormapRgbBytes } from './colormaps';
import { DisplaySelection, DisplayLuminanceRange, PixelSample, VisualizationMode, ViewerState } from './types';
import { ProbeColorPreview } from './probe';
import {
  buildChannelDisplayOptions,
  buildZeroCenteredColormapRange,
  computeHistogramRenderCeiling,
  extractRgbChannelGroups,
  findMergedSelectionForSplitDisplay,
  findSelectedChannelDisplayOption,
  findSelectedStokesDisplayOption,
  findSplitSelectionForMergedDisplay,
  formatScientific,
  getStokesDisplayOptions,
  scaleHistogramCount,
  type HistogramData,
  type HistogramViewOptions,
  type HistogramXAxisMode,
  type HistogramYAxisMode
} from './state';

const HISTOGRAM_DEFAULT_BINS = 2048;
const HISTOGRAM_TICK_COUNT = 5;
const HISTOGRAM_EPSILON = 1e-12;
const HISTOGRAM_EV_SPECIAL_BUCKET_GAP = 4;
const HISTOGRAM_EV_SPECIAL_BUCKET_MIN_WIDTH = 12;
const HISTOGRAM_EV_SPECIAL_BUCKET_MAX_WIDTH = 22;
const OPENED_IMAGES_MAX_VISIBLE_ROWS = 10;
const CHANNEL_OPTIONS_MAX_VISIBLE_ROWS = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE = 1e-16;
const COLORMAP_GRADIENT_STOP_COUNT = 16;
const DEFAULT_COLORMAP_GRADIENT = 'linear-gradient(90deg, #d95656 0%, #05070a 50%, #59d884 100%)';

export interface UiCallbacks {
  onOpenFileClick: () => void;
  onFileSelected: (file: File) => void;
  onFilesDropped: (files: File[]) => void;
  onReloadAllOpenedImages: () => void;
  onReloadSelectedOpenedImage: (sessionId: string) => void;
  onCloseSelectedOpenedImage: (sessionId: string) => void;
  onCloseAllOpenedImages: () => void;
  onOpenedImageSelected: (sessionId: string) => void;
  onReorderOpenedImage: (draggedSessionId: string, targetSessionId: string) => void;
  onExposureChange: (value: number) => void;
  onHistogramXAxisChange: (value: HistogramXAxisMode) => void;
  onHistogramYAxisChange: (value: HistogramYAxisMode) => void;
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
  histogramXAxisSelect: HTMLSelectElement;
  histogramYAxisSelect: HTMLSelectElement;
  histogramSvg: SVGSVGElement;
  errorBanner: HTMLDivElement;
  viewerContainer: HTMLElement;
  dropOverlay: HTMLDivElement;
  loadingOverlay: HTMLDivElement;
  openedImagesSelect: HTMLSelectElement;
  reloadAllOpenedImagesButton: HTMLButtonElement;
  reloadOpenedImageButton: HTMLButtonElement;
  closeOpenedImageButton: HTMLButtonElement;
  closeAllOpenedImagesButton: HTMLButtonElement;
  layerControl: HTMLDivElement;
  layerSelect: HTMLSelectElement;
  rgbSplitToggleButton: HTMLButtonElement;
  rgbGroupSelect: HTMLSelectElement;
  zoomReadout: HTMLElement;
  panReadout: HTMLElement;
  probeMode: HTMLElement;
  probeCoords: HTMLElement;
  probeColorPreview: HTMLDivElement;
  probeColorSwatch: HTMLElement;
  probeColorRValue: HTMLElement;
  probeColorGValue: HTMLElement;
  probeColorBValue: HTMLElement;
  probeValues: HTMLElement;
  glCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
}

interface HistogramPlotLayout {
  plotX: number;
  plotWidth: number;
  specialBucketX: number;
  specialBucketWidth: number;
}

export interface ListboxHitTestMetrics {
  top: number;
  height: number;
  scrollTop: number;
  scrollHeight: number;
  optionCount: number;
}

export class ViewerUi {
  private readonly elements: Elements;
  private readonly rgbGroupMappings = new Map<string, DisplaySelection>();
  private readonly histogramResizeObserver: ResizeObserver;
  private lastHistogram: HistogramData | null = null;
  private histogramViewOptions: HistogramViewOptions = { xAxis: 'ev', yAxis: 'linear' };
  private isLoading = false;
  private isRgbViewLoading = false;
  private openedImageCount = 0;
  private hasMultipleLayers = false;
  private openedImagesActiveId: string | null = null;
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
  private hasRgbGroups = false;
  private hasRgbSplitOptions = false;
  private includeSplitRgbChannels = false;
  private currentRgbChannelNames: string[] = [];
  private currentRgbSelection: DisplaySelection | null = null;
  private currentColormapRange: DisplayLuminanceRange | null = null;
  private currentAutoColormapRange: DisplayLuminanceRange | null = null;
  private currentColormapZeroCentered = false;
  private isColormapEnabled = false;
  private hasColormapOptions = false;

  constructor(private readonly callbacks: UiCallbacks) {
    this.elements = resolveElements();
    this.histogramResizeObserver = new ResizeObserver(() => {
      if (this.lastHistogram) {
        this.drawHistogram(this.lastHistogram);
      }
    });
    this.bindEvents();
    this.histogramResizeObserver.observe(this.elements.histogramSvg);
    this.clearHistogram();
    this.elements.openedImagesSelect.disabled = true;
    this.elements.openedImagesSelect.title = 'Click and drag filename rows to reorder.';
    this.elements.reloadAllOpenedImagesButton.disabled = true;
    this.elements.reloadOpenedImageButton.disabled = true;
    this.elements.closeOpenedImageButton.disabled = true;
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
    }

    this.isLoading = loading;
    this.elements.openFileButton.disabled = loading;
    this.elements.resetViewButton.disabled = loading;
    this.setVisualizationModeButtonsDisabled(loading || this.openedImageCount === 0);
    this.setColormapRangeControlsDisabled(loading || this.openedImageCount === 0);
    this.elements.exposureValue.disabled = loading;
    this.elements.openedImagesSelect.disabled = loading || this.openedImageCount === 0;
    this.elements.reloadAllOpenedImagesButton.disabled = loading || this.openedImageCount === 0;
    this.elements.reloadOpenedImageButton.disabled = loading || this.openedImageCount === 0;
    this.elements.closeOpenedImageButton.disabled = loading || this.openedImageCount === 0;
    this.elements.closeAllOpenedImagesButton.disabled = loading || this.openedImageCount === 0;
    this.elements.layerSelect.disabled = loading || !this.hasMultipleLayers;
    this.elements.rgbGroupSelect.disabled = loading || !this.hasRgbGroups;
    this.updateRgbSplitToggleState();
    this.updateStokesDegreeModulationDisabled();

    if (!loading && this.restoreRgbGroupFocusAfterLoading && !this.elements.rgbGroupSelect.disabled) {
      this.elements.rgbGroupSelect.focus();
    }
    if (!loading) {
      this.restoreRgbGroupFocusAfterLoading = false;
    }

    this.updateLoadingOverlayVisibility();
  }

  setRgbViewLoading(loading: boolean): void {
    this.isRgbViewLoading = loading;
    this.updateRgbSplitToggleState();
    this.updateLoadingOverlayVisibility();
  }

  private updateLoadingOverlayVisibility(): void {
    if (this.isLoading || this.isRgbViewLoading) {
      this.elements.loadingOverlay.classList.remove('hidden');
      return;
    }
    this.elements.loadingOverlay.classList.add('hidden');
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

  setHistogramViewOptions(options: HistogramViewOptions): void {
    const previous = this.histogramViewOptions;
    this.histogramViewOptions = { ...options };
    this.elements.histogramXAxisSelect.value = options.xAxis;
    this.elements.histogramYAxisSelect.value = options.yAxis;

    if (
      this.lastHistogram &&
      previous.xAxis === options.xAxis &&
      previous.yAxis !== options.yAxis
    ) {
      this.drawHistogram(this.lastHistogram);
    }
  }

  setHistogram(histogram: HistogramData): void {
    this.lastHistogram = histogram;
    this.drawHistogram(histogram);
  }

  clearHistogram(): void {
    const fallbackDomain = this.histogramViewOptions.xAxis === 'ev' ? { min: -1, max: 1 } : { min: 0, max: 1 };
    const histogram: HistogramData = {
      mode: 'luminance',
      xAxis: this.histogramViewOptions.xAxis,
      bins: new Float32Array(HISTOGRAM_DEFAULT_BINS),
      nonPositiveCount: 0,
      channelBins: null,
      channelNonPositiveCounts: null,
      min: fallbackDomain.min,
      max: fallbackDomain.max,
      mean: 0,
      channelMeans: null,
      evReference: 1
    };
    this.lastHistogram = histogram;
    this.drawHistogram(histogram);
  }

  setOpenedImageOptions(items: Array<{ id: string; label: string }>, activeId: string | null): void {
    this.openedImageCount = items.length;
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

    this.elements.openedImagesSelect.disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.reloadAllOpenedImagesButton.disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.reloadOpenedImageButton.disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.closeOpenedImageButton.disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.closeAllOpenedImagesButton.disabled = this.isLoading || this.openedImageCount === 0;
    this.setVisualizationModeButtonsDisabled(this.isLoading || this.openedImageCount === 0);
    this.setColormapRangeControlsDisabled(this.isLoading || this.openedImageCount === 0 || !this.currentColormapRange);
    this.updateStokesDegreeModulationDisabled();
  }

  setLayerOptions(items: Array<{ index: number; label: string }>, activeIndex: number): void {
    this.hasMultipleLayers = items.length > 1;
    this.elements.layerSelect.innerHTML = '';
    this.elements.layerControl.classList.toggle('hidden', !this.hasMultipleLayers);

    if (!this.hasMultipleLayers) {
      this.elements.layerSelect.disabled = true;
      this.elements.layerSelect.size = 1;
      this.elements.layerSelect.classList.remove('single-row-listbox');
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
  }

  setRgbGroupOptions(
    channelNames: string[],
    selected: DisplaySelection
  ): void {
    const hadFocus = document.activeElement === this.elements.rgbGroupSelect;
    const nextChannelNames = [...channelNames];
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
      effectiveSelected.displayB
    );
    const selectedStokesOption = findSelectedStokesDisplayOption(stokesOptions, effectiveSelected);
    const showCurrentChannelOption =
      effectiveSelected.displaySource === 'channels' && !selectedChannelOption && stokesOptions.length > 0;
    const optionCount = channelOptions.length + stokesOptions.length + (showCurrentChannelOption ? 1 : 0);

    this.currentRgbChannelNames = nextChannelNames;
    this.currentRgbSelection = { ...effectiveSelected };
    this.hasRgbGroups = optionCount > 0;
    this.hasRgbSplitOptions = rgbGroups.length > 0;
    this.updateRgbSplitToggleState();
    this.rgbGroupMappings.clear();
    this.elements.rgbGroupSelect.innerHTML = '';
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

      if (
        selectedStokesOption && selectedStokesOption.key === stokesOption.key
      ) {
        selectedValue = value;
      }
    });

    this.elements.rgbGroupSelect.value = selectedValue;
    this.elements.rgbGroupSelect.disabled = this.isLoading || !this.hasRgbGroups;
    if (hadFocus && !this.elements.rgbGroupSelect.disabled) {
      this.elements.rgbGroupSelect.focus();
    }

    const remappedSelection = expandedSelection ?? collapsedSelection;
    if (remappedSelection) {
      this.callbacks.onRgbGroupChange(remappedSelection);
    }
  }

  setViewReadout(state: ViewerState): void {
    this.elements.zoomReadout.textContent = `${state.zoom.toFixed(3)}x`;
    this.elements.panReadout.textContent = `(${state.panX.toFixed(2)}, ${state.panY.toFixed(2)})`;
  }

  setProbeReadout(mode: 'Hover' | 'Locked', sample: PixelSample | null, colorPreview: ProbeColorPreview | null): void {
    this.elements.probeMode.textContent = mode;

    if (!sample) {
      this.elements.probeCoords.textContent = '(x: -, y: -)';
      this.elements.probeColorPreview.classList.add('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = 'transparent';
      this.elements.probeColorRValue.textContent = '-';
      this.elements.probeColorGValue.textContent = '-';
      this.elements.probeColorBValue.textContent = '-';
      this.elements.probeValues.innerHTML = '';
      return;
    }

    this.elements.probeCoords.textContent = `(x: ${sample.x}, y: ${sample.y})`;
    if (colorPreview) {
      this.elements.probeColorPreview.classList.remove('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = colorPreview.cssColor;
      this.elements.probeColorRValue.textContent = colorPreview.rValue;
      this.elements.probeColorGValue.textContent = colorPreview.gValue;
      this.elements.probeColorBValue.textContent = colorPreview.bValue;
    } else {
      this.elements.probeColorPreview.classList.add('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = 'transparent';
      this.elements.probeColorRValue.textContent = '-';
      this.elements.probeColorGValue.textContent = '-';
      this.elements.probeColorBValue.textContent = '-';
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

  showDropOverlay(show: boolean): void {
    if (show) {
      this.elements.dropOverlay.classList.remove('hidden');
      return;
    }
    this.elements.dropOverlay.classList.add('hidden');
  }

  private updateRgbSplitToggleState(): void {
    this.elements.rgbSplitToggleButton.classList.toggle('hidden', !this.hasRgbSplitOptions);
    this.elements.rgbSplitToggleButton.disabled = this.isLoading || this.isRgbViewLoading || !this.hasRgbSplitOptions;
    this.elements.rgbSplitToggleButton.setAttribute(
      'aria-pressed',
      this.includeSplitRgbChannels ? 'true' : 'false'
    );
  }

  private drawHistogram(histogram: HistogramData): void {
    const svg = this.elements.histogramSvg;
    const width = Math.max(1, Math.floor(svg.clientWidth));
    const height = Math.max(1, Math.floor(svg.clientHeight));

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.replaceChildren();

    const background = createSvgElement('rect');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', `${width}`);
    background.setAttribute('height', `${height}`);
    background.setAttribute('fill', 'rgba(9, 13, 20, 0.9)');
    svg.append(background);

    const topPadding = 1;
    const tickSize = 3;
    const tickLabelGap = 2;
    const tickFontSize = 9;
    const bottomPadding = tickSize + tickLabelGap + tickFontSize + 1;
    const drawHeight = Math.max(1, height - topPadding - bottomPadding);
    const axisY = topPadding + drawHeight;
    const layout = createHistogramPlotLayout(width, histogram.xAxis);
    const ceiling = computeHistogramRenderCeiling(histogram);

    if (histogram.mode === 'rgb' && histogram.channelBins) {
      this.drawHistogramArea(
        svg,
        scaleHistogramBins(histogram.channelBins.r, ceiling, this.histogramViewOptions.yAxis),
        layout.plotX,
        layout.plotWidth,
        drawHeight,
        axisY,
        'rgba(255, 96, 96, 0.22)',
        'rgba(255, 112, 112, 0.92)'
      );
      this.drawHistogramArea(
        svg,
        scaleHistogramBins(histogram.channelBins.g, ceiling, this.histogramViewOptions.yAxis),
        layout.plotX,
        layout.plotWidth,
        drawHeight,
        axisY,
        'rgba(120, 255, 120, 0.22)',
        'rgba(144, 255, 144, 0.92)'
      );
      this.drawHistogramArea(
        svg,
        scaleHistogramBins(histogram.channelBins.b, ceiling, this.histogramViewOptions.yAxis),
        layout.plotX,
        layout.plotWidth,
        drawHeight,
        axisY,
        'rgba(120, 170, 255, 0.22)',
        'rgba(148, 192, 255, 0.92)'
      );

      if (histogram.xAxis === 'ev' && histogram.channelNonPositiveCounts && layout.specialBucketWidth > 0) {
        this.drawHistogramBucket(
          svg,
          layout.specialBucketX,
          layout.specialBucketWidth,
          scaleHistogramCount(
            histogram.channelNonPositiveCounts.r,
            ceiling,
            this.histogramViewOptions.yAxis
          ),
          drawHeight,
          axisY,
          'rgba(255, 96, 96, 0.22)',
          'rgba(255, 112, 112, 0.92)'
        );
        this.drawHistogramBucket(
          svg,
          layout.specialBucketX,
          layout.specialBucketWidth,
          scaleHistogramCount(
            histogram.channelNonPositiveCounts.g,
            ceiling,
            this.histogramViewOptions.yAxis
          ),
          drawHeight,
          axisY,
          'rgba(120, 255, 120, 0.22)',
          'rgba(144, 255, 144, 0.92)'
        );
        this.drawHistogramBucket(
          svg,
          layout.specialBucketX,
          layout.specialBucketWidth,
          scaleHistogramCount(
            histogram.channelNonPositiveCounts.b,
            ceiling,
            this.histogramViewOptions.yAxis
          ),
          drawHeight,
          axisY,
          'rgba(120, 170, 255, 0.22)',
          'rgba(148, 192, 255, 0.92)'
        );
      }
    } else {
      const bins = histogram.bins.length > 0 ? histogram.bins : new Float32Array(HISTOGRAM_DEFAULT_BINS);
      const defs = createSvgElement('defs');
      const gradient = createSvgElement('linearGradient');
      const gradientId = 'histogram-gradient';
      gradient.setAttribute('id', gradientId);
      gradient.setAttribute('x1', '0%');
      gradient.setAttribute('y1', '0%');
      gradient.setAttribute('x2', '100%');
      gradient.setAttribute('y2', '0%');

      const stop0 = createSvgElement('stop');
      stop0.setAttribute('offset', '0%');
      stop0.setAttribute('stop-color', 'rgba(75, 192, 255, 0.95)');
      gradient.append(stop0);

      const stop1 = createSvgElement('stop');
      stop1.setAttribute('offset', '50%');
      stop1.setAttribute('stop-color', 'rgba(130, 225, 255, 0.95)');
      gradient.append(stop1);

      const stop2 = createSvgElement('stop');
      stop2.setAttribute('offset', '100%');
      stop2.setAttribute('stop-color', 'rgba(255, 220, 120, 0.95)');
      gradient.append(stop2);

      defs.append(gradient);
      svg.append(defs);

      this.drawHistogramArea(
        svg,
        scaleHistogramBins(bins, ceiling, this.histogramViewOptions.yAxis),
        layout.plotX,
        layout.plotWidth,
        drawHeight,
        axisY,
        `url(#${gradientId})`,
        'rgba(216, 234, 255, 0.9)'
      );

      if (histogram.xAxis === 'ev' && layout.specialBucketWidth > 0) {
        this.drawHistogramBucket(
          svg,
          layout.specialBucketX,
          layout.specialBucketWidth,
          scaleHistogramCount(histogram.nonPositiveCount, ceiling, this.histogramViewOptions.yAxis),
          drawHeight,
          axisY,
          'rgba(75, 192, 255, 0.18)',
          'rgba(216, 234, 255, 0.8)'
        );
      }
    }

    this.drawHistogramTicks(svg, histogram, layout, axisY, tickSize, tickLabelGap, tickFontSize);
  }

  private drawHistogramArea(
    svg: SVGSVGElement,
    bins: Float32Array,
    plotX: number,
    plotWidth: number,
    drawHeight: number,
    axisY: number,
    fillStyle: string,
    strokeStyle: string
  ): void {
    const paths = buildHistogramAreaPaths(bins, plotX, plotWidth, drawHeight, axisY);
    if (!paths) {
      return;
    }

    const fillPath = createSvgElement('path');
    fillPath.setAttribute('d', paths.areaPath);
    fillPath.setAttribute('fill', fillStyle);
    fillPath.setAttribute('shape-rendering', 'geometricPrecision');

    const outlinePath = createSvgElement('path');
    outlinePath.setAttribute('d', paths.outlinePath);
    outlinePath.setAttribute('fill', 'none');
    outlinePath.setAttribute('stroke', strokeStyle);
    outlinePath.setAttribute('stroke-width', '1.15');
    outlinePath.setAttribute('stroke-linejoin', 'round');
    outlinePath.setAttribute('stroke-linecap', 'round');
    outlinePath.setAttribute('vector-effect', 'non-scaling-stroke');

    svg.append(fillPath, outlinePath);
  }

  private drawHistogramBucket(
    svg: SVGSVGElement,
    x: number,
    width: number,
    value: number,
    drawHeight: number,
    axisY: number,
    fillStyle: string,
    strokeStyle: string
  ): void {
    if (value <= 0 || width <= 0) {
      return;
    }

    const bucketHeight = Math.max(1, value * drawHeight);
    const rect = createSvgElement('rect');
    rect.setAttribute('x', `${x}`);
    rect.setAttribute('width', `${width}`);
    rect.setAttribute('y', `${axisY - bucketHeight}`);
    rect.setAttribute('height', `${bucketHeight}`);
    rect.setAttribute('fill', fillStyle);
    rect.setAttribute('stroke', strokeStyle);
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(rect);
  }

  private drawHistogramTicks(
    svg: SVGSVGElement,
    histogram: HistogramData,
    layout: HistogramPlotLayout,
    axisY: number,
    tickSize: number,
    tickLabelGap: number,
    tickFontSize: number
  ): void {
    const baselineY = Math.floor(axisY) + 0.5;

    const ticksGroup = createSvgElement('g');
    ticksGroup.setAttribute('stroke', 'rgba(154, 164, 180, 0.75)');
    ticksGroup.setAttribute('stroke-width', '1');
    ticksGroup.setAttribute('shape-rendering', 'geometricPrecision');

    const axis = createSvgElement('line');
    axis.setAttribute('x1', '0');
    axis.setAttribute('y1', `${baselineY}`);
    axis.setAttribute('x2', `${layout.plotX + layout.plotWidth}`);
    axis.setAttribute('y2', `${baselineY}`);
    ticksGroup.append(axis);

    const labelsGroup = createSvgElement('g');
    labelsGroup.setAttribute('fill', 'rgba(154, 164, 180, 0.95)');
    labelsGroup.setAttribute('font-family', '"IBM Plex Mono", "Cascadia Mono", monospace');
    labelsGroup.setAttribute('font-size', `${tickFontSize}`);
    labelsGroup.setAttribute('dominant-baseline', 'hanging');

    if (histogram.xAxis === 'ev' && layout.specialBucketWidth > 0) {
      const specialCenterX = layout.specialBucketX + layout.specialBucketWidth * 0.5;
      appendHistogramTick(
        ticksGroup,
        labelsGroup,
        specialCenterX,
        baselineY,
        tickSize,
        tickLabelGap,
        '<=0',
        'middle'
      );
    }

    const ticks =
      histogram.xAxis === 'ev'
        ? buildEvTicks(histogram.min, histogram.max, histogram.evReference)
        : buildLinearTicks(histogram.min, histogram.max, HISTOGRAM_TICK_COUNT);

    ticks.forEach((tick, index) => {
      const x =
        layout.plotX +
        projectHistogramDomainValue(tick.value, histogram.min, histogram.max, layout.plotWidth);
      let align: 'start' | 'middle' | 'end' = 'middle';
      let drawX = x;

      if (index === 0) {
        align = 'start';
        drawX = Math.max(layout.plotX + 1, x);
      } else if (index === ticks.length - 1) {
        align = 'end';
        drawX = layout.plotX + layout.plotWidth - 1;
      }

      appendHistogramTick(
        ticksGroup,
        labelsGroup,
        drawX,
        baselineY,
        tickSize,
        tickLabelGap,
        tick.label,
        align
      );
    });

    svg.append(ticksGroup, labelsGroup);
  }

  private bindEvents(): void {
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
      this.callbacks.onOpenFileClick();
    });

    this.elements.reloadAllOpenedImagesButton.addEventListener('click', () => {
      if (this.elements.reloadAllOpenedImagesButton.disabled) {
        return;
      }

      this.callbacks.onReloadAllOpenedImages();
    });

    this.elements.reloadOpenedImageButton.addEventListener('click', () => {
      if (this.elements.reloadOpenedImageButton.disabled) {
        return;
      }

      const sessionId = this.elements.openedImagesSelect.value;
      if (!sessionId) {
        return;
      }

      this.callbacks.onReloadSelectedOpenedImage(sessionId);
    });

    this.elements.closeOpenedImageButton.addEventListener('click', () => {
      if (this.elements.closeOpenedImageButton.disabled) {
        return;
      }

      const sessionId = this.elements.openedImagesSelect.value;
      if (!sessionId) {
        return;
      }

      this.callbacks.onCloseSelectedOpenedImage(sessionId);
    });

    this.elements.closeAllOpenedImagesButton.addEventListener('click', () => {
      if (this.elements.closeAllOpenedImagesButton.disabled) {
        return;
      }

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

    this.elements.histogramXAxisSelect.addEventListener('change', (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      this.callbacks.onHistogramXAxisChange(parseHistogramXAxisMode(target.value));
    });

    this.elements.histogramYAxisSelect.addEventListener('change', (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      this.callbacks.onHistogramYAxisChange(parseHistogramYAxisMode(target.value));
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

      this.callbacks.onLayerChange(layerIndex);
    };
    this.elements.layerSelect.addEventListener('change', onLayerSelect);
    this.elements.layerSelect.addEventListener('input', onLayerSelect);

    const onOpenedImagesSelect = (event: Event): void => {
      if (this.openedImageDragState || performance.now() < this.suppressOpenedImageSelectionUntilMs) {
        return;
      }

      const target = event.currentTarget as HTMLSelectElement;
      this.callbacks.onOpenedImageSelected(target.value);
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
        this.callbacks.onOpenedImageSelected(sessionId);
      }

      this.openedImageDragState = {
        sessionId,
        startY: event.clientY,
        lastTargetSessionId: null,
        isDragging: false
      };
    });
    window.addEventListener('mousemove', (event) => {
      this.onOpenedImagesMouseMove(event);
    });
    window.addEventListener('mouseup', () => {
      this.finishOpenedImagesDrag();
    });
    window.addEventListener('blur', () => {
      this.finishOpenedImagesDrag();
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

      if (!this.includeSplitRgbChannels) {
        const collapsedSelection = findMergedSelectionForSplitDisplay(this.currentRgbChannelNames, selection);
        if (collapsedSelection) {
          this.currentRgbSelection = { ...collapsedSelection };
          this.callbacks.onRgbGroupChange(collapsedSelection);
          return;
        }
      }

      this.setRgbGroupOptions(this.currentRgbChannelNames, selection);
    });

    const onRgbGroupSelect = (event: Event): void => {
      const target = event.currentTarget as HTMLSelectElement;
      const mapping = this.rgbGroupMappings.get(target.value);
      if (!mapping) {
        return;
      }

      this.currentRgbSelection = { ...mapping };
      this.callbacks.onRgbGroupChange(mapping);
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
      this.callbacks.onRgbGroupChange(mapping);
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

    const activeId = this.openedImagesActiveId;
    if (dragState?.isDragging && activeId) {
      this.elements.openedImagesSelect.value = activeId;
    }

    if (dragState?.isDragging) {
      this.suppressOpenedImageSelectionUntilMs = performance.now() + 120;
    }
  }

  private getOpenedImageSessionAtClientY(clientY: number): string | null {
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
    histogramXAxisSelect: requireElement('histogram-x-axis-select', HTMLSelectElement),
    histogramYAxisSelect: requireElement('histogram-y-axis-select', HTMLSelectElement),
    histogramSvg: requireElement('histogram-svg', SVGSVGElement),
    errorBanner: requireElement('error-banner', HTMLDivElement),
    viewerContainer: requireElement('viewer-container', HTMLElement),
    dropOverlay: requireElement('drop-overlay', HTMLDivElement),
    loadingOverlay: requireElement('loading-overlay', HTMLDivElement),
    openedImagesSelect: requireElement('opened-images-select', HTMLSelectElement),
    reloadAllOpenedImagesButton: requireElement('reload-all-opened-images-button', HTMLButtonElement),
    reloadOpenedImageButton: requireElement('reload-opened-image-button', HTMLButtonElement),
    closeOpenedImageButton: requireElement('close-opened-image-button', HTMLButtonElement),
    closeAllOpenedImagesButton: requireElement('close-all-opened-images-button', HTMLButtonElement),
    layerControl: requireElement('layer-control', HTMLDivElement),
    layerSelect: requireElement('layer-select', HTMLSelectElement),
    rgbSplitToggleButton: requireElement('rgb-split-toggle-button', HTMLButtonElement),
    rgbGroupSelect: requireElement('rgb-group-select', HTMLSelectElement),
    zoomReadout: requireElement('zoom-readout', HTMLElement),
    panReadout: requireElement('pan-readout', HTMLElement),
    probeMode: requireElement('probe-mode', HTMLElement),
    probeCoords: requireElement('probe-coords', HTMLElement),
    probeColorPreview: requireElement('probe-color-preview', HTMLDivElement),
    probeColorSwatch: requireElement('probe-color-swatch', HTMLElement),
    probeColorRValue: requireElement('probe-color-r-value', HTMLElement),
    probeColorGValue: requireElement('probe-color-g-value', HTMLElement),
    probeColorBValue: requireElement('probe-color-b-value', HTMLElement),
    probeValues: requireElement('probe-values', HTMLElement),
    glCanvas: requireElement('gl-canvas', HTMLCanvasElement),
    overlayCanvas: requireElement('overlay-canvas', HTMLCanvasElement)
  };
}

function formatCurrentChannelOptionLabel(selected: DisplaySelection): string {
  const channels = [selected.displayR, selected.displayG, selected.displayB];
  return channels.every((channel) => channel === channels[0])
    ? channels[0] ?? 'Current'
    : channels.join(',');
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

function parseHistogramXAxisMode(value: string): HistogramXAxisMode {
  return value === 'linear' ? 'linear' : 'ev';
}

function parseHistogramYAxisMode(value: string): HistogramYAxisMode {
  if (value === 'linear' || value === 'log') {
    return value;
  }
  return 'sqrt';
}

function formatHistogramTickLabel(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }

  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.01 || abs >= 1000)) {
    return value.toExponential(1);
  }

  return value.toPrecision(3);
}

function buildLinearTicks(min: number, max: number, targetCount: number): Array<{ value: number; label: string }> {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  if (Math.abs(max - min) <= HISTOGRAM_EPSILON) {
    return [{ value: min, label: formatHistogramTickLabel(min) }];
  }

  const step = computeNiceLinearStep((max - min) / Math.max(1, targetCount - 1));
  const start = Math.ceil((min - HISTOGRAM_EPSILON) / step) * step;
  const end = Math.floor((max + HISTOGRAM_EPSILON) / step) * step;
  const ticks: Array<{ value: number; label: string }> = [];

  for (let value = start; value <= end + HISTOGRAM_EPSILON; value += step) {
    const normalized = Math.abs(value) < HISTOGRAM_EPSILON ? 0 : value;
    ticks.push({
      value: normalized,
      label: formatHistogramTickLabel(normalized)
    });
  }

  if (ticks.length > 0) {
    return ticks;
  }

  return [
    { value: min, label: formatHistogramTickLabel(min) },
    { value: max, label: formatHistogramTickLabel(max) }
  ];
}

function buildEvTicks(
  min: number,
  max: number,
  evReference: number
): Array<{ value: number; label: string }> {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  if (Math.abs(max - min) <= HISTOGRAM_EPSILON) {
    return [{ value: min, label: formatHistogramTickLabel(evReference * 2 ** min) }];
  }

  const candidateSteps = [0.5, 1, 2, 4, 8];
  let bestStep = candidateSteps[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const step of candidateSteps) {
    const count = countTicksForStep(min, max, step);
    if (count <= 0) {
      continue;
    }

    const penalty = count < 4 || count > 6 ? 10 : 0;
    const score = penalty + Math.abs(count - HISTOGRAM_TICK_COUNT);
    if (score < bestScore) {
      bestScore = score;
      bestStep = step;
    }
  }

  const start = Math.ceil((min - HISTOGRAM_EPSILON) / bestStep) * bestStep;
  const end = Math.floor((max + HISTOGRAM_EPSILON) / bestStep) * bestStep;
  const ticks: Array<{ value: number; label: string }> = [];

  for (let value = start; value <= end + HISTOGRAM_EPSILON; value += bestStep) {
    const normalized = Math.abs(value) < HISTOGRAM_EPSILON ? 0 : value;
    ticks.push({
      value: normalized,
      label: formatHistogramTickLabel(evReference * 2 ** normalized)
    });
  }

  if (ticks.length >= 2) {
    return ticks;
  }

  return [
    { value: min, label: formatHistogramTickLabel(evReference * 2 ** min) },
    { value: max, label: formatHistogramTickLabel(evReference * 2 ** max) }
  ];
}

function countTicksForStep(min: number, max: number, step: number): number {
  const start = Math.ceil((min - HISTOGRAM_EPSILON) / step) * step;
  const end = Math.floor((max + HISTOGRAM_EPSILON) / step) * step;
  if (end < start) {
    return 0;
  }
  return Math.floor((end - start) / step) + 1;
}

function computeNiceLinearStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(rawStep));
  const power = 10 ** exponent;
  const scaled = rawStep / power;

  if (scaled <= 1) {
    return power;
  }
  if (scaled <= 2) {
    return 2 * power;
  }
  if (scaled <= 5) {
    return 5 * power;
  }
  return 10 * power;
}

function appendHistogramTick(
  ticksGroup: SVGGElement,
  labelsGroup: SVGGElement,
  x: number,
  baselineY: number,
  tickSize: number,
  tickLabelGap: number,
  label: string,
  align: 'start' | 'middle' | 'end'
): void {
  const tickX = Math.floor(x) + 0.5;
  const tickLine = createSvgElement('line');
  tickLine.setAttribute('x1', `${tickX}`);
  tickLine.setAttribute('y1', `${baselineY}`);
  tickLine.setAttribute('x2', `${tickX}`);
  tickLine.setAttribute('y2', `${baselineY + tickSize}`);
  ticksGroup.append(tickLine);

  const text = createSvgElement('text');
  text.setAttribute('x', `${x}`);
  text.setAttribute('y', `${baselineY + tickSize + tickLabelGap}`);
  text.setAttribute('text-anchor', align);
  text.textContent = label;
  labelsGroup.append(text);
}

function projectHistogramDomainValue(value: number, min: number, max: number, plotWidth: number): number {
  if (plotWidth <= 1 || Math.abs(max - min) <= HISTOGRAM_EPSILON) {
    return Math.max(0, plotWidth * 0.5);
  }

  const unit = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return unit * Math.max(1, plotWidth - 1);
}

function scaleHistogramBins(
  bins: Float32Array,
  ceiling: number,
  yAxis: HistogramYAxisMode
): Float32Array {
  const scaledBins = new Float32Array(bins.length);
  for (let i = 0; i < bins.length; i += 1) {
    scaledBins[i] = scaleHistogramCount(bins[i], ceiling, yAxis);
  }
  return scaledBins;
}

function createHistogramPlotLayout(totalWidth: number, xAxis: HistogramXAxisMode): HistogramPlotLayout {
  if (xAxis !== 'ev') {
    return {
      plotX: 0,
      plotWidth: totalWidth,
      specialBucketX: 0,
      specialBucketWidth: 0
    };
  }

  const maxSpecialBucketWidth = Math.max(0, totalWidth - HISTOGRAM_EV_SPECIAL_BUCKET_GAP - 1);
  if (maxSpecialBucketWidth <= 0) {
    return {
      plotX: 0,
      plotWidth: Math.max(1, totalWidth),
      specialBucketX: 0,
      specialBucketWidth: 0
    };
  }

  const desiredSpecialBucketWidth = Math.min(
    HISTOGRAM_EV_SPECIAL_BUCKET_MAX_WIDTH,
    Math.max(HISTOGRAM_EV_SPECIAL_BUCKET_MIN_WIDTH, totalWidth * 0.075)
  );
  const specialBucketWidth = Math.min(desiredSpecialBucketWidth, maxSpecialBucketWidth);
  const plotX = specialBucketWidth + HISTOGRAM_EV_SPECIAL_BUCKET_GAP;
  return {
    plotX,
    plotWidth: Math.max(1, totalWidth - plotX),
    specialBucketX: 0,
    specialBucketWidth
  };
}

function buildHistogramAreaPaths(
  bins: Float32Array,
  xStart: number,
  width: number,
  drawHeight: number,
  axisY: number
): { areaPath: string; outlinePath: string } | null {
  if (bins.length === 0) {
    return null;
  }

  let hasVisibleValue = false;
  for (let i = 0; i < bins.length; i += 1) {
    if (bins[i] > 0) {
      hasVisibleValue = true;
      break;
    }
  }

  if (!hasVisibleValue) {
    return null;
  }

  const safeWidth = Math.max(1, width);
  // Use one continuous stepped path so adjacent bins share edges without visible seams.
  const firstY = histogramValueToY(bins[0], drawHeight, axisY);
  const startX = formatSvgNumber(xStart);
  const areaSegments = [`M ${startX} ${formatSvgNumber(axisY)}`, `L ${startX} ${formatSvgNumber(firstY)}`];
  const outlineSegments = [`M ${startX} ${formatSvgNumber(firstY)}`];

  for (let i = 0; i < bins.length; i += 1) {
    const currentY = histogramValueToY(bins[i], drawHeight, axisY);
    const nextX = xStart + ((i + 1) / bins.length) * safeWidth;
    const formattedNextX = formatSvgNumber(nextX);
    const formattedCurrentY = formatSvgNumber(currentY);

    areaSegments.push(`L ${formattedNextX} ${formattedCurrentY}`);
    outlineSegments.push(`L ${formattedNextX} ${formattedCurrentY}`);

    if (i + 1 < bins.length) {
      const nextY = histogramValueToY(bins[i + 1], drawHeight, axisY);
      if (Math.abs(nextY - currentY) > 1e-6) {
        const formattedNextY = formatSvgNumber(nextY);
        areaSegments.push(`L ${formattedNextX} ${formattedNextY}`);
        outlineSegments.push(`L ${formattedNextX} ${formattedNextY}`);
      }
    }
  }

  areaSegments.push(`L ${formatSvgNumber(xStart + safeWidth)} ${formatSvgNumber(axisY)}`, 'Z');

  return {
    areaPath: areaSegments.join(' '),
    outlinePath: outlineSegments.join(' ')
  };
}

function histogramValueToY(value: number, drawHeight: number, axisY: number): number {
  const clampedValue = Math.max(0, Math.min(1, value));
  return axisY - clampedValue * drawHeight;
}

function formatSvgNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}
