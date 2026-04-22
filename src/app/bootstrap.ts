import { disposeDecodeWorker, loadExrOffMainThread } from '../exr-worker-client';
import { ViewerInteractionCoordinator } from '../interaction-coordinator';
import { createAbortError, isAbortError } from '../lifecycle';
import { ViewerUi } from '../ui';
import { preserveImagePanOnViewportChange, type ViewportClientRect, ViewerInteraction } from '../interaction';
import { WebGlExrRenderer } from '../renderer';
import { DisplayController } from '../controllers/display-controller';
import { SessionController } from '../controllers/session-controller';
import { createPngBlobFromPixels } from '../export-image';
import { LoadQueueService } from '../services/load-queue';
import { ThumbnailService } from '../services/thumbnail-service';
import { RenderCacheService } from '../services/render-cache-service';
import { mergeRenderState, samePixel, sameViewState } from '../view-state';
import { ViewerAppCore } from './viewer-app-core';
import { selectActiveSession } from './viewer-app-selectors';
import { InvalidationFlags } from './viewer-app-invalidation';
import type { ViewerAppTransition } from './viewer-app-types';

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
  let interactionCoordinator!: ViewerInteractionCoordinator;
  let interaction: ViewerInteraction | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let unsubscribeCore: (() => void) | null = null;
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
      unsubscribeCore?.();
      unsubscribeCore = null;
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

    unsubscribeCore = core.subscribe((transition) => {
      if (disposed) {
        return;
      }

      syncInteractionCoordinator(interactionCoordinator, transition);
      applySessionResourceEffects(transition, core, renderCache, thumbnailService!);
      applyUiEffects(ui, renderer!, transition);
      applyRenderEffects(core, renderer!, renderCache, transition);
    });

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

function applySessionResourceEffects(
  transition: ViewerAppTransition,
  core: ViewerAppCore,
  renderCache: RenderCacheService,
  thumbnailService: ThumbnailService
): void {
  switch (transition.intent.type) {
    case 'sessionLoaded': {
      scheduleThumbnailGeneration(core, thumbnailService, transition.intent.session.id, transition.intent.session.state);
      return;
    }
    case 'sessionReloaded': {
      renderCache.discard(transition.intent.sessionId);
      thumbnailService.discard(transition.intent.sessionId);
      scheduleThumbnailGeneration(core, thumbnailService, transition.intent.sessionId, transition.intent.session.state);
      return;
    }
    case 'sessionClosed': {
      renderCache.discard(transition.intent.sessionId);
      thumbnailService.discard(transition.intent.sessionId);
      return;
    }
    case 'allSessionsClosed': {
      renderCache.clear();
      thumbnailService.clear();
      return;
    }
    default:
      return;
  }
}

function scheduleThumbnailGeneration(
  core: ViewerAppCore,
  thumbnailService: ThumbnailService,
  sessionId: string,
  stateSnapshot: ViewerAppTransition['state']['sessionState']
): void {
  const token = core.issueRequestId();
  core.dispatch({
    type: 'thumbnailRequested',
    sessionId,
    token
  });
  void thumbnailService.enqueue(sessionId, stateSnapshot, token).catch(() => undefined);
}

function syncInteractionCoordinator(
  interactionCoordinator: ViewerInteractionCoordinator,
  transition: ViewerAppTransition
): void {
  const coordinatorState = interactionCoordinator.getState();
  const nextInteractionState = transition.state.interactionState;
  if (
    sameViewState(coordinatorState.view, nextInteractionState.view) &&
    samePixel(coordinatorState.hoveredPixel, nextInteractionState.hoveredPixel)
  ) {
    return;
  }

  interactionCoordinator.syncSessionState(transition.state.sessionState, {
    clearHover: nextInteractionState.hoveredPixel === null
  });
}

function applyUiEffects(
  ui: ViewerUi,
  renderer: WebGlExrRenderer,
  transition: ViewerAppTransition
): void {
  const { snapshot, invalidation, state } = transition;

  if (invalidation & InvalidationFlags.UiError) {
    ui.setError(state.errorMessage);
  }

  if (invalidation & InvalidationFlags.UiLoading) {
    ui.setLoading(state.isLoading);
    ui.setRgbViewLoading(snapshot.isRgbViewLoading);
  }

  if (invalidation & InvalidationFlags.UiOpenedImages) {
    ui.setOpenedImageOptions(snapshot.openedImageOptions, state.activeSessionId);
  }

  if (invalidation & InvalidationFlags.UiExportTarget) {
    ui.setExportTarget(snapshot.exportTarget);
  }

  if (invalidation & InvalidationFlags.UiExposure) {
    ui.setExposure(state.sessionState.exposureEv);
  }

  if (invalidation & InvalidationFlags.UiViewerMode) {
    ui.setViewerMode(state.sessionState.viewerMode);
  }

  if (invalidation & InvalidationFlags.UiVisualizationMode) {
    ui.setVisualizationMode(state.sessionState.visualizationMode);
  }

  if (invalidation & InvalidationFlags.UiStokesDegreeModulation) {
    ui.setStokesDegreeModulationControl(
      snapshot.stokesDegreeModulationControl?.label ?? null,
      snapshot.stokesDegreeModulationControl?.enabled ?? false
    );
  }

  if (invalidation & InvalidationFlags.UiActiveColormap) {
    ui.setActiveColormap(state.sessionState.activeColormapId);
  }

  if (invalidation & InvalidationFlags.UiColormapOptions) {
    ui.setColormapOptions(snapshot.colormapOptions, state.defaultColormapId);
  }

  if ((invalidation & InvalidationFlags.UiColormapGradient) && state.activeColormapLut) {
    renderer.setColormapTexture(state.activeColormapLut.entryCount, state.activeColormapLut.rgba8);
    ui.setColormapGradient(state.activeColormapLut);
  }

  if (invalidation & InvalidationFlags.UiColormapRange) {
    ui.setColormapRange(
      state.sessionState.colormapRange,
      state.activeDisplayLuminanceRange ?? state.sessionState.colormapRange,
      state.sessionState.colormapRangeMode === 'alwaysAuto',
      state.sessionState.colormapZeroCentered
    );
  }

  if (invalidation & InvalidationFlags.UiLayerOptions) {
    ui.setLayerOptions(snapshot.layerOptions, state.sessionState.activeLayer);
  }

  if (invalidation & InvalidationFlags.UiProbeMetadata) {
    ui.setProbeMetadata(snapshot.probePresentation.metadata);
  }

  if (invalidation & InvalidationFlags.UiRgbGroupOptions) {
    ui.setRgbGroupOptions(snapshot.rgbGroupChannelNames, state.sessionState.displaySelection);
  }

  if (invalidation & InvalidationFlags.UiClearPanels) {
    ui.clearImageBrowserPanels();
  }

  if (invalidation & InvalidationFlags.UiProbeReadout) {
    ui.setProbeReadout(
      snapshot.probePresentation.mode,
      snapshot.probePresentation.sample,
      snapshot.probePresentation.colorPreview,
      snapshot.probePresentation.imageSize
    );
  }
}

function applyRenderEffects(
  core: ViewerAppCore,
  renderer: WebGlExrRenderer,
  renderCache: RenderCacheService,
  transition: ViewerAppTransition
): void {
  const { snapshot, invalidation, state } = transition;
  const activeSession = snapshot.activeSession;
  if (invalidation & InvalidationFlags.ResourceClearImage) {
    renderer.clearImage();
  }

  if ((invalidation & InvalidationFlags.ResourcePrepare) && activeSession) {
    renderCache.prepareActiveSession(activeSession, state.sessionState);
    synchronizeCachedDisplayRange(core, renderCache, activeSession.id, state.sessionState);
  }

  if ((invalidation & InvalidationFlags.ResourceRequestDisplayRange) && activeSession && snapshot.displayRangeRequestKey) {
    const requestId = core.issueRequestId();
    const result = renderCache.requestDisplayLuminanceRange(activeSession, state.sessionState, requestId);
    if (result.pending) {
      core.dispatch({
        type: 'displayRangeRequestStarted',
        requestId,
        requestKey: snapshot.displayRangeRequestKey
      });
    } else {
      core.dispatch({
        type: 'displayLuminanceRangeResolved',
        requestId,
        sessionId: activeSession.id,
        activeLayer: state.sessionState.activeLayer,
        displaySelection: state.sessionState.displaySelection,
        displayLuminanceRange: result.displayLuminanceRange
      });
    }
  }

  if (!activeSession) {
    return;
  }

  if (invalidation & InvalidationFlags.RenderImage) {
    renderer.renderImage(snapshot.renderState);
  }

  if (invalidation & InvalidationFlags.RenderValueOverlay) {
    renderer.renderValueOverlay(snapshot.renderState);
  }

  if (invalidation & InvalidationFlags.RenderProbeOverlay) {
    renderer.renderProbeOverlay(snapshot.renderState);
  }
}

function synchronizeCachedDisplayRange(
  core: ViewerAppCore,
  renderCache: RenderCacheService,
  sessionId: string,
  sessionState: ViewerAppTransition['state']['sessionState']
): void {
  const cachedRange = renderCache.getCachedLuminanceRange(sessionId, sessionState);
  if (
    cachedRange?.min === core.getState().activeDisplayLuminanceRange?.min &&
    cachedRange?.max === core.getState().activeDisplayLuminanceRange?.max
  ) {
    return;
  }

  core.dispatch({
    type: 'displayLuminanceRangeResolved',
    requestId: null,
    sessionId,
    activeLayer: sessionState.activeLayer,
    displaySelection: sessionState.displaySelection,
    displayLuminanceRange: cachedRange
  });
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
