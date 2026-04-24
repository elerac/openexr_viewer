import { disposeDecodeWorker, loadExrOffMainThread } from '../../exr-worker-client';
import { ViewerInteractionCoordinator } from '../../interaction-coordinator';
import { WebGlExrRenderer } from '../../renderer';
import { ChannelThumbnailService } from '../../services/channel-thumbnail-service';
import { LoadQueueService } from '../../services/load-queue';
import { RenderCacheService } from '../../services/render-cache-service';
import { ThumbnailService } from '../../services/thumbnail-service';
import { DisplayController } from '../../controllers/display-controller';
import { SessionController } from '../../controllers/session-controller';
import { ViewerUi } from '../../ui/viewer-ui';
import { ViewerAppCore } from '../viewer-app-core';

export interface BootstrapServices {
  renderer: WebGlExrRenderer;
  renderCache: RenderCacheService;
  thumbnailService: ThumbnailService;
  channelThumbnailService: ChannelThumbnailService;
  sessionController: SessionController;
  interactionCoordinator: ViewerInteractionCoordinator;
  displayController: DisplayController;
}

interface CreateBootstrapServicesArgs {
  core: ViewerAppCore;
  ui: ViewerUi;
  loadQueue: LoadQueueService;
  isDisposed: () => boolean;
}

export function createBootstrapServices({
  core,
  ui,
  loadQueue,
  isDisposed
}: CreateBootstrapServicesArgs): BootstrapServices {
  const renderer = new WebGlExrRenderer(ui.glCanvas, ui.overlayCanvas, ui.probeOverlayCanvas);
  const renderCache = new RenderCacheService({
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
  const thumbnailService = new ThumbnailService({
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
  const channelThumbnailService = new ChannelThumbnailService({
    getSession: (sessionId) => {
      return core.getState().sessions.find((session) => session.id === sessionId) ?? null;
    },
    getColormapRegistry: () => core.getState().colormapRegistry,
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
  const sessionController = new SessionController({
    core,
    loadQueue,
    decodeBytes: loadExrOffMainThread,
    getViewport: () => renderer.getViewport()
  });
  const interactionCoordinator = new ViewerInteractionCoordinator({
    initialSessionState: core.getState().sessionState,
    getSessionState: () => core.getState().sessionState,
    commitViewState: (view) => {
      core.dispatch({
        type: 'viewStateCommitted',
        view
      });
    },
    onInteractionChange: (state) => {
      if (isDisposed()) {
        return;
      }

      core.dispatch({
        type: 'interactionStatePublished',
        interactionState: state
      });
    }
  });
  const displayController = new DisplayController({
    core
  });

  return {
    renderer,
    renderCache,
    thumbnailService,
    channelThumbnailService,
    sessionController,
    interactionCoordinator,
    displayController
  };
}

export function disposeBootstrapServices(services: Partial<BootstrapServices>): void {
  services.interactionCoordinator?.dispose();
  services.displayController?.dispose();
  services.sessionController?.dispose();
  services.thumbnailService?.dispose();
  services.channelThumbnailService?.dispose();
  services.renderCache?.dispose();
  services.renderer?.dispose();
  disposeDecodeWorker();
}
