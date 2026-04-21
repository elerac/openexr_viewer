import {
  DEFAULT_COLORMAP_ID,
  findColormapIdByLabel,
  getColormapAsset,
  getColormapOptions,
  loadColormapRegistry,
  loadColormapLut,
  type ColormapLut,
  type ColormapRegistry
} from './colormaps';
import {
  clampDisplayCacheBudgetMb,
  displayCacheBudgetMbToBytes,
  getRetainedDisplayCacheBytes,
  pruneDisplayCachesToBudget,
  readStoredDisplayCacheBudgetMb,
  saveStoredDisplayCacheBudgetMb
} from './display-cache';
import { loadExrOffMainThread } from './exr-worker-client';
import { clampZoom, ViewerInteraction } from './interaction';
import { buildProbeColorPreview, resolveActiveProbePixel, resolveProbeMode } from './probe';
import { WebGlExrRenderer } from './renderer';
import { createOpenedImageThumbnailDataUrl } from './thumbnail';
import {
  buildSelectedDisplayTexture,
  buildViewerStateForLayer,
  buildSessionDisplayName,
  buildZeroCenteredColormapRange,
  computeDisplayTextureLuminanceRange,
  createDefaultStokesDegreeModulation,
  createInitialState,
  getStokesDegreeModulationLabel,
  getStokesDisplayColormapDefault,
  isStokesDisplaySelection,
  isStokesDegreeModulationParameter,
  persistActiveSessionState,
  pickNextSessionIndexAfterRemoval,
  resolveColormapAutoRange,
  samplePixelValuesForDisplay,
  samePixel,
  shouldRefreshDisplayLuminanceRange,
  shouldPreserveStokesColormapState,
  ViewerStore
} from './state';
import { ViewerUi } from './ui';
import {
  DecodedExrImage,
  DecodedLayer,
  DisplaySelection,
  DisplayLuminanceRange,
  ImagePixel,
  OpenedImageSession,
  SessionSource,
  VisualizationMode,
  ViewerState,
  ZERO_CHANNEL
} from './types';

const COLORMAP_ZERO_CENTER_MANUAL_MIN_MAGNITUDE = 1e-16;
const MIN_RGB_VIEW_LOADING_MS = 120;
const GALLERY_IMAGES = [
  {
    id: 'cbox-rgb',
    label: 'cbox_rgb.exr',
    filename: 'cbox_rgb.exr'
  }
] as const;

type RestorableVisualizationState = Pick<
  ViewerState,
  'visualizationMode' | 'activeColormapId' | 'colormapRange' | 'colormapRangeMode' | 'colormapZeroCentered'
>;

void bootstrap();

async function bootstrap(): Promise<void> {
  const store = new ViewerStore(createInitialState());

  let renderer: WebGlExrRenderer | null = null;
  let interaction: ViewerInteraction | null = null;

  let sessions: OpenedImageSession[] = [];
  let activeSessionId: string | null = null;
  let sessionCounter = 0;
  let rgbViewChangeToken = 0;
  let colormapChangeToken = 0;
  let loadQueue: Promise<void> = Promise.resolve();
  let displayCacheBudgetMb = readStoredDisplayCacheBudgetMb();
  let displayCacheTouchCounter = 0;

  let renderedSessionId: string | null = null;
  let uploadedSessionId: string | null = null;
  let uploadedTextureRevisionKey = '';
  let uploadedColormapId: string | null = null;
  let activeColormapLut: ColormapLut | null = null;
  let defaultColormapId = DEFAULT_COLORMAP_ID;
  let colormapRegistry: ColormapRegistry | null = null;
  const stokesDisplayRestoreStates = new Map<string, RestorableVisualizationState>();

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
    onGalleryImageSelected: (galleryId) => {
      enqueueGalleryImageLoad(galleryId);
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
    onDisplayCacheBudgetChange: (valueMb) => {
      displayCacheBudgetMb = clampDisplayCacheBudgetMb(valueMb);
      saveStoredDisplayCacheBudgetMb(displayCacheBudgetMb);
      ui.setDisplayCacheBudget(displayCacheBudgetMb);
      pruneDisplayCachesToBudget(sessions, activeSessionId, getDisplayCacheBudgetBytes());
      syncDisplayCacheUsageUi();
    },
    onToggleOpenedImagePin: (sessionId) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) {
        return;
      }

      session.displayCachePinned = !session.displayCachePinned;
      syncOpenedImageOptions();
      pruneDisplayCachesToBudget(sessions, activeSessionId, getDisplayCacheBudgetBytes());
      syncDisplayCacheUsageUi();
    },
    onExposureChange: (value) => {
      store.setState({ exposureEv: value });
    },
    onLayerChange: (layerIndex) => {
      setActiveLayer(layerIndex);
    },
    onRgbGroupChange: (mapping) => {
      void applyDisplaySelectionWithLoading(mapping);
    },
    onVisualizationModeChange: (mode) => {
      setVisualizationMode(mode);
    },
    onColormapChange: (colormapId) => {
      void setActiveColormap(colormapId);
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
    onStokesDegreeModulationToggle: () => {
      toggleStokesDegreeModulation();
    },
    onResetView: () => {
      resetAllState();
    }
  });
  ui.setDisplayCacheBudget(displayCacheBudgetMb);
  syncDisplayCacheUsageUi();

  try {
    colormapRegistry = await loadColormapRegistry();
    defaultColormapId = colormapRegistry.defaultId;
    ui.setColormapOptions(getColormapOptions(colormapRegistry), defaultColormapId);
    store.setState({ activeColormapId: defaultColormapId });
    renderer = new WebGlExrRenderer(ui.glCanvas, ui.overlayCanvas);
    await uploadColormapToRenderer(defaultColormapId);
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
      state.visualizationMode !== previous.visualizationMode ||
      state.displaySource !== previous.displaySource ||
      state.stokesParameter !== previous.stokesParameter ||
      state.stokesDegreeModulation !== previous.stokesDegreeModulation
    ) {
      updateStokesDegreeModulationControl(state);
    }

    if (sessionChanged || state.activeColormapId !== previous.activeColormapId) {
      ui.setActiveColormap(state.activeColormapId);
      syncColormapTextureForState(state.activeColormapId);
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
          ui.setProbeMetadata(layer.metadata ?? null);
        }

        const uiSelectionDirty =
          layerSelectionDirty ||
          sessionChanged ||
          state.displaySource !== previous.displaySource ||
          state.stokesParameter !== previous.stokesParameter ||
          state.displayR !== previous.displayR ||
          state.displayG !== previous.displayG ||
          state.displayB !== previous.displayB ||
          state.displayA !== previous.displayA;

        if (uiSelectionDirty) {
          ui.setRgbGroupOptions(layer.channelNames, {
            displaySource: state.displaySource,
            stokesParameter: state.stokesParameter,
            displayR: state.displayR,
            displayG: state.displayG,
            displayB: state.displayB,
            displayA: state.displayA
          });
        }

        const textureKey = buildTextureRevisionKey(state);
        const textureDirty = textureKey !== activeSession.textureRevisionKey || !activeSession.displayTexture;
        if (textureDirty) {
          activeSession.displayTexture = buildSelectedDisplayTexture(
            layer,
            activeImage.width,
            activeImage.height,
            state,
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
          activeSession.displayLuminanceRange = computeDisplayTextureLuminanceRange(
            activeSession.displayTexture
          );
          activeSession.displayLuminanceRangeRevisionKey = textureKey;
        }

        if (activeSession.displayTexture) {
          touchDisplayCache(activeSession);
          pruneDisplayCachesToBudget(sessions, activeSessionId, getDisplayCacheBudgetBytes());
          syncDisplayCacheUsageUi();
        }

        const activeAutoColormapRange = resolveColormapAutoRange(
          state,
          activeSession.displayLuminanceRange,
          state.colormapZeroCentered
        );

        if (
          state.visualizationMode === 'colormap' &&
          (textureDirty || luminanceRangeDirty) &&
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
          luminanceRangeDirty
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

        const probeDirty =
          sessionChanged ||
          state.activeLayer !== previous.activeLayer ||
          state.exposureEv !== previous.exposureEv ||
          state.displaySource !== previous.displaySource ||
          state.stokesParameter !== previous.stokesParameter ||
          state.displayR !== previous.displayR ||
          state.displayG !== previous.displayG ||
          state.displayB !== previous.displayB ||
          state.displayA !== previous.displayA ||
          state.visualizationMode !== previous.visualizationMode ||
          state.activeColormapId !== previous.activeColormapId ||
          state.colormapRange !== previous.colormapRange ||
          state.colormapRangeMode !== previous.colormapRangeMode ||
          state.colormapZeroCentered !== previous.colormapZeroCentered ||
          state.stokesDegreeModulation !== previous.stokesDegreeModulation ||
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
              displaySource: state.displaySource,
              stokesParameter: state.stokesParameter,
              displayR: state.displayR,
              displayG: state.displayG,
              displayB: state.displayB,
              displayA: state.displayA
            },
            state.exposureEv,
            state.visualizationMode,
            state.colormapRange,
            getActiveColormapLut(state.activeColormapId),
            state.stokesDegreeModulation
          );
        }
      } else {
        ui.setLayerOptions([], 0);
        ui.setProbeMetadata(null);
        ui.setRgbGroupOptions([], {
          displaySource: 'channels',
          stokesParameter: null,
          displayR: ZERO_CHANNEL,
          displayG: ZERO_CHANNEL,
          displayB: ZERO_CHANNEL,
          displayA: null
        });
        ui.setColormapRange(null, null);
        ui.setProbeReadout('Hover', null, null, {
          width: activeImage.width,
          height: activeImage.height
        });
      }
    } else {
      ui.setVisualizationMode('rgb');
      ui.setColormapRange(null, null);
      ui.setProbeMetadata(null);
      ui.setProbeReadout('Hover', null, null);
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
      state.displaySource !== previous.displaySource ||
      state.stokesParameter !== previous.stokesParameter ||
      state.displayR !== previous.displayR ||
      state.displayG !== previous.displayG ||
      state.displayB !== previous.displayB ||
      state.displayA !== previous.displayA ||
      state.visualizationMode !== previous.visualizationMode ||
      state.activeColormapId !== previous.activeColormapId ||
      state.colormapRange !== previous.colormapRange ||
      state.colormapRangeMode !== previous.colormapRangeMode ||
      state.colormapZeroCentered !== previous.colormapZeroCentered ||
      state.stokesDegreeModulation !== previous.stokesDegreeModulation;

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
  syncOpenedImageOptions();

  window.addEventListener('beforeunload', () => {
    interaction?.destroy();
    resizeObserver.disconnect();
  });

  async function loadGalleryImage(galleryId: string): Promise<void> {
    if (!renderer) {
      return;
    }

    ui.setLoading(true);
    ui.setError(null);

    const galleryImage = GALLERY_IMAGES.find((item) => item.id === galleryId);
    if (!galleryImage) {
      ui.setError(`Unknown gallery image: ${galleryId}`);
      ui.setLoading(false);
      return;
    }

    const galleryImageUrl = `${import.meta.env.BASE_URL}${galleryImage.filename}`;

    try {
      const response = await fetch(galleryImageUrl);
      if (!response.ok) {
        throw new Error(`Failed to load ${galleryImageUrl} (${response.status})`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const byteLength = bytes.byteLength;
      await applyDecodedImage(await loadExrOffMainThread(bytes), galleryImage.filename, byteLength, {
        kind: 'url',
        url: galleryImageUrl
      });
    } catch (error) {
      ui.setError(error instanceof Error ? error.message : `Unknown error while loading ${galleryImage.label}`);
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
      const decoded = await loadExrOffMainThread(bytes);
      await applyDecodedImage(decoded, file.name, file.size, {
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

  function enqueueGalleryImageLoad(galleryId: string): void {
    loadQueue = loadQueue
      .catch(() => undefined)
      .then(async () => {
        await loadGalleryImage(galleryId);
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

  async function applyDecodedImage(
    decoded: DecodedExrImage,
    filename: string,
    fileSizeBytes: number | null,
    source: SessionSource
  ): Promise<void> {
    if (!renderer) {
      return;
    }

    const sessionId = `session-${++sessionCounter}`;
    const displayName = buildSessionDisplayName(
      filename,
      sessions.map((session) => session.filename)
    );

    const fitView = computeFitView(decoded.width, decoded.height);
    const initialExposureEv = activeSessionId ? store.getState().exposureEv : 0;

    const sessionState = buildViewerStateForLayer(
      {
        exposureEv: initialExposureEv,
        visualizationMode: 'rgb',
        activeColormapId: defaultColormapId,
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        colormapZeroCentered: false,
        stokesDegreeModulation: createDefaultStokesDegreeModulation(),
        activeLayer: 0,
        displaySource: 'channels',
        stokesParameter: null,
        displayR: ZERO_CHANNEL,
        displayG: ZERO_CHANNEL,
        displayB: ZERO_CHANNEL,
        displayA: null,
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
      fileSizeBytes,
      source,
      decoded,
      thumbnailDataUrl: createOpenedImageThumbnailDataUrl(decoded, sessionState),
      state: sessionState,
      textureRevisionKey: '',
      displayTexture: null,
      displayLuminanceRangeRevisionKey: '',
      displayLuminanceRange: null,
      displayCachePinned: false,
      displayCacheLastTouched: 0
    };

    sessions = [...sessions, session];
    activeSessionId = session.id;
    syncOpenedImageOptions();

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
        thumbnailDataUrl: createOpenedImageThumbnailDataUrl(decoded, nextState),
        state: nextState,
        textureRevisionKey: '',
        displayTexture: null,
        displayLuminanceRangeRevisionKey: '',
        displayLuminanceRange: null,
        displayCacheLastTouched: 0
      };

      sessions = sessions.map((current) => (current.id === sessionId ? reloadedSession : current));

      if (uploadedSessionId === sessionId) {
        uploadedSessionId = null;
        uploadedTextureRevisionKey = '';
      }

      syncOpenedImageOptions();
      syncDisplayCacheUsageUi();

      if (activeSessionId === sessionId) {
        store.setState(nextState);
      }

      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Unknown error.';
    }
  }

  async function applyDisplaySelectionWithLoading(selection: DisplaySelection): Promise<void> {
    const activeSession = getActiveSession();
    if (!activeSession) {
      store.setState({ ...selection });
      return;
    }

    const currentState = store.getState();
    const stokesDefaults = getStokesDisplayColormapDefault(selection);
    if (!stokesDefaults) {
      const patch: Partial<ViewerState> = { ...selection };
      if (selection.displaySource === 'channels' && isStokesDisplaySelection(currentState)) {
        Object.assign(patch, resolveStokesDisplayRestoreState(activeSession.id));
      }

      rgbViewChangeToken += 1;
      ui.setRgbViewLoading(false);
      const sessionId = activeSession.id;
      queueMicrotask(() => {
        if (getActiveSession()?.id !== sessionId) {
          return;
        }

        store.setState({ ...patch });
      });
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

      const currentState = store.getState();
      const patch: Partial<ViewerState> = { ...selection };
      if (selection.displaySource === 'channels' && isStokesDisplaySelection(currentState)) {
        Object.assign(patch, resolveStokesDisplayRestoreState(activeSession.id));
      }

      if (!isStokesDisplaySelection(currentState)) {
        stokesDisplayRestoreStates.set(activeSession.id, captureRestorableVisualizationState(currentState));
      }

      if (shouldPreserveStokesColormapState(currentState, selection)) {
        patch.visualizationMode = 'colormap';
        store.setState({ ...patch });

        const elapsedMs = performance.now() - startedAt;
        if (elapsedMs < MIN_RGB_VIEW_LOADING_MS) {
          await waitMs(MIN_RGB_VIEW_LOADING_MS - elapsedMs);
        }
        return;
      }

      const registry = getLoadedColormapRegistry();
      const colormapId = findColormapIdByLabel(registry, stokesDefaults.colormapLabel);
      if (!colormapId) {
        ui.setError(`Required colormap not found: ${stokesDefaults.colormapLabel}`);
        return;
      }

      const colormapToken = ++colormapChangeToken;
      const lut = await loadColormapLut(registry, colormapId);
      if (token !== rgbViewChangeToken || colormapToken !== colormapChangeToken) {
        return;
      }

      uploadLoadedColormap(colormapId, lut);
      patch.visualizationMode = 'colormap';
      patch.activeColormapId = colormapId;
      patch.colormapRange = stokesDefaults.range;
      patch.colormapRangeMode = 'oneTime';
      patch.colormapZeroCentered = stokesDefaults.zeroCentered;

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

  async function setActiveColormap(colormapId: string): Promise<void> {
    const registry = getLoadedColormapRegistry();
    if (!getColormapAsset(registry, colormapId)) {
      ui.setActiveColormap(store.getState().activeColormapId);
      ui.setError(`Unknown colormap: ${colormapId}`);
      return;
    }

    const currentState = store.getState();
    if (currentState.activeColormapId === colormapId) {
      return;
    }

    const token = ++colormapChangeToken;
    const startedAt = performance.now();
    ui.setRgbViewLoading(true);

    try {
      const lut = await loadColormapLut(registry, colormapId);
      if (token !== colormapChangeToken) {
        return;
      }

      uploadLoadedColormap(colormapId, lut);
      store.setState({
        activeColormapId: colormapId
      });

      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs < MIN_RGB_VIEW_LOADING_MS) {
        await waitMs(MIN_RGB_VIEW_LOADING_MS - elapsedMs);
      }
    } catch (error) {
      ui.setActiveColormap(currentState.activeColormapId);
      ui.setError(error instanceof Error ? error.message : 'Failed to load colormap.');
    } finally {
      if (token === colormapChangeToken) {
        ui.setRgbViewLoading(false);
      }
    }
  }

  function setVisualizationMode(mode: VisualizationMode): void {
    if (!getActiveSession()) {
      return;
    }

    const currentState = store.getState();
    if (currentState.visualizationMode === mode) {
      return;
    }

    if (mode === 'colormap') {
      syncColormapTextureForState(currentState.activeColormapId);
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
    const nextRange = currentState.colormapRangeMode === 'alwaysAuto'
      ? resolveColormapAutoRange(currentState, activeSession.displayLuminanceRange, nextZeroCentered)
      : nextZeroCentered
        ? buildZeroCenteredColormapRange(currentState.colormapRange ?? activeSession.displayLuminanceRange)
        : cloneDisplayLuminanceRange(currentState.colormapRange);

    store.setState({
      colormapRange: nextRange,
      colormapZeroCentered: nextZeroCentered
    });
  }

  function toggleStokesDegreeModulation(): void {
    if (!getActiveSession()) {
      return;
    }

    const currentState = store.getState();
    if (
      currentState.displaySource === 'channels' ||
      !isStokesDegreeModulationParameter(currentState.stokesParameter)
    ) {
      return;
    }

    const parameter = currentState.stokesParameter;
    store.setState({
      stokesDegreeModulation: {
        ...currentState.stokesDegreeModulation,
        [parameter]: !currentState.stokesDegreeModulation[parameter]
      }
    });
  }

  function applyAutoColormapRange(): void {
    const activeSession = getActiveSession();
    if (!activeSession) {
      return;
    }

    const currentState = store.getState();
    const nextRange = resolveColormapAutoRange(
      currentState,
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
      nextState.displaySource === currentState.displaySource &&
      nextState.stokesParameter === currentState.stokesParameter &&
      nextState.displayR === currentState.displayR &&
      nextState.displayG === currentState.displayG &&
      nextState.displayB === currentState.displayB &&
      nextState.displayA === currentState.displayA
    ) {
      return;
    }

    store.setState(nextState);
  }

  function switchActiveSession(sessionId: string): void {
    const nextSession = sessions.find((session) => session.id === sessionId);
    if (!nextSession || activeSessionId === nextSession.id) {
      return;
    }

    const currentState = store.getState();
    const nextState = buildSwitchedSessionState(nextSession, currentState, getActiveSession()?.decoded ?? null);

    activeSessionId = nextSession.id;
    syncOpenedImageOptions();

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

    syncOpenedImageOptions();
  }

  function resetAllState(): void {
    const activeSession = getActiveSession();
    if (!activeSession) {
      store.setState({
        exposureEv: 0,
        visualizationMode: 'rgb',
        activeColormapId: defaultColormapId,
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        colormapZeroCentered: false,
        stokesDegreeModulation: createDefaultStokesDegreeModulation(),
        displaySource: 'channels',
        stokesParameter: null,
        displayA: null,
        hoveredPixel: null,
        lockedPixel: null
      });
      return;
    }

    const fitView = computeFitView(activeSession.decoded.width, activeSession.decoded.height);

    const nextState = buildViewerStateForLayer(
      {
        exposureEv: 0,
        visualizationMode: 'rgb',
        activeColormapId: defaultColormapId,
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        colormapZeroCentered: false,
        stokesDegreeModulation: createDefaultStokesDegreeModulation(),
        activeLayer: 0,
        displaySource: 'channels',
        stokesParameter: null,
        displayR: ZERO_CHANNEL,
        displayG: ZERO_CHANNEL,
        displayB: ZERO_CHANNEL,
        displayA: null,
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
    activeSession.displayLuminanceRangeRevisionKey = '';
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
      stokesDisplayRestoreStates.delete(sessionId);
      syncOpenedImageOptions();
      syncDisplayCacheUsageUi();
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
    stokesDisplayRestoreStates.delete(sessionId);
    activeSessionId = nextSession.id;

    syncOpenedImageOptions();

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
    stokesDisplayRestoreStates.clear();

    renderer.clearImage();

    store.setState({
      exposureEv: 0,
      visualizationMode: 'rgb',
      activeColormapId: defaultColormapId,
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false,
      stokesDegreeModulation: createDefaultStokesDegreeModulation(),
      zoom: 1,
      panX: 0,
      panY: 0,
      activeLayer: 0,
      displaySource: 'channels',
      stokesParameter: null,
      displayR: ZERO_CHANNEL,
      displayG: ZERO_CHANNEL,
      displayB: ZERO_CHANNEL,
      displayA: null,
      hoveredPixel: null,
      lockedPixel: null
    });

    ui.setOpenedImageOptions([], null);
    ui.setLayerOptions([], 0);
    ui.setProbeMetadata(null);
    ui.setRgbGroupOptions([], {
      displaySource: 'channels',
      stokesParameter: null,
      displayR: ZERO_CHANNEL,
      displayG: ZERO_CHANNEL,
      displayB: ZERO_CHANNEL,
      displayA: null
    });

    syncDisplayCacheUsageUi();
    renderer.render(store.getState());
  }

  async function uploadColormapToRenderer(colormapId: string): Promise<void> {
    uploadLoadedColormap(colormapId, await loadColormapLut(getLoadedColormapRegistry(), colormapId));
  }

  function getLoadedColormapRegistry(): ColormapRegistry {
    if (!colormapRegistry) {
      throw new Error('Colormap manifest is not loaded.');
    }

    return colormapRegistry;
  }

  function uploadLoadedColormap(colormapId: string, lut: ColormapLut): void {
    if (!renderer) {
      return;
    }

    renderer.setColormapTexture(lut.entryCount, lut.rgba8);
    uploadedColormapId = colormapId;
    activeColormapLut = lut;
    ui.setColormapGradient(lut);
  }

  function syncColormapTextureForState(colormapId: string): void {
    if (uploadedColormapId === colormapId) {
      return;
    }

    const token = ++colormapChangeToken;
    void loadColormapLut(getLoadedColormapRegistry(), colormapId)
      .then((lut) => {
        if (token !== colormapChangeToken || store.getState().activeColormapId !== colormapId) {
          return;
        }

        uploadLoadedColormap(colormapId, lut);
        refreshActiveProbeReadout();
        renderer?.render(store.getState());
      })
      .catch((error) => {
        ui.setError(error instanceof Error ? error.message : 'Failed to load colormap.');
      });
  }

  function getActiveColormapLut(colormapId: string): ColormapLut | null {
    return uploadedColormapId === colormapId ? activeColormapLut : null;
  }

  function updateStokesDegreeModulationControl(state: ViewerState): void {
    if (state.displaySource === 'channels' || !isStokesDegreeModulationParameter(state.stokesParameter)) {
      ui.setStokesDegreeModulationControl(null);
      return;
    }

    ui.setStokesDegreeModulationControl(
      getStokesDegreeModulationLabel(state.stokesParameter),
      state.stokesDegreeModulation[state.stokesParameter]
    );
  }

  function refreshActiveProbeReadout(): void {
    const activeSession = getActiveSession();
    if (!activeSession) {
      ui.setProbeMetadata(null);
      ui.setProbeReadout('Hover', null, null);
      return;
    }

    const state = store.getState();
    const layer = getSelectedLayer(activeSession.decoded, state.activeLayer);
    if (!layer) {
      ui.setProbeMetadata(null);
      ui.setProbeReadout('Hover', null, null, {
        width: activeSession.decoded.width,
        height: activeSession.decoded.height
      });
      return;
    }

    ui.setProbeMetadata(layer.metadata ?? null);
    updateProbeReadout(
      layer,
      activeSession.decoded.width,
      activeSession.decoded.height,
      state.lockedPixel,
      state.hoveredPixel,
      {
        displaySource: state.displaySource,
        stokesParameter: state.stokesParameter,
        displayR: state.displayR,
        displayG: state.displayG,
        displayB: state.displayB,
        displayA: state.displayA
      },
      state.exposureEv,
      state.visualizationMode,
      state.colormapRange,
      getActiveColormapLut(state.activeColormapId),
      state.stokesDegreeModulation
    );
  }

  function getActiveSession(): OpenedImageSession | null {
    if (!activeSessionId) {
      return null;
    }

    return sessions.find((session) => session.id === activeSessionId) ?? null;
  }

  function syncOpenedImageOptions(): void {
    ui.setOpenedImageOptions(
      sessions.map((session) => ({
        id: session.id,
        label: session.displayName,
        sizeBytes: session.fileSizeBytes,
        sourceDetail: getSessionSourceDetail(session.source, session.filename),
        thumbnailDataUrl: session.thumbnailDataUrl,
        pinned: session.displayCachePinned
      })),
      activeSessionId
    );
  }

  function getSessionSourceDetail(source: SessionSource, fallbackName: string): string {
    if (source.kind === 'url') {
      return source.url;
    }

    const relativePath = source.file.webkitRelativePath.trim();
    return relativePath || source.file.name || fallbackName;
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

  function getDisplayCacheBudgetBytes(): number {
    return displayCacheBudgetMbToBytes(displayCacheBudgetMb);
  }

  function touchDisplayCache(session: OpenedImageSession): void {
    if (!session.displayTexture) {
      return;
    }

    session.displayCacheLastTouched = ++displayCacheTouchCounter;
  }

  function syncDisplayCacheUsageUi(): void {
    ui.setDisplayCacheUsage(getRetainedDisplayCacheBytes(sessions), getDisplayCacheBudgetBytes());
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
    displayMapping: DisplaySelection,
    exposureEv: number,
    visualizationMode: VisualizationMode,
    colormapRange: DisplayLuminanceRange | null,
    colormapLut: ColormapLut | null,
    stokesDegreeModulation: ViewerState['stokesDegreeModulation']
  ): void {
    const targetPixel = resolveActiveProbePixel(lockedPixel, hoveredPixel);
    const mode = resolveProbeMode(lockedPixel);

    if (!targetPixel) {
      ui.setProbeReadout(mode, null, null, { width, height });
      return;
    }

    const sample = samplePixelValuesForDisplay(layer, width, height, targetPixel, displayMapping);
    ui.setProbeReadout(
      mode,
      sample,
      buildProbeColorPreview(sample, displayMapping, exposureEv, {
        mode: visualizationMode,
        colormapRange,
        colormapLut,
        stokesDegreeModulation
      }),
      { width, height }
    );
  }

  async function decodeExrFromSessionSource(source: SessionSource): Promise<DecodedExrImage> {
    if (source.kind === 'url') {
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`Failed to load ${source.url} (${response.status})`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return await loadExrOffMainThread(bytes);
    }

    const bytes = new Uint8Array(await source.file.arrayBuffer());
    return await loadExrOffMainThread(bytes);
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
        exposureEv: currentState.exposureEv,
        displaySource: currentState.displaySource,
        stokesParameter: currentState.stokesParameter,
        displayR: currentState.displayR,
        displayG: currentState.displayG,
        displayB: currentState.displayB,
        displayA: currentState.displayA,
        visualizationMode: currentState.visualizationMode,
        activeColormapId: currentState.activeColormapId,
        colormapRange: currentState.colormapRange,
        colormapRangeMode: currentState.colormapRangeMode,
        colormapZeroCentered: currentState.colormapZeroCentered,
        stokesDegreeModulation: { ...currentState.stokesDegreeModulation },
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
    return [
      state.activeLayer,
      state.displaySource,
      state.stokesParameter ?? '',
      state.displayR,
      state.displayG,
      state.displayB,
      state.displayA ?? ''
    ].join(':');
  }

  function cloneDisplayLuminanceRange(range: DisplayLuminanceRange | null): DisplayLuminanceRange | null {
    return range ? { min: range.min, max: range.max } : null;
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

  function resolveStokesDisplayRestoreState(sessionId: string): RestorableVisualizationState {
    const restoreState = stokesDisplayRestoreStates.get(sessionId);
    if (restoreState) {
      return {
        ...restoreState,
        colormapRange: cloneDisplayLuminanceRange(restoreState.colormapRange)
      };
    }

    return {
      visualizationMode: 'rgb',
      activeColormapId: defaultColormapId,
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false
    };
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
