import { zipSync } from 'fflate';
import { findColormapIdByLabel, getColormapAsset, loadColormapLut, type ColormapLut } from '../../colormaps';
import { cloneDisplayLuminanceRange, resolveColormapAutoRange } from '../../colormap-range';
import { cloneDisplaySelection, isStokesSelection } from '../../display-model';
import { createPngBlobFromPixels } from '../../export-image';
import { buildColormapExportPixels, type ExportImagePixels } from '../../export/export-pixels';
import {
  buildReproductionMetadataFilename,
  buildScreenshotReproductionMetadata,
  serializeScreenshotReproductionMetadata,
  type ScreenshotReproductionMetadataV1
} from '../../export/screenshot-reproduction-metadata';
import { createAbortError, isAbortError, throwIfAborted } from '../../lifecycle';
import { RenderCacheService } from '../../services/render-cache-service';
import { getStokesDisplayColormapDefault, isStokesDegreeModulationParameter } from '../../stokes';
import { buildDisplaySelectionThumbnailPixels } from '../../thumbnail';
import { createInteractionState, mergeRenderState } from '../../view-state';
import {
  selectActiveColormapLut,
  selectActiveSession,
  selectColormapLutById
} from '../viewer-app-selectors';
import { ViewerAppCore } from '../viewer-app-core';
import type { ViewerAppState } from '../viewer-app-types';
import type { DisplayController } from '../../controllers/display-controller';
import type {
  ExportColormapPreviewRequest,
  ExportColormapRequest,
  ExportImageBatchPreviewRequest,
  ExportImageBatchRequest,
  ExportImagePreviewRequest,
  ExportImageRequest,
  OpenedImageSession,
  ViewerState,
  ViewerSessionState
} from '../../types';
import type { WebGlExrRenderer } from '../../renderer';

type BatchEntryVisualizationState = Pick<
  ViewerSessionState,
  'visualizationMode' | 'activeColormapId' | 'colormapRange' | 'colormapRangeMode' | 'colormapZeroCentered'
>;

interface ColormapExportResolverOptions {
  signal?: AbortSignal;
  previewMaxLongestEdge?: number;
}

interface ImageExportResolverOptions {
  signal?: AbortSignal;
  previewMaxLongestEdge?: number;
}

interface ColormapExportResolverDependencies {
  core: ViewerAppCore;
  isDisposed: () => boolean;
}

interface ImageExportResolverDependencies {
  core: ViewerAppCore;
  getRenderCache: () => RenderCacheService;
  getRenderer: () => WebGlExrRenderer;
  getDisplayController: () => DisplayController;
  isDisposed: () => boolean;
}

interface ExportImageActionDependencies {
  core: ViewerAppCore;
  resolveImageExportPixels: ReturnType<typeof createImageExportPixelsResolver>;
  isDisposed: () => boolean;
}

interface ExportImageBatchActionDependencies {
  core: ViewerAppCore;
  getRenderCache: () => RenderCacheService;
  getRenderer: () => WebGlExrRenderer;
  isDisposed: () => boolean;
}

interface ExportImageBatchPreviewActionDependencies {
  core: ViewerAppCore;
  getRenderCache: () => RenderCacheService;
  getRenderer: () => WebGlExrRenderer;
  isDisposed: () => boolean;
  previewMaxLongestEdge: number;
}

type ViewerStateProvider = () => ViewerAppState;

interface ExportColormapActionDependencies {
  core: ViewerAppCore;
  resolveColormapExportPixels: ReturnType<typeof createColormapExportPixelsResolver>;
  isDisposed: () => boolean;
}

export function createColormapExportPixelsResolver({
  core,
  isDisposed
}: ColormapExportResolverDependencies) {
  return async (
    request: ExportColormapPreviewRequest | ExportColormapRequest,
    options: ColormapExportResolverOptions = {}
  ) => {
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    if (options.signal) {
      throwIfAborted(options.signal);
    }

    const state = core.getState();
    const registry = state.colormapRegistry;
    if (!registry) {
      throw new Error('No colormaps are available.');
    }

    if (!Number.isInteger(request.width) || request.width <= 0 || !Number.isInteger(request.height) || request.height <= 0) {
      throw new Error('Colormap export dimensions must be positive integers.');
    }

    if (!getColormapAsset(registry, request.colormapId)) {
      throw new Error(`Unknown colormap: ${request.colormapId}`);
    }

    const dimensions = options.previewMaxLongestEdge
      ? resolveBoundedColormapExportSize(request.width, request.height, options.previewMaxLongestEdge)
      : { width: request.width, height: request.height };

    const lut = await loadColormapLut(registry, request.colormapId, options.signal);
    if (options.signal) {
      throwIfAborted(options.signal);
    }

    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    return buildColormapExportPixels({
      lut,
      width: dimensions.width,
      height: dimensions.height,
      orientation: request.orientation
    });
  };
}

export function createImageExportPixelsResolver({
  core,
  getRenderCache,
  getRenderer,
  getDisplayController,
  isDisposed
}: ImageExportResolverDependencies): (
  request?: ExportImagePreviewRequest | ExportImageRequest,
  options?: ImageExportResolverOptions
) => Promise<ExportImagePixels> {
  return async (
    request: ExportImagePreviewRequest | ExportImageRequest = { mode: 'image' },
    options: ImageExportResolverOptions = {}
  ) => {
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    if (options.signal) {
      throwIfAborted(options.signal);
    }

    const state = core.getState();
    const activeSession = selectActiveSession(state);
    if (!activeSession) {
      throw new Error('No image is active.');
    }

    if (
      state.sessionState.visualizationMode === 'colormap' &&
      !getDisplayController().getActiveColormapLutForState(state.sessionState.activeColormapId)
    ) {
      throw new Error('The active colormap is not ready for export.');
    }

    assertActiveSessionCurrent(core.getState(), activeSession, options.signal);
    getRenderCache().prepareActiveSession(activeSession, state.sessionState);
    if (options.signal) {
      throwIfAborted(options.signal);
    }
    assertActiveSessionCurrent(core.getState(), activeSession, options.signal);

    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    const screenshotRegion = request.mode === 'screenshot' ? request : null;
    const requestedWidth = screenshotRegion?.outputWidth ?? activeSession.decoded.width;
    const requestedHeight = screenshotRegion?.outputHeight ?? activeSession.decoded.height;
    const outputSize = options.previewMaxLongestEdge
      ? resolveBoundedImageExportSize(requestedWidth, requestedHeight, options.previewMaxLongestEdge)
      : screenshotRegion
        ? { width: requestedWidth, height: requestedHeight }
        : null;

    return getRenderer().readExportPixels({
      state: mergeRenderState(state.sessionState, state.interactionState),
      sourceWidth: activeSession.decoded.width,
      sourceHeight: activeSession.decoded.height,
      ...(screenshotRegion ? {
        screenshot: {
          rect: screenshotRegion.rect,
          sourceViewport: screenshotRegion.sourceViewport
        }
      } : {}),
      ...(outputSize ? {
        outputWidth: outputSize.width,
        outputHeight: outputSize.height
      } : {})
    });
  };
}

export async function handleExportImage(
  request: ExportImageRequest,
  {
    core,
    resolveImageExportPixels,
    isDisposed
  }: ExportImageActionDependencies
): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  try {
    const stateSnapshot = core.getState();
    const sourceSession = selectActiveSession(stateSnapshot);
    const pixels = await resolveImageExportPixels(request);
    if (sourceSession) {
      assertActiveSessionCurrent(core.getState(), sourceSession);
    }
    const blob = await createPngBlobFromPixels(pixels, {
      compressionLevel: request.pngCompressionLevel
    });
    if (sourceSession) {
      assertActiveSessionCurrent(core.getState(), sourceSession);
    }
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }
    if (sourceSession && request.mode === 'screenshot' && request.includeReproductionMetadata) {
      const jsonFilename = buildReproductionMetadataFilename(request.filename);
      const metadata = buildScreenshotReproductionMetadata({
        pngFilename: request.filename,
        jsonFilename,
        pngCompressionLevel: request.pngCompressionLevel,
        region: request,
        session: sourceSession,
        renderState: mergeRenderState(stateSnapshot.sessionState, stateSnapshot.interactionState)
      });
      const zipBlob = createZipBlob({
        [request.filename]: new Uint8Array(await blob.arrayBuffer()),
        [jsonFilename]: new Uint8Array(await createJsonBlob(metadata).arrayBuffer())
      });
      triggerBrowserDownload(zipBlob, buildScreenshotMetadataBundleFilename(request.filename));
    } else {
      triggerBrowserDownload(blob, request.filename);
    }
  } catch (error) {
    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    if (isAbortError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Export failed.';
    core.dispatch({ type: 'errorSet', message });
    throw new Error(message);
  }
}

export async function handleExportImageBatch(
  request: ExportImageBatchRequest,
  signal: AbortSignal,
  {
    core,
    getRenderCache,
    getRenderer,
    isDisposed
  }: ExportImageBatchActionDependencies
): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  const renderCache = getRenderCache();
  const renderer = getRenderer();
  const stateSnapshot = core.getState();
  const lutCache = new Map<string, ColormapLut>();

  try {
    if (request.format !== 'png-zip') {
      throw new Error('Unsupported batch export format.');
    }
    if (request.entries.length === 0) {
      throw new Error('Select at least one image.');
    }

    const files: Record<string, Uint8Array> = {};
    for (const entry of request.entries) {
      throwIfAborted(signal, 'Batch export cancelled.');
      if (isDisposed()) {
        throw createAbortError('Viewer application has been disposed.');
      }

      const session = stateSnapshot.sessions.find((item) => item.id === entry.sessionId) ?? null;
      if (!session) {
        throw new Error(`Image is no longer open: ${entry.sessionId}`);
      }

      const result = await resolveBatchEntryExportResult({
        entry,
        session,
        appState: stateSnapshot,
        getCurrentState: () => core.getState(),
        renderCache,
        renderer,
        lutCache,
        signal,
        abortMessage: 'Batch export cancelled.'
      });
      const blob = await createPngBlobFromPixels(result.pixels, {
        compressionLevel: request.pngCompressionLevel
      });
      throwIfAborted(signal, 'Batch export cancelled.');
      assertSessionCurrent(core.getState(), session, signal);
      files[entry.outputFilename] = new Uint8Array(await blob.arrayBuffer());
      if (request.includeReproductionMetadata && entry.mode === 'screenshot') {
        const jsonFilename = buildReproductionMetadataFilename(entry.outputFilename);
        const metadata = buildScreenshotReproductionMetadata({
          pngFilename: entry.outputFilename,
          jsonFilename,
          pngCompressionLevel: request.pngCompressionLevel,
          region: entry,
          session,
          renderState: result.renderState,
          batch: {
            archiveFilename: request.archiveFilename,
            sessionId: entry.sessionId,
            channelLabel: entry.channelLabel,
            outputFilename: entry.outputFilename
          }
        });
        files[jsonFilename] = new Uint8Array(await createJsonBlob(metadata).arrayBuffer());
      }
      throwIfAborted(signal, 'Batch export cancelled.');
      assertSessionCurrent(core.getState(), session, signal);
    }

    const zipBlob = createZipBlob(files);
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }
    triggerBrowserDownload(zipBlob, request.archiveFilename);
  } catch (error) {
    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    if (signal.aborted || isAbortError(error)) {
      throw error instanceof Error ? error : createAbortError('Batch export cancelled.');
    }

    const message = error instanceof Error ? error.message : 'Batch export failed.';
    core.dispatch({ type: 'errorSet', message });
    throw new Error(message);
  } finally {
    if (!isDisposed()) {
      restoreActiveRendererBinding(core, renderCache, renderer);
    }
  }
}

export async function resolveExportImageBatchPreviewPixels(
  request: ExportImageBatchPreviewRequest,
  signal: AbortSignal,
  {
    core,
    getRenderCache,
    getRenderer,
    isDisposed,
    previewMaxLongestEdge
  }: ExportImageBatchPreviewActionDependencies
): Promise<ExportImagePixels> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  const renderCache = getRenderCache();
  const stateSnapshot = core.getState();
  const lutCache = new Map<string, ColormapLut>();

  try {
    throwIfAborted(signal, 'Batch export preview cancelled.');
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    const session = stateSnapshot.sessions.find((item) => item.id === request.sessionId) ?? null;
    if (!session) {
      throw new Error(`Image is no longer open: ${request.sessionId}`);
    }

    const pixels = await resolveBatchEntryPreviewPixels({
      entry: request,
      session,
      appState: stateSnapshot,
      getCurrentState: () => core.getState(),
      renderCache,
      renderer: getRenderer(),
      lutCache,
      signal,
      previewMaxLongestEdge,
      abortMessage: 'Batch export preview cancelled.'
    });
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    return pixels;
  } catch (error) {
    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    if (signal.aborted) {
      throw error instanceof Error ? error : createAbortError('Batch export preview cancelled.');
    }

    throw error instanceof Error ? error : new Error('Batch export preview failed.');
  } finally {
    if (request.mode === 'screenshot' && !isDisposed()) {
      restoreActiveRendererBinding(core, renderCache, getRenderer());
    }
  }
}

export async function handleExportColormap(
  request: ExportColormapRequest,
  {
    core,
    resolveColormapExportPixels,
    isDisposed
  }: ExportColormapActionDependencies
): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  try {
    const pixels = await resolveColormapExportPixels(request);
    const blob = await createPngBlobFromPixels(pixels, {
      compressionLevel: request.pngCompressionLevel
    });
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    triggerBrowserDownload(blob, request.filename);
  } catch (error) {
    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    const message = error instanceof Error ? error.message : 'Export failed.';
    core.dispatch({ type: 'errorSet', message });
    throw new Error(message);
  }
}

async function resolveBatchEntryExportResult({
  entry,
  session,
  appState,
  getCurrentState,
  renderCache,
  renderer,
  lutCache,
  signal,
  previewMaxLongestEdge,
  abortMessage
}: {
  entry: ExportImageBatchPreviewRequest;
  session: OpenedImageSession;
  appState: ViewerAppState;
  getCurrentState: ViewerStateProvider;
  renderCache: RenderCacheService;
  renderer: WebGlExrRenderer;
  lutCache: Map<string, ColormapLut>;
  signal: AbortSignal;
  previewMaxLongestEdge?: number;
  abortMessage: string;
}): Promise<{ pixels: ExportImagePixels; renderState: ViewerState }> {
  const exportState = await resolveBatchEntryExportState({
    entry,
    session,
    appState,
    renderCache,
    lutCache,
    signal
  });
  assertSessionCurrent(getCurrentState(), session, signal);
  if (exportState.lut) {
    renderer.setColormapTexture(exportState.lut.entryCount, exportState.lut.rgba8);
  }

  assertSessionCurrent(getCurrentState(), session, signal);
  renderCache.prepareActiveSession(session, exportState.state);
  throwIfAborted(signal, abortMessage);
  assertSessionCurrent(getCurrentState(), session, signal);

  const screenshotRegion = entry.mode === 'screenshot' ? entry : null;
  const requestedWidth = screenshotRegion?.outputWidth ?? session.decoded.width;
  const requestedHeight = screenshotRegion?.outputHeight ?? session.decoded.height;
  const outputSize = previewMaxLongestEdge
    ? resolveBoundedImageExportSize(requestedWidth, requestedHeight, previewMaxLongestEdge)
    : screenshotRegion
      ? { width: requestedWidth, height: requestedHeight }
      : null;
  const renderState = screenshotRegion
    ? {
      ...mergeRenderState(exportState.state, createInteractionState(exportState.state)),
      viewerMode: appState.sessionState.viewerMode,
      ...appState.interactionState.view
    }
    : mergeRenderState(exportState.state, createInteractionState(exportState.state));

  const pixels = renderer.readExportPixels({
    state: renderState,
    sourceWidth: session.decoded.width,
    sourceHeight: session.decoded.height,
    ...(screenshotRegion ? {
      screenshot: {
        rect: screenshotRegion.rect,
        sourceViewport: screenshotRegion.sourceViewport
      }
    } : {}),
    ...(outputSize ? {
      outputWidth: outputSize.width,
      outputHeight: outputSize.height
    } : {})
  });
  throwIfAborted(signal, abortMessage);
  assertSessionCurrent(getCurrentState(), session, signal);
  return { pixels, renderState };
}

async function resolveBatchEntryPreviewPixels({
  entry,
  session,
  appState,
  getCurrentState,
  renderCache,
  renderer,
  lutCache,
  signal,
  previewMaxLongestEdge,
  abortMessage
}: {
  entry: ExportImageBatchPreviewRequest;
  session: OpenedImageSession;
  appState: ViewerAppState;
  getCurrentState: ViewerStateProvider;
  renderCache: RenderCacheService;
  renderer: WebGlExrRenderer;
  lutCache: Map<string, ColormapLut>;
  signal: AbortSignal;
  previewMaxLongestEdge: number;
  abortMessage: string;
}): Promise<ExportImagePixels> {
  if (entry.mode === 'screenshot') {
    const result = await resolveBatchEntryExportResult({
      entry,
      session,
      appState,
      getCurrentState,
      renderCache,
      renderer,
      lutCache,
      signal,
      previewMaxLongestEdge,
      abortMessage
    });
    return result.pixels;
  }

  const exportState = await resolveBatchEntryExportState({
    entry,
    session,
    appState,
    renderCache,
    lutCache,
    signal
  });
  throwIfAborted(signal, abortMessage);
  assertSessionCurrent(getCurrentState(), session, signal);

  const layer = session.decoded.layers[exportState.state.activeLayer] ?? null;
  if (!layer) {
    throw new Error(`Channel is not available for ${session.displayName}: ${entry.channelLabel}`);
  }

  const pixels = buildDisplaySelectionThumbnailPixels(
    layer,
    session.decoded.width,
    session.decoded.height,
    exportState.state,
    exportState.state.displaySelection,
    previewMaxLongestEdge,
    {
      visualizationMode: exportState.state.visualizationMode,
      colormapRange: exportState.state.colormapRange,
      colormapLut: exportState.lut,
      stokesDegreeModulation: exportState.state.stokesDegreeModulation,
      stokesAolpDegreeModulationMode: exportState.state.stokesAolpDegreeModulationMode
    }
  );
  throwIfAborted(signal, abortMessage);
  assertSessionCurrent(getCurrentState(), session, signal);
  return pixels;
}

async function resolveBatchEntryExportState({
  entry,
  session,
  appState,
  renderCache,
  lutCache,
  signal
}: {
  entry: ExportImageBatchPreviewRequest;
  session: OpenedImageSession;
  appState: ViewerAppState;
  renderCache: RenderCacheService;
  lutCache: Map<string, ColormapLut>;
  signal: AbortSignal;
}): Promise<{ state: ViewerSessionState; lut: ColormapLut | null }> {
  const selection = cloneDisplaySelection(entry.displaySelection);
  const layer = session.decoded.layers[entry.activeLayer] ?? null;
  if (!selection || !layer) {
    throw new Error(`Channel is not available for ${session.displayName}: ${entry.channelLabel}`);
  }

  const baseState = session.id === appState.activeSessionId ? appState.sessionState : session.state;
  const currentState = appState.sessionState;
  const stokesDefault = isStokesSelection(selection)
    ? getStokesDisplayColormapDefault(selection, appState.stokesColormapDefaults)
    : null;
  const entryVisualization = resolveBatchEntryVisualizationState(appState, session.id, baseState);

  let visualizationMode = entryVisualization.visualizationMode;
  let activeColormapId = entryVisualization.activeColormapId;
  let colormapRange = cloneDisplayLuminanceRange(entryVisualization.colormapRange);
  let colormapRangeMode = entryVisualization.colormapRangeMode;
  let colormapZeroCentered = entryVisualization.colormapZeroCentered;
  const stokesDegreeModulation = { ...currentState.stokesDegreeModulation };
  let stokesAolpDegreeModulationMode = currentState.stokesAolpDegreeModulationMode;

  if (stokesDefault) {
    if (!appState.colormapRegistry) {
      throw new Error('No colormaps are available.');
    }

    const stokesColormapId = findColormapIdByLabel(appState.colormapRegistry, stokesDefault.colormapLabel);
    if (!stokesColormapId) {
      throw new Error(`Required colormap not found: ${stokesDefault.colormapLabel}`);
    }

    visualizationMode = 'colormap';
    activeColormapId = stokesColormapId;
    colormapRange = cloneDisplayLuminanceRange(stokesDefault.range);
    colormapRangeMode = 'oneTime';
    colormapZeroCentered = stokesDefault.zeroCentered;
    if (isStokesSelection(selection) && isStokesDegreeModulationParameter(selection.parameter) && stokesDefault.modulation) {
      stokesDegreeModulation[selection.parameter] = stokesDefault.modulation.enabled;
      if (selection.parameter === 'aolp') {
        stokesAolpDegreeModulationMode = stokesDefault.modulation.aolpMode ?? 'value';
      }
    }
  } else if (visualizationMode === 'colormap' && colormapRangeMode === 'alwaysAuto') {
    const displayLuminanceRange = renderCache.resolveDisplayLuminanceRange(session, {
      activeLayer: entry.activeLayer,
      displaySelection: selection,
      visualizationMode
    });
    colormapRange = resolveColormapAutoRange(selection, displayLuminanceRange, colormapZeroCentered);
  }

  const exportState: ViewerSessionState = {
    ...baseState,
    activeLayer: entry.activeLayer,
    displaySelection: selection,
    exposureEv: currentState.exposureEv,
    viewerMode: 'image',
    visualizationMode,
    activeColormapId,
    colormapRange,
    colormapRangeMode,
    colormapZeroCentered,
    stokesDegreeModulation,
    stokesAolpDegreeModulationMode,
    lockedPixel: null,
    roi: null
  };

  const lut = visualizationMode === 'colormap'
    ? await resolveBatchExportColormapLut(appState, activeColormapId, lutCache, signal)
    : null;

  return { state: exportState, lut };
}

function resolveBatchEntryVisualizationState(
  appState: ViewerAppState,
  sessionId: string,
  baseState: ViewerSessionState
): BatchEntryVisualizationState {
  const source = isStokesSelection(baseState.displaySelection)
    ? appState.stokesDisplayRestoreStates[sessionId] ?? null
    : baseState;

  if (!source) {
    return {
      visualizationMode: 'rgb',
      activeColormapId: appState.defaultColormapId,
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false
    };
  }

  return {
    visualizationMode: source.visualizationMode,
    activeColormapId: source.activeColormapId,
    colormapRange: cloneDisplayLuminanceRange(source.colormapRange),
    colormapRangeMode: source.colormapRangeMode,
    colormapZeroCentered: source.colormapZeroCentered
  };
}

async function resolveBatchExportColormapLut(
  appState: ViewerAppState,
  colormapId: string,
  lutCache: Map<string, ColormapLut>,
  signal: AbortSignal
): Promise<ColormapLut> {
  const cached = lutCache.get(colormapId);
  if (cached) {
    return cached;
  }

  const loadedLut = selectColormapLutById(appState, colormapId);
  if (loadedLut) {
    lutCache.set(colormapId, loadedLut);
    return loadedLut;
  }

  const registry = appState.colormapRegistry;
  if (!registry) {
    throw new Error('No colormaps are available.');
  }
  if (!getColormapAsset(registry, colormapId)) {
    throw new Error(`Unknown colormap: ${colormapId}`);
  }

  const lut = await loadColormapLut(registry, colormapId, signal);
  lutCache.set(colormapId, lut);
  return lut;
}

function restoreActiveRendererBinding(
  core: ViewerAppCore,
  renderCache: RenderCacheService,
  renderer: WebGlExrRenderer
): void {
  const state = core.getState();
  const activeSession = selectActiveSession(state);
  if (!activeSession) {
    return;
  }

  const activeColormapLut = selectActiveColormapLut(state);
  if (activeColormapLut) {
    renderer.setColormapTexture(activeColormapLut.entryCount, activeColormapLut.rgba8);
  }
  renderCache.prepareActiveSession(activeSession, state.sessionState);
  renderer.renderImage(mergeRenderState(state.sessionState, state.interactionState));
}

function assertActiveSessionCurrent(
  state: ViewerAppState,
  session: OpenedImageSession,
  signal?: AbortSignal
): void {
  if (signal) {
    throwIfAborted(signal, 'Image export cancelled.');
  }

  const activeSession = selectActiveSession(state);
  if (!activeSession || activeSession.id !== session.id || activeSession.decoded !== session.decoded) {
    throw createAbortError('Active image changed before export finished.');
  }
}

function assertSessionCurrent(
  state: ViewerAppState,
  session: OpenedImageSession,
  signal?: AbortSignal
): void {
  if (signal) {
    throwIfAborted(signal, 'Export cancelled.');
  }

  const currentSession = state.sessions.find((item) => item.id === session.id) ?? null;
  if (!currentSession || currentSession.decoded !== session.decoded) {
    throw createAbortError('Image changed before export finished.');
  }
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}

function createJsonBlob(metadata: ScreenshotReproductionMetadataV1): Blob {
  return new Blob([serializeScreenshotReproductionMetadata(metadata)], {
    type: 'application/json'
  });
}

function createZipBlob(files: Record<string, Uint8Array>): Blob {
  const zipBytes = zipSync(files);
  const zipBuffer = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer;
  return new Blob([zipBuffer], { type: 'application/zip' });
}

function buildScreenshotMetadataBundleFilename(pngFilename: string): string {
  return /\.png$/i.test(pngFilename)
    ? pngFilename.replace(/\.png$/i, '.zip')
    : `${pngFilename}.zip`;
}

export function resolveBoundedColormapExportSize(
  width: number,
  height: number,
  maxLongestEdge: number
): { width: number; height: number } {
  const longestEdge = Math.max(width, height);
  if (!Number.isFinite(maxLongestEdge) || maxLongestEdge <= 0 || longestEdge <= maxLongestEdge) {
    return { width, height };
  }

  const scale = maxLongestEdge / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function resolveBoundedImageExportSize(
  width: number,
  height: number,
  maxLongestEdge: number
): { width: number; height: number } {
  return resolveBoundedColormapExportSize(width, height, maxLongestEdge);
}
