import { createAbortError } from '../lifecycle';
import { ViewerInteraction } from '../interaction/viewer-interaction';
import { LoadQueueService } from '../services/load-queue';
import { readStoredImageLoadWorkers } from '../image-load-workers';
import { setMaxDecodeWorkers } from '../exr-worker-client';
import { EmbedViewerUi } from '../embed/embed-viewer-ui';
import {
  applyEmbedViewerStateSnapshot,
  createEmbedViewerStateSnapshot,
  type EmbedViewerStateSnapshot
} from '../embed/embed-state';
import { buildFullViewerUrl } from '../embed/embed-params';
import {
  createLocalFileHandoffId,
  startLocalFileHandoffSender
} from '../embed/local-file-handoff';
import { ViewerAppCore } from './viewer-app-core';
import { createViewerUi } from './bootstrap/create-ui';
import {
  createBootstrapServices,
  disposeBootstrapServices,
  type BootstrapServices
} from './bootstrap/create-services';
import {
  createColormapExportPixelsResolver,
  createImageExportPixelsResolver
} from './bootstrap/export-actions';
import { registerBootstrapEffects } from './bootstrap/register-effects';
import { createViewerInteraction, initializeViewportLifecycle } from './bootstrap/viewport-lifecycle';
import { installE2EHooks } from './e2e-hooks';
import { selectActiveSession } from './viewer-app-selectors';
import type { ViewerRuntimeUi } from '../ui/viewer-runtime-ui';

export interface BootstrapAppOptions {
  mode?: 'full' | 'embed';
}

export interface AppHandle {
  loadUrl(url: string, options?: { name?: string; state?: EmbedViewerStateSnapshot | null }): Promise<void>;
  loadGallery(galleryId: string, options?: { name?: string; state?: EmbedViewerStateSnapshot | null }): Promise<void>;
  loadFile(file: File, options?: { name?: string; state?: EmbedViewerStateSnapshot | null }): Promise<void>;
  applyState(state: EmbedViewerStateSnapshot | null | undefined): void;
  openFullViewer(): void;
  dispose(): void;
}

export async function bootstrapApp(options: BootstrapAppOptions = {}): Promise<AppHandle> {
  const core = new ViewerAppCore();

  let services: BootstrapServices | null = null;
  let interaction: ViewerInteraction | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let cleanupE2EHooks: () => void = () => {};
  const unsubscribers: Array<() => void> = [];
  let disposed = false;
  const isDisposed = () => disposed;
  const onBeforeUnload = () => {
    app.dispose();
  };

  const initialImageLoadWorkers = readStoredImageLoadWorkers();
  setMaxDecodeWorkers(initialImageLoadWorkers);
  const loadQueue = new LoadQueueService({ maxWorkers: initialImageLoadWorkers });
  const resolveColormapExportPixels = createColormapExportPixelsResolver({
    core,
    isDisposed
  });
  const resolveImageExportPixels = createImageExportPixelsResolver({
    core,
    getRenderCache: () => {
      if (!services) {
        throw createAbortError('Viewer application has not finished initializing.');
      }
      return services.renderCache;
    },
    getRenderer: () => {
      if (!services) {
        throw createAbortError('Viewer application has not finished initializing.');
      }
      return services.renderer;
    },
    getDisplayController: () => {
      if (!services) {
        throw createAbortError('Viewer application has not finished initializing.');
      }
      return services.displayController;
    },
    isDisposed
  });
  const getServices = (): BootstrapServices => {
    if (!services) {
      throw createAbortError('Viewer application has not finished initializing.');
    }
    return services;
  };
  const ui: ViewerRuntimeUi = options.mode === 'embed'
    ? new EmbedViewerUi({
        onOpenFull: () => {
          app.openFullViewer();
        }
      })
    : createViewerUi({
        core,
        getSessionController: () => getServices().sessionController,
        getDisplayController: () => getServices().displayController,
        getChannelThumbnailService: () => getServices().channelThumbnailService,
        getRenderCache: () => getServices().renderCache,
        getRenderer: () => getServices().renderer,
        getInteraction: () => interaction,
        resolveColormapExportPixels,
        resolveImageExportPixels,
        onImageLoadWorkersChange: (workerCount) => {
          loadQueue.setMaxWorkers(workerCount);
          setMaxDecodeWorkers(workerCount);
        },
        isDisposed
      });
  const app: AppHandle = {
    loadUrl: async (url, loadOptions = {}) => {
      await getServices().sessionController.enqueueUrl(url, {
        displayName: loadOptions.name
      });
      applyEmbedViewerStateSnapshot(core, loadOptions.state);
    },
    loadGallery: async (galleryId, loadOptions = {}) => {
      await getServices().sessionController.enqueueGalleryImage(galleryId, {
        displayName: loadOptions.name
      });
      applyEmbedViewerStateSnapshot(core, loadOptions.state);
    },
    loadFile: async (file, loadOptions = {}) => {
      await getServices().sessionController.enqueueFiles([file], {
        displayName: loadOptions.name
      });
      applyEmbedViewerStateSnapshot(core, loadOptions.state);
    },
    applyState: (state) => {
      applyEmbedViewerStateSnapshot(core, state);
    },
    openFullViewer: () => {
      openFullViewer(core);
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      cleanupE2EHooks();
      cleanupE2EHooks = () => {};
      while (unsubscribers.length > 0) {
        unsubscribers.pop()?.();
      }
      interaction?.destroy();
      interaction = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      loadQueue.dispose();
      disposeBootstrapServices(services ?? {});
      services = null;
      ui.dispose();
    }
  };

  try {
    services = createBootstrapServices({
      core,
      ui,
      loadQueue,
      isDisposed
    });
    unsubscribers.push(...registerBootstrapEffects({
      core,
      ui,
      services,
      isDisposed
    }));

    interaction = createViewerInteraction({
      core,
      ui,
      interactionCoordinator: services.interactionCoordinator
    });
    resizeObserver = initializeViewportLifecycle({
      core,
      ui,
      renderer: services.renderer,
      interactionCoordinator: services.interactionCoordinator,
      isDisposed
    });

    await services.displayController.initialize();
    cleanupE2EHooks = installE2EHooks(core);

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

function openFullViewer(core: ViewerAppCore): void {
  const activeSession = selectActiveSession(core.getState());
  if (!activeSession) {
    return;
  }

  const state = createEmbedViewerStateSnapshot(core.getState());
  const source = activeSession.source;
  const explicitName = activeSession.displayNameIsCustom ? activeSession.displayName : undefined;
  if (source.kind === 'url') {
    window.open(buildFullViewerUrl({
      baseUrl: import.meta.env.BASE_URL,
      src: source.url,
      name: explicitName,
      state
    }), '_blank');
    return;
  }

  const handoffId = createLocalFileHandoffId();
  const fullWindow = window.open(buildFullViewerUrl({
    baseUrl: import.meta.env.BASE_URL,
    handoffId,
    name: explicitName,
    state
  }), '_blank');
  if (!fullWindow) {
    core.dispatch({
      type: 'errorSet',
      message: 'Popup blocked. Allow popups to open the full viewer.'
    });
    return;
  }

  startLocalFileHandoffSender({
    targetWindow: fullWindow,
    handoffId,
    file: source.file,
    name: explicitName,
    state,
    targetOrigin: window.location.origin,
    onTimeout: () => {
      core.dispatch({
        type: 'errorSet',
        message: 'Timed out while opening the local file in the full viewer.'
      });
    }
  });
}
