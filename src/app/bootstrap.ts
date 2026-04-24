import { createAbortError } from '../lifecycle';
import { ViewerInteraction } from '../interaction/viewer-interaction';
import { LoadQueueService } from '../services/load-queue';
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

export interface AppHandle {
  dispose(): void;
}

export async function bootstrapApp(): Promise<AppHandle> {
  const core = new ViewerAppCore();

  let services: BootstrapServices | null = null;
  let interaction: ViewerInteraction | null = null;
  let resizeObserver: ResizeObserver | null = null;
  const unsubscribers: Array<() => void> = [];
  let disposed = false;
  const isDisposed = () => disposed;
  const onBeforeUnload = () => {
    app.dispose();
  };

  const loadQueue = new LoadQueueService();
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
  const ui = createViewerUi({
    core,
    getSessionController: () => {
      if (!services) {
        throw createAbortError('Viewer application has not finished initializing.');
      }
      return services.sessionController;
    },
    getDisplayController: () => {
      if (!services) {
        throw createAbortError('Viewer application has not finished initializing.');
      }
      return services.displayController;
    },
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
    getInteraction: () => interaction,
    resolveColormapExportPixels,
    resolveImageExportPixels,
    isDisposed
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

    await services.displayController.initialize();

    interaction = createViewerInteraction({
      core,
      ui,
      renderer: services.renderer,
      interactionCoordinator: services.interactionCoordinator
    });
    resizeObserver = initializeViewportLifecycle({
      core,
      ui,
      renderer: services.renderer,
      interactionCoordinator: services.interactionCoordinator,
      isDisposed
    });

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
