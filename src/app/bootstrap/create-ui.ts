import { DEFAULT_DISPLAY_CACHE_BUDGET_MB } from '../../display-cache';
import { ViewerUi, type UiCallbacks } from '../../ui/viewer-ui';
import { imageToScreen } from '../../interaction/image-geometry';
import { getPanoramaProjectionDiameter } from '../../interaction/panorama-geometry';
import {
  handleExportColormap,
  handleExportImage,
  handleExportImageBatch,
  resolveExportImageBatchPreviewPixels
} from './export-actions';
import type { ExportImagePixels } from '../../export-image';
import { mergeRenderState } from '../../view-state';
import { selectActiveSession } from '../viewer-app-selectors';
import { ViewerAppCore } from '../viewer-app-core';
import type { DisplayController } from '../../controllers/display-controller';
import type { SessionController } from '../../controllers/session-controller';
import type {
  ExportColormapPreviewRequest,
  ExportColormapRequest,
  ExportImageBatchPreviewRequest,
  ExportImageBatchRequest,
  ExportImagePreviewRequest,
  ExportImageRequest,
  OpenedImageDropPlacement,
  ViewerKeyboardNavigationInput,
  ViewerKeyboardZoomInput,
  ViewportInfo,
  ViewportRect
} from '../../types';
import type { StokesColormapDefaultGroup, StokesColormapDefaultSetting } from '../../stokes';
import type { RenderCacheService } from '../../services/render-cache-service';
import type { WebGlExrRenderer } from '../../renderer';

interface InteractionInputBridge {
  setViewerKeyboardNavigationInput(input: ViewerKeyboardNavigationInput): void;
  setViewerKeyboardZoomInput(input: ViewerKeyboardZoomInput): void;
}

interface CreateViewerUiDependencies {
  core: ViewerAppCore;
  getSessionController: () => SessionController;
  getDisplayController: () => DisplayController;
  getRenderCache: () => RenderCacheService;
  getRenderer: () => WebGlExrRenderer;
  getInteraction: () => InteractionInputBridge | null;
  resolveColormapExportPixels: (
    request: ExportColormapPreviewRequest | ExportColormapRequest,
    options?: { signal?: AbortSignal; previewMaxLongestEdge?: number }
  ) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  resolveImageExportPixels: (
    request?: ExportImagePreviewRequest | ExportImageRequest,
    options?: { signal?: AbortSignal; previewMaxLongestEdge?: number }
  ) => Promise<ExportImagePixels>;
  isDisposed: () => boolean;
}

export function createViewerUi({
  core,
  getSessionController,
  getDisplayController,
  getRenderCache,
  getRenderer,
  getInteraction,
  resolveColormapExportPixels,
  resolveImageExportPixels,
  isDisposed
}: CreateViewerUiDependencies): ViewerUi {
  const callbacks: UiCallbacks = {
    onOpenFileClick: () => {
      const input = document.getElementById('file-input') as HTMLInputElement;
      input.click();
    },
    onOpenFolderClick: () => {
      const input = document.getElementById('folder-input') as HTMLInputElement;
      input.click();
    },
    onExportImage: async (request: ExportImageRequest) => {
      await handleExportImage(request, {
        core,
        resolveImageExportPixels,
        isDisposed
      });
    },
    onResolveExportImagePreview: async (request, signal) => {
      return await resolveImageExportPixels(request, {
        signal,
        previewMaxLongestEdge: 256
      });
    },
    onExportImageBatch: async (request: ExportImageBatchRequest, signal: AbortSignal) => {
      await handleExportImageBatch(request, signal, {
        core,
        getRenderCache,
        getRenderer,
        isDisposed
      });
    },
    onResolveExportImageBatchPreview: async (request: ExportImageBatchPreviewRequest, signal: AbortSignal) => {
      return await resolveExportImageBatchPreviewPixels(request, signal, {
        core,
        getRenderCache,
        getRenderer,
        isDisposed,
        previewMaxLongestEdge: 96
      });
    },
    onExportColormap: async (request: ExportColormapRequest) => {
      await handleExportColormap(request, {
        core,
        resolveColormapExportPixels,
        isDisposed
      });
    },
    onResolveExportColormapPreview: async (request, signal) => {
      return await resolveColormapExportPixels(request, {
        signal,
        previewMaxLongestEdge: 256
      });
    },
    onFileSelected: (file) => {
      void getSessionController().enqueueFiles([file]);
    },
    onFolderSelected: (files, options) => {
      void getSessionController().enqueueFolderFiles(files, options);
    },
    onFilesDropped: (files) => {
      void getSessionController().enqueueFiles(files);
    },
    onGalleryImageSelected: (galleryId) => {
      void getSessionController().enqueueGalleryImage(galleryId);
    },
    onReloadAllOpenedImages: () => {
      void getSessionController().reloadAllSessions();
    },
    onReloadSelectedOpenedImage: (sessionId) => {
      void getSessionController().reloadSession(sessionId);
    },
    onCloseSelectedOpenedImage: (sessionId) => {
      getSessionController().closeSession(sessionId);
    },
    onCloseAllOpenedImages: () => {
      getSessionController().closeAllSessions();
    },
    onOpenedImageSelected: (sessionId) => {
      getSessionController().switchActiveSession(sessionId);
    },
    onOpenedImageDisplayNameChange: (sessionId, displayName) => {
      getSessionController().renameSessionDisplayName(sessionId, displayName);
    },
    onReorderOpenedImage: (
      draggedSessionId: string,
      targetSessionId: string,
      placement: OpenedImageDropPlacement
    ) => {
      getSessionController().reorderSessions(draggedSessionId, targetSessionId, placement);
    },
    onDisplayCacheBudgetChange: (valueMb) => {
      getRenderCache().setBudgetMb(valueMb);
    },
    onExposureChange: (value) => {
      core.dispatch({ type: 'exposureSet', exposureEv: value });
    },
    onViewerKeyboardNavigationInputChange: (input) => {
      getInteraction()?.setViewerKeyboardNavigationInput(input);
    },
    onViewerKeyboardZoomInputChange: (input) => {
      getInteraction()?.setViewerKeyboardZoomInput(input);
    },
    onAutoFitImageOnSelectChange: (enabled) => {
      core.dispatch({ type: 'autoFitImageOnSelectSet', enabled });
    },
    onAutoFitImage: () => {
      getSessionController().fitActiveSessionToViewport();
    },
    onAutoExposureChange: (enabled) => {
      core.dispatch({ type: 'autoExposureSet', enabled });
    },
    onAutoExposurePercentileChange: (percentile) => {
      core.dispatch({ type: 'autoExposurePercentileSet', percentile });
    },
    onRulersVisibleChange: (enabled) => {
      core.dispatch({ type: 'rulersVisibleSet', enabled });
    },
    getScreenshotFitRect: () => {
      const state = core.getState();
      const activeSession = selectActiveSession(state);
      if (!activeSession) {
        return null;
      }

      const viewport = getRenderer().getViewport();
      const renderState = mergeRenderState(state.sessionState, state.interactionState);
      if (renderState.viewerMode === 'panorama') {
        return resolveVisiblePanoramaRect(renderState.panoramaHfovDeg, viewport);
      }

      if (renderState.viewerMode !== 'image') {
        return null;
      }

      const topLeft = imageToScreen(0, 0, renderState, viewport);
      const bottomRight = imageToScreen(
        activeSession.decoded.width,
        activeSession.decoded.height,
        renderState,
        viewport
      );
      return intersectViewportRect({
        x: Math.min(topLeft.x, bottomRight.x),
        y: Math.min(topLeft.y, bottomRight.y),
        width: Math.abs(bottomRight.x - topLeft.x),
        height: Math.abs(bottomRight.y - topLeft.y)
      }, viewport);
    },
    onViewerModeChange: (mode) => {
      getDisplayController().setViewerMode(mode);
    },
    onLayerChange: (layerIndex) => {
      getDisplayController().setActiveLayer(layerIndex);
    },
    onRgbGroupChange: (mapping) => {
      void getDisplayController().applyDisplaySelection(mapping);
    },
    onVisualizationModeChange: (mode) => {
      getDisplayController().setVisualizationMode(mode);
    },
    onColormapChange: (colormapId) => {
      void getDisplayController().setActiveColormap(colormapId);
    },
    onColormapRangeChange: (range) => {
      getDisplayController().setColormapRange(range);
    },
    onColormapAutoRange: () => {
      getDisplayController().applyAutoColormapRange();
    },
    onColormapZeroCenterToggle: () => {
      getDisplayController().toggleColormapZeroCenter();
    },
    onStokesDegreeModulationToggle: () => {
      getDisplayController().toggleStokesDegreeModulation();
    },
    onStokesAolpDegreeModulationModeChange: (mode) => {
      getDisplayController().setStokesAolpDegreeModulationMode(mode);
    },
    onStokesDefaultSettingChange: (
      group: StokesColormapDefaultGroup,
      setting: StokesColormapDefaultSetting
    ) => {
      void getDisplayController().setStokesColormapDefaultSetting(group, setting);
    },
    onClearRoi: () => {
      core.dispatch({
        type: 'roiSet',
        roi: null
      });
    },
    onResetSettings: () => {
      getRenderCache().setBudgetMb(DEFAULT_DISPLAY_CACHE_BUDGET_MB);
      void getDisplayController().resetStokesColormapDefaults();
    },
    onResetView: () => {
      getSessionController().resetActiveSessionState();
    }
  };

  return new ViewerUi(callbacks);
}

function resolveVisiblePanoramaRect(hfovDeg: number, viewport: ViewportInfo): ViewportRect | null {
  const projectionDiameter = getPanoramaProjectionDiameter(viewport, hfovDeg);
  return intersectViewportRect({
    x: viewport.width * 0.5 - projectionDiameter * 0.5,
    y: viewport.height * 0.5 - projectionDiameter * 0.5,
    width: projectionDiameter,
    height: projectionDiameter
  }, viewport);
}

function intersectViewportRect(rect: ViewportRect, viewport: ViewportInfo): ViewportRect | null {
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  if (!isFinitePositiveRect(rect) || viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const x0 = Math.max(0, Math.min(viewportWidth, rect.x));
  const y0 = Math.max(0, Math.min(viewportHeight, rect.y));
  const x1 = Math.max(0, Math.min(viewportWidth, rect.x + rect.width));
  const y1 = Math.max(0, Math.min(viewportHeight, rect.y + rect.height));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: x0,
    y: y0,
    width,
    height
  };
}

function isFinitePositiveRect(rect: ViewportRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}
