import { loadExrOffMainThread } from '../exr-worker-client';
import { ViewerStore, createInitialState } from '../viewer-store';
import { ViewerUi } from '../ui';
import { clampZoom, ViewerInteraction } from '../interaction';
import { WebGlExrRenderer } from '../renderer';
import { DisplayController } from '../controllers/display-controller';
import { SessionController } from '../controllers/session-controller';
import { LoadQueueService } from '../services/load-queue';
import { ThumbnailService } from '../services/thumbnail-service';

export async function bootstrapApp(): Promise<void> {
  const store = new ViewerStore(createInitialState());

  let sessionController!: SessionController;
  let displayController!: DisplayController;
  let interaction: ViewerInteraction | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const loadQueue = new LoadQueueService();
  const ui = new ViewerUi({
    onOpenFileClick: () => {
      const input = document.getElementById('file-input') as HTMLInputElement;
      input.click();
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
      sessionController.setDisplayCacheBudget(valueMb);
    },
    onToggleOpenedImagePin: (sessionId) => {
      sessionController.toggleSessionPin(sessionId);
    },
    onExposureChange: (value) => {
      store.setState({ exposureEv: value });
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

  try {
    const renderer = new WebGlExrRenderer(ui.glCanvas, ui.overlayCanvas);
    const thumbnailService = new ThumbnailService({
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
      getActiveSession: () => sessionController.getActiveSession(),
      getSessions: () => sessionController.getSessions(),
      getActiveSessionId: () => sessionController.getActiveSessionId(),
      getDisplayCacheBudgetBytes: () => sessionController.getDisplayCacheBudgetBytes(),
      touchDisplayCache: (session) => {
        sessionController.touchDisplayCache(session);
      },
      syncOpenedImageOptions: () => {
        sessionController.syncOpenedImageOptions();
      },
      syncDisplayCacheUsage: () => {
        sessionController.syncDisplayCacheUsageUi();
      }
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

    store.subscribe((state, previous) => {
      sessionController.handleStoreChange(state);
      displayController.handleStoreChange(state, previous);
    });

    resizeObserver = new ResizeObserver(() => {
      const rect = ui.viewerContainer.getBoundingClientRect();
      renderer.resize(rect.width, rect.height);
      renderer.render(store.getState());
    });
    resizeObserver.observe(ui.viewerContainer);

    const rect = ui.viewerContainer.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
    renderer.render(store.getState());
    sessionController.syncOpenedImageOptions();

    window.addEventListener('beforeunload', () => {
      interaction?.destroy();
      resizeObserver?.disconnect();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize WebGL2 renderer.';
    ui.setError(message);
    ui.setLoading(false);
  }
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
