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
  computeDisplayTextureLuminanceRange,
  resolveColormapAutoRange,
  sameDisplayLuminanceRange,
  shouldPreserveStokesColormapState,
  shouldRefreshDisplayLuminanceRange
} from '../colormap-range';
import { pruneDisplayCachesToBudget } from '../display-cache';
import {
  buildDisplayTextureRevisionKey,
  buildSelectedDisplayTexture,
  samplePixelValuesForDisplay
} from '../display-texture';
import {
  cloneDisplaySelection,
  isChannelSelection,
  isStokesSelection,
  sameDisplaySelection,
  type DisplaySelection
} from '../display-model';
import { buildProbeColorPreview, resolveActiveProbePixel, resolveProbeMode } from '../probe';
import { WebGlExrRenderer } from '../renderer';
import {
  getStokesDegreeModulationLabel,
  getStokesDisplayColormapDefault,
  isStokesDisplaySelection,
  isStokesDegreeModulationParameter
} from '../stokes';
import { ViewerUi } from '../ui';
import {
  DecodedExrImage,
  DecodedLayer,
  DisplayLuminanceRange,
  ImagePixel,
  OpenedImageSession,
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
  | 'setVisualizationMode'
>;

export interface DisplayControllerDependencies {
  store: ViewerStore;
  ui: DisplayUi;
  renderer: WebGlExrRenderer;
  getActiveSession: () => OpenedImageSession | null;
  getSessions: () => OpenedImageSession[];
  getActiveSessionId: () => string | null;
  getDisplayCacheBudgetBytes: () => number;
  touchDisplayCache: (session: OpenedImageSession) => void;
  syncOpenedImageOptions: () => void;
  syncDisplayCacheUsage: () => void;
}

export class DisplayController {
  private readonly store: ViewerStore;
  private readonly ui: DisplayUi;
  private readonly renderer: WebGlExrRenderer;
  private readonly getActiveSession: DisplayControllerDependencies['getActiveSession'];
  private readonly getSessions: DisplayControllerDependencies['getSessions'];
  private readonly getActiveSessionId: DisplayControllerDependencies['getActiveSessionId'];
  private readonly getDisplayCacheBudgetBytes: DisplayControllerDependencies['getDisplayCacheBudgetBytes'];
  private readonly touchDisplayCache: DisplayControllerDependencies['touchDisplayCache'];
  private readonly syncOpenedImageOptions: DisplayControllerDependencies['syncOpenedImageOptions'];
  private readonly syncDisplayCacheUsage: DisplayControllerDependencies['syncDisplayCacheUsage'];

  private rgbViewChangeToken = 0;
  private colormapChangeToken = 0;
  private renderedSessionId: string | null = null;
  private uploadedSessionId: string | null = null;
  private uploadedTextureRevisionKey = '';
  private uploadedColormapId: string | null = null;
  private activeColormapLut: ColormapLut | null = null;
  private defaultColormapId = DEFAULT_COLORMAP_ID;
  private colormapRegistry: ColormapRegistry | null = null;
  private readonly stokesDisplayRestoreStates = new Map<string, RestorableVisualizationState>();

  constructor(dependencies: DisplayControllerDependencies) {
    this.store = dependencies.store;
    this.ui = dependencies.ui;
    this.renderer = dependencies.renderer;
    this.getActiveSession = dependencies.getActiveSession;
    this.getSessions = dependencies.getSessions;
    this.getActiveSessionId = dependencies.getActiveSessionId;
    this.getDisplayCacheBudgetBytes = dependencies.getDisplayCacheBudgetBytes;
    this.touchDisplayCache = dependencies.touchDisplayCache;
    this.syncOpenedImageOptions = dependencies.syncOpenedImageOptions;
    this.syncDisplayCacheUsage = dependencies.syncDisplayCacheUsage;
  }

  async initialize(): Promise<void> {
    this.colormapRegistry = await loadColormapRegistry();
    this.defaultColormapId = this.colormapRegistry.defaultId;
    this.ui.setColormapOptions(getColormapOptions(this.colormapRegistry), this.defaultColormapId);
    this.store.setState({ activeColormapId: this.defaultColormapId });
    await this.uploadColormapToRenderer(this.defaultColormapId);
  }

  handleStoreChange(state: ViewerState, previous: ViewerState): void {
    const activeSession = this.getActiveSession();
    const nextRenderedSessionId = activeSession?.id ?? null;
    const sessionChanged = nextRenderedSessionId !== this.renderedSessionId;
    const selectionChanged = !sameDisplaySelection(state.displaySelection, previous.displaySelection);

    if (sessionChanged || state.exposureEv !== previous.exposureEv) {
      this.ui.setExposure(state.exposureEv);
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
          state.activeLayer !== previous.activeLayer ||
          !activeSession.displayTexture;

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

        const textureKey = buildDisplayTextureRevisionKey(state);
        const textureDirty = textureKey !== activeSession.textureRevisionKey || !activeSession.displayTexture;
        if (textureDirty) {
          activeSession.displayTexture = buildSelectedDisplayTexture(
            layer,
            activeImage.width,
            activeImage.height,
            state.displaySelection,
            activeSession.displayTexture ?? undefined
          );
          activeSession.textureRevisionKey = textureKey;
        }

        const luminanceRangeDirty = shouldRefreshDisplayLuminanceRange(
          state.visualizationMode,
          textureKey,
          activeSession.displayLuminanceRangeRevisionKey,
          Boolean(activeSession.displayTexture)
        );

        if (luminanceRangeDirty && activeSession.displayTexture) {
          activeSession.displayLuminanceRange = computeDisplayTextureLuminanceRange(activeSession.displayTexture);
          activeSession.displayLuminanceRangeRevisionKey = textureKey;
        }

        if (activeSession.displayTexture) {
          this.touchDisplayCache(activeSession);
          pruneDisplayCachesToBudget(
            this.getSessions(),
            this.getActiveSessionId(),
            this.getDisplayCacheBudgetBytes()
          );
          this.syncDisplayCacheUsage();
        }

        const activeAutoColormapRange = resolveColormapAutoRange(
          state.displaySelection,
          activeSession.displayLuminanceRange,
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
            activeSession.displayLuminanceRange,
            state.colormapRangeMode === 'alwaysAuto',
            state.colormapZeroCentered
          );
        }

        const needsUpload =
          this.uploadedSessionId !== activeSession.id ||
          this.uploadedTextureRevisionKey !== activeSession.textureRevisionKey;

        if (needsUpload && activeSession.displayTexture) {
          this.renderer.setDisplayTexture(
            activeImage.width,
            activeImage.height,
            activeSession.displayTexture
          );
          this.uploadedSessionId = activeSession.id;
          this.uploadedTextureRevisionKey = activeSession.textureRevisionKey;
        }

        const probeDirty =
          sessionChanged ||
          state.activeLayer !== previous.activeLayer ||
          state.exposureEv !== previous.exposureEv ||
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
        this.ui.setRgbGroupOptions([], createZeroDisplaySelection());
        this.ui.setColormapRange(null, null);
        this.ui.setProbeReadout('Hover', null, null, {
          width: activeImage.width,
          height: activeImage.height
        });
      }
    } else {
      this.renderedSessionId = null;
      this.uploadedSessionId = null;
      this.uploadedTextureRevisionKey = '';
      this.ui.setVisualizationMode('rgb');
      this.ui.setLayerOptions([], 0);
      this.ui.setColormapRange(null, null);
      this.ui.setProbeMetadata(null);
      this.ui.setRgbGroupOptions([], createZeroDisplaySelection());
      this.ui.setProbeReadout('Hover', null, null);
    }

    const shouldRender =
      sessionChanged ||
      state.zoom !== previous.zoom ||
      state.panX !== previous.panX ||
      state.panY !== previous.panY ||
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
        if (this.getActiveSession()?.id !== sessionId) {
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
      await waitForNextPaint();
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
          await waitMs(MIN_RGB_VIEW_LOADING_MS - elapsedMs);
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
      const lut = await loadColormapLut(registry, colormapId);
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
        await waitMs(MIN_RGB_VIEW_LOADING_MS - elapsedMs);
      }
    } finally {
      if (token === this.rgbViewChangeToken) {
        this.ui.setRgbViewLoading(false);
      }
    }
  }

  async setActiveColormap(colormapId: string): Promise<void> {
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
      const lut = await loadColormapLut(registry, colormapId);
      if (token !== this.colormapChangeToken) {
        return;
      }

      this.uploadLoadedColormap(colormapId, lut);
      this.store.setState({
        activeColormapId: colormapId
      });

      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs < MIN_RGB_VIEW_LOADING_MS) {
        await waitMs(MIN_RGB_VIEW_LOADING_MS - elapsedMs);
      }
    } catch (error) {
      this.ui.setActiveColormap(currentState.activeColormapId);
      this.ui.setError(error instanceof Error ? error.message : 'Failed to load colormap.');
    } finally {
      if (token === this.colormapChangeToken) {
        this.ui.setRgbViewLoading(false);
      }
    }
  }

  setVisualizationMode(mode: VisualizationMode): void {
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

  setColormapRange(range: DisplayLuminanceRange): void {
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
    const activeSession = this.getActiveSession();
    if (!activeSession) {
      return;
    }

    const currentState = this.store.getState();
    const nextRange = resolveColormapAutoRange(
      currentState.displaySelection,
      activeSession.displayLuminanceRange,
      currentState.colormapZeroCentered
    );
    const currentMode = currentState.colormapRangeMode;

    this.store.setState({
      colormapRange: nextRange,
      colormapRangeMode: currentMode === 'alwaysAuto' ? 'oneTime' : 'alwaysAuto'
    });
  }

  toggleColormapZeroCenter(): void {
    const activeSession = this.getActiveSession();
    if (!activeSession) {
      return;
    }

    const currentState = this.store.getState();
    const nextZeroCentered = !currentState.colormapZeroCentered;
    const nextRange = currentState.colormapRangeMode === 'alwaysAuto'
      ? resolveColormapAutoRange(currentState.displaySelection, activeSession.displayLuminanceRange, nextZeroCentered)
      : nextZeroCentered
        ? buildZeroCenteredColormapRange(currentState.colormapRange ?? activeSession.displayLuminanceRange)
        : cloneDisplayLuminanceRange(currentState.colormapRange);

    this.store.setState({
      colormapRange: nextRange,
      colormapZeroCentered: nextZeroCentered
    });
  }

  toggleStokesDegreeModulation(): void {
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

  handleSessionClosed(sessionId: string): void {
    this.stokesDisplayRestoreStates.delete(sessionId);
    if (this.uploadedSessionId === sessionId) {
      this.uploadedSessionId = null;
      this.uploadedTextureRevisionKey = '';
    }
    if (this.renderedSessionId === sessionId) {
      this.renderedSessionId = null;
    }
  }

  handleAllSessionsClosed(): void {
    this.stokesDisplayRestoreStates.clear();
    this.renderedSessionId = null;
    this.uploadedSessionId = null;
    this.uploadedTextureRevisionKey = '';
  }

  private async uploadColormapToRenderer(colormapId: string): Promise<void> {
    this.uploadLoadedColormap(
      colormapId,
      await loadColormapLut(this.getLoadedColormapRegistry(), colormapId)
    );
  }

  private getLoadedColormapRegistry(): ColormapRegistry {
    if (!this.colormapRegistry) {
      throw new Error('Colormap manifest is not loaded.');
    }

    return this.colormapRegistry;
  }

  private uploadLoadedColormap(colormapId: string, lut: ColormapLut): void {
    this.renderer.setColormapTexture(lut.entryCount, lut.rgba8);
    this.uploadedColormapId = colormapId;
    this.activeColormapLut = lut;
    this.ui.setColormapGradient(lut);
  }

  private syncColormapTextureForState(colormapId: string): void {
    if (this.uploadedColormapId === colormapId) {
      return;
    }

    const token = ++this.colormapChangeToken;
    void loadColormapLut(this.getLoadedColormapRegistry(), colormapId)
      .then((lut) => {
        if (token !== this.colormapChangeToken || this.store.getState().activeColormapId !== colormapId) {
          return;
        }

        this.uploadLoadedColormap(colormapId, lut);
        this.refreshProbeReadout();
        this.renderer.render(this.store.getState());
      })
      .catch((error) => {
        this.ui.setError(error instanceof Error ? error.message : 'Failed to load colormap.');
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

function createZeroDisplaySelection(): DisplaySelection | null {
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

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

function waitMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, durationMs));
  });
}
