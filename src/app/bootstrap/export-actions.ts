import { zipSync } from 'fflate';
import { findColormapIdByLabel, getColormapAsset, loadColormapLut, type ColormapLut } from '../../colormaps';
import { cloneDisplayLuminanceRange, resolveColormapAutoRange } from '../../colormap-range';
import { computeRec709Luminance } from '../../color';
import { cloneDisplaySelection, isStokesSelection } from '../../display-model';
import {
  createDisplayPixelValues,
  readDisplaySelectionPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator
} from '../../display/evaluator';
import { createPngBlobFromPixels } from '../../export-image';
import { buildColormapExportPixels, type ExportImagePixels } from '../../export/export-pixels';
import { cloneScreenshotRegionCrop } from '../../export/screenshot-region';
import {
  buildReproductionMetadataFilename,
  buildScreenshotReproductionMetadata,
  serializeScreenshotReproductionMetadata,
  type ScreenshotReproductionMetadataV2
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
  ExportProgressUpdate,
  ExportScreenshotRegionsRequest,
  DecodedLayer,
  DisplayLuminanceRange,
  OpenedImageSession,
  ViewerState,
  ViewerSessionState,
  VisualizationMode
} from '../../types';
import type { WebGlExrRenderer } from '../../renderer';

type BatchPreviewRangeStrategy = 'exact' | 'sampledPreview';

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

interface ExportScreenshotRegionsActionDependencies {
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
type ExportProgressReporter = (update: ExportProgressUpdate) => void;

const PREVIEW_LUMINANCE_RANGE_MAX_SAMPLES = 4096;

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

    const screenshotRegion = request.mode === 'screenshot' ? request : null;
    if (options.previewMaxLongestEdge && !screenshotRegion) {
      const layer = activeSession.decoded.layers[state.sessionState.activeLayer] ?? null;
      if (!layer) {
        throw new Error('No image layer is active.');
      }

      const pixels = buildDisplaySelectionThumbnailPixels(
        layer,
        activeSession.decoded.width,
        activeSession.decoded.height,
        state.sessionState,
        state.sessionState.displaySelection,
        options.previewMaxLongestEdge,
        {
          visualizationMode: state.sessionState.visualizationMode,
          colormapRange: state.sessionState.colormapRange,
          colormapLut: selectActiveColormapLut(state),
          stokesDegreeModulation: state.sessionState.stokesDegreeModulation,
          stokesAolpDegreeModulationMode: state.sessionState.stokesAolpDegreeModulationMode
        }
      );
      assertActiveSessionCurrent(core.getState(), activeSession, options.signal);
      return pixels;
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
        screenshot: cloneScreenshotRegionCrop(screenshotRegion)
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
  }: ExportImageActionDependencies,
  onProgress?: ExportProgressReporter
): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  try {
    emitSingleExportProgress(onProgress, request, 'preparing');
    const stateSnapshot = core.getState();
    const sourceSession = selectActiveSession(stateSnapshot);
    emitSingleExportProgress(onProgress, request, 'rendering');
    const pixels = await resolveImageExportPixels(request);
    if (sourceSession) {
      assertActiveSessionCurrent(core.getState(), sourceSession);
    }
    emitSingleExportProgress(onProgress, request, 'encoding');
    const blob = await createPngBlobFromPixels(pixels, {
      compressionLevel: request.pngCompressionLevel
    });
    if (sourceSession) {
      assertActiveSessionCurrent(core.getState(), sourceSession);
    }
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }
    emitSingleExportProgress(onProgress, request, 'packaging', 1);
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

export async function handleExportScreenshotRegions(
  request: ExportScreenshotRegionsRequest,
  {
    core,
    resolveImageExportPixels,
    isDisposed
  }: ExportScreenshotRegionsActionDependencies,
  onProgress?: ExportProgressReporter
): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  try {
    if (request.format !== 'png-zip' || request.mode !== 'screenshot-regions') {
      throw new Error('Unsupported screenshot regions export format.');
    }
    if (request.regions.length === 0) {
      throw new Error('Select at least one screenshot region.');
    }

    const stateSnapshot = core.getState();
    const sourceSession = selectActiveSession(stateSnapshot);
    if (!sourceSession) {
      throw new Error('No image is active.');
    }

    const usedFilenames = new Map<string, number>();
    const files: Record<string, Uint8Array> = {};
    onProgress?.({
      completed: 0,
      total: request.regions.length,
      stage: 'preparing'
    });

    for (const [regionEntryIndex, region] of request.regions.entries()) {
      if (isDisposed()) {
        throw createAbortError('Viewer application has been disposed.');
      }

      const outputFilename = buildScreenshotRegionOutputFilename(
        request.baseFilename,
        region.index,
        region.count,
        usedFilenames
      );
      const regionRequest: ExportImageRequest = {
        filename: outputFilename,
        format: 'png',
        mode: 'screenshot',
        ...cloneScreenshotRegionCrop(region),
        outputWidth: region.outputWidth,
        outputHeight: region.outputHeight,
        pngCompressionLevel: request.pngCompressionLevel
      };

      onProgress?.({
        completed: regionEntryIndex,
        total: request.regions.length,
        stage: 'rendering',
        currentFilename: outputFilename
      });
      const pixels = await resolveImageExportPixels(regionRequest);
      assertActiveSessionCurrent(core.getState(), sourceSession);
      onProgress?.({
        completed: regionEntryIndex,
        total: request.regions.length,
        stage: 'encoding',
        currentFilename: outputFilename
      });
      const blob = await createPngBlobFromPixels(pixels, {
        compressionLevel: request.pngCompressionLevel
      });
      assertActiveSessionCurrent(core.getState(), sourceSession);
      files[outputFilename] = new Uint8Array(await blob.arrayBuffer());

      if (request.includeReproductionMetadata) {
        const jsonFilename = buildReproductionMetadataFilename(outputFilename);
        const metadata = buildScreenshotReproductionMetadata({
          pngFilename: outputFilename,
          jsonFilename,
          pngCompressionLevel: request.pngCompressionLevel,
          region,
          session: sourceSession,
          renderState: mergeRenderState(stateSnapshot.sessionState, stateSnapshot.interactionState),
          batch: {
            archiveFilename: request.archiveFilename,
            sessionId: sourceSession.id,
            channelLabel: 'Current Display',
            outputFilename,
            regionIndex: region.index,
            regionLabel: region.label,
            regionCount: region.count
          }
        });
        files[jsonFilename] = new Uint8Array(await createJsonBlob(metadata).arrayBuffer());
      }

      onProgress?.({
        completed: regionEntryIndex + 1,
        total: request.regions.length,
        stage: 'encoding'
      });
    }

    onProgress?.({
      completed: request.regions.length,
      total: request.regions.length,
      stage: 'packaging'
    });
    triggerBrowserDownload(createZipBlob(files), request.archiveFilename);
  } catch (error) {
    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    if (isAbortError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Screenshot regions export failed.';
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
  }: ExportImageBatchActionDependencies,
  onProgress?: ExportProgressReporter
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
    onProgress?.({
      completed: 0,
      total: request.entries.length,
      stage: 'preparing'
    });

    for (const [entryIndex, entry] of request.entries.entries()) {
      throwIfAborted(signal, 'Batch export cancelled.');
      if (isDisposed()) {
        throw createAbortError('Viewer application has been disposed.');
      }

      const session = stateSnapshot.sessions.find((item) => item.id === entry.sessionId) ?? null;
      if (!session) {
        throw new Error(`Image is no longer open: ${entry.sessionId}`);
      }

      onProgress?.({
        completed: entryIndex,
        total: request.entries.length,
        stage: 'rendering',
        currentFilename: entry.outputFilename
      });
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
      onProgress?.({
        completed: entryIndex,
        total: request.entries.length,
        stage: 'encoding',
        currentFilename: entry.outputFilename
      });
      const blob = await createPngBlobFromPixels(result.pixels, {
        compressionLevel: request.pngCompressionLevel
      });
      throwIfAborted(signal, 'Batch export cancelled.');
      assertSessionCurrent(core.getState(), session, signal);
      files[entry.outputFilename] = new Uint8Array(await blob.arrayBuffer());
      onProgress?.({
        completed: entryIndex + 1,
        total: request.entries.length,
        stage: 'encoding'
      });
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
            outputFilename: entry.outputFilename,
            ...(entry.screenshotRegionIndex !== undefined
              ? {
                regionIndex: entry.screenshotRegionIndex,
                regionLabel: entry.screenshotRegionLabel,
                regionCount: entry.screenshotRegionCount
              }
              : {})
          }
        });
        files[jsonFilename] = new Uint8Array(await createJsonBlob(metadata).arrayBuffer());
      }
      throwIfAborted(signal, 'Batch export cancelled.');
      assertSessionCurrent(core.getState(), session, signal);
    }

    onProgress?.({
      completed: request.entries.length,
      total: request.entries.length,
      stage: 'packaging'
    });
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
  rangeStrategy = 'exact',
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
  rangeStrategy?: BatchPreviewRangeStrategy;
  abortMessage: string;
}): Promise<{ pixels: ExportImagePixels; renderState: ViewerState }> {
  const exportState = await resolveBatchEntryExportState({
    entry,
    session,
    appState,
    renderCache,
    lutCache,
    signal,
    rangeStrategy
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
      screenshot: cloneScreenshotRegionCrop(screenshotRegion)
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
      rangeStrategy: 'sampledPreview',
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
    signal,
    rangeStrategy: 'sampledPreview'
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
  signal,
  rangeStrategy = 'exact'
}: {
  entry: ExportImageBatchPreviewRequest;
  session: OpenedImageSession;
  appState: ViewerAppState;
  renderCache: RenderCacheService;
  lutCache: Map<string, ColormapLut>;
  signal: AbortSignal;
  rangeStrategy?: BatchPreviewRangeStrategy;
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
    const rangeState = {
      activeLayer: entry.activeLayer,
      displaySelection: selection,
      visualizationMode
    };
    const displayLuminanceRange = rangeStrategy === 'sampledPreview'
      ? resolvePreviewDisplayLuminanceRange(renderCache, session, layer, rangeState)
      : renderCache.resolveDisplayLuminanceRange(session, rangeState);
    colormapRange = resolveColormapAutoRange(selection, displayLuminanceRange, colormapZeroCentered);
  }

  const exportState: ViewerSessionState = {
    ...baseState,
    activeLayer: entry.activeLayer,
    displaySelection: selection,
    exposureEv: currentState.exposureEv,
    displayGamma: currentState.displayGamma,
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

function resolvePreviewDisplayLuminanceRange(
  renderCache: RenderCacheService,
  session: OpenedImageSession,
  layer: DecodedLayer,
  state: {
    activeLayer: number;
    displaySelection: ViewerSessionState['displaySelection'];
    visualizationMode: VisualizationMode;
  }
): DisplayLuminanceRange | null {
  const cachedRange = renderCache.getCachedLuminanceRange(session.id, state);
  if (cachedRange) {
    return cachedRange;
  }

  return computeSampledDisplayLuminanceRange(
    layer,
    session.decoded.width,
    session.decoded.height,
    state.displaySelection,
    state.visualizationMode
  );
}

function computeSampledDisplayLuminanceRange(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: ViewerSessionState['displaySelection'],
  visualizationMode: VisualizationMode
): DisplayLuminanceRange | null {
  const pixelCount = Math.max(0, width * height);
  if (pixelCount === 0) {
    return null;
  }

  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode);
  const sample = createDisplayPixelValues();
  const sampleStep = Math.max(1, Math.ceil(pixelCount / PREVIEW_LUMINANCE_RANGE_MAX_SAMPLES));
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += sampleStep) {
    readDisplaySelectionPixelValuesAtIndex(evaluator, pixelIndex, sample);
    const luminance = computeRec709Luminance(sample.r, sample.g, sample.b);
    if (!Number.isFinite(luminance)) {
      continue;
    }

    finiteCount += 1;
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
  }

  return finiteCount > 0 ? { min, max } : null;
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

function createJsonBlob(metadata: ScreenshotReproductionMetadataV2): Blob {
  return new Blob([serializeScreenshotReproductionMetadata(metadata)], {
    type: 'application/json'
  });
}

function createZipBlob(files: Record<string, Uint8Array>): Blob {
  const zipBytes = zipSync(files);
  const zipBuffer = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer;
  return new Blob([zipBuffer], { type: 'application/zip' });
}

function emitSingleExportProgress(
  onProgress: ExportProgressReporter | undefined,
  request: ExportImageRequest,
  stage: ExportProgressUpdate['stage'],
  completed = 0
): void {
  onProgress?.({
    completed,
    total: 1,
    stage,
    currentFilename: request.filename,
    indeterminate: true
  });
}

function buildScreenshotMetadataBundleFilename(pngFilename: string): string {
  return /\.png$/i.test(pngFilename)
    ? pngFilename.replace(/\.png$/i, '.zip')
    : `${pngFilename}.zip`;
}

function buildScreenshotRegionOutputFilename(
  baseFilename: string,
  regionIndex: number,
  regionCount: number,
  usedFilenames: Map<string, number>
): string {
  const screenshotFilename = /\.png$/i.test(baseFilename)
    ? baseFilename.replace(/\.png$/i, '-screenshot.png')
    : `${baseFilename}-screenshot.png`;
  const filename = regionCount <= 1
    ? screenshotFilename
    : screenshotFilename.replace(/\.png$/i, `.region-${String(regionIndex + 1).padStart(2, '0')}.png`);
  return uniquifyExportFilename(filename, usedFilenames);
}

function uniquifyExportFilename(filename: string, usedFilenames: Map<string, number>): string {
  const count = usedFilenames.get(filename) ?? 0;
  usedFilenames.set(filename, count + 1);
  if (count === 0) {
    return filename;
  }

  return filename.replace(/\.png$/i, ` (${count + 1}).png`);
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
