import { disposeDecodeWorker, loadExrOffMainThread } from '../exr-worker-client';
import { ViewerInteractionCoordinator } from '../interaction-coordinator';
import { createAbortError } from '../lifecycle';
import { ViewerStore, createInitialState } from '../viewer-store';
import { ViewerUi } from '../ui';
import { ViewerInteraction } from '../interaction';
import { WebGlExrRenderer } from '../renderer';
import { DisplayController } from '../controllers/display-controller';
import { SessionController } from '../controllers/session-controller';
import { createPngBlobFromPixels } from '../export-image';
import { LoadQueueService } from '../services/load-queue';
import { ThumbnailService } from '../services/thumbnail-service';
import { RenderCacheService } from '../services/render-cache-service';
import { mergeRenderState, samePixel } from '../view-state';

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
  let interactionCoordinator!: ViewerInteractionCoordinator;
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
      try {
        if (state.visualizationMode === 'colormap' && !displayController.getActiveColormapLutForState(state.activeColormapId)) {
          throw new Error('The active colormap is not ready for export.');
        }

        renderCache.prepareActiveSession(activeSession, state);
        const pixels = renderer!.readExportPixels({
          state,
          sourceWidth: activeSession.decoded.width,
          sourceHeight: activeSession.decoded.height,
          targetWidth: request.width,
          targetHeight: request.height
        });
        const blob = await createPngBlobFromPixels(pixels);
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
      interactionCoordinator?.dispose();
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
    renderer = new WebGlExrRenderer(ui.glCanvas, ui.overlayCanvas, ui.probeOverlayCanvas);
    renderCache = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => sessionController?.getActiveSessionId() ?? null,
      onDisplayLuminanceRangeResolved: (event) => {
        displayController?.handleDisplayLuminanceRangeResolved(event);
      }
    });
    thumbnailService = new ThumbnailService({
      getSession: (sessionId) => {
        return sessionController?.getSessions().find((session) => session.id === sessionId) ?? null;
      },
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
      getViewport: () => renderer!.getViewport(),
      getDefaultColormapId: () => displayController.getDefaultColormapId(),
      clearRendererImage: () => {
        renderer!.clearImage();
      },
      onSessionClosed: (sessionId) => {
        displayController.handleSessionClosed(sessionId);
      },
      onAllSessionsClosed: () => {
        displayController.handleAllSessionsClosed();
      }
    });

    interactionCoordinator = new ViewerInteractionCoordinator({
      initialSessionState: store.getState(),
      getSessionState: () => store.getState(),
      commitViewState: (view) => {
        store.setState(view);
      },
      onInteractionChange: (state, previous) => {
        if (disposed) {
          return;
        }

        displayController.handleInteractionStateChange(state, previous);
      }
    });

    displayController = new DisplayController({
      store,
      ui,
      renderer,
      renderCache,
      getActiveSession: () => sessionController.getActiveSession(),
      getInteractionState: () => interactionCoordinator.getState()
    });

    await displayController.initialize();

    interaction = new ViewerInteraction(ui.viewerContainer, {
      getState: () => mergeRenderState(store.getState(), interactionCoordinator.getState()),
      getViewport: () => renderer!.getViewport(),
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
        interactionCoordinator.enqueueViewPatch(next);
      },
      onHoverPixel: (pixel) => {
        interactionCoordinator.enqueueHoverPixel(pixel);
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

    let lastActiveSession = sessionController.getActiveSession();
    unsubscribeStore = store.subscribe((state, previous) => {
      if (disposed) {
        return;
      }

      const activeSession = sessionController.getActiveSession();
      const interactionSync = interactionCoordinator.syncSessionState(state, {
        clearHover:
          activeSession !== lastActiveSession ||
          state.activeLayer !== previous.activeLayer ||
          state.viewerMode !== previous.viewerMode
      });
      sessionController.handleStoreChange(state);
      displayController.handleSessionStateChange(state, previous, interactionSync.changed);
      lastActiveSession = activeSession;
    });

    resizeObserver = new ResizeObserver(() => {
      if (disposed || !renderer) {
        return;
      }

      const rect = ui.viewerContainer.getBoundingClientRect();
      renderer.resize(rect.width, rect.height);
      renderer.render(mergeRenderState(store.getState(), interactionCoordinator.getState()));
    });
    resizeObserver.observe(ui.viewerContainer);

    const rect = ui.viewerContainer.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
    renderer.render(mergeRenderState(store.getState(), interactionCoordinator.getState()));
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
