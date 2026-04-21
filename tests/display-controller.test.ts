import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayController } from '../src/controllers/display-controller';
import { RenderCacheService } from '../src/services/render-cache-service';
import { buildViewerStateForLayer, createInitialState, ViewerStore } from '../src/viewer-store';
import { DecodedExrImage, OpenedImageSession, ViewerState } from '../src/types';
import { createChannelRgbSelection, createLayerFromChannels, createStokesSelection } from './helpers/state-fixtures';

const colormapMocks = vi.hoisted(() => ({
  loadColormapRegistry: vi.fn(),
  getColormapOptions: vi.fn(),
  loadColormapLut: vi.fn(),
  getColormapAsset: vi.fn(),
  findColormapIdByLabel: vi.fn()
}));

vi.mock('../src/colormaps', () => ({
  DEFAULT_COLORMAP_ID: '0',
  loadColormapRegistry: colormapMocks.loadColormapRegistry,
  getColormapOptions: colormapMocks.getColormapOptions,
  loadColormapLut: colormapMocks.loadColormapLut,
  getColormapAsset: colormapMocks.getColormapAsset,
  findColormapIdByLabel: colormapMocks.findColormapIdByLabel
}));

function createDecodedImage(channelNames: string[] = ['R', 'G', 'B']): DecodedExrImage {
  const channelValues: Record<string, Float32Array> = {};
  for (const channelName of channelNames) {
    channelValues[channelName] = new Float32Array([channelName.startsWith('S') ? 0.5 : 1, 0]);
  }

  const layer = createLayerFromChannels(channelValues, 'beauty');

  return {
    width: 2,
    height: 1,
    layers: [layer]
  };
}

function createSession(decoded: DecodedExrImage): OpenedImageSession {
  const state = buildViewerStateForLayer(createInitialState(), decoded, 0);
  return {
    id: 'session-1',
    filename: 'image.exr',
    displayName: 'image.exr',
    fileSizeBytes: 16,
    source: { kind: 'url', url: '/image.exr' },
    decoded,
    state
  };
}

function createUiMock() {
  return {
    setActiveColormap: vi.fn(),
    clearImageBrowserPanels: vi.fn(),
    setDisplayCacheBudget: vi.fn(),
    setDisplayCacheUsage: vi.fn(),
    setColormapGradient: vi.fn(),
    setColormapOptions: vi.fn(),
    setColormapRange: vi.fn(),
    setError: vi.fn(),
    setExposure: vi.fn(),
    setLayerOptions: vi.fn(),
    setProbeMetadata: vi.fn(),
    setProbeReadout: vi.fn(),
    setRgbGroupOptions: vi.fn(),
    setRgbViewLoading: vi.fn(),
    setStokesDegreeModulationControl: vi.fn(),
    setViewerMode: vi.fn(),
    setVisualizationMode: vi.fn()
  };
}

function createRendererMock() {
  return {
    getViewport: vi.fn(() => ({ width: 200, height: 100 })),
    render: vi.fn(),
    setColormapTexture: vi.fn(),
    ensureLayerSourceTextures: vi.fn(),
    setDisplaySelectionBindings: vi.fn(),
    discardSessionTextures: vi.fn()
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const registry = {
  defaultId: '0',
  assets: [
    { label: 'Default', file: 'default.npy' },
    { label: 'HSV', file: 'hsv.npy' },
    { label: 'Secondary', file: 'secondary.npy' }
  ],
  options: [
    { id: '0', label: 'Default' },
    { id: '1', label: 'HSV' },
    { id: '2', label: 'Secondary' }
  ]
};

const luts = {
  '0': { id: '0', label: 'Default', entryCount: 2, rgba8: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) },
  '1': { id: '1', label: 'HSV', entryCount: 2, rgba8: new Uint8Array([1, 0, 0, 255, 0, 1, 0, 255]) },
  '2': { id: '2', label: 'Secondary', entryCount: 2, rgba8: new Uint8Array([0, 0, 1, 255, 1, 1, 0, 255]) }
};

function createController(options: {
  session?: OpenedImageSession | null;
} = {}) {
  const store = new ViewerStore(createInitialState());
  const ui = createUiMock();
  const renderer = createRendererMock();
  const session = options.session ?? null;
  const renderCache = new RenderCacheService({
    ui,
    renderer: renderer as never,
    getActiveSessionId: () => session?.id ?? null
  });

  const controller = new DisplayController({
    store,
    ui,
    renderer: renderer as never,
    renderCache,
    getActiveSession: () => session
  });

  return { controller, store, ui, renderer, session, renderCache };
}

beforeEach(() => {
  const immediateWindow = {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    setTimeout: ((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        callback();
      }
      return 1;
    }) as typeof window.setTimeout
  };

  vi.stubGlobal('window', immediateWindow);
  colormapMocks.loadColormapRegistry.mockResolvedValue(registry);
  colormapMocks.getColormapOptions.mockReturnValue(registry.options);
  colormapMocks.loadColormapLut.mockImplementation(async (_registry: unknown, id: keyof typeof luts) => luts[id]);
  colormapMocks.getColormapAsset.mockImplementation((_registry: typeof registry, id: string) => {
    return registry.assets[Number(id)] ?? null;
  });
  colormapMocks.findColormapIdByLabel.mockImplementation((_registry: typeof registry, label: string) => {
    return registry.options.find((option) => option.label.toLowerCase() === label.toLowerCase())?.id ?? null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('display controller', () => {
  it('initializes the default colormap and publishes the options to the UI', async () => {
    const { controller, store, ui, renderer } = createController();

    await controller.initialize();

    expect(ui.setColormapOptions).toHaveBeenCalledWith(registry.options, '0');
    expect(store.getState().activeColormapId).toBe('0');
    expect(renderer.setColormapTexture).toHaveBeenCalledWith(luts['0'].entryCount, luts['0'].rgba8);
  });

  it('uploads the active source textures once per layer and only rebinds the active revision once', async () => {
    const session = createSession(createDecodedImage());
    const { controller, store, renderer } = createController({ session });

    await controller.initialize();

    const previous = store.getState();
    const next = {
      ...session.state,
      visualizationMode: 'rgb' as const
    };
    store.setState(next);

    controller.handleStoreChange(store.getState(), previous);
    controller.handleStoreChange(store.getState(), store.getState());

    expect(renderer.ensureLayerSourceTextures).toHaveBeenCalledTimes(1);
    expect(renderer.setDisplaySelectionBindings).toHaveBeenCalledTimes(1);
  });

  it('ignores stale async colormap loads when a newer selection wins', async () => {
    const firstDeferred = createDeferred<(typeof luts)['1']>();
    const secondDeferred = createDeferred<(typeof luts)['2']>();
    colormapMocks.loadColormapLut.mockImplementation((_registry: unknown, id: string) => {
      if (id === '0') {
        return Promise.resolve(luts['0']);
      }
      if (id === '1') {
        return firstDeferred.promise;
      }
      return secondDeferred.promise;
    });

    const { controller, store, renderer } = createController();
    await controller.initialize();

    const first = controller.setActiveColormap('1');
    const second = controller.setActiveColormap('2');
    secondDeferred.resolve(luts['2']);
    await second;
    firstDeferred.resolve(luts['1']);
    await first;

    expect(store.getState().activeColormapId).toBe('2');
    expect(renderer.setColormapTexture).toHaveBeenLastCalledWith(luts['2'].entryCount, luts['2'].rgba8);
  });

  it('applies always-auto colormap ranges from the computed display luminance range', async () => {
    const decoded = createDecodedImage();
    const session = createSession(decoded);
    const { controller, store } = createController({ session });

    await controller.initialize();

    const previous = store.getState();
    const next: ViewerState = {
      ...session.state,
      visualizationMode: 'colormap',
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto'
    };
    store.setState(next);

    controller.handleStoreChange(store.getState(), previous);

    expect(store.getState().colormapRange).toEqual({ min: 0, max: 1 });
  });

  it('restores the saved non-stokes visualization state when returning to channels', async () => {
    const decoded = createDecodedImage(['R', 'G', 'B', 'S0', 'S1', 'S2', 'S3']);
    const session = createSession(decoded);
    const { controller, store } = createController({ session });

    await controller.initialize();

    await controller.applyDisplaySelection({
      ...createStokesSelection('aolp')
    });
    await controller.applyDisplaySelection({
      ...createChannelRgbSelection('R', 'G', 'B')
    });
    await Promise.resolve();

    expect(store.getState().visualizationMode).toBe('rgb');
    expect(store.getState().activeColormapId).toBe('0');
    expect(store.getState().displaySelection).toEqual(createChannelRgbSelection('R', 'G', 'B'));
  });

  it('clears image browser panels explicitly when there is no active session', async () => {
    const { controller, store, ui } = createController();

    await controller.initialize();
    vi.clearAllMocks();

    const previous = store.getState();
    controller.handleStoreChange(store.getState(), previous);

    expect(ui.clearImageBrowserPanels).toHaveBeenCalledTimes(1);
    expect(ui.setLayerOptions).not.toHaveBeenCalled();
    expect(ui.setRgbGroupOptions).not.toHaveBeenCalled();
  });

  it('switches viewer mode through the store and clears stale hover probes', async () => {
    const session = createSession(createDecodedImage());
    const { controller, store } = createController({ session });

    await controller.initialize();

    store.setState({
      hoveredPixel: { ix: 1, iy: 0 }
    });

    controller.setViewerMode('panorama');

    expect(store.getState().viewerMode).toBe('panorama');
    expect(store.getState().hoveredPixel).toBeNull();
  });

  it('suppresses late colormap loads after dispose', async () => {
    const deferred = createDeferred<(typeof luts)['1']>();
    colormapMocks.loadColormapLut.mockImplementation((_registry: unknown, id: string) => {
      if (id === '0') {
        return Promise.resolve(luts['0']);
      }
      return deferred.promise;
    });

    const { controller, store, renderer } = createController();
    await controller.initialize();

    const pending = controller.setActiveColormap('1');
    controller.dispose();
    deferred.resolve(luts['1']);

    await expect(pending).resolves.toBeUndefined();
    expect(store.getState().activeColormapId).toBe('0');
    expect(renderer.setColormapTexture).toHaveBeenCalledTimes(1);
  });
});
