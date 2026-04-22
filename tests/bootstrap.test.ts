// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const unsubscribe = vi.fn();
  const uiDispose = vi.fn();
  const rendererDispose = vi.fn();
  const interactionDestroy = vi.fn();
  const interactionCoordinatorDispose = vi.fn();
  const sessionDispose = vi.fn();
  const displayDispose = vi.fn();
  const thumbnailDispose = vi.fn();
  const renderCacheDispose = vi.fn();
  const loadQueueDispose = vi.fn();
  const workerDispose = vi.fn();
  const interactionCoordinatorGetState = vi.fn(() => ({
    view: {
      zoom: 4,
      panX: 10,
      panY: 20,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100
    },
    hoveredPixel: null
  }));
  const interactionCoordinatorEnqueueViewPatch = vi.fn();
  const viewerRect = {
    left: 0,
    top: 0,
    width: 320,
    height: 180
  };
  let resizeObserverCallback: ResizeObserverCallback | null = null;

  return {
    unsubscribe,
    uiDispose,
    rendererDispose,
    interactionDestroy,
    interactionCoordinatorDispose,
    sessionDispose,
    displayDispose,
    thumbnailDispose,
    renderCacheDispose,
    loadQueueDispose,
    workerDispose,
    interactionCoordinatorGetState,
    interactionCoordinatorEnqueueViewPatch,
    viewerRect,
    getResizeObserverCallback: () => resizeObserverCallback,
    setResizeObserverCallback: (callback: ResizeObserverCallback | null) => {
      resizeObserverCallback = callback;
    }
  };
});

vi.mock('../src/app/viewer-app-core', () => ({
  ViewerAppCore: class {
    getState(): object {
      return {
        activeSessionId: null,
        sessions: [],
        errorMessage: null,
        isLoading: false,
        defaultColormapId: '0',
        activeColormapLut: null,
        activeDisplayLuminanceRange: null,
        sessionState: {
          exposureEv: 0,
          viewerMode: 'image',
          visualizationMode: 'rgb',
          activeColormapId: '0',
          colormapRange: null,
          colormapRangeMode: 'alwaysAuto',
          colormapZeroCentered: false,
          stokesDegreeModulation: { aolp: false, cop: true, top: true },
          zoom: 1,
          panX: 0,
          panY: 0,
          panoramaYawDeg: 0,
          panoramaPitchDeg: 0,
          panoramaHfovDeg: 100,
          activeLayer: 0,
          displaySelection: null,
          lockedPixel: null
        },
        interactionState: {
          view: {
            zoom: 1,
            panX: 0,
            panY: 0,
            panoramaYawDeg: 0,
            panoramaPitchDeg: 0,
            panoramaHfovDeg: 100
          },
          hoveredPixel: null
        }
      };
    }

    subscribeState(): () => void {
      return mocks.unsubscribe;
    }

    subscribeUi(): () => void {
      return mocks.unsubscribe;
    }

    subscribeRender(): () => void {
      return mocks.unsubscribe;
    }

    dispatch(): void {}
    issueRequestId(): number {
      return 1;
    }

    issueSessionId(): string {
      return 'session-1';
    }
  }
}));

vi.mock('../src/ui', () => ({
  ViewerUi: class {
    readonly viewerContainer = Object.assign(document.createElement('div'), {
      getBoundingClientRect: () => ({ ...mocks.viewerRect })
    });
    readonly glCanvas = document.createElement('canvas');
    readonly overlayCanvas = document.createElement('canvas');
    readonly probeOverlayCanvas = document.createElement('canvas');
    readonly dispose = mocks.uiDispose;
    readonly setError = vi.fn();
    readonly setLoading = vi.fn();
    readonly setRgbViewLoading = vi.fn();
    readonly setDisplayCacheBudget = vi.fn();
    readonly setDisplayCacheUsage = vi.fn();
    readonly setOpenedImageOptions = vi.fn();
    readonly setExportTarget = vi.fn();
    readonly setExposure = vi.fn();
    readonly setViewerMode = vi.fn();
    readonly setVisualizationMode = vi.fn();
    readonly setStokesDegreeModulationControl = vi.fn();
    readonly setActiveColormap = vi.fn();
    readonly setColormapOptions = vi.fn();
    readonly setColormapGradient = vi.fn();
    readonly setColormapRange = vi.fn();
    readonly setLayerOptions = vi.fn();
    readonly setProbeMetadata = vi.fn();
    readonly setRgbGroupOptions = vi.fn();
    readonly clearImageBrowserPanels = vi.fn();
    readonly setProbeReadout = vi.fn();
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
    readonly setColormapTexture = vi.fn();
    readonly readExportPixels = vi.fn(() => ({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255])
    }));
  }
}));

vi.mock('../src/interaction', () => ({
  preserveImagePanOnViewportChange: vi.fn((state, previousViewport, nextViewport) => ({
    panX: state.panX + (
      (nextViewport.left + nextViewport.width * 0.5) -
      (previousViewport.left + previousViewport.width * 0.5)
    ) / state.zoom,
    panY: state.panY + (
      (nextViewport.top + nextViewport.height * 0.5) -
      (previousViewport.top + previousViewport.height * 0.5)
    ) / state.zoom
  })),
  ViewerInteraction: class {
    readonly destroy = mocks.interactionDestroy;
  }
}));

vi.mock('../src/interaction-coordinator', () => ({
  ViewerInteractionCoordinator: class {
    readonly dispose = mocks.interactionCoordinatorDispose;
    readonly getState = mocks.interactionCoordinatorGetState;
    readonly enqueueViewPatch = mocks.interactionCoordinatorEnqueueViewPatch;
    readonly enqueueHoverPixel = vi.fn();
    readonly syncSessionState = vi.fn();
  }
}));

vi.mock('../src/controllers/session-controller', () => ({
  SessionController: class {
    readonly dispose = mocks.sessionDispose;
    readonly getActiveSession = vi.fn(() => null);
    readonly getActiveSessionId = vi.fn(() => null);
    readonly getSessions = vi.fn(() => []);
  }
}));

vi.mock('../src/controllers/display-controller', () => ({
  DisplayController: class {
    readonly dispose = mocks.displayDispose;
    readonly initialize = vi.fn(async () => undefined);
    readonly getActiveColormapLutForState = vi.fn(() => null);
  }
}));

vi.mock('../src/services/thumbnail-service', () => ({
  ThumbnailService: class {
    readonly dispose = mocks.thumbnailDispose;
    readonly enqueue = vi.fn(async () => undefined);
    readonly discard = vi.fn();
    readonly clear = vi.fn();
  }
}));

vi.mock('../src/services/render-cache-service', () => ({
  RenderCacheService: class {
    readonly dispose = mocks.renderCacheDispose;
    readonly prepareActiveSession = vi.fn(() => ({
      textureRevisionKey: '',
      textureDirty: false
    }));
    readonly requestDisplayLuminanceRange = vi.fn(() => ({
      displayLuminanceRange: null,
      pending: false
    }));
    readonly getCachedLuminanceRange = vi.fn(() => null);
    readonly discard = vi.fn();
    readonly clear = vi.fn();
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
  createPngBlobFromPixels: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  mocks.viewerRect.left = 0;
  mocks.viewerRect.top = 0;
  mocks.viewerRect.width = 320;
  mocks.viewerRect.height = 180;
  mocks.setResizeObserverCallback(null);
});

describe('bootstrap app lifecycle', () => {
  it('returns an app handle whose unload path disposes every owned subsystem', async () => {
    const resizeDisconnect = vi.fn();
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

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

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(3);
    expect(mocks.interactionCoordinatorDispose).toHaveBeenCalledTimes(1);
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

  it('preserves image alignment when the viewer container shifts during resize', async () => {
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    mocks.interactionCoordinatorEnqueueViewPatch.mockClear();

    mocks.viewerRect.left = 40;
    mocks.viewerRect.width = 260;
    mocks.viewerRect.top = 10;
    mocks.viewerRect.height = 200;
    mocks.getResizeObserverCallback()?.([], {} as ResizeObserver);

    expect(mocks.interactionCoordinatorEnqueueViewPatch).toHaveBeenCalledWith({
      panX: 12.5,
      panY: 25
    });

    app.dispose();
  });
});
