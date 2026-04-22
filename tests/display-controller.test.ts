import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayController } from '../src/controllers/display-controller';
import { ViewerAppCore } from '../src/app/viewer-app-core';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import { DecodedExrImage, OpenedImageSession } from '../src/types';
import {
  createChannelRgbSelection,
  createLayerFromChannels,
  createStokesSelection
} from './helpers/state-fixtures';

const colormapMocks = vi.hoisted(() => ({
  loadColormapRegistry: vi.fn(),
  loadColormapLut: vi.fn(),
  getColormapAsset: vi.fn(),
  findColormapIdByLabel: vi.fn()
}));

vi.mock('../src/colormaps', () => ({
  DEFAULT_COLORMAP_ID: '0',
  loadColormapRegistry: colormapMocks.loadColormapRegistry,
  getColormapOptions: vi.fn(() => []),
  loadColormapLut: colormapMocks.loadColormapLut,
  getColormapAsset: colormapMocks.getColormapAsset,
  findColormapIdByLabel: colormapMocks.findColormapIdByLabel
}));

function createDecodedImage(channelNames: string[] = ['R', 'G', 'B']): DecodedExrImage {
  const channelValues: Record<string, Float32Array> = {};
  for (const channelName of channelNames) {
    channelValues[channelName] = new Float32Array([channelName.startsWith('S') ? 0.5 : 1, 0]);
  }

  return {
    width: 2,
    height: 1,
    layers: [createLayerFromChannels(channelValues, 'beauty')]
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

function createController(session: OpenedImageSession | null = null) {
  const core = new ViewerAppCore();
  if (session) {
    core.dispatch({
      type: 'sessionLoaded',
      session
    });
  }

  const controller = new DisplayController({ core });
  return { controller, core };
}

beforeEach(() => {
  vi.stubGlobal('window', {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: vi.fn(),
    setTimeout: ((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        callback();
      }
      return 1;
    }) as typeof window.setTimeout,
    clearTimeout: vi.fn()
  });
  colormapMocks.loadColormapRegistry.mockResolvedValue(registry);
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

describe('display controller shim', () => {
  it('initializes the default colormap into the app core', async () => {
    const { controller, core } = createController();

    await controller.initialize();

    expect(core.getState().defaultColormapId).toBe('0');
    expect(core.getState().sessionState.activeColormapId).toBe('0');
    expect(core.getState().activeColormapLut).toEqual(luts['0']);
  });

  it('ignores stale explicit colormap loads when a newer request wins', async () => {
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

    const { controller, core } = createController();
    await controller.initialize();

    const first = controller.setActiveColormap('1');
    const second = controller.setActiveColormap('2');
    secondDeferred.resolve(luts['2']);
    await second;
    firstDeferred.resolve(luts['1']);
    await first;

    expect(core.getState().sessionState.activeColormapId).toBe('2');
    expect(core.getState().loadedColormapId).toBe('2');
  });

  it('persists the requested colormap before the lut resolves', async () => {
    const deferred = createDeferred<(typeof luts)['1']>();
    colormapMocks.loadColormapLut.mockImplementation((_registry: unknown, id: string) => {
      if (id === '0') {
        return Promise.resolve(luts['0']);
      }
      return deferred.promise;
    });

    const { controller, core } = createController();
    await controller.initialize();

    const pending = controller.setActiveColormap('1');

    expect(core.getState().sessionState.activeColormapId).toBe('1');
    expect(core.getState().loadedColormapId).toBe('0');

    deferred.resolve(luts['1']);
    await pending;

    expect(core.getState().sessionState.activeColormapId).toBe('1');
    expect(core.getState().loadedColormapId).toBe('1');
  });

  it('applies stokes selection through the core and restores the previous non-stokes visualization state', async () => {
    const decoded = createDecodedImage(['R', 'G', 'B', 'S0', 'S1', 'S2', 'S3']);
    const { controller, core } = createController(createSession(decoded));

    await controller.initialize();

    await controller.applyDisplaySelection(createStokesSelection('aolp'));
    expect(core.getState().sessionState.visualizationMode).toBe('colormap');
    expect(core.getState().sessionState.activeColormapId).toBe('1');

    await controller.applyDisplaySelection(createChannelRgbSelection('R', 'G', 'B'));

    expect(core.getState().sessionState.visualizationMode).toBe('rgb');
    expect(core.getState().sessionState.activeColormapId).toBe('0');
    expect(core.getState().sessionState.displaySelection).toEqual(createChannelRgbSelection('R', 'G', 'B'));
  });

  it('suppresses late colormap loads after dispose', async () => {
    const deferred = createDeferred<(typeof luts)['1']>();
    colormapMocks.loadColormapLut.mockImplementation((_registry: unknown, id: string) => {
      if (id === '0') {
        return Promise.resolve(luts['0']);
      }
      return deferred.promise;
    });

    const { controller, core } = createController();
    await controller.initialize();

    const pending = controller.setActiveColormap('1');
    controller.dispose();
    deferred.resolve(luts['1']);

    await expect(pending).resolves.toBeUndefined();
    expect(core.getState().sessionState.activeColormapId).toBe('1');
    expect(core.getState().loadedColormapId).toBe('0');
  });
});
