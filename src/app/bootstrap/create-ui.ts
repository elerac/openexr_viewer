import { DEFAULT_DISPLAY_CACHE_BUDGET_MB } from '../../display-cache';
import { ViewerUi, type UiCallbacks } from '../../ui/viewer-ui';
import { handleExportColormap, handleExportImage } from './export-actions';
import type { ExportImagePixels } from '../../export-image';
import { ViewerAppCore } from '../viewer-app-core';
import type { DisplayController } from '../../controllers/display-controller';
import type { SessionController } from '../../controllers/session-controller';
import type {
  ExportColormapPreviewRequest,
  ExportColormapRequest,
  ExportImageRequest,
  OpenedImageDropPlacement,
  PanoramaKeyboardOrbitInput
} from '../../types';
import type { RenderCacheService } from '../../services/render-cache-service';

interface InteractionInputBridge {
  setPanoramaKeyboardOrbitInput(input: PanoramaKeyboardOrbitInput): void;
}

interface CreateViewerUiDependencies {
  core: ViewerAppCore;
  getSessionController: () => SessionController;
  getDisplayController: () => DisplayController;
  getRenderCache: () => RenderCacheService;
  getInteraction: () => InteractionInputBridge | null;
  resolveColormapExportPixels: (
    request: ExportColormapPreviewRequest | ExportColormapRequest,
    options?: { signal?: AbortSignal; previewMaxLongestEdge?: number }
  ) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  resolveImageExportPixels: (
    options?: { signal?: AbortSignal; previewMaxLongestEdge?: number }
  ) => Promise<ExportImagePixels>;
  isDisposed: () => boolean;
}

export function createViewerUi({
  core,
  getSessionController,
  getDisplayController,
  getRenderCache,
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
    onResolveExportImagePreview: async (signal) => {
      return await resolveImageExportPixels({
        signal,
        previewMaxLongestEdge: 256
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
    onPanoramaKeyboardOrbitInputChange: (input) => {
      getInteraction()?.setPanoramaKeyboardOrbitInput(input);
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
    onClearRoi: () => {
      core.dispatch({
        type: 'roiSet',
        roi: null
      });
    },
    onResetSettings: () => {
      getRenderCache().setBudgetMb(DEFAULT_DISPLAY_CACHE_BUDGET_MB);
    },
    onResetView: () => {
      getSessionController().resetActiveSessionState();
    }
  };

  return new ViewerUi(callbacks);
}
