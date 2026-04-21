import {
  DEFAULT_COLORMAP_ID,
  findColormapIdByLabel,
  getColormapAsset,
  getColormapOptions,
  loadColormapLut,
  loadColormapRegistry,
  type ColormapLut,
  type ColormapRegistry
} from '../colormaps';
import {
  buildZeroCenteredColormapRange,
  cloneDisplayLuminanceRange,
  resolveColormapAutoRange,
  sameDisplayLuminanceRange,
  shouldPreserveStokesColormapState
} from '../colormap-range';
import { samplePixelValuesForDisplay } from '../display-texture';
import {
  cloneDisplaySelection,
  isChannelSelection,
  isStokesSelection,
  sameDisplaySelection,
  type DisplaySelection
} from '../display-model';
import { createAbortError, isAbortError, throwIfAborted, type Disposable } from '../lifecycle';
import { buildProbeColorPreview, resolveActiveProbePixel, resolveProbeMode } from '../probe';
import { WebGlExrRenderer } from '../renderer';
import {
  getStokesDegreeModulationLabel,
  getStokesDisplayColormapDefault,
  isStokesDisplaySelection,
  isStokesDegreeModulationParameter
} from '../stokes';
import { ViewerUi } from '../ui';
import { RenderCacheService } from '../services/render-cache-service';
import {
  DecodedExrImage,
  DecodedLayer,
  DisplayLuminanceRange,
  ImagePixel,
  OpenedImageSession,
  ViewerMode,
  ViewerState,
  VisualizationMode
} from '../types';
import { buildViewerStateForLayer, ViewerStore } from '../viewer-store';

const COLORMAP_ZERO_CENTER_MANUAL_MIN_MAGNITUDE = 1e-16;
const MIN_RGB_VIEW_LOADING_MS = 120;

type RestorableVisualizationState = Pick<
  ViewerState,
  'visualizationMode' | 'activeColormapId' | 'colormapRange' | 'colormapRangeMode' | 'colormapZeroCentered'
>;

type DisplayUi = Pick<
  ViewerUi,
  | 'setActiveColormap'
  | 'clearImageBrowserPanels'
  | 'setColormapGradient'
  | 'setColormapOptions'
  | 'setColormapRange'
  | 'setError'
  | 'setExposure'
  | 'setLayerOptions'
  | 'setProbeMetadata'
  | 'setProbeReadout'
  | 'setRgbGroupOptions'
  | 'setRgbViewLoading'
  | 'setStokesDegreeModulationControl'
  | 'setViewerMode'
  | 'setVisualizationMode'
>;

export interface DisplayControllerDependencies {
  store: ViewerStore;
  ui: DisplayUi;
  renderer: WebGlExrRenderer;
  renderCache: RenderCacheService;
  getActiveSession: () => OpenedImageSession | null;
}

export class DisplayController implements Disposable {
  private readonly store: ViewerStore;
  private readonly ui: DisplayUi;
  private readonly renderer: WebGlExrRenderer;
  private readonly renderCache: RenderCacheService;
  private readonly getActiveSession: DisplayControllerDependencies['getActiveSession'];

  private rgbViewChangeToken = 0;
  private colormapChangeToken = 0;
  private renderedSessionId: string | null = null;
  private uploadedColormapId: string | null = null;
  private activeColormapLut: ColormapLut | null = null;
  private defaultColormapId = DEFAULT_COLORMAP_ID;
  private colormapRegistry: ColormapRegistry | null = null;
  private readonly stokesDisplayRestoreStates = new Map<string, RestorableVisualizationState>();
  private readonly abortController = new AbortController();
  private disposed = false;

  constructor(dependencies: DisplayControllerDependencies) {
    this.store = dependencies.store;
    this.ui = dependencies.ui;
    this.renderer = dependencies.renderer;
    this.renderCache = dependencies.renderCache;
    this.getActiveSession = dependencies.getActiveSession;
  }

  async initialize(): Promise<void> {
    try {
      this.throwIfStopped();
      this.colormapRegistry = await loadColormapRegistry(this.abortController.signal);
      this.throwIfStopped();
      this.defaultColormapId = this.colormapRegistry.defaultId;
      this.ui.setColormapOptions(getColormapOptions(this.colormapRegistry), this.defaultColormapId);
      this.store.setState({ activeColormapId: this.defaultColormapId });
      await this.uploadColormapToRenderer(this.defaultColormapId);
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
    }
  }

  handleStoreChange(state: ViewerState, previous: ViewerState): void {
    if (this.disposed) {
      return;
    }

    const activeSession = this.getActiveSession();
    const nextRenderedSessionId = activeSession?.id ?? null;
    const sessionChanged = nextRenderedSessionId !== this.renderedSessionId;
    const selectionChanged = !sameDisplaySelection(state.displaySelection, previous.displaySelection);

    if (sessionChanged || state.exposureEv !== previous.exposureEv) {
      this.ui.setExposure(state.exposureEv);
    }

    if (sessionChanged || state.viewerMode !== previous.viewerMode) {
      this.ui.setViewerMode(state.viewerMode);
    }

    if (sessionChanged || state.visualizationMode !== previous.visualizationMode) {
      this.ui.setVisualizationMode(state.visualizationMode);
    }

    if (
      sessionChanged ||
      state.visualizationMode !== previous.visualizationMode ||
      selectionChanged ||
      state.stokesDegreeModulation !== previous.stokesDegreeModulation
    ) {
      this.updateStokesDegreeModulationControl(state);
    }

    if (sessionChanged || state.activeColormapId !== previous.activeColormapId) {
      this.ui.setActiveColormap(state.activeColormapId);
      this.syncColormapTextureForState(state.activeColormapId);
    }

    if (activeSession) {
      const activeImage = activeSession.decoded;
      const layer = getSelectedLayer(activeImage, state.activeLayer);

      if (layer) {
        const layerSelectionDirty =
          sessionChanged ||
          state.activeLayer !== previous.activeLayer;

        if (layerSelectionDirty) {
          this.ui.setLayerOptions(buildLayerOptions(activeImage), state.activeLayer);
          this.ui.setProbeMetadata(layer.metadata ?? null);
        }

        const uiSelectionDirty =
          layerSelectionDirty ||
          sessionChanged ||
          selectionChanged;

        if (uiSelectionDirty) {
          this.ui.setRgbGroupOptions(layer.channelNames, state.displaySelection);
        }

        const {
          displayLuminanceRange,
          textureDirty,
          luminanceRangeDirty
        } = this.renderCache.prepareActiveSession(activeSession, state);

        const activeAutoColormapRange = resolveColormapAutoRange(
          state.displaySelection,
          displayLuminanceRange,
          state.colormapZeroCentered
        );

        if (
          state.visualizationMode === 'colormap' &&
          (textureDirty || luminanceRangeDirty) &&
          state.colormapRangeMode === 'alwaysAuto' &&
          !sameDisplayLuminanceRange(state.colormapRange, activeAutoColormapRange)
        ) {
          this.store.setState({
            colormapRange: activeAutoColormapRange
          });
          return;
        }

        if (
          sessionChanged ||
          state.colormapRange !== previous.colormapRange ||
          state.colormapRangeMode !== previous.colormapRangeMode ||
          state.colormapZeroCentered !== previous.colormapZeroCentered ||
          luminanceRangeDirty
        ) {
          this.ui.setColormapRange(
            state.colormapRange,
            displayLuminanceRange,
            state.colormapRangeMode === 'alwaysAuto',
            state.colormapZeroCentered
          );
        }

        const probeDirty =
          sessionChanged ||
          state.activeLayer !== previous.activeLayer ||
          state.exposureEv !== previous.exposureEv ||
          state.viewerMode !== previous.viewerMode ||
          state.panoramaYawDeg !== previous.panoramaYawDeg ||
          state.panoramaPitchDeg !== previous.panoramaPitchDeg ||
          state.panoramaHfovDeg !== previous.panoramaHfovDeg ||
          selectionChanged ||
          state.visualizationMode !== previous.visualizationMode ||
          state.activeColormapId !== previous.activeColormapId ||
          state.colormapRange !== previous.colormapRange ||
          state.colormapRangeMode !== previous.colormapRangeMode ||
          state.colormapZeroCentered !== previous.colormapZeroCentered ||
          state.stokesDegreeModulation !== previous.stokesDegreeModulation ||
          state.lockedPixel !== previous.lockedPixel ||
          state.hoveredPixel !== previous.hoveredPixel;

        if (probeDirty) {
          this.updateProbeReadout(
            layer,
            activeImage.width,
            activeImage.height,
            state.lockedPixel,
            state.hoveredPixel,
            state.displaySelection,
            state.exposureEv,
            state.visualizationMode,
            state.colormapRange,
            this.getActiveColormapLut(state.activeColormapId),
            state.stokesDegreeModulation
          );
        }
      } else {
        this.ui.setLayerOptions([], 0);
        this.ui.setProbeMetadata(null);
        this.ui.setRgbGroupOptions([], null);
        this.ui.setColormapRange(null, null);
        this.ui.setProbeReadout('Hover', null, null, {
          width: activeImage.width,
          height: activeImage.height
        });
      }
    } else {
      this.renderedSessionId = null;
      this.ui.setViewerMode('image');
      this.ui.setVisualizationMode('rgb');
      this.ui.clearImageBrowserPanels();
      this.ui.setColormapRange(null, null);
      this.ui.setProbeMetadata(null);
      this.ui.setProbeReadout('Hover', null, null);
    }

    const shouldRender =
      sessionChanged ||
      state.viewerMode !== previous.viewerMode ||
      state.zoom !== previous.zoom ||
      state.panX !== previous.panX ||
      state.panY !== previous.panY ||
      state.panoramaYawDeg !== previous.panoramaYawDeg ||
      state.panoramaPitchDeg !== previous.panoramaPitchDeg ||
      state.panoramaHfovDeg !== previous.panoramaHfovDeg ||
      state.exposureEv !== previous.exposureEv ||
      state.hoveredPixel !== previous.hoveredPixel ||
      state.lockedPixel !== previous.lockedPixel ||
      state.activeLayer !== previous.activeLayer ||
      selectionChanged ||
      state.visualizationMode !== previous.visualizationMode ||
      state.activeColormapId !== previous.activeColormapId ||
      state.colormapRange !== previous.colormapRange ||
      state.colormapRangeMode !== previous.colormapRangeMode ||
      state.colormapZeroCentered !== previous.colormapZeroCentered ||
      state.stokesDegreeModulation !== previous.stokesDegreeModulation;

    if (shouldRender) {
      this.renderer.render(state);
    }

    this.renderedSessionId = nextRenderedSessionId;
  }

  async applyDisplaySelection(selection: DisplaySelection): Promise<void> {
    if (this.disposed) {
      return;
    }

    const activeSession = this.getActiveSession();
    if (!activeSession) {
      this.store.setState({ displaySelection: cloneDisplaySelection(selection) });
      return;
    }

    const currentState = this.store.getState();
    const stokesDefaults = getStokesDisplayColormapDefault(selection);
    if (!stokesDefaults) {
      const patch: Partial<ViewerState> = {
        displaySelection: cloneDisplaySelection(selection)
      };
      if (isChannelSelection(selection) && isStokesSelection(currentState.displaySelection)) {
        Object.assign(patch, this.resolveStokesDisplayRestoreState(activeSession.id));
      }

      this.rgbViewChangeToken += 1;
      this.ui.setRgbViewLoading(false);
      const sessionId = activeSession.id;
      queueMicrotask(() => {
        if (this.disposed || this.getActiveSession()?.id !== sessionId) {
          return;
        }

        this.store.setState({ ...patch });
      });
      return;
    }

    const token = ++this.rgbViewChangeToken;
    const startedAt = performance.now();
    this.ui.setRgbViewLoading(true);

    try {
      await waitForNextPaint(this.abortController.signal);
      this.throwIfStopped();
      if (token !== this.rgbViewChangeToken) {
        return;
      }

      const latestState = this.store.getState();
      const patch: Partial<ViewerState> = {
        displaySelection: cloneDisplaySelection(selection)
      };
      if (isChannelSelection(selection) && isStokesSelection(latestState.displaySelection)) {
        Object.assign(patch, this.resolveStokesDisplayRestoreState(activeSession.id));
      }

      if (!isStokesSelection(latestState.displaySelection)) {
        this.stokesDisplayRestoreStates.set(activeSession.id, captureRestorableVisualizationState(latestState));
      }

      if (shouldPreserveStokesColormapState(latestState.displaySelection, selection)) {
        patch.visualizationMode = 'colormap';
        this.store.setState({ ...patch });

        const elapsedMs = performance.now() - startedAt;
        if (elapsedMs < MIN_RGB_VIEW_LOADING_MS) {
          await waitMs(MIN_RGB_VIEW_LOADING_MS - elapsedMs, this.abortController.signal);
        }
        return;
      }

      const registry = this.getLoadedColormapRegistry();
      const colormapId = findColormapIdByLabel(registry, stokesDefaults.colormapLabel);
      if (!colormapId) {
        this.ui.setError(`Required colormap not found: ${stokesDefaults.colormapLabel}`);
        return;
      }

      const colormapToken = ++this.colormapChangeToken;
      const lut = await loadColormapLut(registry, colormapId, this.abortController.signal);
      this.throwIfStopped();
      if (token !== this.rgbViewChangeToken || colormapToken !== this.colormapChangeToken) {
        return;
      }

      this.uploadLoadedColormap(colormapId, lut);
      patch.visualizationMode = 'colormap';
      patch.activeColormapId = colormapId;
      patch.colormapRange = stokesDefaults.range;
      patch.colormapRangeMode = 'oneTime';
      patch.colormapZeroCentered = stokesDefaults.zeroCentered;

      this.store.setState({ ...patch });

      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs < MIN_RGB_VIEW_LOADING_MS) {
        await waitMs(MIN_RGB_VIEW_LOADING_MS - elapsedMs, this.abortController.signal);
      }
    } catch (error) {
      if (!isAbortError(error) && !this.disposed) {
        throw error;
      }
    } finally {
      if (!this.disposed && token === this.rgbViewChangeToken) {
        this.ui.setRgbViewLoading(false);
      }
    }
  }

  async setActiveColormap(colormapId: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    const registry = this.getLoadedColormapRegistry();
    if (!getColormapAsset(registry, colormapId)) {
      this.ui.setActiveColormap(this.store.getState().activeColormapId);
      this.ui.setError(`Unknown colormap: ${colormapId}`);
      return;
    }

    const currentState = this.store.getState();
    if (currentState.activeColormapId === colormapId) {
      return;
    }

    const token = ++this.colormapChangeToken;
    const startedAt = performance.now();
    this.ui.setRgbViewLoading(true);

    try {
      const lut = await loadColormapLut(registry, colormapId, this.abortController.signal);
      this.throwIfStopped();
      if (token !== this.colormapChangeToken) {
        return;
      }

      this.uploadLoadedColormap(colormapId, lut);
      this.store.setState({
        activeColormapId: colormapId
      });

      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs < MIN_RGB_VIEW_LOADING_MS) {
        await waitMs(MIN_RGB_VIEW_LOADING_MS - elapsedMs, this.abortController.signal);
      }
    } catch (error) {
      if (!isAbortError(error) && !this.disposed) {
        this.ui.setActiveColormap(currentState.activeColormapId);
        this.ui.setError(error instanceof Error ? error.message : 'Failed to load colormap.');
      }
    } finally {
      if (!this.disposed && token === this.colormapChangeToken) {
        this.ui.setRgbViewLoading(false);
      }
    }
  }

  setVisualizationMode(mode: VisualizationMode): void {
    if (this.disposed) {
      return;
    }

    if (!this.getActiveSession()) {
      return;
    }

    const currentState = this.store.getState();
    if (currentState.visualizationMode === mode) {
      return;
    }

    if (mode === 'colormap') {
      this.syncColormapTextureForState(currentState.activeColormapId);
    }

    this.store.setState({
      visualizationMode: mode
    });
  }

  setViewerMode(mode: ViewerMode): void {
    if (this.disposed) {
      return;
    }

    if (!this.getActiveSession()) {
      return;
    }

    const currentState = this.store.getState();
    if (currentState.viewerMode === mode) {
      return;
    }

    this.store.setState({
      viewerMode: mode,
      hoveredPixel: null
    });
  }

  setColormapRange(range: DisplayLuminanceRange): void {
    if (this.disposed) {
      return;
    }

    if (!this.getActiveSession() || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      return;
    }

    const currentState = this.store.getState();
    const orderedRange = range.min <= range.max
      ? { min: range.min, max: range.max }
      : { min: range.max, max: range.min };
    const nextRange = currentState.colormapZeroCentered
      ? buildZeroCenteredColormapRange(orderedRange, COLORMAP_ZERO_CENTER_MANUAL_MIN_MAGNITUDE)
      : orderedRange;

    if (
      currentState.colormapRangeMode === 'oneTime' &&
      sameDisplayLuminanceRange(currentState.colormapRange, nextRange)
    ) {
      return;
    }

    this.store.setState({
      colormapRange: nextRange,
      colormapRangeMode: 'oneTime'
    });
  }

  applyAutoColormapRange(): void {
    if (this.disposed) {
      return;
    }

    const activeSession = this.getActiveSession();
    if (!activeSession) {
      return;
    }

    const currentState = this.store.getState();
    const nextRange = resolveColormapAutoRange(
      currentState.displaySelection,
      this.renderCache.getCachedLuminanceRange(activeSession.id, currentState),
      currentState.colormapZeroCentered
    );
    const currentMode = currentState.colormapRangeMode;

    this.store.setState({
      colormapRange: nextRange,
      colormapRangeMode: currentMode === 'alwaysAuto' ? 'oneTime' : 'alwaysAuto'
    });
  }

  toggleColormapZeroCenter(): void {
    if (this.disposed) {
      return;
    }

    const activeSession = this.getActiveSession();
    if (!activeSession) {
      return;
    }

    const currentState = this.store.getState();
    const nextZeroCentered = !currentState.colormapZeroCentered;
    const cachedRange = this.renderCache.getCachedLuminanceRange(activeSession.id, currentState);
    const nextRange = currentState.colormapRangeMode === 'alwaysAuto'
      ? resolveColormapAutoRange(currentState.displaySelection, cachedRange, nextZeroCentered)
      : nextZeroCentered
        ? buildZeroCenteredColormapRange(currentState.colormapRange ?? cachedRange)
        : cloneDisplayLuminanceRange(currentState.colormapRange);

    this.store.setState({
      colormapRange: nextRange,
      colormapZeroCentered: nextZeroCentered
    });
  }

  toggleStokesDegreeModulation(): void {
    if (this.disposed) {
      return;
    }

    if (!this.getActiveSession()) {
      return;
    }

    const currentState = this.store.getState();
    if (!isStokesSelection(currentState.displaySelection) || !isStokesDegreeModulationParameter(currentState.displaySelection.parameter)) {
      return;
    }

    const parameter = currentState.displaySelection.parameter;
    this.store.setState({
      stokesDegreeModulation: {
        ...currentState.stokesDegreeModulation,
        [parameter]: !currentState.stokesDegreeModulation[parameter]
      }
    });
  }

  setActiveLayer(layerIndex: number): void {
    if (this.disposed) {
      return;
    }

    const activeSession = this.getActiveSession();
    if (!activeSession) {
      return;
    }

    const currentState = this.store.getState();
    const nextState = buildViewerStateForLayer(currentState, activeSession.decoded, layerIndex);
    if (nextState.activeLayer === currentState.activeLayer && sameDisplaySelection(nextState.displaySelection, currentState.displaySelection)) {
      return;
    }

    this.store.setState(nextState);
  }

  refreshProbeReadout(): void {
    if (this.disposed) {
      return;
    }

    const activeSession = this.getActiveSession();
    if (!activeSession) {
      this.ui.setProbeMetadata(null);
      this.ui.setProbeReadout('Hover', null, null);
      return;
    }

    const state = this.store.getState();
    const layer = getSelectedLayer(activeSession.decoded, state.activeLayer);
    if (!layer) {
      this.ui.setProbeMetadata(null);
      this.ui.setProbeReadout('Hover', null, null, {
        width: activeSession.decoded.width,
        height: activeSession.decoded.height
      });
      return;
    }

    this.ui.setProbeMetadata(layer.metadata ?? null);
    this.updateProbeReadout(
      layer,
      activeSession.decoded.width,
      activeSession.decoded.height,
      state.lockedPixel,
      state.hoveredPixel,
      state.displaySelection,
      state.exposureEv,
      state.visualizationMode,
      state.colormapRange,
      this.getActiveColormapLut(state.activeColormapId),
      state.stokesDegreeModulation
    );
  }

  getDefaultColormapId(): string {
    return this.defaultColormapId;
  }

  getActiveColormapLutForState(colormapId: string): ColormapLut | null {
    return this.getActiveColormapLut(colormapId);
  }

  handleSessionClosed(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    this.stokesDisplayRestoreStates.delete(sessionId);
    if (this.renderedSessionId === sessionId) {
      this.renderedSessionId = null;
    }
  }

  handleAllSessionsClosed(): void {
    if (this.disposed) {
      return;
    }

    this.stokesDisplayRestoreStates.clear();
    this.renderedSessionId = null;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.rgbViewChangeToken += 1;
    this.colormapChangeToken += 1;
    this.abortController.abort(createAbortError('Display controller has been disposed.'));
    this.stokesDisplayRestoreStates.clear();
    this.renderedSessionId = null;
    this.uploadedColormapId = null;
    this.activeColormapLut = null;
  }

  private async uploadColormapToRenderer(colormapId: string): Promise<void> {
    this.throwIfStopped();
    this.uploadLoadedColormap(
      colormapId,
      await loadColormapLut(this.getLoadedColormapRegistry(), colormapId, this.abortController.signal)
    );
  }

  private getLoadedColormapRegistry(): ColormapRegistry {
    if (!this.colormapRegistry) {
      throw new Error('Colormap manifest is not loaded.');
    }

    return this.colormapRegistry;
  }

  private uploadLoadedColormap(colormapId: string, lut: ColormapLut): void {
    if (this.disposed) {
      return;
    }

    this.renderer.setColormapTexture(lut.entryCount, lut.rgba8);
    this.uploadedColormapId = colormapId;
    this.activeColormapLut = lut;
    this.ui.setColormapGradient(lut);
  }

  private syncColormapTextureForState(colormapId: string): void {
    if (this.disposed) {
      return;
    }

    if (this.uploadedColormapId === colormapId) {
      return;
    }

    const token = ++this.colormapChangeToken;
    void loadColormapLut(this.getLoadedColormapRegistry(), colormapId, this.abortController.signal)
      .then((lut) => {
        if (
          this.disposed ||
          token !== this.colormapChangeToken ||
          this.store.getState().activeColormapId !== colormapId
        ) {
          return;
        }

        this.uploadLoadedColormap(colormapId, lut);
        this.refreshProbeReadout();
        this.renderer.render(this.store.getState());
      })
      .catch((error) => {
        if (!isAbortError(error) && !this.disposed) {
          this.ui.setError(error instanceof Error ? error.message : 'Failed to load colormap.');
        }
      });
  }

  private getActiveColormapLut(colormapId: string): ColormapLut | null {
    return this.uploadedColormapId === colormapId ? this.activeColormapLut : null;
  }

  private updateStokesDegreeModulationControl(state: ViewerState): void {
    const selection = state.displaySelection;
    if (!isStokesSelection(selection) || !isStokesDegreeModulationParameter(selection.parameter)) {
      this.ui.setStokesDegreeModulationControl(null);
      return;
    }

    this.ui.setStokesDegreeModulationControl(
      getStokesDegreeModulationLabel(selection.parameter),
      state.stokesDegreeModulation[selection.parameter]
    );
  }

  private updateProbeReadout(
    layer: DecodedLayer,
    width: number,
    height: number,
    lockedPixel: ImagePixel | null,
    hoveredPixel: ImagePixel | null,
    displaySelection: DisplaySelection | null,
    exposureEv: number,
    visualizationMode: VisualizationMode,
    colormapRange: DisplayLuminanceRange | null,
    colormapLut: ColormapLut | null,
    stokesDegreeModulation: ViewerState['stokesDegreeModulation']
  ): void {
    const targetPixel = resolveActiveProbePixel(lockedPixel, hoveredPixel);
    const mode = resolveProbeMode(lockedPixel);

    if (!targetPixel) {
      this.ui.setProbeReadout(mode, null, null, { width, height });
      return;
    }

    const sample = samplePixelValuesForDisplay(layer, width, height, targetPixel, displaySelection);
    this.ui.setProbeReadout(
      mode,
      sample,
      buildProbeColorPreview(sample, displaySelection, exposureEv, {
        mode: visualizationMode,
        colormapRange,
        colormapLut,
        stokesDegreeModulation
      }),
      { width, height }
    );
  }

  private resolveStokesDisplayRestoreState(sessionId: string): RestorableVisualizationState {
    const restoreState = this.stokesDisplayRestoreStates.get(sessionId);
    if (restoreState) {
      return {
        ...restoreState,
        colormapRange: cloneDisplayLuminanceRange(restoreState.colormapRange)
      };
    }

    return {
      visualizationMode: 'rgb',
      activeColormapId: this.defaultColormapId,
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false
    };
  }

  private throwIfStopped(): void {
    if (this.disposed) {
      throw createAbortError('Display controller has been disposed.');
    }

    throwIfAborted(this.abortController.signal, 'Display controller has been disposed.');
  }
}

function getSelectedLayer(image: DecodedExrImage, layerIndex: number): DecodedLayer | null {
  return image.layers[layerIndex] ?? null;
}

function buildLayerOptions(image: DecodedExrImage): Array<{ index: number; label: string; channelCount: number }> {
  return image.layers.map((layer, index) => ({
    index,
    label: buildLayerPanelLabel(layer, index),
    channelCount: layer.channelNames.length
  }));
}

function buildLayerPanelLabel(layer: DecodedLayer, index: number): string {
  if (layer.name) {
    return layer.name;
  }

  const groupedName = inferDominantChannelGroupName(layer.channelNames);
  if (groupedName) {
    return groupedName;
  }

  return index === 0 ? 'Main Layer' : `Layer ${index + 1}`;
}

function inferDominantChannelGroupName(channelNames: string[]): string | null {
  if (channelNames.length === 0) {
    return null;
  }

  const rgbBases = new Map<string, Set<string>>();
  for (const channelName of channelNames) {
    const match = /^(?:(.+)\.)?([RGBA])$/.exec(channelName);
    if (!match) {
      continue;
    }

    const base = match[1] ?? '';
    const suffix = match[2] ?? '';
    const suffixes = rgbBases.get(base) ?? new Set<string>();
    suffixes.add(suffix);
    rgbBases.set(base, suffixes);
  }

  for (const [base, suffixes] of rgbBases.entries()) {
    if (suffixes.has('R') && suffixes.has('G') && suffixes.has('B')) {
      return base || 'RGB';
    }
  }

  if (channelNames.length === 1) {
    return channelNames[0] ?? null;
  }

  return null;
}

function captureRestorableVisualizationState(state: ViewerState): RestorableVisualizationState {
  return {
    visualizationMode: state.visualizationMode,
    activeColormapId: state.activeColormapId,
    colormapRange: cloneDisplayLuminanceRange(state.colormapRange),
    colormapRangeMode: state.colormapRangeMode,
    colormapZeroCentered: state.colormapZeroCentered
  };
}

function waitForNextPaint(signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  }

  throwIfAborted(signal, 'Display controller has been disposed.');
  return new Promise((resolve, reject) => {
    let firstHandle = 0;
    let secondHandle = 0;
    const onAbort = () => {
      if (firstHandle && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(firstHandle);
      }
      if (secondHandle && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(secondHandle);
      }
      reject(signal.reason instanceof Error ? signal.reason : createAbortError('Display controller has been disposed.'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    firstHandle = window.requestAnimationFrame(() => {
      firstHandle = 0;
      secondHandle = window.requestAnimationFrame(() => {
        secondHandle = 0;
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  });
}

function waitMs(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, durationMs));
    });
  }

  throwIfAborted(signal, 'Display controller has been disposed.');
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      if (typeof window.clearTimeout === 'function') {
        window.clearTimeout(handle);
      }
      reject(signal.reason instanceof Error ? signal.reason : createAbortError('Display controller has been disposed.'));
    };
    const handle = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, durationMs));

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
