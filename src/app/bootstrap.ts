import { disposeDecodeWorker, loadExrOffMainThread } from '../exr-worker-client';
import { createAbortError } from '../lifecycle';
import { ViewerStore, createInitialState } from '../viewer-store';
import { ViewerUi } from '../ui';
import { clampZoom, ViewerInteraction } from '../interaction';
import { WebGlExrRenderer } from '../renderer';
import { DisplayController } from '../controllers/display-controller';
import { SessionController } from '../controllers/session-controller';
import { createExportImageBlob } from '../export-image';
import { LoadQueueService } from '../services/load-queue';
import { ThumbnailService } from '../services/thumbnail-service';
import { RenderCacheService } from '../services/render-cache-service';

export interface AppHandle {
  dispose(): void;
}

export async function bootstrapApp(): Promise<AppHandle> {
  const store = new ViewerStore(createInitialState());

  let sessionController!: SessionController;
  let displayController!: DisplayController;
  let renderCache!: RenderCacheService;
  let renderer: WebGlExrRenderer | null = null;
  let thumbnailService: ThumbnailService | null = null;
  let interaction: ViewerInteraction | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let unsubscribeStore: (() => void) | null = null;
  let disposed = false;
  const onBeforeUnload = () => {
    app.dispose();
  };

  const loadQueue = new LoadQueueService();
  const ui = new ViewerUi({
    onOpenFileClick: () => {
      const input = document.getElementById('file-input') as HTMLInputElement;
      input.click();
    },
    onExportImage: async (request) => {
      if (disposed) {
        throw createAbortError('Viewer application has been disposed.');
      }

      const activeSession = sessionController.getActiveSession();
      if (!activeSession) {
        const error = new Error('No image is active.');
        ui.setError(error.message);
        throw error;
      }

      const state = store.getState();
      const colormapLut = displayController.getActiveColormapLutForState(state.activeColormapId);
      const displayTexture = renderCache.getTextureForSnapshot(activeSession, state);
      try {
        if (!displayTexture) {
          throw new Error('No exportable image is active.');
        }

        const blob = await createExportImageBlob({
          request,
          decoded: activeSession.decoded,
          displayTexture,
          state,
          colormapLut
        });
        if (disposed) {
          throw createAbortError('Viewer application has been disposed.');
        }
        triggerBrowserDownload(blob, request.filename);
      } catch (error) {
        if (disposed) {
          throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
        }

        const message = error instanceof Error ? error.message : 'Export failed.';
        ui.setError(message);
        throw new Error(message);
      }
    },
    onFileSelected: (file) => {
      void sessionController.enqueueFiles([file]);
    },
    onFilesDropped: (files) => {
      void sessionController.enqueueFiles(files);
    },
    onGalleryImageSelected: (galleryId) => {
      void sessionController.enqueueGalleryImage(galleryId);
    },
    onReloadAllOpenedImages: () => {
      void sessionController.reloadAllSessions();
    },
    onReloadSelectedOpenedImage: (sessionId) => {
      void sessionController.reloadSession(sessionId);
    },
    onCloseSelectedOpenedImage: (sessionId) => {
      sessionController.closeSession(sessionId);
    },
    onCloseAllOpenedImages: () => {
      sessionController.closeAllSessions();
    },
    onOpenedImageSelected: (sessionId) => {
      sessionController.switchActiveSession(sessionId);
    },
    onReorderOpenedImage: (draggedSessionId, targetSessionId) => {
      sessionController.reorderSessions(draggedSessionId, targetSessionId);
    },
    onDisplayCacheBudgetChange: (valueMb) => {
      renderCache.setBudgetMb(valueMb);
    },
    onExposureChange: (value) => {
      store.setState({ exposureEv: value });
    },
    onViewerModeChange: (mode) => {
      displayController.setViewerMode(mode);
    },
    onLayerChange: (layerIndex) => {
      displayController.setActiveLayer(layerIndex);
    },
    onRgbGroupChange: (mapping) => {
      void displayController.applyDisplaySelection(mapping);
    },
    onVisualizationModeChange: (mode) => {
      displayController.setVisualizationMode(mode);
    },
    onColormapChange: (colormapId) => {
      void displayController.setActiveColormap(colormapId);
    },
    onColormapRangeChange: (range) => {
      displayController.setColormapRange(range);
    },
    onColormapAutoRange: () => {
      displayController.applyAutoColormapRange();
    },
    onColormapZeroCenterToggle: () => {
      displayController.toggleColormapZeroCenter();
    },
    onStokesDegreeModulationToggle: () => {
      displayController.toggleStokesDegreeModulation();
    },
    onResetView: () => {
      sessionController.resetActiveSessionState();
    }
  });
  const app: AppHandle = {
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      unsubscribeStore?.();
      unsubscribeStore = null;
      interaction?.destroy();
      interaction = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      displayController?.dispose();
      sessionController?.dispose();
      thumbnailService?.dispose();
      renderCache?.dispose();
      loadQueue.dispose();
      renderer?.dispose();
      ui.dispose();
      disposeDecodeWorker();
    }
  };

  try {
    renderer = new WebGlExrRenderer(ui.glCanvas, ui.overlayCanvas);
    renderCache = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => sessionController?.getActiveSessionId() ?? null
    });
    thumbnailService = new ThumbnailService({
      getSession: (sessionId) => {
        return sessionController?.getSessions().find((session) => session.id === sessionId) ?? null;
      },
      renderCache,
      onThumbnailUpdated: () => {
        sessionController.syncOpenedImageOptions();
      }
    });

    sessionController = new SessionController({
      ui,
      loadQueue,
      thumbnailService,
      renderCache,
      decodeBytes: loadExrOffMainThread,
      getCurrentState: () => store.getState(),
      setState: (next) => {
        store.setState(next);
      },
      getViewport: () => renderer.getViewport(),
      getDefaultColormapId: () => displayController.getDefaultColormapId(),
      clearRendererImage: () => {
        renderer.clearImage();
      },
      onSessionClosed: (sessionId) => {
        displayController.handleSessionClosed(sessionId);
      },
      onAllSessionsClosed: () => {
        displayController.handleAllSessionsClosed();
      }
    });

    displayController = new DisplayController({
      store,
      ui,
      renderer,
      renderCache,
      getActiveSession: () => sessionController.getActiveSession()
    });

    await displayController.initialize();

    interaction = new ViewerInteraction(ui.viewerContainer, {
      getState: () => store.getState(),
      getViewport: () => renderer.getViewport(),
      getImageSize: () => {
        const activeSession = sessionController.getActiveSession();
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

    unsubscribeStore = store.subscribe((state, previous) => {
      if (disposed) {
        return;
      }

      sessionController.handleStoreChange(state);
      displayController.handleStoreChange(state, previous);
    });

    resizeObserver = new ResizeObserver(() => {
      if (disposed || !renderer) {
        return;
      }

      const rect = ui.viewerContainer.getBoundingClientRect();
      renderer.resize(rect.width, rect.height);
      renderer.render(store.getState());
    });
    resizeObserver.observe(ui.viewerContainer);

    const rect = ui.viewerContainer.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
    renderer.render(store.getState());
    sessionController.syncOpenedImageOptions();

    window.addEventListener('beforeunload', onBeforeUnload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize WebGL2 renderer.';
    if (!disposed) {
      ui.setError(message);
      ui.setLoading(false);
    }
  }

  return app;
}

function samePixel(a: { ix: number; iy: number } | null, b: { ix: number; iy: number } | null): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.ix === b.ix && a.iy === b.iy;
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
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
