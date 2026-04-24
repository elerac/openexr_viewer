// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const createCoreState = () => ({
    activeSessionId: null,
    sessions: [],
    errorMessage: null,
    isLoading: false,
    colormapRegistry: null as
      | {
          defaultId: string;
          assets: Array<{ label: string; file: string }>;
          options: Array<{ id: string; label: string }>;
        }
      | null,
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
      lockedPixel: null,
      roi: null
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
      hoveredPixel: null,
      draftRoi: null
    }
  });
  const unsubscribe = vi.fn();
  const coreDispatch = vi.fn();
  const uiDispose = vi.fn();
  const rendererDispose = vi.fn();
  const interactionDestroy = vi.fn();
  const interactionSetPanoramaKeyboardOrbitInput = vi.fn();
  const interactionCoordinatorDispose = vi.fn();
  const sessionDispose = vi.fn();
  const displayDispose = vi.fn();
  const thumbnailDispose = vi.fn();
  const renderCacheDispose = vi.fn();
  const loadQueueDispose = vi.fn();
  const workerDispose = vi.fn();
  const rendererReadExportPixels = vi.fn(() => ({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255])
  }));
  const renderCachePrepareActiveSession = vi.fn(() => ({
    textureRevisionKey: '',
    textureDirty: false
  }));
  const displayGetActiveColormapLutForState = vi.fn(() => null);
  const loadColormapLut = vi.fn();
  const getColormapAsset = vi.fn((registry: { assets?: Array<{ label: string; file: string }> }, id: string) => {
    const index = Number(id);
    return Number.isInteger(index) ? registry.assets?.[index] ?? null : null;
  });
  const createPngBlobFromPixels = vi.fn();
  const buildColormapExportPixels = vi.fn();
  const interactionCoordinatorGetState = vi.fn(() => ({
    view: {
      zoom: 4,
      panX: 10,
      panY: 20,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100
    },
    hoveredPixel: null,
    draftRoi: null
  }));
  const interactionCoordinatorEnqueueViewPatch = vi.fn();
  const viewerRect = {
    left: 0,
    top: 0,
    width: 320,
    height: 180
  };
  const coreState = createCoreState();
  let uiCallbacks: Record<string, unknown> | null = null;
  let resizeObserverCallback: ResizeObserverCallback | null = null;

  return {
    createCoreState,
    coreState,
    resetCoreState: () => {
      const nextState = createCoreState();
      Object.keys(coreState).forEach((key) => {
        delete (coreState as Record<string, unknown>)[key];
      });
      Object.assign(coreState, nextState);
    },
    unsubscribe,
    coreDispatch,
    uiDispose,
    rendererDispose,
    interactionDestroy,
    interactionSetPanoramaKeyboardOrbitInput,
    interactionCoordinatorDispose,
    sessionDispose,
    displayDispose,
    thumbnailDispose,
    renderCacheDispose,
    loadQueueDispose,
    workerDispose,
    rendererReadExportPixels,
    renderCachePrepareActiveSession,
    displayGetActiveColormapLutForState,
    loadColormapLut,
    getColormapAsset,
    createPngBlobFromPixels,
    buildColormapExportPixels,
    interactionCoordinatorGetState,
    interactionCoordinatorEnqueueViewPatch,
    viewerRect,
    getUiCallbacks: () => uiCallbacks,
    setUiCallbacks: (callbacks: Record<string, unknown> | null) => {
      uiCallbacks = callbacks;
    },
    getResizeObserverCallback: () => resizeObserverCallback,
    setResizeObserverCallback: (callback: ResizeObserverCallback | null) => {
      resizeObserverCallback = callback;
    }
  };
});

vi.mock('../src/app/viewer-app-core', () => ({
  ViewerAppCore: class {
    getState(): object {
      return mocks.coreState;
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

    dispatch(intent: object): void {
      mocks.coreDispatch(intent);
    }
    issueRequestId(): number {
      return 1;
    }

    issueSessionId(): string {
      return 'session-1';
    }
  }
}));

vi.mock('../src/ui/viewer-ui', () => ({
  ViewerUi: class {
    constructor(callbacks: Record<string, unknown>) {
      mocks.setUiCallbacks(callbacks);
    }

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
    readonly setMetadata = vi.fn();
    readonly setRoiReadout = vi.fn();
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
    readonly readExportPixels = mocks.rendererReadExportPixels;
  }
}));

vi.mock('../src/interaction/image-geometry', () => ({
  preserveImagePanOnViewportChange: vi.fn((state, previousViewport, nextViewport) => ({
    panX: state.panX + (
      (nextViewport.left + nextViewport.width * 0.5) -
      (previousViewport.left + previousViewport.width * 0.5)
    ) / state.zoom,
    panY: state.panY + (
      (nextViewport.top + nextViewport.height * 0.5) -
      (previousViewport.top + previousViewport.height * 0.5)
    ) / state.zoom
  }))
}));

vi.mock('../src/interaction/viewer-interaction', () => ({
  ViewerInteraction: class {
    readonly destroy = mocks.interactionDestroy;
    readonly setPanoramaKeyboardOrbitInput = mocks.interactionSetPanoramaKeyboardOrbitInput;
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
    readonly getActiveColormapLutForState = mocks.displayGetActiveColormapLutForState;
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
    readonly prepareActiveSession = mocks.renderCachePrepareActiveSession;
    readonly requestDisplayLuminanceRange = vi.fn(() => ({
      displayLuminanceRange: null,
      pending: false
    }));
    readonly getCachedLuminanceRange = vi.fn(() => null);
    readonly trackSession = vi.fn();
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

vi.mock('../src/colormaps', () => ({
  getColormapAsset: mocks.getColormapAsset,
  loadColormapLut: mocks.loadColormapLut
}));

vi.mock('../src/export-image', () => ({
  buildColormapExportPixels: mocks.buildColormapExportPixels,
  createPngBlobFromPixels: mocks.createPngBlobFromPixels
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  mocks.resetCoreState();
  mocks.setUiCallbacks(null);
  mocks.viewerRect.left = 0;
  mocks.viewerRect.top = 0;
  mocks.viewerRect.width = 320;
  mocks.viewerRect.height = 180;
  mocks.setResizeObserverCallback(null);
  mocks.rendererReadExportPixels.mockImplementation(() => ({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255])
  }));
  mocks.renderCachePrepareActiveSession.mockImplementation(() => ({
    textureRevisionKey: '',
    textureDirty: false
  }));
  mocks.displayGetActiveColormapLutForState.mockImplementation(() => null);
  mocks.getColormapAsset.mockImplementation((registry: { assets?: Array<{ label: string; file: string }> }, id: string) => {
    const index = Number(id);
    return Number.isInteger(index) ? registry.assets?.[index] ?? null : null;
  });
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

  it('routes panorama keyboard orbit callbacks to the live interaction instance', async () => {
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
    const callbacks = mocks.getUiCallbacks() as {
      onPanoramaKeyboardOrbitInputChange: (input: {
        up: boolean;
        left: boolean;
        down: boolean;
        right: boolean;
      }) => void;
    };

    callbacks.onPanoramaKeyboardOrbitInputChange({
      up: false,
      left: false,
      down: false,
      right: true
    });

    expect(mocks.interactionSetPanoramaKeyboardOrbitInput).toHaveBeenCalledWith({
      up: false,
      left: false,
      down: false,
      right: true
    });

    app.dispose();
  });

  it('exports registered colormaps as PNG gradients and triggers a download', async () => {
    vi.useFakeTimers();

    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const createObjectURL = vi.fn(() => 'blob:colormap');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'append');

    const registry = {
      defaultId: '0',
      assets: [{ label: 'Viridis', file: 'colormaps/viridis.npy' }],
      options: [{ id: '0', label: 'Viridis' }]
    };
    const lut = {
      id: '0',
      label: 'Viridis',
      entryCount: 2,
      rgba8: new Uint8Array([
        0, 0, 0, 255,
        255, 255, 255, 255
      ])
    };
    const pixels = {
      width: 8,
      height: 2,
      data: new Uint8ClampedArray(8 * 2 * 4)
    };
    const blob = new Blob(['png'], { type: 'image/png' });
    mocks.coreState.colormapRegistry = registry;
    mocks.loadColormapLut.mockResolvedValue(lut);
    mocks.buildColormapExportPixels.mockReturnValue(pixels);
    mocks.createPngBlobFromPixels.mockResolvedValue(blob);

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    const callbacks = mocks.getUiCallbacks() as {
      onExportColormap: (request: {
        colormapId: string;
        width: number;
        height: number;
        orientation: 'horizontal' | 'vertical';
        filename: string;
        format: 'png';
      }) => Promise<void>;
    };

    await expect(callbacks.onExportColormap({
      colormapId: '0',
      width: 8,
      height: 2,
      orientation: 'horizontal',
      filename: 'viridis.png',
      format: 'png'
    })).resolves.toBeUndefined();

    expect(mocks.loadColormapLut).toHaveBeenCalledWith(registry, '0', undefined);
    expect(mocks.buildColormapExportPixels).toHaveBeenCalledWith({
      lut,
      width: 8,
      height: 2,
      orientation: 'horizontal'
    });
    expect(mocks.createPngBlobFromPixels).toHaveBeenCalledWith(pixels);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement | undefined;
    expect(anchor?.download).toBe('viridis.png');
    expect(anchor?.href).toBe('blob:colormap');

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:colormap');

    app.dispose();
  });

  it('resolves colormap preview pixels without creating a blob or triggering a download', async () => {
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const registry = {
      defaultId: '0',
      assets: [{ label: 'Viridis', file: 'colormaps/viridis.npy' }],
      options: [{ id: '0', label: 'Viridis' }]
    };
    const lut = {
      id: '0',
      label: 'Viridis',
      entryCount: 2,
      rgba8: new Uint8Array([
        0, 0, 0, 255,
        255, 255, 255, 255
      ])
    };
    const pixels = {
      width: 256,
      height: 16,
      data: new Uint8ClampedArray(256 * 16 * 4)
    };
    mocks.coreState.colormapRegistry = registry;
    mocks.loadColormapLut.mockResolvedValue(lut);
    mocks.buildColormapExportPixels.mockReturnValue(pixels);

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    const callbacks = mocks.getUiCallbacks() as {
      onResolveExportColormapPreview: (request: {
        colormapId: string;
        width: number;
        height: number;
        orientation: 'horizontal' | 'vertical';
      }, signal: AbortSignal) => Promise<typeof pixels>;
    };
    const abortController = new AbortController();

    await expect(callbacks.onResolveExportColormapPreview({
      colormapId: '0',
      width: 1024,
      height: 64,
      orientation: 'horizontal'
    }, abortController.signal)).resolves.toEqual(pixels);

    expect(mocks.loadColormapLut).toHaveBeenCalledWith(registry, '0', abortController.signal);
    expect(mocks.buildColormapExportPixels).toHaveBeenCalledWith({
      lut,
      width: 256,
      height: 16,
      orientation: 'horizontal'
    });
    expect(mocks.createPngBlobFromPixels).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();

    app.dispose();
  });

  it('surfaces colormap export failures when no registry is available', async () => {
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
    const callbacks = mocks.getUiCallbacks() as {
      onExportColormap: (request: {
        colormapId: string;
        width: number;
        height: number;
        orientation: 'horizontal' | 'vertical';
        filename: string;
        format: 'png';
      }) => Promise<void>;
    };

    await expect(callbacks.onExportColormap({
      colormapId: '0',
      width: 8,
      height: 2,
      orientation: 'horizontal',
      filename: 'viridis.png',
      format: 'png'
    })).rejects.toThrow('No colormaps are available.');

    expect(mocks.coreDispatch).toHaveBeenCalledWith({
      type: 'errorSet',
      message: 'No colormaps are available.'
    });

    app.dispose();
  });

  it('surfaces preview failures when no registry is available without setting a global error', async () => {
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
    const callbacks = mocks.getUiCallbacks() as {
      onResolveExportColormapPreview: (request: {
        colormapId: string;
        width: number;
        height: number;
        orientation: 'horizontal' | 'vertical';
      }, signal: AbortSignal) => Promise<unknown>;
    };

    await expect(callbacks.onResolveExportColormapPreview({
      colormapId: '0',
      width: 8,
      height: 2,
      orientation: 'horizontal'
    }, new AbortController().signal)).rejects.toThrow('No colormaps are available.');

    expect(mocks.coreDispatch).not.toHaveBeenCalledWith({
      type: 'errorSet',
      message: 'No colormaps are available.'
    });

    app.dispose();
  });
});
