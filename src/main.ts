import { loadExr } from './exr';
import { clampZoom, ViewerInteraction } from './interaction';
import { buildProbeColorPreview, resolveActiveProbePixel, resolveProbeMode } from './probe';
import { WebGlExrRenderer } from './renderer';
import {
  buildLayerDisplayHistogram,
  buildDisplayTexture,
  buildViewerStateForLayer,
  buildSessionDisplayName,
  buildZeroCenteredColormapRange,
  computeDisplayTextureLuminanceRange,
  createInitialState,
  extractRgbChannelGroups,
  findSelectedRgbGroup,
  persistActiveSessionState,
  pickNextSessionIndexAfterRemoval,
  samplePixelValues,
  samePixel,
  ViewerStore,
  type HistogramData,
  type HistogramMode,
  type HistogramViewOptions
} from './state';
import { ViewerUi } from './ui';
import {
  DecodedExrImage,
  DecodedLayer,
  DisplayLuminanceRange,
  ImagePixel,
  OpenedImageSession,
  SessionSource,
  VisualizationMode,
  ViewerState,
  ZERO_CHANNEL
} from './types';

const HISTOGRAM_BIN_COUNT = 2048;
const HISTOGRAM_EV_REFERENCE = 1;
const COLORMAP_ZERO_CENTER_MANUAL_MIN_MAGNITUDE = 1e-16;
const MIN_RGB_VIEW_LOADING_MS = 120;
const DEFAULT_HISTOGRAM_VIEW_OPTIONS: HistogramViewOptions = {
  xAxis: 'ev',
  yAxis: 'linear'
};

void bootstrap();

async function bootstrap(): Promise<void> {
  const store = new ViewerStore(createInitialState());

  let renderer: WebGlExrRenderer | null = null;
  let interaction: ViewerInteraction | null = null;

  let sessions: OpenedImageSession[] = [];
  let activeSessionId: string | null = null;
  let sessionCounter = 0;
  let rgbViewChangeToken = 0;
  let loadQueue: Promise<void> = Promise.resolve();
  let histogramViewOptions: HistogramViewOptions = { ...DEFAULT_HISTOGRAM_VIEW_OPTIONS };
  let cachedHistogram: HistogramData | null = null;
  let cachedHistogramSessionId: string | null = null;
  let cachedHistogramTextureRevisionKey = '';
  let cachedHistogramMode: HistogramMode | null = null;
  let cachedHistogramXAxis = histogramViewOptions.xAxis;

  let renderedSessionId: string | null = null;
  let uploadedSessionId: string | null = null;
  let uploadedTextureRevisionKey = '';

  const ui = new ViewerUi({
    onOpenFileClick: () => {
      const input = document.getElementById('file-input') as HTMLInputElement;
      input.click();
    },
    onFileSelected: (file) => {
      enqueueFileLoads([file]);
    },
    onFilesDropped: (files) => {
      enqueueFileLoads(files);
    },
    onReloadAllOpenedImages: () => {
      enqueueAllSessionsReload();
    },
    onReloadSelectedOpenedImage: (sessionId) => {
      enqueueSessionReload(sessionId);
    },
    onCloseSelectedOpenedImage: (sessionId) => {
      closeSessionById(sessionId);
    },
    onCloseAllOpenedImages: () => {
      closeAllSessions();
    },
    onOpenedImageSelected: (sessionId) => {
      switchActiveSession(sessionId);
    },
    onReorderOpenedImage: (draggedSessionId, targetSessionId) => {
      reorderOpenedImages(draggedSessionId, targetSessionId);
    },
    onExposureChange: (value) => {
      store.setState({ exposureEv: value });
    },
    onHistogramXAxisChange: (value) => {
      setHistogramXAxisMode(value);
    },
    onHistogramYAxisChange: (value) => {
      setHistogramYAxisMode(value);
    },
    onLayerChange: (layerIndex) => {
      setActiveLayer(layerIndex);
    },
    onRgbGroupChange: (mapping) => {
      void applyRgbViewChangeWithLoading(mapping);
    },
    onVisualizationModeChange: (mode) => {
      setVisualizationMode(mode);
    },
    onColormapRangeChange: (range) => {
      setColormapRange(range);
    },
    onColormapAutoRange: () => {
      applyAutoColormapRange();
    },
    onColormapZeroCenterToggle: () => {
      toggleColormapZeroCenter();
    },
    onResetView: () => {
      resetAllState();
    }
  });
  ui.setHistogramViewOptions(histogramViewOptions);

  try {
    renderer = new WebGlExrRenderer(ui.glCanvas, ui.overlayCanvas);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize WebGL2 renderer.';
    ui.setError(message);
    ui.setLoading(false);
    return;
  }

  interaction = new ViewerInteraction(ui.viewerContainer, {
    getState: () => store.getState(),
    getViewport: () => renderer?.getViewport() ?? { width: 1, height: 1 },
    getImageSize: () => {
      const activeSession = getActiveSession();
      if (!activeSession) {
        return null;
      }

      return {
        width: activeSession.decoded.width,
        height: activeSession.decoded.height
      };
    },
    onViewChange: (next) => {
      store.setState(next);
    },
    onHoverPixel: (pixel) => {
      store.setState({ hoveredPixel: pixel });
    },
    onToggleLockPixel: (pixel) => {
      const current = store.getState().lockedPixel;
      if (samePixel(current, pixel)) {
        store.setState({ lockedPixel: null });
        return;
      }
      store.setState({ lockedPixel: pixel });
    }
  });

  store.subscribe((state, previous) => {
    if (!renderer) {
      return;
    }

    const activeSession = getActiveSession();
    const nextRenderedSessionId = activeSession?.id ?? null;
    const sessionChanged = nextRenderedSessionId !== renderedSessionId;

    persistActiveSessionState(sessions, activeSessionId, state);

    if (sessionChanged || state.exposureEv !== previous.exposureEv) {
      ui.setExposure(state.exposureEv);
    }

    if (sessionChanged || state.visualizationMode !== previous.visualizationMode) {
      ui.setVisualizationMode(state.visualizationMode);
    }

    if (
      sessionChanged ||
      state.zoom !== previous.zoom ||
      state.panX !== previous.panX ||
      state.panY !== previous.panY
    ) {
      ui.setViewReadout(state);
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
          ui.setLayerOptions(buildLayerOptions(activeImage), state.activeLayer);
        }

        const uiSelectionDirty =
          layerSelectionDirty ||
          sessionChanged ||
          state.displayR !== previous.displayR ||
          state.displayG !== previous.displayG ||
          state.displayB !== previous.displayB;

        let rgbGroups: ReturnType<typeof extractRgbChannelGroups> = [];
        if (uiSelectionDirty) {
          rgbGroups = extractRgbChannelGroups(layer.channelNames);
          ui.setRgbGroupOptions(layer.channelNames, {
            displayR: state.displayR,
            displayG: state.displayG,
            displayB: state.displayB
          });
        }

        const textureKey = buildTextureRevisionKey(state);
        const textureDirty = textureKey !== activeSession.textureRevisionKey || !activeSession.displayTexture;
        if (textureDirty) {
          activeSession.displayTexture = buildDisplayTexture(
            layer,
            activeImage.width,
            activeImage.height,
            state.displayR,
            state.displayG,
            state.displayB,
            activeSession.displayTexture ?? undefined
          );
          activeSession.displayLuminanceRange = computeDisplayTextureLuminanceRange(
            activeSession.displayTexture
          );
          activeSession.textureRevisionKey = textureKey;
        }

        const activeAutoColormapRange = resolveAutoColormapRange(
          activeSession.displayLuminanceRange,
          state.colormapZeroCentered
        );

        if (
          textureDirty &&
          state.colormapRangeMode === 'alwaysAuto' &&
          !sameDisplayLuminanceRange(state.colormapRange, activeAutoColormapRange)
        ) {
          store.setState({
            colormapRange: activeAutoColormapRange
          });
          return;
        }

        if (
          sessionChanged ||
          state.colormapRange !== previous.colormapRange ||
          state.colormapRangeMode !== previous.colormapRangeMode ||
          state.colormapZeroCentered !== previous.colormapZeroCentered ||
          textureDirty
        ) {
          ui.setColormapRange(
            state.colormapRange,
            activeSession.displayLuminanceRange,
            state.colormapRangeMode === 'alwaysAuto',
            state.colormapZeroCentered
          );
        }

        const needsUpload =
          uploadedSessionId !== activeSession.id || uploadedTextureRevisionKey !== activeSession.textureRevisionKey;

        if (needsUpload && activeSession.displayTexture) {
          renderer.setDisplayTexture(
            activeImage.width,
            activeImage.height,
            activeSession.displayTexture
          );
          uploadedSessionId = activeSession.id;
          uploadedTextureRevisionKey = activeSession.textureRevisionKey;
        }

        if ((sessionChanged || needsUpload) && activeSession.displayTexture) {
          refreshActiveHistogram(false, rgbGroups);
        }

        const probeDirty =
          sessionChanged ||
          state.activeLayer !== previous.activeLayer ||
          state.exposureEv !== previous.exposureEv ||
          state.displayR !== previous.displayR ||
          state.displayG !== previous.displayG ||
          state.displayB !== previous.displayB ||
          state.visualizationMode !== previous.visualizationMode ||
          state.colormapRange !== previous.colormapRange ||
          state.colormapRangeMode !== previous.colormapRangeMode ||
          state.colormapZeroCentered !== previous.colormapZeroCentered ||
          state.lockedPixel !== previous.lockedPixel ||
          state.hoveredPixel !== previous.hoveredPixel;

        if (probeDirty) {
          updateProbeReadout(
            layer,
            activeImage.width,
            activeImage.height,
            state.lockedPixel,
            state.hoveredPixel,
            {
              displayR: state.displayR,
              displayG: state.displayG,
              displayB: state.displayB
            },
            state.exposureEv,
            state.visualizationMode,
            state.colormapRange
          );
        }
      } else {
        invalidateHistogramCache();
        ui.setLayerOptions([], 0);
        ui.setRgbGroupOptions([], {
          displayR: ZERO_CHANNEL,
          displayG: ZERO_CHANNEL,
          displayB: ZERO_CHANNEL
        });
        ui.setColormapRange(null, null);
        ui.setProbeReadout('Hover', null, null);
        ui.clearHistogram();
      }
    } else {
      invalidateHistogramCache();
      ui.setVisualizationMode('rgb');
      ui.setColormapRange(null, null);
      ui.setProbeReadout('Hover', null, null);
      ui.clearHistogram();
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
      state.displayR !== previous.displayR ||
      state.displayG !== previous.displayG ||
      state.displayB !== previous.displayB ||
      state.visualizationMode !== previous.visualizationMode ||
      state.colormapRange !== previous.colormapRange ||
      state.colormapRangeMode !== previous.colormapRangeMode ||
      state.colormapZeroCentered !== previous.colormapZeroCentered;

    if (shouldRender) {
      renderer.render(state);
    }

    renderedSessionId = nextRenderedSessionId;
  });

  const resizeObserver = new ResizeObserver(() => {
    if (!renderer) {
      return;
    }

    const rect = ui.viewerContainer.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
    renderer.render(store.getState());
  });
  resizeObserver.observe(ui.viewerContainer);

  renderer.resize(
    ui.viewerContainer.getBoundingClientRect().width,
    ui.viewerContainer.getBoundingClientRect().height
  );
  renderer.render(store.getState());

  loadQueue = loadQueue
    .catch(() => undefined)
    .then(async () => {
      await loadDefaultImage();
    });
  await loadQueue;

  window.addEventListener('beforeunload', () => {
    interaction?.destroy();
    resizeObserver.disconnect();
  });

  async function loadDefaultImage(): Promise<void> {
    if (!renderer) {
      return;
    }

    ui.setLoading(true);
    ui.setError(null);

    const defaultImageFilename = 'cbox_rgb.exr';
    const defaultImageUrl = `${import.meta.env.BASE_URL}${defaultImageFilename}`;

    try {
      const response = await fetch(defaultImageUrl);
      if (!response.ok) {
        throw new Error(`Failed to load ${defaultImageUrl} (${response.status})`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      await applyDecodedImage(await loadExr(bytes), 'cbox_rgb.exr', {
        kind: 'url',
        url: defaultImageUrl
      });
    } catch (error) {
      ui.setError(error instanceof Error ? error.message : `Unknown error while loading ${defaultImageFilename}`);
    } finally {
      ui.setLoading(false);
    }
  }

  async function loadFile(file: File): Promise<void> {
    if (!renderer) {
      return;
    }

    ui.setLoading(true);
    ui.setError(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decoded = await loadExr(bytes);
      await applyDecodedImage(decoded, file.name, {
        kind: 'file',
        file
      });
    } catch (error) {
      ui.setError(error instanceof Error ? `Load failed: ${error.message}` : 'Load failed.');
    } finally {
      ui.setLoading(false);
    }
  }

  function enqueueFileLoads(files: File[]): void {
    if (files.length === 0) {
      return;
    }

    loadQueue = loadQueue
      .catch(() => undefined)
      .then(async () => {
        for (const file of files) {
          await loadFile(file);
        }
      });
  }

  function enqueueSessionReload(sessionId: string): void {
    loadQueue = loadQueue
      .catch(() => undefined)
      .then(async () => {
        await reloadSessionById(sessionId);
      });
  }

  function enqueueAllSessionsReload(): void {
    if (sessions.length === 0) {
      return;
    }

    loadQueue = loadQueue
      .catch(() => undefined)
      .then(async () => {
        await reloadAllSessions();
      });
  }

  async function applyDecodedImage(decoded: DecodedExrImage, filename: string, source: SessionSource): Promise<void> {
    if (!renderer) {
      return;
    }

    const sessionId = `session-${++sessionCounter}`;
    const displayName = buildSessionDisplayName(
      filename,
      sessions.map((session) => session.filename)
    );

    const fitView = computeFitView(decoded.width, decoded.height);

    const sessionState = buildViewerStateForLayer(
      {
        exposureEv: 0,
        visualizationMode: 'rgb',
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        colormapZeroCentered: false,
        activeLayer: 0,
        displayR: ZERO_CHANNEL,
        displayG: ZERO_CHANNEL,
        displayB: ZERO_CHANNEL,
        hoveredPixel: null,
        lockedPixel: null,
        zoom: fitView.zoom,
        panX: fitView.panX,
        panY: fitView.panY
      },
      decoded,
      0
    );

    const session: OpenedImageSession = {
      id: sessionId,
      filename,
      displayName,
      source,
      decoded,
      state: sessionState,
      textureRevisionKey: '',
      displayTexture: null,
      displayLuminanceRange: null
    };

    sessions = [...sessions, session];
    activeSessionId = session.id;
    releaseInactiveSessionDisplayCaches(activeSessionId);
    ui.setOpenedImageOptions(
      sessions.map((item) => ({ id: item.id, label: item.displayName })),
      activeSessionId
    );

    store.setState(session.state);
  }

  async function reloadSessionById(sessionId: string): Promise<void> {
    if (!renderer) {
      return;
    }

    ui.setLoading(true);
    ui.setError(null);

    try {
      const error = await reloadSessionByIdInternal(sessionId);
      if (error) {
        ui.setError(`Reload failed: ${error}`);
      }
    } finally {
      ui.setLoading(false);
    }
  }

  async function reloadAllSessions(): Promise<void> {
    if (!renderer || sessions.length === 0) {
      return;
    }

    const reloadIds = sessions.map((session) => session.id);
    const failures: string[] = [];

    ui.setLoading(true);
    ui.setError(null);

    try {
      for (const sessionId of reloadIds) {
        const label = sessions.find((session) => session.id === sessionId)?.displayName ?? sessionId;
        const error = await reloadSessionByIdInternal(sessionId);
        if (error) {
          failures.push(`${label}: ${error}`);
        }
      }

      if (failures.length > 0) {
        const preview = failures.slice(0, 3).join(' | ');
        const suffix = failures.length > 3 ? ` (+${failures.length - 3} more)` : '';
        ui.setError(`Reload all finished with ${failures.length} failure(s): ${preview}${suffix}`);
      }
    } finally {
      ui.setLoading(false);
    }
  }

  async function reloadSessionByIdInternal(sessionId: string): Promise<string | null> {
    const sessionIndex = sessions.findIndex((session) => session.id === sessionId);
    if (sessionIndex < 0) {
      return 'Session not found.';
    }

    const session = sessions[sessionIndex];
    if (!session) {
      return 'Session not found.';
    }

    try {
      const decoded = await decodeExrFromSessionSource(session.source);
      const baseState = activeSessionId === sessionId ? store.getState() : session.state;
      const nextState = buildReloadedSessionState(baseState, session.decoded, decoded);
      const reloadedSession: OpenedImageSession = {
        ...session,
        decoded,
        state: nextState,
        textureRevisionKey: '',
        displayTexture: null,
        displayLuminanceRange: null
      };

      sessions = sessions.map((current) => (current.id === sessionId ? reloadedSession : current));

      if (uploadedSessionId === sessionId) {
        uploadedSessionId = null;
        uploadedTextureRevisionKey = '';
      }

      ui.setOpenedImageOptions(
        sessions.map((item) => ({ id: item.id, label: item.displayName })),
        activeSessionId
      );

      if (activeSessionId === sessionId) {
        store.setState(nextState);
      }

      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Unknown error.';
    }
  }

  async function applyRgbViewChangeWithLoading(patch: {
    displayR?: string;
    displayG?: string;
    displayB?: string;
  }): Promise<void> {
    if (!getActiveSession()) {
      store.setState({ ...patch });
      return;
    }

    const token = ++rgbViewChangeToken;
    const startedAt = performance.now();
    ui.setRgbViewLoading(true);

    try {
      await waitForNextPaint();
      if (token !== rgbViewChangeToken) {
        return;
      }

      store.setState({ ...patch });

      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs < MIN_RGB_VIEW_LOADING_MS) {
        await waitMs(MIN_RGB_VIEW_LOADING_MS - elapsedMs);
      }
    } finally {
      if (token === rgbViewChangeToken) {
        ui.setRgbViewLoading(false);
      }
    }
  }

  function setVisualizationMode(mode: VisualizationMode): void {
    if (!getActiveSession()) {
      return;
    }

    const currentMode = store.getState().visualizationMode;
    if (currentMode === mode) {
      return;
    }

    store.setState({
      visualizationMode: mode
    });
  }

  function setColormapRange(range: DisplayLuminanceRange): void {
    if (!getActiveSession() || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      return;
    }

    const currentState = store.getState();
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

    store.setState({
      colormapRange: nextRange,
      colormapRangeMode: 'oneTime'
    });
  }

  function toggleColormapZeroCenter(): void {
    const activeSession = getActiveSession();
    if (!activeSession) {
      return;
    }

    const currentState = store.getState();
    const nextZeroCentered = !currentState.colormapZeroCentered;
    const nextRange = nextZeroCentered
      ? buildZeroCenteredColormapRange(currentState.colormapRange ?? activeSession.displayLuminanceRange)
      : currentState.colormapRangeMode === 'alwaysAuto'
        ? cloneDisplayLuminanceRange(activeSession.displayLuminanceRange)
        : cloneDisplayLuminanceRange(currentState.colormapRange);

    store.setState({
      colormapRange: nextRange,
      colormapZeroCentered: nextZeroCentered
    });
  }

  function applyAutoColormapRange(): void {
    const activeSession = getActiveSession();
    if (!activeSession) {
      return;
    }

    const currentState = store.getState();
    const nextRange = resolveAutoColormapRange(
      activeSession.displayLuminanceRange,
      currentState.colormapZeroCentered
    );
    const currentMode = currentState.colormapRangeMode;

    store.setState({
      colormapRange: nextRange,
      colormapRangeMode: currentMode === 'alwaysAuto' ? 'oneTime' : 'alwaysAuto'
    });
  }

  function setActiveLayer(layerIndex: number): void {
    const activeSession = getActiveSession();
    if (!activeSession) {
      return;
    }

    const currentState = store.getState();
    const nextState = buildViewerStateForLayer(currentState, activeSession.decoded, layerIndex);
    if (
      nextState.activeLayer === currentState.activeLayer &&
      nextState.displayR === currentState.displayR &&
      nextState.displayG === currentState.displayG &&
      nextState.displayB === currentState.displayB
    ) {
      return;
    }

    store.setState(nextState);
  }

  function setHistogramXAxisMode(value: HistogramViewOptions['xAxis']): void {
    if (histogramViewOptions.xAxis === value) {
      return;
    }

    histogramViewOptions = {
      ...histogramViewOptions,
      xAxis: value
    };
    ui.setHistogramViewOptions(histogramViewOptions);
    invalidateHistogramCache();

    if (!getActiveSession()) {
      ui.clearHistogram();
      return;
    }

    refreshActiveHistogram(true);
  }

  function setHistogramYAxisMode(value: HistogramViewOptions['yAxis']): void {
    if (histogramViewOptions.yAxis === value) {
      return;
    }

    histogramViewOptions = {
      ...histogramViewOptions,
      yAxis: value
    };
    ui.setHistogramViewOptions(histogramViewOptions);

    if (!getActiveSession()) {
      ui.clearHistogram();
    }
  }

  function refreshActiveHistogram(
    forceRebuild: boolean,
    rgbGroupsOverride?: ReturnType<typeof extractRgbChannelGroups>
  ): void {
    const activeSession = getActiveSession();
    if (!activeSession) {
      invalidateHistogramCache();
      ui.clearHistogram();
      return;
    }

    const state = store.getState();
    const textureKey = buildTextureRevisionKey(state);
    const layer = getSelectedLayer(activeSession.decoded, state.activeLayer);
    if (!layer) {
      invalidateHistogramCache();
      ui.clearHistogram();
      return;
    }

    const rgbGroups = rgbGroupsOverride ?? extractRgbChannelGroups(layer.channelNames);
    const histogramMode: HistogramMode = findSelectedRgbGroup(
      rgbGroups,
      state.displayR,
      state.displayG,
      state.displayB
    )
      ? 'rgb'
      : 'luminance';

    const shouldRebuild =
      forceRebuild ||
      !cachedHistogram ||
      cachedHistogramSessionId !== activeSession.id ||
      cachedHistogramTextureRevisionKey !== textureKey ||
      cachedHistogramMode !== histogramMode ||
      cachedHistogramXAxis !== histogramViewOptions.xAxis;

    if (shouldRebuild) {
      cachedHistogram = buildLayerDisplayHistogram(
        layer,
        activeSession.decoded.width,
        activeSession.decoded.height,
        state.displayR,
        state.displayG,
        state.displayB,
        {
          bins: HISTOGRAM_BIN_COUNT,
          mode: histogramMode,
          xAxis: histogramViewOptions.xAxis,
          evReference: HISTOGRAM_EV_REFERENCE
        }
      );
      cachedHistogramSessionId = activeSession.id;
      cachedHistogramTextureRevisionKey = textureKey;
      cachedHistogramMode = histogramMode;
      cachedHistogramXAxis = histogramViewOptions.xAxis;
    }

    if (!cachedHistogram) {
      ui.clearHistogram();
      return;
    }

    ui.setHistogramViewOptions(histogramViewOptions);
    ui.setHistogram(cachedHistogram);
  }

  function invalidateHistogramCache(): void {
    cachedHistogram = null;
    cachedHistogramSessionId = null;
    cachedHistogramTextureRevisionKey = '';
    cachedHistogramMode = null;
    cachedHistogramXAxis = histogramViewOptions.xAxis;
  }

  function resetHistogramViewOptions(): void {
    histogramViewOptions = { ...DEFAULT_HISTOGRAM_VIEW_OPTIONS };
    ui.setHistogramViewOptions(histogramViewOptions);
    invalidateHistogramCache();
  }

  function switchActiveSession(sessionId: string): void {
    const nextSession = sessions.find((session) => session.id === sessionId);
    if (!nextSession || activeSessionId === nextSession.id) {
      return;
    }

    const currentState = store.getState();
    const nextState = buildSwitchedSessionState(nextSession, currentState, getActiveSession()?.decoded ?? null);

    activeSessionId = nextSession.id;
    releaseInactiveSessionDisplayCaches(activeSessionId);
    ui.setOpenedImageOptions(
      sessions.map((session) => ({ id: session.id, label: session.displayName })),
      activeSessionId
    );

    store.setState(nextState);
  }

  function reorderOpenedImages(draggedSessionId: string, targetSessionId: string): void {
    if (sessions.length <= 1 || draggedSessionId === targetSessionId) {
      return;
    }

    const draggedIndex = sessions.findIndex((session) => session.id === draggedSessionId);
    const targetIndex = sessions.findIndex((session) => session.id === targetSessionId);
    if (draggedIndex < 0 || targetIndex < 0) {
      return;
    }

    const reordered = [...sessions];
    const [draggedSession] = reordered.splice(draggedIndex, 1);
    if (!draggedSession) {
      return;
    }
    reordered.splice(targetIndex, 0, draggedSession);
    sessions = reordered;

    ui.setOpenedImageOptions(
      sessions.map((session) => ({ id: session.id, label: session.displayName })),
      activeSessionId
    );
  }

  function resetAllState(): void {
    resetHistogramViewOptions();

    const activeSession = getActiveSession();
    if (!activeSession) {
      store.setState({
        exposureEv: 0,
        visualizationMode: 'rgb',
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        colormapZeroCentered: false,
        hoveredPixel: null,
        lockedPixel: null
      });
      ui.clearHistogram();
      return;
    }

    const fitView = computeFitView(activeSession.decoded.width, activeSession.decoded.height);

    const nextState = buildViewerStateForLayer(
      {
        exposureEv: 0,
        visualizationMode: 'rgb',
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        colormapZeroCentered: false,
        activeLayer: 0,
        displayR: ZERO_CHANNEL,
        displayG: ZERO_CHANNEL,
        displayB: ZERO_CHANNEL,
        zoom: fitView.zoom,
        panX: fitView.panX,
        panY: fitView.panY,
        hoveredPixel: null,
        lockedPixel: null
      },
      activeSession.decoded,
      0
    );

    activeSession.state = nextState;
    activeSession.textureRevisionKey = '';
    activeSession.displayLuminanceRange = null;

    store.setState(nextState);
  }

  function closeSessionById(sessionId: string): void {
    if (!renderer) {
      return;
    }

    const removeIndex = sessions.findIndex((session) => session.id === sessionId);
    if (removeIndex < 0) {
      return;
    }
    const removingActiveSession = activeSessionId === sessionId;

    const removedSession = sessions[removeIndex] ?? null;
    sessions = sessions.filter((session) => session.id !== sessionId);

    if (uploadedSessionId === sessionId) {
      uploadedSessionId = null;
      uploadedTextureRevisionKey = '';
    }

    if (!removingActiveSession) {
      ui.setOpenedImageOptions(
        sessions.map((session) => ({ id: session.id, label: session.displayName })),
        activeSessionId
      );
      return;
    }

    if (sessions.length === 0) {
      clearAllSessionsState();
      return;
    }

    const nextIndex = pickNextSessionIndexAfterRemoval(removeIndex, sessions.length);
    if (nextIndex < 0) {
      return;
    }

    const nextSession = sessions[nextIndex];
    const currentState = store.getState();
    const nextState = buildSwitchedSessionState(nextSession, currentState, removedSession?.decoded ?? null);
    activeSessionId = nextSession.id;
    releaseInactiveSessionDisplayCaches(activeSessionId);

    ui.setOpenedImageOptions(
      sessions.map((session) => ({ id: session.id, label: session.displayName })),
      activeSessionId
    );

    store.setState(nextState);
  }

  function closeAllSessions(): void {
    if (!renderer || sessions.length === 0) {
      return;
    }
    clearAllSessionsState();
  }

  function clearAllSessionsState(): void {
    if (!renderer) {
      return;
    }

    sessions = [];
    activeSessionId = null;
    uploadedSessionId = null;
    uploadedTextureRevisionKey = '';
    renderedSessionId = null;
    invalidateHistogramCache();

    renderer.clearImage();

    store.setState({
      exposureEv: 0,
      visualizationMode: 'rgb',
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false,
      zoom: 1,
      panX: 0,
      panY: 0,
      activeLayer: 0,
      displayR: ZERO_CHANNEL,
      displayG: ZERO_CHANNEL,
      displayB: ZERO_CHANNEL,
      hoveredPixel: null,
      lockedPixel: null
    });

    ui.setOpenedImageOptions([], null);
    ui.setLayerOptions([], 0);
    ui.setRgbGroupOptions([], {
      displayR: ZERO_CHANNEL,
      displayG: ZERO_CHANNEL,
      displayB: ZERO_CHANNEL
    });

    renderer.render(store.getState());
  }

  function getActiveSession(): OpenedImageSession | null {
    if (!activeSessionId) {
      return null;
    }

    return sessions.find((session) => session.id === activeSessionId) ?? null;
  }

  function getSelectedLayer(image: DecodedExrImage, layerIndex: number): DecodedLayer | null {
    return image.layers[layerIndex] ?? null;
  }

  function buildLayerOptions(image: DecodedExrImage): Array<{ index: number; label: string }> {
    return image.layers.map((layer, index) => ({
      index,
      label: layer.name ? `Layer ${index + 1}: ${layer.name}` : index === 0 ? 'Main Layer' : `Layer ${index + 1}`
    }));
  }

  function releaseInactiveSessionDisplayCaches(activeId: string | null): void {
    for (const session of sessions) {
      if (session.id === activeId) {
        continue;
      }

      session.displayTexture = null;
      session.displayLuminanceRange = null;
      session.textureRevisionKey = '';
    }

    if (uploadedSessionId !== activeId) {
      uploadedSessionId = null;
      uploadedTextureRevisionKey = '';
    }
  }

  function computeFitView(width: number, height: number): { zoom: number; panX: number; panY: number } {
    if (!renderer) {
      return {
        zoom: clampZoom(1),
        panX: width * 0.5,
        panY: height * 0.5
      };
    }

    const viewport = renderer.getViewport();
    const fitZoom = clampZoom(Math.min(viewport.width / width, viewport.height / height));

    return {
      zoom: fitZoom,
      panX: width * 0.5,
      panY: height * 0.5
    };
  }

  function updateProbeReadout(
    layer: DecodedLayer,
    width: number,
    height: number,
    lockedPixel: ImagePixel | null,
    hoveredPixel: ImagePixel | null,
    displayMapping: { displayR: string; displayG: string; displayB: string },
    exposureEv: number,
    visualizationMode: VisualizationMode,
    colormapRange: DisplayLuminanceRange | null
  ): void {
    const targetPixel = resolveActiveProbePixel(lockedPixel, hoveredPixel);
    const mode = resolveProbeMode(lockedPixel);

    if (!targetPixel) {
      ui.setProbeReadout(mode, null, null);
      return;
    }

    const sample = samplePixelValues(layer, width, height, targetPixel);
    ui.setProbeReadout(
      mode,
      sample,
      buildProbeColorPreview(sample, displayMapping, exposureEv, {
        mode: visualizationMode,
        colormapRange
      })
    );
  }

  async function decodeExrFromSessionSource(source: SessionSource): Promise<DecodedExrImage> {
    if (source.kind === 'url') {
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`Failed to load ${source.url} (${response.status})`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return await loadExr(bytes);
    }

    const bytes = new Uint8Array(await source.file.arrayBuffer());
    return await loadExr(bytes);
  }

  function buildReloadedSessionState(
    currentState: ViewerState,
    previousImage: DecodedExrImage,
    decoded: DecodedExrImage
  ): ViewerState {
    const pan = remapPanToImageCenterAnchor(
      currentState.panX,
      currentState.panY,
      previousImage,
      decoded
    );

    const lockedPixel = currentState.lockedPixel
      ? clampPixelToImageBounds(currentState.lockedPixel, decoded.width, decoded.height)
      : null;
    const hoveredPixel = currentState.hoveredPixel
      ? clampPixelToImageBounds(currentState.hoveredPixel, decoded.width, decoded.height)
      : null;

    return buildViewerStateForLayer(
      {
        ...currentState,
        panX: pan.panX,
        panY: pan.panY,
        hoveredPixel,
        lockedPixel
      },
      decoded,
      currentState.activeLayer
    );
  }

  function buildSwitchedSessionState(
    nextSession: OpenedImageSession,
    currentState: ViewerState,
    previousImage: DecodedExrImage | null
  ): ViewerState {
    const pan = remapPanToImageCenterAnchor(
      currentState.panX,
      currentState.panY,
      previousImage,
      nextSession.decoded
    );

    const lockedPixel = currentState.lockedPixel
      ? clampPixelToImageBounds(currentState.lockedPixel, nextSession.decoded.width, nextSession.decoded.height)
      : null;
    const hoveredPixel = !lockedPixel && currentState.hoveredPixel
      ? clampPixelToImageBounds(currentState.hoveredPixel, nextSession.decoded.width, nextSession.decoded.height)
      : null;

    const nextState = buildViewerStateForLayer(
      {
        ...nextSession.state,
        zoom: currentState.zoom,
        panX: pan.panX,
        panY: pan.panY,
        displayR: currentState.displayR,
        displayG: currentState.displayG,
        displayB: currentState.displayB,
        visualizationMode: currentState.visualizationMode,
        colormapRange: currentState.colormapRange,
        colormapRangeMode: currentState.colormapRangeMode,
        colormapZeroCentered: currentState.colormapZeroCentered,
        hoveredPixel,
        lockedPixel
      },
      nextSession.decoded,
      nextSession.state.activeLayer
    );

    if (lockedPixel) {
      // Ensure the carried lock position is used for probe sampling after switching.
      nextState.hoveredPixel = null;
    }

    return nextState;
  }

  function remapPanToImageCenterAnchor(
    panX: number,
    panY: number,
    previousImage: DecodedExrImage | null,
    nextImage: DecodedExrImage
  ): { panX: number; panY: number } {
    if (!previousImage) {
      return {
        panX,
        panY
      };
    }

    const previousCenterX = previousImage.width * 0.5;
    const previousCenterY = previousImage.height * 0.5;
    const nextCenterX = nextImage.width * 0.5;
    const nextCenterY = nextImage.height * 0.5;

    return {
      panX: nextCenterX + (panX - previousCenterX),
      panY: nextCenterY + (panY - previousCenterY)
    };
  }

  function clampPixelToImageBounds(pixel: ImagePixel, width: number, height: number): ImagePixel | null {
    if (pixel.ix < 0 || pixel.iy < 0 || pixel.ix >= width || pixel.iy >= height) {
      return null;
    }

    return {
      ix: pixel.ix,
      iy: pixel.iy
    };
  }

  function buildTextureRevisionKey(state: ViewerState): string {
    return `${state.activeLayer}:${state.displayR}:${state.displayG}:${state.displayB}`;
  }

  function cloneDisplayLuminanceRange(range: DisplayLuminanceRange | null): DisplayLuminanceRange | null {
    return range ? { min: range.min, max: range.max } : null;
  }

  function resolveAutoColormapRange(
    range: DisplayLuminanceRange | null,
    zeroCentered: boolean
  ): DisplayLuminanceRange | null {
    return zeroCentered
      ? buildZeroCenteredColormapRange(range)
      : cloneDisplayLuminanceRange(range);
  }

  function sameDisplayLuminanceRange(
    a: DisplayLuminanceRange | null,
    b: DisplayLuminanceRange | null
  ): boolean {
    if (!a && !b) {
      return true;
    }

    if (!a || !b) {
      return false;
    }

    return a.min === b.min && a.max === b.max;
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
}
