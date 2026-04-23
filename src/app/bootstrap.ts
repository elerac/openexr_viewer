import { disposeDecodeWorker, loadExrOffMainThread } from '../exr-worker-client';
import { ViewerInteractionCoordinator } from '../interaction-coordinator';
import { createAbortError, isAbortError } from '../lifecycle';
import { ViewerUi } from '../ui';
import { preserveImagePanOnViewportChange, type ViewportClientRect, ViewerInteraction } from '../interaction';
import { WebGlExrRenderer } from '../renderer';
import { DisplayController } from '../controllers/display-controller';
import { SessionController } from '../controllers/session-controller';
import { createPngBlobFromPixels } from '../export-image';
import { ChannelThumbnailService } from '../services/channel-thumbnail-service';
import { LoadQueueService } from '../services/load-queue';
import { ThumbnailService } from '../services/thumbnail-service';
import { RenderCacheService } from '../services/render-cache-service';
import { DEFAULT_DISPLAY_CACHE_BUDGET_MB } from '../display-cache';
import { mergeRenderState } from '../view-state';
import { ViewerAppCore } from './viewer-app-core';
import { applyRenderEffects } from './viewer-app-render-effects';
import { selectActiveSession } from './viewer-app-selectors';
import {
  applyChannelThumbnailEffects,
  applySessionResourceEffects,
  syncInteractionCoordinator
} from './viewer-app-state-effects';
import { applyUiEffects } from './viewer-app-ui-effects';

export interface AppHandle {
  dispose(): void;
}

export async function bootstrapApp(): Promise<AppHandle> {
  const core = new ViewerAppCore();

  let sessionController!: SessionController;
  let displayController!: DisplayController;
  let renderCache!: RenderCacheService;
  let renderer: WebGlExrRenderer | null = null;
  let thumbnailService: ThumbnailService | null = null;
  let channelThumbnailService: ChannelThumbnailService | null = null;
  let interactionCoordinator!: ViewerInteractionCoordinator;
  let interaction: ViewerInteraction | null = null;
  let resizeObserver: ResizeObserver | null = null;
  const unsubscribers: Array<() => void> = [];
  let viewerContainerRect: ViewportClientRect | null = null;
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
    onOpenFolderClick: () => {
      const input = document.getElementById('folder-input') as HTMLInputElement;
      input.click();
    },
    onExportImage: async (request) => {
      if (disposed) {
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
        const pixels = renderer!.readExportPixels({
          state: mergeRenderState(state.sessionState, state.interactionState),
          sourceWidth: activeSession.decoded.width,
          sourceHeight: activeSession.decoded.height
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
        core.dispatch({ type: 'errorSet', message });
        throw new Error(message);
      }
    },
    onFileSelected: (file) => {
      void sessionController.enqueueFiles([file]);
    },
    onFolderSelected: (files) => {
      void sessionController.enqueueFolderFiles(files);
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
    onReorderOpenedImage: (draggedSessionId, targetSessionId, placement) => {
      sessionController.reorderSessions(draggedSessionId, targetSessionId, placement);
    },
    onDisplayCacheBudgetChange: (valueMb) => {
      renderCache.setBudgetMb(valueMb);
    },
    onExposureChange: (value) => {
      core.dispatch({ type: 'exposureSet', exposureEv: value });
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
    onClearRoi: () => {
      core.dispatch({
        type: 'roiSet',
        roi: null
      });
    },
    onResetSettings: () => {
      renderCache.setBudgetMb(DEFAULT_DISPLAY_CACHE_BUDGET_MB);
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
      while (unsubscribers.length > 0) {
        unsubscribers.pop()?.();
      }
      interactionCoordinator?.dispose();
      interaction?.destroy();
      interaction = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      displayController?.dispose();
      sessionController?.dispose();
      thumbnailService?.dispose();
      channelThumbnailService?.dispose();
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
      getActiveSessionId: () => core.getState().activeSessionId,
      onDisplayLuminanceRangeResolved: (event) => {
        core.dispatch({
          type: 'displayLuminanceRangeResolved',
          requestId: event.requestId,
          sessionId: event.sessionId,
          activeLayer: event.activeLayer,
          displaySelection: event.displaySelection,
          displayLuminanceRange: event.displayLuminanceRange
        });
      }
    });
    thumbnailService = new ThumbnailService({
      getSession: (sessionId) => {
        return core.getState().sessions.find((session) => session.id === sessionId) ?? null;
      },
      onThumbnailReady: (event) => {
        core.dispatch({
          type: 'thumbnailReady',
          sessionId: event.sessionId,
          token: event.token,
          thumbnailDataUrl: event.thumbnailDataUrl
        });
      }
    });
    channelThumbnailService = new ChannelThumbnailService({
      getSession: (sessionId) => {
        return core.getState().sessions.find((session) => session.id === sessionId) ?? null;
      },
      onThumbnailReady: (event) => {
        core.dispatch({
          type: 'channelThumbnailReady',
          sessionId: event.sessionId,
          requestKey: event.requestKey,
          contextKey: event.contextKey,
          token: event.token,
          thumbnailDataUrl: event.thumbnailDataUrl
        });
      }
    });

    sessionController = new SessionController({
      core,
      loadQueue,
      decodeBytes: loadExrOffMainThread,
      getViewport: () => renderer!.getViewport()
    });

    interactionCoordinator = new ViewerInteractionCoordinator({
      initialSessionState: core.getState().sessionState,
      getSessionState: () => core.getState().sessionState,
      commitViewState: (view) => {
        core.dispatch({
          type: 'viewStateCommitted',
          view
        });
      },
      onInteractionChange: (state) => {
        if (disposed) {
          return;
        }

        core.dispatch({
          type: 'interactionStatePublished',
          interactionState: state
        });
      }
    });

    displayController = new DisplayController({
      core
    });

    unsubscribers.push(core.subscribeState((transition) => {
      if (disposed) {
        return;
      }

      syncInteractionCoordinator(interactionCoordinator, transition);
      applySessionResourceEffects(transition, core, renderCache, thumbnailService!);
      applyChannelThumbnailEffects(transition, core, channelThumbnailService!);
    }));
    unsubscribers.push(core.subscribeUi((transition) => {
      if (disposed) {
        return;
      }

      applyUiEffects(ui, transition);
    }));
    unsubscribers.push(core.subscribeRender((transition) => {
      if (disposed) {
        return;
      }

      applyRenderEffects(core, ui, renderer!, renderCache, transition);
    }));

    await displayController.initialize();

    interaction = new ViewerInteraction(ui.viewerContainer, {
      getState: () => mergeRenderState(core.getState().sessionState, core.getState().interactionState),
      getViewport: () => renderer!.getViewport(),
      getImageSize: () => {
        const activeSession = selectActiveSession(core.getState());
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
        core.dispatch({
          type: 'lockedPixelToggled',
          pixel
        });
      },
      onDraftRoi: (roi) => {
        interactionCoordinator.enqueueDraftRoi(roi);
      },
      onCommitRoi: (roi) => {
        core.dispatch({
          type: 'roiSet',
          roi
        });
      }
    });

    resizeObserver = new ResizeObserver(() => {
      if (disposed || !renderer) {
        return;
      }

      const rect = readViewportClientRect(ui.viewerContainer);
      const interactionState = interactionCoordinator.getState();
      if (viewerContainerRect && core.getState().sessionState.viewerMode === 'image') {
        const nextPan = preserveImagePanOnViewportChange(interactionState.view, viewerContainerRect, rect);
        if (nextPan.panX !== interactionState.view.panX || nextPan.panY !== interactionState.view.panY) {
          interactionCoordinator.enqueueViewPatch(nextPan);
        }
      }
      viewerContainerRect = rect;
      renderer.resize(rect.width, rect.height, rect.left, rect.top);
      if (selectActiveSession(core.getState())) {
        renderer.render(mergeRenderState(core.getState().sessionState, interactionCoordinator.getState()));
      } else {
        renderer.clearImage();
      }
    });
    resizeObserver.observe(ui.viewerContainer);

    const rect = readViewportClientRect(ui.viewerContainer);
    viewerContainerRect = rect;
    renderer.resize(rect.width, rect.height, rect.left, rect.top);
    if (selectActiveSession(core.getState())) {
      renderer.render(mergeRenderState(core.getState().sessionState, interactionCoordinator.getState()));
    } else {
      renderer.clearImage();
    }

    window.addEventListener('beforeunload', onBeforeUnload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize WebGL2 renderer.';
    if (!disposed) {
      core.dispatch({ type: 'errorSet', message });
      core.dispatch({ type: 'loadingSet', loading: false });
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

function readViewportClientRect(element: HTMLElement): ViewportClientRect {
  const rect = element.getBoundingClientRect();
  return {
    left: Number.isFinite(rect.left) ? rect.left : 0,
    top: Number.isFinite(rect.top) ? rect.top : 0,
    width: Number.isFinite(rect.width) ? rect.width : 0,
    height: Number.isFinite(rect.height) ? rect.height : 0
  };
}
