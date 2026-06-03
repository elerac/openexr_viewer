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
import { buildFullViewerUrl, type EmbedBottomPanelMode } from '../embed/embed-params';
import {
  createLocalFileHandoffId,
  startLocalFileHandoffSender
} from '../embed/local-file-handoff';
import { ViewerAppCore } from './viewer-app-core';
import { createViewerUi, promoteActiveChannelThumbnail } from './bootstrap/create-ui';
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
import { createViewerHost, presentDesktopError } from '../platform';
import type { ViewerRuntimeUi } from '../ui/viewer-runtime-ui';

export interface BootstrapAppOptions {
  mode?: 'full' | 'embed';
  embedBottomPanel?: EmbedBottomPanelMode;
}

export interface AppHandle {
  loadUrl(url: string, options?: { name?: string; state?: EmbedViewerStateSnapshot | null }): Promise<void>;
  loadGallery(galleryId: string, options?: { name?: string; state?: EmbedViewerStateSnapshot | null }): Promise<void>;
  loadFile(file: File, options?: { name?: string; state?: EmbedViewerStateSnapshot | null }): Promise<void>;
  applyState(state: EmbedViewerStateSnapshot | null | undefined): void;
  setError(message: string | null): void;
  deferInitialLoad(load: () => void | Promise<void>): void;
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
  const host = createViewerHost();
  const reportDesktopError = (error: unknown, fallbackMessage: string): void => {
    const { message } = presentDesktopError(error, fallbackMessage);
    if (!message) {
      return;
    }
    core.dispatch({ type: 'errorSet', message });
  };
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
        bottomPanel: options.embedBottomPanel ?? 'probe',
        onChannelSelection: (selection) => {
          promoteActiveChannelThumbnail(core, () => getServices().channelThumbnailService, selection);
          void getServices().displayController.applyDisplaySelection(selection);
        },
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
        host,
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
    setError: (message) => {
      core.dispatch({ type: 'errorSet', message });
    },
    deferInitialLoad: (load) => {
      if (!ui.setDeferredLoad) {
        void load();
        return;
      }

      let started = false;
      ui.setDeferredLoad(async () => {
        if (started) {
          return;
        }
        started = true;
        ui.setDeferredLoad?.(null);
        await load();
      });
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
      pathFileProvider: host.pathFileProvider,
      onPathSessionLoaded: (entry) => {
        host.recordRecentFile(entry);
      },
      onPathSessionLoadFailed: (entry, error) => {
        host.recordPathLoadFailure(entry, error);
      },
      isDisposed
    });
    if (host.kind !== 'web') {
      const recentMenu = host.installRecentFilesMenu({
        onOpenEntry: (entry) => {
          void getServices().sessionController.enqueuePathEntries([entry]);
        },
        onError: (error) => {
          reportDesktopError(error, 'Failed to open recent file.');
        }
      });
      unsubscribers.push(() => recentMenu.dispose());

      void host.setupDesktopEvents({
        onEntries: (entries) => {
          void getServices().sessionController.enqueuePathEntries(entries);
        },
        onDragStateChange: (active) => {
          ui.showDropOverlay?.(active);
        },
        onError: (error) => {
          reportDesktopError(error, 'Failed to open dropped file.');
        }
      }).then((events) => {
        if (disposed) {
          events.dispose();
          return;
        }
        unsubscribers.push(() => events.dispose());
      }).catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to initialize desktop file events.';
        core.dispatch({ type: 'errorSet', message });
      });

      void host.setupDesktopCommands({
        onCommand: (commandId) => {
          if (commandId === 'clearRecentFiles') {
            void host.clearRecentFiles();
            return;
          }
          ui.executeDesktopCommand?.(commandId);
        },
        onOpenRecent: (entry) => {
          void getServices().sessionController.enqueuePathEntries([entry]);
        },
        onError: (error) => {
          reportDesktopError(error, 'Failed to open recent file.');
        },
        getCommandState: () => ui.getDesktopCommandState?.() ?? {}
      }).then((commands) => {
        if (disposed) {
          commands.dispose();
          return;
        }
        unsubscribers.push(() => commands.dispose());
      }).catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to initialize desktop menus.';
        core.dispatch({ type: 'errorSet', message });
      });
    }
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
      baseUrl: getViewerAppBaseUrl(),
      src: source.url,
      name: explicitName,
      state
    }), '_blank');
    return;
  }
  if (source.kind === 'path') {
    core.dispatch({
      type: 'errorSet',
      message: 'Opening a desktop path file in a separate browser viewer is not supported.'
    });
    return;
  }

  const handoffId = createLocalFileHandoffId();
  const fullWindow = window.open(buildFullViewerUrl({
    baseUrl: getViewerAppBaseUrl(),
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

function getViewerAppBaseUrl(): string {
  const baseUrl = import.meta.env.BASE_URL || '/';
  if (baseUrl === './') {
    return new URL('./', window.location.href).toString();
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}app/`;
}
