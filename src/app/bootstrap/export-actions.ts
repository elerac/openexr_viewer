import { getColormapAsset, loadColormapLut } from '../../colormaps';
import { buildColormapExportPixels, createPngBlobFromPixels } from '../../export-image';
import { createAbortError, throwIfAborted } from '../../lifecycle';
import { RenderCacheService } from '../../services/render-cache-service';
import { mergeRenderState } from '../../view-state';
import { selectActiveSession } from '../viewer-app-selectors';
import { ViewerAppCore } from '../viewer-app-core';
import type { DisplayController } from '../../controllers/display-controller';
import type { ExportColormapPreviewRequest, ExportColormapRequest, ExportImageRequest } from '../../types';
import type { WebGlExrRenderer } from '../../renderer';

interface ColormapExportResolverOptions {
  signal?: AbortSignal;
  previewMaxLongestEdge?: number;
}

interface ColormapExportResolverDependencies {
  core: ViewerAppCore;
  isDisposed: () => boolean;
}

interface ExportImageActionDependencies {
  core: ViewerAppCore;
  renderCache: RenderCacheService;
  renderer: WebGlExrRenderer;
  displayController: DisplayController;
  isDisposed: () => boolean;
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

export async function handleExportImage(
  request: ExportImageRequest,
  {
    core,
    renderCache,
    renderer,
    displayController,
    isDisposed
  }: ExportImageActionDependencies
): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  const activeSession = selectActiveSession(core.getState());
  if (!activeSession) {
    const error = new Error('No image is active.');
    core.dispatch({ type: 'errorSet', message: error.message });
    throw error;
  }

  const state = core.getState();
  try {
    if (state.sessionState.visualizationMode === 'colormap' && !displayController.getActiveColormapLutForState(state.sessionState.activeColormapId)) {
      throw new Error('The active colormap is not ready for export.');
    }

    renderCache.prepareActiveSession(activeSession, state.sessionState);
    const pixels = renderer.readExportPixels({
      state: mergeRenderState(state.sessionState, state.interactionState),
      sourceWidth: activeSession.decoded.width,
      sourceHeight: activeSession.decoded.height
    });
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
