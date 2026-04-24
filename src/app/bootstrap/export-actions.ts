import { zipSync } from 'fflate';
import { findColormapIdByLabel, getColormapAsset, loadColormapLut, type ColormapLut } from '../../colormaps';
import { cloneDisplayLuminanceRange, resolveColormapAutoRange } from '../../colormap-range';
import { cloneDisplaySelection, isStokesSelection } from '../../display-model';
import { buildColormapExportPixels, createPngBlobFromPixels, type ExportImagePixels } from '../../export-image';
import { createAbortError, throwIfAborted } from '../../lifecycle';
import { RenderCacheService } from '../../services/render-cache-service';
import { getStokesDisplayColormapDefault } from '../../stokes';
import { buildDisplaySelectionThumbnailPixels } from '../../thumbnail';
import { createInteractionState, mergeRenderState } from '../../view-state';
import { selectActiveSession } from '../viewer-app-selectors';
import { ViewerAppCore } from '../viewer-app-core';
import type { ViewerAppState } from '../viewer-app-types';
import type { DisplayController } from '../../controllers/display-controller';
import type {
  ExportColormapPreviewRequest,
  ExportColormapRequest,
  ExportImageBatchPreviewRequest,
  ExportImageBatchRequest,
  ExportImageRequest,
  OpenedImageSession,
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
  isDisposed: () => boolean;
  previewMaxLongestEdge: number;
}

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
}: ImageExportResolverDependencies): (options?: ImageExportResolverOptions) => Promise<ExportImagePixels> {
  return async (options: ImageExportResolverOptions = {}) => {
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

    getRenderCache().prepareActiveSession(activeSession, state.sessionState);
    if (options.signal) {
      throwIfAborted(options.signal);
    }

    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    const outputSize = options.previewMaxLongestEdge
      ? resolveBoundedImageExportSize(
        activeSession.decoded.width,
        activeSession.decoded.height,
        options.previewMaxLongestEdge
      )
      : null;

    return getRenderer().readExportPixels({
      state: mergeRenderState(state.sessionState, state.interactionState),
      sourceWidth: activeSession.decoded.width,
      sourceHeight: activeSession.decoded.height,
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
    const pixels = await resolveImageExportPixels();
    const blob = await createPngBlobFromPixels(pixels);
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

      const pixels = await resolveBatchEntryExportPixels({
        entry,
        session,
        appState: stateSnapshot,
        renderCache,
        renderer,
        lutCache,
        signal,
        abortMessage: 'Batch export cancelled.'
      });
      const blob = await createPngBlobFromPixels(pixels);
      throwIfAborted(signal, 'Batch export cancelled.');
      files[entry.outputFilename] = new Uint8Array(await blob.arrayBuffer());
    }

    const zipBytes = zipSync(files);
    const zipBuffer = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer;
    const zipBlob = new Blob([zipBuffer], { type: 'application/zip' });
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }
    triggerBrowserDownload(zipBlob, request.archiveFilename);
  } catch (error) {
    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    if (signal.aborted) {
      throw error instanceof Error ? error : createAbortError('Batch export cancelled.');
    }

    const message = error instanceof Error ? error.message : 'Batch export failed.';
    core.dispatch({ type: 'errorSet', message });
    throw new Error(message);
  } finally {
    restoreActiveRendererBinding(core, renderCache, renderer);
  }
}

export async function resolveExportImageBatchPreviewPixels(
  request: ExportImageBatchPreviewRequest,
  signal: AbortSignal,
  {
    core,
    getRenderCache,
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
      renderCache,
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
    const blob = await createPngBlobFromPixels(pixels);
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

async function resolveBatchEntryExportPixels({
  entry,
  session,
  appState,
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
  renderCache: RenderCacheService;
  renderer: WebGlExrRenderer;
  lutCache: Map<string, ColormapLut>;
  signal: AbortSignal;
  previewMaxLongestEdge?: number;
  abortMessage: string;
}): Promise<ExportImagePixels> {
  const exportState = await resolveBatchEntryExportState({
    entry,
    session,
    appState,
    renderCache,
    lutCache,
    signal
  });
  if (exportState.lut) {
    renderer.setColormapTexture(exportState.lut.entryCount, exportState.lut.rgba8);
  }

  renderCache.prepareActiveSession(session, exportState.state);
  throwIfAborted(signal, abortMessage);

  const outputSize = previewMaxLongestEdge
    ? resolveBoundedImageExportSize(session.decoded.width, session.decoded.height, previewMaxLongestEdge)
    : null;

  const pixels = renderer.readExportPixels({
    state: mergeRenderState(exportState.state, createInteractionState(exportState.state)),
    sourceWidth: session.decoded.width,
    sourceHeight: session.decoded.height,
    ...(outputSize ? {
      outputWidth: outputSize.width,
      outputHeight: outputSize.height
    } : {})
  });
  throwIfAborted(signal, abortMessage);
  return pixels;
}

async function resolveBatchEntryPreviewPixels({
  entry,
  session,
  appState,
  renderCache,
  lutCache,
  signal,
  previewMaxLongestEdge,
  abortMessage
}: {
  entry: ExportImageBatchPreviewRequest;
  session: OpenedImageSession;
  appState: ViewerAppState;
  renderCache: RenderCacheService;
  lutCache: Map<string, ColormapLut>;
  signal: AbortSignal;
  previewMaxLongestEdge: number;
  abortMessage: string;
}): Promise<ExportImagePixels> {
  const exportState = await resolveBatchEntryExportState({
    entry,
    session,
    appState,
    renderCache,
    lutCache,
    signal
  });
  throwIfAborted(signal, abortMessage);

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
  const stokesDefault = isStokesSelection(selection) ? getStokesDisplayColormapDefault(selection) : null;
  const entryVisualization = resolveBatchEntryVisualizationState(appState, session.id, baseState);

  let visualizationMode = entryVisualization.visualizationMode;
  let activeColormapId = entryVisualization.activeColormapId;
  let colormapRange = cloneDisplayLuminanceRange(entryVisualization.colormapRange);
  let colormapRangeMode = entryVisualization.colormapRangeMode;
  let colormapZeroCentered = entryVisualization.colormapZeroCentered;

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
    stokesDegreeModulation: { ...currentState.stokesDegreeModulation },
    stokesAolpDegreeModulationMode: currentState.stokesAolpDegreeModulationMode,
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

  if (appState.loadedColormapId === colormapId && appState.activeColormapLut) {
    lutCache.set(colormapId, appState.activeColormapLut);
    return appState.activeColormapLut;
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

  if (state.activeColormapLut) {
    renderer.setColormapTexture(state.activeColormapLut.entryCount, state.activeColormapLut.rgba8);
  }
  renderCache.prepareActiveSession(activeSession, state.sessionState);
  renderer.renderImage(mergeRenderState(state.sessionState, state.interactionState));
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
