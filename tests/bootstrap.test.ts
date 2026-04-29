// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';

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
    activeImageStats: null,
    loadedColormapId: null,
    stokesDisplayRestoreStates: {},
    autoFitImageOnSelect: false,
    autoExposureEnabled: false,
    autoExposurePercentile: 99.5,
    rulersVisible: false,
    pendingAutoExposureRequestId: null,
    pendingAutoExposureRequestKey: null,
    pendingImageStatsRequestId: null,
    pendingImageStatsRequestKey: null,
    sessionState: {
      exposureEv: 0,
      viewerMode: 'image',
      visualizationMode: 'rgb',
      activeColormapId: '0',
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false,
      stokesDegreeModulation: { aolp: false, cop: true, top: true },
      stokesAolpDegreeModulationMode: 'value',
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
  const interactionSetViewerKeyboardNavigationInput = vi.fn();
  const interactionSetViewerKeyboardZoomInput = vi.fn();
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
  const findColormapIdByLabel = vi.fn((
    registry: { options?: Array<{ id: string; label: string }> },
    label: string
  ) => {
    return registry.options?.find((option) => option.label.toLowerCase() === label.toLowerCase())?.id ?? null;
  });
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
  let viewerContainer: HTMLElement | null = null;

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
    interactionSetViewerKeyboardNavigationInput,
    interactionSetViewerKeyboardZoomInput,
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
    findColormapIdByLabel,
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
    },
    getViewerContainer: () => viewerContainer,
    setViewerContainer: (element: HTMLElement | null) => {
      viewerContainer = element;
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
    readonly viewerContainer: HTMLElement;

    constructor(callbacks: Record<string, unknown>) {
      this.viewerContainer = Object.assign(document.createElement('div'), {
        getBoundingClientRect: () => ({ ...mocks.viewerRect })
      });
      mocks.setViewerContainer(this.viewerContainer);
      mocks.setUiCallbacks(callbacks);
    }

    readonly glCanvas = document.createElement('canvas');
    readonly overlayCanvas = document.createElement('canvas');
    readonly probeOverlayCanvas = document.createElement('canvas');
    readonly rulerOverlaySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    readonly rulerLabelOverlay = document.createElement('div');
    readonly dispose = mocks.uiDispose;
    readonly setViewerViewportRect = vi.fn((rect: { left: number; top: number }) => {
      this.viewerContainer.style.setProperty('--viewer-checker-offset-x', `${-rect.left}px`);
      this.viewerContainer.style.setProperty('--viewer-checker-offset-y', `${-rect.top}px`);
    });
    readonly setError = vi.fn();
    readonly setLoading = vi.fn();
    readonly setRgbViewLoading = vi.fn();
    readonly setAutoFitImageOnSelect = vi.fn();
    readonly setAutoExposureEnabled = vi.fn();
    readonly setRulersVisible = vi.fn();
    readonly setDisplayCacheBudget = vi.fn();
    readonly setDisplayCacheUsage = vi.fn();
    readonly setOpenedImageOptions = vi.fn();
    readonly setExportTarget = vi.fn();
    readonly setExportBatchTarget = vi.fn();
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
    readonly setImageStats = vi.fn();
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
    readonly renderRulerOverlay = vi.fn();
    readonly setRulersVisible = vi.fn();
    readonly getViewport = vi.fn(() => ({ width: 320, height: 180 }));
    readonly clearImage = vi.fn();
    readonly setColormapTexture = vi.fn();
    readonly readExportPixels = mocks.rendererReadExportPixels;
  }
}));

vi.mock('../src/interaction/image-geometry', () => {
  function computeMockFitView(
    viewport: { width: number; height: number },
    width: number,
    height: number,
    fitInsets?: { top?: number; right?: number; bottom?: number; left?: number } | null
  ) {
    const left = sanitizeInset(fitInsets?.left);
    const right = sanitizeInset(fitInsets?.right);
    const top = sanitizeInset(fitInsets?.top);
    const bottom = sanitizeInset(fitInsets?.bottom);
    const fitWidth = Math.max(1, viewport.width - left - right);
    const fitHeight = Math.max(1, viewport.height - top - bottom);
    const centerX = left + fitWidth * 0.5;
    const centerY = top + fitHeight * 0.5;
    const zoom = Math.min(512, Math.max(0.03125, Math.min(fitWidth / width, fitHeight / height)));
    return {
      zoom,
      panX: width * 0.5 + (viewport.width * 0.5 - centerX) / zoom,
      panY: height * 0.5 + (viewport.height * 0.5 - centerY) / zoom
    };
  }

  function sanitizeInset(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  }

  return {
    computeFitView: vi.fn(computeMockFitView),
    isFitViewForViewport: vi.fn((view, viewport, width, height, fitInsets) => {
      const fitView = computeMockFitView(viewport, width, height, fitInsets);
      const epsilon = 1e-6;
      return (
        Math.abs(view.zoom - fitView.zoom) <= epsilon &&
        Math.abs(view.panX - fitView.panX) <= epsilon &&
        Math.abs(view.panY - fitView.panY) <= epsilon
      );
    }),
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
  };
});

vi.mock('../src/interaction/viewer-interaction', () => ({
  ViewerInteraction: class {
    readonly destroy = mocks.interactionDestroy;
    readonly setViewerKeyboardNavigationInput = mocks.interactionSetViewerKeyboardNavigationInput;
    readonly setViewerKeyboardZoomInput = mocks.interactionSetViewerKeyboardZoomInput;
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
    readonly requestImageStats = vi.fn(() => ({
      imageStats: null,
      pending: false
    }));
    readonly requestAutoExposure = vi.fn(() => ({
      autoExposure: null,
      pending: false
    }));
    readonly getCachedLuminanceRange = vi.fn(() => null);
    readonly getCachedImageStats = vi.fn(() => null);
    readonly resolveDisplayLuminanceRange = vi.fn(() => null);
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
  findColormapIdByLabel: mocks.findColormapIdByLabel,
  getColormapAsset: mocks.getColormapAsset,
  loadColormapLut: mocks.loadColormapLut,
  mapValueToColormapRgbBytes: vi.fn(() => [0, 0, 0]),
  modulateRgbBytesHsv: vi.fn((rgb: [number, number, number]) => rgb)
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
  mocks.setViewerContainer(null);
  mocks.rendererReadExportPixels.mockImplementation(() => ({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255])
  }));
  mocks.renderCachePrepareActiveSession.mockImplementation(() => ({
    textureRevisionKey: '',
    textureDirty: false
  }));
  mocks.interactionCoordinatorGetState.mockImplementation(() => ({
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
    const viewerContainer = mocks.getViewerContainer();
    expect(viewerContainer?.style.getPropertyValue('--viewer-checker-offset-x')).toBe('0px');
    expect(viewerContainer?.style.getPropertyValue('--viewer-checker-offset-y')).toBe('0px');
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
    expect(viewerContainer?.style.getPropertyValue('--viewer-checker-offset-x')).toBe('-40px');
    expect(viewerContainer?.style.getPropertyValue('--viewer-checker-offset-y')).toBe('-10px');

    app.dispose();
  });

  it('refits an auto-fitted image when the viewer container changes size', async () => {
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const mutableCoreState = mocks.coreState as unknown as {
      activeSessionId: string | null;
      sessions: unknown[];
    };
    mutableCoreState.activeSessionId = 'session-1';
    mutableCoreState.sessions = [{
      id: 'session-1',
      filename: 'image.exr',
      displayName: 'image.exr',
      fileSizeBytes: 4,
      source: { kind: 'url', url: '/image.exr' },
      decoded: { width: 640, height: 360, layers: [] },
      state: mocks.coreState.sessionState
    }];
    mocks.interactionCoordinatorGetState.mockImplementation(() => ({
      view: {
        zoom: 0.5,
        panX: 320,
        panY: 180,
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 100
      },
      hoveredPixel: null,
      draftRoi: null
    }));

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    mocks.interactionCoordinatorEnqueueViewPatch.mockClear();

    mocks.viewerRect.height = 146;
    mocks.getResizeObserverCallback()?.([], {} as ResizeObserver);

    expect(mocks.interactionCoordinatorEnqueueViewPatch).toHaveBeenCalledWith({
      zoom: 146 / 360,
      panX: 320,
      panY: 180
    });

    app.dispose();
  });

  it('refits an auto-fitted image against ruler insets during resize', async () => {
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const mutableCoreState = mocks.coreState as unknown as {
      activeSessionId: string | null;
      rulersVisible: boolean;
      sessions: unknown[];
    };
    mutableCoreState.activeSessionId = 'session-1';
    mutableCoreState.rulersVisible = true;
    mutableCoreState.sessions = [{
      id: 'session-1',
      filename: 'image.exr',
      displayName: 'image.exr',
      fileSizeBytes: 4,
      source: { kind: 'url', url: '/image.exr' },
      decoded: { width: 640, height: 360, layers: [] },
      state: mocks.coreState.sessionState
    }];
    const previousZoom = (mocks.viewerRect.height - 24) / 360;
    mocks.interactionCoordinatorGetState.mockImplementation(() => ({
      view: {
        zoom: previousZoom,
        panX: 320 - 12 / previousZoom,
        panY: 180 - 12 / previousZoom,
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 100
      },
      hoveredPixel: null,
      draftRoi: null
    }));

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    mocks.interactionCoordinatorEnqueueViewPatch.mockClear();

    mocks.viewerRect.height = 146;
    mocks.getResizeObserverCallback()?.([], {} as ResizeObserver);

    const patch = mocks.interactionCoordinatorEnqueueViewPatch.mock.calls.at(-1)?.[0] as
      | { zoom: number; panX: number; panY: number }
      | undefined;
    if (!patch) {
      throw new Error('Expected resize to enqueue a view patch.');
    }
    const expectedZoom = (146 - 24) / 360;
    expect(patch.zoom).toBeCloseTo(expectedZoom);
    expect(patch.panX).toBeCloseTo(320 - 12 / expectedZoom);
    expect(patch.panY).toBeCloseTo(180 - 12 / expectedZoom);

    app.dispose();
  });

  it('preserves manual image alignment instead of refitting during resize', async () => {
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const mutableCoreState = mocks.coreState as unknown as {
      activeSessionId: string | null;
      sessions: unknown[];
    };
    mutableCoreState.activeSessionId = 'session-1';
    mutableCoreState.sessions = [{
      id: 'session-1',
      filename: 'image.exr',
      displayName: 'image.exr',
      fileSizeBytes: 4,
      source: { kind: 'url', url: '/image.exr' },
      decoded: { width: 640, height: 360, layers: [] },
      state: mocks.coreState.sessionState
    }];
    mocks.interactionCoordinatorGetState.mockImplementation(() => ({
      view: {
        zoom: 1,
        panX: 123,
        panY: 77,
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 100
      },
      hoveredPixel: null,
      draftRoi: null
    }));

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    mocks.interactionCoordinatorEnqueueViewPatch.mockClear();

    mocks.viewerRect.height = 146;
    mocks.getResizeObserverCallback()?.([], {} as ResizeObserver);

    expect(mocks.interactionCoordinatorEnqueueViewPatch).toHaveBeenCalledWith({
      panX: 123,
      panY: 60
    });

    app.dispose();
  });

  it('routes viewer keyboard navigation callbacks to the live interaction instance', async () => {
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
      onViewerKeyboardNavigationInputChange: (input: {
        up: boolean;
        left: boolean;
        down: boolean;
        right: boolean;
      }) => void;
    };

    callbacks.onViewerKeyboardNavigationInputChange({
      up: false,
      left: false,
      down: false,
      right: true
    });

    expect(mocks.interactionSetViewerKeyboardNavigationInput).toHaveBeenCalledWith({
      up: false,
      left: false,
      down: false,
      right: true
    });

    app.dispose();
  });

  it('routes viewer keyboard zoom input callbacks to the live interaction instance', async () => {
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
      onViewerKeyboardZoomInputChange: (input: { zoomIn: boolean; zoomOut: boolean }) => void;
    };

    callbacks.onViewerKeyboardZoomInputChange({ zoomIn: true, zoomOut: false });

    expect(mocks.interactionSetViewerKeyboardZoomInput).toHaveBeenCalledWith({
      zoomIn: true,
      zoomOut: false
    });

    app.dispose();
  });

  it('routes manual viewer state edits through app state dispatch', async () => {
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
      onViewerViewStateChange: (patch: { zoom: number }) => void;
    };

    callbacks.onViewerViewStateChange({ zoom: 3 });

    expect(mocks.coreDispatch).toHaveBeenCalledWith({
      type: 'viewerStateEdited',
      patch: { zoom: 3 }
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

  it('resolves image preview pixels without creating a blob or triggering a download', async () => {
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const session = {
      id: 'session-1',
      filename: 'image.exr',
      displayName: 'image.exr',
      fileSizeBytes: 3,
      source: {
        kind: 'url',
        url: '/image.exr'
      },
      decoded: {
        width: 1024,
        height: 512,
        layers: []
      },
      state: mocks.coreState.sessionState
    };
    const pixels = {
      width: 256,
      height: 128,
      data: new Uint8ClampedArray(256 * 128 * 4)
    };
    const mutableCoreState = mocks.coreState as unknown as {
      activeSessionId: string | null;
      sessions: unknown[];
    };
    mutableCoreState.activeSessionId = 'session-1';
    mutableCoreState.sessions = [session];
    mocks.rendererReadExportPixels.mockReturnValue(pixels);

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    const callbacks = mocks.getUiCallbacks() as {
      onResolveExportImagePreview: (request: unknown, signal: AbortSignal) => Promise<typeof pixels>;
    };
    const abortController = new AbortController();

    await expect(callbacks.onResolveExportImagePreview({ mode: 'image' }, abortController.signal)).resolves.toEqual(pixels);

    expect(mocks.renderCachePrepareActiveSession).toHaveBeenCalledWith(session, mocks.coreState.sessionState);
    expect(mocks.rendererReadExportPixels).toHaveBeenCalledWith(expect.objectContaining({
      sourceWidth: 1024,
      sourceHeight: 512,
      outputWidth: 256,
      outputHeight: 128
    }));
    expect(mocks.createPngBlobFromPixels).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();

    app.dispose();
  });

  it('resolves batch export preview pixels as a bounded full-image thumbnail', async () => {
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const rgbSelection = {
      kind: 'channelRgb',
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };
    const { createPlanarChannelStorage } = await import('../src/channel-storage');
    const pixelCount = 192 * 48;
    const layer = {
      name: null,
      channelNames: ['R', 'G', 'B'],
      channelStorage: createPlanarChannelStorage({
        R: new Float32Array(pixelCount).fill(1),
        G: new Float32Array(pixelCount).fill(0.5),
        B: new Float32Array(pixelCount).fill(0.25)
      }, ['R', 'G', 'B']),
      analysis: {
        displayLuminanceRangeBySelectionKey: {},
        finiteRangeByChannel: {}
      }
    };
    const session = {
      id: 'session-1',
      filename: 'beauty.exr',
      displayName: 'beauty.exr',
      fileSizeBytes: 3,
      source: { kind: 'url', url: '/beauty.exr' },
      decoded: {
        width: 192,
        height: 48,
        layers: [layer]
      },
      state: mocks.coreState.sessionState
    };
    const mutableCoreState = mocks.coreState as unknown as {
      activeSessionId: string | null;
      sessions: unknown[];
      sessionState: { displaySelection: unknown };
    };
    mutableCoreState.activeSessionId = 'session-1';
    mutableCoreState.sessions = [session];
    mutableCoreState.sessionState.displaySelection = rgbSelection;

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    const callbacks = mocks.getUiCallbacks() as {
      onResolveExportImageBatchPreview: (request: {
        sessionId: string;
        activeLayer: number;
        displaySelection: typeof rgbSelection;
        channelLabel: string;
      }, signal: AbortSignal) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
    };
    const abortController = new AbortController();

    const pixels = await callbacks.onResolveExportImageBatchPreview({
      sessionId: 'session-1',
      activeLayer: 0,
      displaySelection: rgbSelection,
      channelLabel: 'RGB'
    }, abortController.signal);

    expect(pixels.width).toBe(96);
    expect(pixels.height).toBe(24);
    expect(pixels.data).toHaveLength(96 * 24 * 4);

    expect(mocks.renderCachePrepareActiveSession).not.toHaveBeenCalled();
    expect(mocks.rendererReadExportPixels).not.toHaveBeenCalled();
    expect(mocks.createPngBlobFromPixels).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();

    app.dispose();
  });

  it('resolves screenshot batch previews through the renderer with bounded output', async () => {
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const rgbSelection = {
      kind: 'channelRgb',
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };
    const layer = {
      name: null,
      channelNames: ['R', 'G', 'B'],
      channelStorage: {},
      analysis: {
        displayLuminanceRangeBySelectionKey: {},
        finiteRangeByChannel: {}
      }
    };
    const session = {
      id: 'session-1',
      filename: 'beauty.exr',
      displayName: 'beauty.exr',
      fileSizeBytes: 3,
      source: { kind: 'url', url: '/beauty.exr' },
      decoded: {
        width: 192,
        height: 48,
        layers: [layer]
      },
      state: mocks.coreState.sessionState
    };
    const pixels = {
      width: 96,
      height: 48,
      data: new Uint8ClampedArray(96 * 48 * 4)
    };
    const mutableCoreState = mocks.coreState as unknown as {
      activeSessionId: string | null;
      sessions: unknown[];
      sessionState: Record<string, unknown>;
      interactionState: { view: Record<string, unknown> };
    };
    mutableCoreState.activeSessionId = 'session-1';
    mutableCoreState.sessions = [session];
    Object.assign(mutableCoreState.sessionState, {
      displaySelection: rgbSelection,
      viewerMode: 'image'
    });
    Object.assign(mutableCoreState.interactionState.view, {
      zoom: 3,
      panX: 12,
      panY: 6
    });
    mocks.rendererReadExportPixels.mockReturnValue(pixels);

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    const callbacks = mocks.getUiCallbacks() as {
      onResolveExportImageBatchPreview: (request: {
        sessionId: string;
        activeLayer: number;
        displaySelection: typeof rgbSelection;
        channelLabel: string;
        mode: 'screenshot';
        rect: { x: number; y: number; width: number; height: number };
        sourceViewport: { width: number; height: number };
        outputWidth: number;
        outputHeight: number;
      }, signal: AbortSignal) => Promise<typeof pixels>;
    };
    const abortController = new AbortController();

    await expect(callbacks.onResolveExportImageBatchPreview({
      sessionId: 'session-1',
      activeLayer: 0,
      displaySelection: rgbSelection,
      channelLabel: 'RGB',
      mode: 'screenshot',
      rect: { x: 8, y: 4, width: 120, height: 60 },
      sourceViewport: { width: 240, height: 120 },
      outputWidth: 240,
      outputHeight: 120
    }, abortController.signal)).resolves.toBe(pixels);

    expect(mocks.renderCachePrepareActiveSession).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ activeLayer: 0, displaySelection: rgbSelection })
    );
    expect(mocks.rendererReadExportPixels).toHaveBeenCalledWith(expect.objectContaining({
      sourceWidth: 192,
      sourceHeight: 48,
      outputWidth: 96,
      outputHeight: 48,
      screenshot: {
        rect: { x: 8, y: 4, width: 120, height: 60 },
        sourceViewport: { width: 240, height: 120 }
      },
      state: expect.objectContaining({
        viewerMode: 'image',
        zoom: 3,
        panX: 12,
        panY: 6
      })
    }));
    expect(mocks.createPngBlobFromPixels).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();

    app.dispose();
  });

  it('resolves normal batch previews without inheriting the active Stokes colormap', async () => {
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    const rgbSelection = {
      kind: 'channelRgb',
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };
    const stokesSelection = {
      kind: 'stokesAngle',
      parameter: 'aolp',
      source: { kind: 'scalar' }
    };
    const { createPlanarChannelStorage } = await import('../src/channel-storage');
    const pixelCount = 16 * 8;
    const layer = {
      name: null,
      channelNames: ['R', 'G', 'B', 'S0', 'S1', 'S2', 'S3'],
      channelStorage: createPlanarChannelStorage({
        R: new Float32Array(pixelCount).fill(1),
        G: new Float32Array(pixelCount).fill(0.5),
        B: new Float32Array(pixelCount).fill(0.25),
        S0: new Float32Array(pixelCount).fill(1),
        S1: new Float32Array(pixelCount).fill(0.25),
        S2: new Float32Array(pixelCount).fill(0.5),
        S3: new Float32Array(pixelCount).fill(0)
      }, ['R', 'G', 'B', 'S0', 'S1', 'S2', 'S3']),
      analysis: {
        displayLuminanceRangeBySelectionKey: {},
        finiteRangeByChannel: {}
      }
    };
    const session = {
      id: 'session-1',
      filename: 'stokes.exr',
      displayName: 'stokes.exr',
      fileSizeBytes: 3,
      source: { kind: 'url', url: '/stokes.exr' },
      decoded: {
        width: 16,
        height: 8,
        layers: [layer]
      },
      state: mocks.coreState.sessionState
    };
    const mutableCoreState = mocks.coreState as unknown as {
      activeSessionId: string | null;
      sessions: unknown[];
      sessionState: Record<string, unknown>;
      stokesDisplayRestoreStates: Record<string, unknown>;
    };
    mutableCoreState.activeSessionId = 'session-1';
    mutableCoreState.sessions = [session];
    Object.assign(mutableCoreState.sessionState, {
      visualizationMode: 'colormap',
      activeColormapId: '1',
      colormapRange: { min: 0, max: Math.PI },
      colormapRangeMode: 'oneTime',
      displaySelection: stokesSelection
    });
    mutableCoreState.stokesDisplayRestoreStates = {
      'session-1': {
        visualizationMode: 'rgb',
        activeColormapId: '0',
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        colormapZeroCentered: false
      }
    };

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    const callbacks = mocks.getUiCallbacks() as {
      onResolveExportImageBatchPreview: (request: {
        sessionId: string;
        activeLayer: number;
        displaySelection: typeof rgbSelection;
        channelLabel: string;
      }, signal: AbortSignal) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
    };
    const abortController = new AbortController();

    const pixels = await callbacks.onResolveExportImageBatchPreview({
      sessionId: 'session-1',
      activeLayer: 0,
      displaySelection: rgbSelection,
      channelLabel: 'RGB'
    }, abortController.signal);

    expect(pixels.width).toBeGreaterThan(0);
    expect(pixels.height).toBeGreaterThan(0);
    expect(mocks.loadColormapLut).not.toHaveBeenCalled();

    app.dispose();
  });

  it('exports selected image batch entries as one ZIP download', async () => {
    vi.useFakeTimers();

    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const createObjectURL = vi.fn<(_: Blob) => string>(() => 'blob:batch');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'append');

    const rgbSelection = {
      kind: 'channelRgb',
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };
    const depthSelection = {
      kind: 'channelMono',
      channel: 'Z',
      alpha: null
    };
    const layer = {
      name: null,
      channelNames: ['R', 'G', 'B', 'Z'],
      channelStorage: {},
      analysis: {
        displayLuminanceRangeBySelectionKey: {},
        finiteRangeByChannel: {}
      }
    };
    const session1 = {
      id: 'session-1',
      filename: 'beauty.exr',
      displayName: 'beauty.exr',
      fileSizeBytes: 3,
      source: { kind: 'url', url: '/beauty.exr' },
      decoded: {
        width: 2,
        height: 1,
        layers: [layer]
      },
      state: mocks.coreState.sessionState
    };
    const session2 = {
      id: 'session-2',
      filename: 'depth.exr',
      displayName: 'depth.exr',
      fileSizeBytes: 3,
      source: { kind: 'url', url: '/depth.exr' },
      decoded: {
        width: 2,
        height: 1,
        layers: [layer]
      },
      state: {
        ...mocks.coreState.sessionState,
        displaySelection: depthSelection
      }
    };
    const mutableCoreState = mocks.coreState as unknown as {
      activeSessionId: string | null;
      sessions: unknown[];
      sessionState: { displaySelection: unknown };
    };
    mutableCoreState.activeSessionId = 'session-1';
    mutableCoreState.sessions = [session1, session2];
    mutableCoreState.sessionState.displaySelection = rgbSelection;

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mocks.createPngBlobFromPixels.mockResolvedValue(new Blob([pngBytes], { type: 'image/png' }));

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    const callbacks = mocks.getUiCallbacks() as {
      onExportImageBatch: (request: {
        archiveFilename: string;
        entries: Array<{
          sessionId: string;
          activeLayer: number;
          displaySelection: typeof rgbSelection | typeof depthSelection;
          channelLabel: string;
          outputFilename: string;
        }>;
        format: 'png-zip';
      }, signal: AbortSignal) => Promise<void>;
    };

    await expect(callbacks.onExportImageBatch({
      archiveFilename: 'openexr-export.zip',
      format: 'png-zip',
      entries: [
        {
          sessionId: 'session-1',
          activeLayer: 0,
          displaySelection: rgbSelection,
          channelLabel: 'RGB',
          outputFilename: 'beauty.RGB.png'
        },
        {
          sessionId: 'session-2',
          activeLayer: 0,
          displaySelection: depthSelection,
          channelLabel: 'Z',
          outputFilename: 'depth.Z.png'
        }
      ]
    }, new AbortController().signal)).resolves.toBeUndefined();

    expect(mocks.renderCachePrepareActiveSession).toHaveBeenCalledWith(
      session1,
      expect.objectContaining({ activeLayer: 0, displaySelection: rgbSelection })
    );
    expect(mocks.renderCachePrepareActiveSession).toHaveBeenCalledWith(
      session2,
      expect.objectContaining({ activeLayer: 0, displaySelection: depthSelection })
    );
    expect(mocks.rendererReadExportPixels).toHaveBeenCalledTimes(2);
    expect(mocks.createPngBlobFromPixels).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement | undefined;
    expect(anchor?.download).toBe('openexr-export.zip');

    const zipBlob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const entries = unzipSync(new Uint8Array(await zipBlob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['beauty.RGB.png', 'depth.Z.png']);
    expect(entries['beauty.RGB.png']?.subarray(0, 8)).toEqual(pngBytes);
    expect(entries['depth.Z.png']?.subarray(0, 8)).toEqual(pngBytes);

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:batch');

    app.dispose();
  });

  it('exports screenshot batch entries with the active viewer crop and view state', async () => {
    vi.useFakeTimers();

    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const createObjectURL = vi.fn<(_: Blob) => string>(() => 'blob:screenshot-batch');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'append');

    const rgbSelection = {
      kind: 'channelRgb',
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };
    const depthSelection = {
      kind: 'channelMono',
      channel: 'Z',
      alpha: null
    };
    const layer = {
      name: null,
      channelNames: ['R', 'G', 'B', 'Z'],
      channelStorage: {},
      analysis: {
        displayLuminanceRangeBySelectionKey: {},
        finiteRangeByChannel: {}
      }
    };
    const session1 = {
      id: 'session-1',
      filename: 'beauty.exr',
      displayName: 'beauty.exr',
      fileSizeBytes: 3,
      source: { kind: 'url', url: '/beauty.exr' },
      decoded: {
        width: 2,
        height: 1,
        layers: [layer]
      },
      state: mocks.coreState.sessionState
    };
    const session2 = {
      id: 'session-2',
      filename: 'depth.exr',
      displayName: 'depth.exr',
      fileSizeBytes: 3,
      source: { kind: 'url', url: '/depth.exr' },
      decoded: {
        width: 2,
        height: 1,
        layers: [layer]
      },
      state: {
        ...mocks.coreState.sessionState,
        displaySelection: depthSelection
      }
    };
    const mutableCoreState = mocks.coreState as unknown as {
      activeSessionId: string | null;
      sessions: unknown[];
      sessionState: Record<string, unknown>;
      interactionState: { view: Record<string, unknown> };
    };
    mutableCoreState.activeSessionId = 'session-1';
    mutableCoreState.sessions = [session1, session2];
    Object.assign(mutableCoreState.sessionState, {
      displaySelection: rgbSelection,
      viewerMode: 'panorama'
    });
    Object.assign(mutableCoreState.interactionState.view, {
      zoom: 5,
      panX: 7,
      panY: 9,
      panoramaYawDeg: 21,
      panoramaPitchDeg: -3,
      panoramaHfovDeg: 80
    });

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    mocks.createPngBlobFromPixels.mockResolvedValue(new Blob([pngBytes], { type: 'image/png' }));

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    const callbacks = mocks.getUiCallbacks() as {
      onExportImageBatch: (request: {
        archiveFilename: string;
        entries: Array<{
          sessionId: string;
          activeLayer: number;
          displaySelection: typeof rgbSelection | typeof depthSelection;
          channelLabel: string;
          mode: 'screenshot';
          rect: { x: number; y: number; width: number; height: number };
          sourceViewport: { width: number; height: number };
          outputWidth: number;
          outputHeight: number;
          outputFilename: string;
        }>;
        format: 'png-zip';
      }, signal: AbortSignal) => Promise<void>;
    };

    await expect(callbacks.onExportImageBatch({
      archiveFilename: 'openexr-screenshot-export.zip',
      format: 'png-zip',
      entries: [
        {
          sessionId: 'session-1',
          activeLayer: 0,
          displaySelection: rgbSelection,
          channelLabel: 'RGB',
          mode: 'screenshot',
          rect: { x: 10, y: 5, width: 40, height: 20 },
          sourceViewport: { width: 100, height: 50 },
          outputWidth: 80,
          outputHeight: 40,
          outputFilename: 'beauty-screenshot.RGB.png'
        },
        {
          sessionId: 'session-2',
          activeLayer: 0,
          displaySelection: depthSelection,
          channelLabel: 'Z',
          mode: 'screenshot',
          rect: { x: 10, y: 5, width: 40, height: 20 },
          sourceViewport: { width: 100, height: 50 },
          outputWidth: 80,
          outputHeight: 40,
          outputFilename: 'depth-screenshot.Z.png'
        }
      ]
    }, new AbortController().signal)).resolves.toBeUndefined();

    expect(mocks.rendererReadExportPixels).toHaveBeenCalledTimes(2);
    expect(mocks.rendererReadExportPixels).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceWidth: 2,
      sourceHeight: 1,
      outputWidth: 80,
      outputHeight: 40,
      screenshot: {
        rect: { x: 10, y: 5, width: 40, height: 20 },
        sourceViewport: { width: 100, height: 50 }
      },
      state: expect.objectContaining({
        displaySelection: rgbSelection,
        viewerMode: 'panorama',
        zoom: 5,
        panX: 7,
        panY: 9,
        panoramaYawDeg: 21,
        panoramaPitchDeg: -3,
        panoramaHfovDeg: 80
      })
    }));
    expect(mocks.rendererReadExportPixels).toHaveBeenNthCalledWith(2, expect.objectContaining({
      outputWidth: 80,
      outputHeight: 40,
      screenshot: {
        rect: { x: 10, y: 5, width: 40, height: 20 },
        sourceViewport: { width: 100, height: 50 }
      },
      state: expect.objectContaining({
        displaySelection: depthSelection,
        viewerMode: 'panorama',
        zoom: 5,
        panX: 7,
        panY: 9
      })
    }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement | undefined;
    expect(anchor?.download).toBe('openexr-screenshot-export.zip');

    const zipBlob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const entries = unzipSync(new Uint8Array(await zipBlob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['beauty-screenshot.RGB.png', 'depth-screenshot.Z.png']);
    expect(entries['beauty-screenshot.RGB.png']?.subarray(0, 4)).toEqual(pngBytes);
    expect(entries['depth-screenshot.Z.png']?.subarray(0, 4)).toEqual(pngBytes);

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:screenshot-batch');

    app.dispose();
  });

  it('isolates normal batch export entries from the active Stokes colormap', async () => {
    vi.useFakeTimers();

    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        mocks.setResizeObserverCallback(callback);
      }

      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn<(_: Blob) => string>(() => 'blob:batch-stokes'),
      revokeObjectURL: vi.fn()
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(document.body, 'append');

    const registry = {
      defaultId: '0',
      assets: [
        { label: 'Viridis', file: 'viridis.npy' },
        { label: 'HSV', file: 'hsv.npy' },
        { label: 'Secondary', file: 'secondary.npy' }
      ],
      options: [
        { id: '0', label: 'Viridis' },
        { id: '1', label: 'HSV' },
        { id: '2', label: 'Secondary' }
      ]
    };
    const luts = {
      '1': { id: '1', label: 'HSV', entryCount: 2, rgba8: new Uint8Array([1, 0, 0, 255, 0, 1, 0, 255]) },
      '2': { id: '2', label: 'Secondary', entryCount: 2, rgba8: new Uint8Array([0, 0, 1, 255, 1, 1, 0, 255]) }
    };
    mocks.loadColormapLut.mockImplementation(async (_registry: unknown, id: keyof typeof luts) => luts[id]);

    const rgbSelection = {
      kind: 'channelRgb',
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };
    const stokesSelection = {
      kind: 'stokesAngle',
      parameter: 'aolp',
      source: { kind: 'scalar' }
    };
    const layer = {
      name: null,
      channelNames: ['R', 'G', 'B', 'S0', 'S1', 'S2', 'S3'],
      channelStorage: {},
      analysis: {
        displayLuminanceRangeBySelectionKey: {},
        finiteRangeByChannel: {}
      }
    };
    const session1 = {
      id: 'session-1',
      filename: 'active.exr',
      displayName: 'active.exr',
      fileSizeBytes: 3,
      source: { kind: 'url', url: '/active.exr' },
      decoded: {
        width: 2,
        height: 1,
        layers: [layer]
      },
      state: mocks.coreState.sessionState
    };
    const session2 = {
      id: 'session-2',
      filename: 'inactive.exr',
      displayName: 'inactive.exr',
      fileSizeBytes: 3,
      source: { kind: 'url', url: '/inactive.exr' },
      decoded: {
        width: 2,
        height: 1,
        layers: [layer]
      },
      state: {
        ...mocks.coreState.sessionState,
        visualizationMode: 'colormap',
        activeColormapId: '2',
        colormapRange: { min: 0.2, max: 0.8 },
        colormapRangeMode: 'oneTime',
        displaySelection: rgbSelection
      }
    };
    const mutableCoreState = mocks.coreState as unknown as {
      activeSessionId: string | null;
      sessions: unknown[];
      colormapRegistry: typeof registry;
      loadedColormapId: string | null;
      activeColormapLut: unknown;
      sessionState: Record<string, unknown>;
      stokesDisplayRestoreStates: Record<string, unknown>;
    };
    mutableCoreState.activeSessionId = 'session-1';
    mutableCoreState.sessions = [session1, session2];
    mutableCoreState.colormapRegistry = registry;
    mutableCoreState.loadedColormapId = '1';
    mutableCoreState.activeColormapLut = luts['1'];
    Object.assign(mutableCoreState.sessionState, {
      visualizationMode: 'colormap',
      activeColormapId: '1',
      colormapRange: { min: 0, max: Math.PI },
      colormapRangeMode: 'oneTime',
      colormapZeroCentered: false,
      displaySelection: stokesSelection
    });
    mutableCoreState.stokesDisplayRestoreStates = {
      'session-1': {
        visualizationMode: 'rgb',
        activeColormapId: '0',
        colormapRange: null,
        colormapRangeMode: 'alwaysAuto',
        colormapZeroCentered: false
      }
    };

    mocks.createPngBlobFromPixels.mockResolvedValue(new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' }));

    const { bootstrapApp } = await import('../src/app/bootstrap');
    const app = await bootstrapApp();
    const callbacks = mocks.getUiCallbacks() as {
      onExportImageBatch: (request: {
        archiveFilename: string;
        entries: Array<{
          sessionId: string;
          activeLayer: number;
          displaySelection: typeof rgbSelection | typeof stokesSelection;
          channelLabel: string;
          outputFilename: string;
        }>;
        format: 'png-zip';
      }, signal: AbortSignal) => Promise<void>;
    };

    await expect(callbacks.onExportImageBatch({
      archiveFilename: 'openexr-export.zip',
      format: 'png-zip',
      entries: [
        {
          sessionId: 'session-1',
          activeLayer: 0,
          displaySelection: rgbSelection,
          channelLabel: 'RGB',
          outputFilename: 'active.RGB.png'
        },
        {
          sessionId: 'session-2',
          activeLayer: 0,
          displaySelection: rgbSelection,
          channelLabel: 'RGB',
          outputFilename: 'inactive.RGB.png'
        },
        {
          sessionId: 'session-1',
          activeLayer: 0,
          displaySelection: stokesSelection,
          channelLabel: 'Stokes AoLP',
          outputFilename: 'active.AoLP.png'
        }
      ]
    }, new AbortController().signal)).resolves.toBeUndefined();

    const preparedStates = mocks.renderCachePrepareActiveSession.mock.calls.map((call) => {
      return (call as unknown[])[1];
    });
    expect(preparedStates[0]).toMatchObject({
      displaySelection: rgbSelection,
      visualizationMode: 'rgb',
      activeColormapId: '0',
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false
    });
    expect(preparedStates[1]).toMatchObject({
      displaySelection: rgbSelection,
      visualizationMode: 'colormap',
      activeColormapId: '2',
      colormapRange: { min: 0.2, max: 0.8 },
      colormapRangeMode: 'oneTime',
      colormapZeroCentered: false
    });
    expect(preparedStates[2]).toMatchObject({
      displaySelection: stokesSelection,
      visualizationMode: 'colormap',
      activeColormapId: '1',
      colormapRange: { min: 0, max: Math.PI },
      colormapRangeMode: 'oneTime',
      colormapZeroCentered: false
    });

    app.dispose();
    vi.useRealTimers();
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

  it('surfaces image preview failures without setting a global error', async () => {
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
      onResolveExportImagePreview: (request: unknown, signal: AbortSignal) => Promise<unknown>;
    };

    await expect(callbacks.onResolveExportImagePreview({ mode: 'image' }, new AbortController().signal)).rejects.toThrow('No image is active.');

    expect(mocks.coreDispatch).not.toHaveBeenCalledWith({
      type: 'errorSet',
      message: 'No image is active.'
    });

    app.dispose();
  });
});
