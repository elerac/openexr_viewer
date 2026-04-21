// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const unsubscribe = vi.fn();
  const uiDispose = vi.fn();
  const rendererDispose = vi.fn();
  const interactionDestroy = vi.fn();
  const sessionDispose = vi.fn();
  const displayDispose = vi.fn();
  const thumbnailDispose = vi.fn();
  const renderCacheDispose = vi.fn();
  const loadQueueDispose = vi.fn();
  const workerDispose = vi.fn();

  return {
    unsubscribe,
    uiDispose,
    rendererDispose,
    interactionDestroy,
    sessionDispose,
    displayDispose,
    thumbnailDispose,
    renderCacheDispose,
    loadQueueDispose,
    workerDispose
  };
});

vi.mock('../src/viewer-store', () => ({
  createInitialState: () => ({}),
  ViewerStore: class {
    private state = {};

    getState(): object {
      return this.state;
    }

    setState(patch: Record<string, unknown>): void {
      this.state = { ...this.state, ...patch };
    }

    subscribe(): () => void {
      return mocks.unsubscribe;
    }
  }
}));

vi.mock('../src/ui', () => ({
  ViewerUi: class {
    readonly viewerContainer = Object.assign(document.createElement('div'), {
      getBoundingClientRect: () => ({ width: 320, height: 180 })
    });
    readonly glCanvas = document.createElement('canvas');
    readonly overlayCanvas = document.createElement('canvas');
    readonly probeOverlayCanvas = document.createElement('canvas');
    readonly dispose = mocks.uiDispose;
    readonly setError = vi.fn();
    readonly setLoading = vi.fn();
    readonly setDisplayCacheBudget = vi.fn();
    readonly setDisplayCacheUsage = vi.fn();
    readonly setOpenedImageOptions = vi.fn();
    readonly setExportTarget = vi.fn();
  }
}));

vi.mock('../src/renderer', () => ({
  WebGlExrRenderer: class {
    readonly dispose = mocks.rendererDispose;
    readonly resize = vi.fn();
    readonly render = vi.fn();
    readonly renderImage = vi.fn();
    readonly renderValueOverlay = vi.fn();
    readonly renderProbeOverlay = vi.fn();
    readonly getViewport = vi.fn(() => ({ width: 320, height: 180 }));
    readonly clearImage = vi.fn();
    readonly setDisplayTexture = vi.fn();
    readonly setColormapTexture = vi.fn();
  }
}));

vi.mock('../src/interaction', () => ({
  ViewerInteraction: class {
    readonly destroy = mocks.interactionDestroy;
  }
}));

vi.mock('../src/controllers/session-controller', () => ({
  SessionController: class {
    readonly dispose = mocks.sessionDispose;
    readonly getActiveSession = vi.fn(() => null);
    readonly getActiveSessionId = vi.fn(() => null);
    readonly getSessions = vi.fn(() => []);
    readonly syncOpenedImageOptions = vi.fn();
    readonly handleStoreChange = vi.fn();
    readonly handleSessionClosed = vi.fn();
    readonly handleAllSessionsClosed = vi.fn();
  }
}));

vi.mock('../src/controllers/display-controller', () => ({
  DisplayController: class {
    readonly dispose = mocks.displayDispose;
    readonly initialize = vi.fn(async () => undefined);
    readonly handleSessionStateChange = vi.fn();
    readonly handleInteractionStateChange = vi.fn();
    readonly getDefaultColormapId = vi.fn(() => '0');
    readonly getActiveColormapLutForState = vi.fn(() => null);
    readonly handleSessionClosed = vi.fn();
    readonly handleAllSessionsClosed = vi.fn();
    readonly setViewerMode = vi.fn();
  }
}));

vi.mock('../src/services/thumbnail-service', () => ({
  ThumbnailService: class {
    readonly dispose = mocks.thumbnailDispose;
    readonly getThumbnailDataUrl = vi.fn(() => null);
  }
}));

vi.mock('../src/services/render-cache-service', () => ({
  RenderCacheService: class {
    readonly dispose = mocks.renderCacheDispose;
    readonly getTextureForSnapshot = vi.fn(() => null);
    readonly setBudgetMb = vi.fn();
  }
}));

vi.mock('../src/services/load-queue', () => ({
  LoadQueueService: class {
    readonly dispose = mocks.loadQueueDispose;
  }
}));

vi.mock('../src/exr-worker-client', () => ({
  loadExrOffMainThread: vi.fn(),
  disposeDecodeWorker: mocks.workerDispose
}));

vi.mock('../src/export-image', () => ({
  createExportImageBlob: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('bootstrap app lifecycle', () => {
  it('returns an app handle whose unload path disposes every owned subsystem', async () => {
    const resizeDisconnect = vi.fn();
    class ResizeObserverMock {
      observe(): void {}
      disconnect = resizeDisconnect;
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    const beforeUnload = addEventListenerSpy.mock.calls.find(([type]) => type === 'beforeunload')?.[1] as
      | EventListener
      | undefined;

    expect(beforeUnload).toBeTypeOf('function');

    beforeUnload?.(new Event('beforeunload'));

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.interactionDestroy).toHaveBeenCalledTimes(1);
    expect(resizeDisconnect).toHaveBeenCalledTimes(1);
    expect(mocks.displayDispose).toHaveBeenCalledTimes(1);
    expect(mocks.sessionDispose).toHaveBeenCalledTimes(1);
    expect(mocks.thumbnailDispose).toHaveBeenCalledTimes(1);
    expect(mocks.renderCacheDispose).toHaveBeenCalledTimes(1);
    expect(mocks.loadQueueDispose).toHaveBeenCalledTimes(1);
    expect(mocks.rendererDispose).toHaveBeenCalledTimes(1);
    expect(mocks.uiDispose).toHaveBeenCalledTimes(1);
    expect(mocks.workerDispose).toHaveBeenCalledTimes(1);
    expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', beforeUnload);

    app.dispose();
    expect(mocks.uiDispose).toHaveBeenCalledTimes(1);
  });
});
