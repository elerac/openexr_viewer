import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderCacheService } from '../src/services/render-cache-service';
import type { AsyncResource } from '../src/async-resource';
import {
  buildDisplayAutoExposureRevisionKey,
  buildDisplayImageStatsRevisionKey,
  buildDisplayLuminanceRevisionKey
} from '../src/display-texture';
import type { DecodedExrImage, DecodedLayer, DisplayLuminanceRange, ImageStats, OpenedImageSession } from '../src/types';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import {
  createChannelMonoSelection,
  createLayerFromChannels
} from './helpers/state-fixtures';

const MB = 1024 * 1024;

function createDecodedImage(
  width = 2,
  height = 1,
  fillByChannel: Record<string, number> = { R: 1, G: 0.5, B: 0 }
): DecodedExrImage {
  const layer = createLayerFromChannels(createFilledChannelValues(width, height, fillByChannel), 'beauty');

  return {
    width,
    height,
    layers: [layer]
  };
}

function createMultiLayerDecodedImage(
  width: number,
  height: number,
  fillByLayer: Array<Record<string, number>>
): DecodedExrImage {
  return {
    width,
    height,
    layers: fillByLayer.map((fillByChannel, layerIndex) => {
      return createLayerFromChannels(
        createFilledChannelValues(width, height, fillByChannel),
        `layer-${layerIndex}`
      );
    })
  };
}

function createFilledChannelValues(
  width: number,
  height: number,
  fillByChannel: Record<string, number>
): Record<string, Float32Array> {
  const pixelCount = width * height;

  return Object.fromEntries(
    Object.entries(fillByChannel).map(([channelName, value]) => {
      return [channelName, new Float32Array(pixelCount).fill(value)];
    })
  );
}

function createSession(id: string, decoded = createDecodedImage()): OpenedImageSession {
  return {
    id,
    filename: `${id}.exr`,
    displayName: `${id}.exr`,
    fileSizeBytes: decoded.width * decoded.height * 16,
    source: { kind: 'url', url: `/${id}.exr` },
    decoded,
    state: buildViewerStateForLayer(createInitialState(), decoded, 0)
  };
}

function createUiMock() {
  return {
    setDisplayCacheBudget: vi.fn(),
    setDisplayCacheUsage: vi.fn()
  };
}

function createRendererMock() {
  return {
    ensureLayerChannelsResident: vi.fn(
      (
        _sessionId: string,
        _layerIndex: number,
        width: number,
        height: number,
        layer: DecodedLayer,
        channelNames: string[]
      ) => channelNames.map((channelName) => ({
        channelName,
        textureBytes: width * height * Float32Array.BYTES_PER_ELEMENT,
        materializedBytes: layer.channelStorage.kind === 'interleaved-f32'
          ? width * height * Float32Array.BYTES_PER_ELEMENT
          : 0
      }))
    ),
    setDisplaySelectionBindings: vi.fn(),
    discardChannelSourceTexture: vi.fn(),
    discardLayerSourceTextures: vi.fn(),
    discardSessionTextures: vi.fn()
  };
}

function getEntries(service: RenderCacheService): Map<string, {
  pinned: boolean;
  decodedBytes: number;
  residentLayers: Map<number, {
    residentChannels: Map<string, { textureBytes: number; materializedBytes: number; lastAccessToken: number }>;
  }>;
  luminanceRangeByRevision: Map<string, AsyncResource<DisplayLuminanceRange | null>>;
  imageStatsByRevision: Map<string, AsyncResource<ImageStats | null>>;
}> {
  return (service as unknown as { entries: Map<string, never> }).entries as never;
}

function createRenderCacheWindowLike() {
  const rafCallbacks: FrameRequestCallback[] = [];
  const idleCallbacks: Array<() => void> = [];
  const timeoutCallbacks: Array<() => void> = [];

  return {
    windowLike: {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      },
      cancelAnimationFrame: vi.fn(),
      requestIdleCallback: (callback: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void) => {
        idleCallbacks.push(() => {
          callback({
            didTimeout: false,
            timeRemaining: () => 1
          });
        });
        return idleCallbacks.length;
      },
      cancelIdleCallback: vi.fn(),
      setTimeout: ((callback: TimerHandler) => {
        if (typeof callback === 'function') {
          timeoutCallbacks.push(callback as () => void);
        }
        return timeoutCallbacks.length;
      }) as typeof window.setTimeout,
      clearTimeout: vi.fn()
    },
    flush: async () => {
      let advanced = true;
      while (advanced) {
        advanced = false;

        while (rafCallbacks.length > 0) {
          advanced = true;
          rafCallbacks.shift()?.(0);
        }
        await Promise.resolve();

        while (idleCallbacks.length > 0) {
          advanced = true;
          idleCallbacks.shift()?.();
        }

        while (timeoutCallbacks.length > 0) {
          advanced = true;
          timeoutCallbacks.shift()?.();
        }
        await Promise.resolve();
      }

      await Promise.resolve();
    }
  };
}

describe('render cache service', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn()
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('uploads only missing channels and only rebinds when the active revision changes', () => {
    const session = createSession('session-1');
    const secondSession = createSession('session-2');
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer
    });

    const first = service.prepareActiveSession(session, session.state);
    const second = service.prepareActiveSession(session, session.state);
    const monoState = {
      ...session.state,
      displaySelection: createChannelMonoSelection('R')
    };
    const third = service.prepareActiveSession(session, monoState);
    const fourth = service.prepareActiveSession(secondSession, secondSession.state);

    expect(first.textureDirty).toBe(true);
    expect(second.textureDirty).toBe(false);
    expect(third.textureDirty).toBe(true);
    expect(fourth.textureDirty).toBe(true);
    expect(renderer.ensureLayerChannelsResident).toHaveBeenCalledTimes(2);
    expect(renderer.ensureLayerChannelsResident).toHaveBeenNthCalledWith(
      1,
      'session-1',
      0,
      2,
      1,
      session.decoded.layers[0],
      ['R', 'G', 'B']
    );
    expect(renderer.setDisplaySelectionBindings).toHaveBeenCalledTimes(3);
  });

  it('keeps texture preparation separate from lazy, deduped luminance requests', async () => {
    const session = createSession('session-1');
    const ui = createUiMock();
    const renderer = createRendererMock();
    const { windowLike, flush } = createRenderCacheWindowLike();
    const onDisplayLuminanceRangeResolved = vi.fn();
    const service = new RenderCacheService({
      ui,
      renderer,
      windowLike,
      onDisplayLuminanceRangeResolved
    });

    service.prepareActiveSession(session, session.state);

    expect(getEntries(service).get(session.id)?.luminanceRangeByRevision.size ?? 0).toBe(0);

    const first = service.requestDisplayLuminanceRange(session, session.state);
    const second = service.requestDisplayLuminanceRange(session, session.state);

    expect(first).toEqual({
      displayLuminanceRange: null,
      pending: true
    });
    expect(second).toEqual({
      displayLuminanceRange: null,
      pending: true
    });
    expect(service.getCachedLuminanceRange(session.id, session.state)).toBeNull();

    await flush();

    expect(service.getCachedLuminanceRange(session.id, session.state)).toEqual({ min: 0.5702, max: 0.5702 });
    expect(service.requestDisplayLuminanceRange(session, session.state)).toEqual({
      displayLuminanceRange: { min: 0.5702, max: 0.5702 },
      pending: false
    });
    expect(onDisplayLuminanceRangeResolved).toHaveBeenCalledTimes(1);
    expect(onDisplayLuminanceRangeResolved).toHaveBeenCalledWith({
      requestId: null,
      requestKey: `${session.id}:${buildDisplayLuminanceRevisionKey(session.state)}`,
      sessionId: session.id,
      activeLayer: 0,
      displaySelection: session.state.displaySelection,
      displayLuminanceRange: { min: 0.5702, max: 0.5702 }
    });
  });

  it('computes and caches lazy, deduped image stats requests', async () => {
    const decoded: DecodedExrImage = {
      width: 5,
      height: 1,
      layers: [createLayerFromChannels({
        R: [1, 2, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
        G: [0, -2, 4, 6, 8],
        B: [Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN]
      }, 'beauty')]
    };
    const session = createSession('session-1', decoded);
    const ui = createUiMock();
    const renderer = createRendererMock();
    const { windowLike, flush } = createRenderCacheWindowLike();
    const onImageStatsResolved = vi.fn();
    const service = new RenderCacheService({
      ui,
      renderer,
      windowLike,
      onImageStatsResolved
    });

    expect(getEntries(service).get(session.id)?.imageStatsByRevision.size ?? 0).toBe(0);

    const first = service.requestImageStats(session, session.state);
    const second = service.requestImageStats(session, session.state);

    expect(first).toEqual({
      imageStats: null,
      pending: true
    });
    expect(second).toEqual({
      imageStats: null,
      pending: true
    });
    expect(service.getCachedImageStats(session.id, session.state)).toBeNull();

    await flush();

    const expectedStats = {
      width: 5,
      height: 1,
      pixelCount: 5,
      channels: [
        createExpectedStatsChannel('R', 1, 1.5, 2, 2, 1, 1, 1),
        createExpectedStatsChannel('G', -2, 3.2, 8, 5, 0, 0, 0),
        createExpectedStatsChannel('B', null, null, null, 0, 5, 0, 0)
      ]
    };
    expect(service.getCachedImageStats(session.id, session.state)).toEqual(expectedStats);
    expect(service.requestImageStats(session, session.state)).toEqual({
      imageStats: expectedStats,
      pending: false
    });
    expect(onImageStatsResolved).toHaveBeenCalledTimes(1);
    expect(onImageStatsResolved).toHaveBeenCalledWith({
      requestId: null,
      requestKey: `${session.id}:${buildDisplayImageStatsRevisionKey(session.state)}`,
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: session.state.visualizationMode,
      displaySelection: session.state.displaySelection,
      imageStats: expectedStats
    });
  });

  it('computes and caches lazy, deduped auto exposure requests', async () => {
    const decoded: DecodedExrImage = {
      width: 5,
      height: 1,
      layers: [createLayerFromChannels({
        R: [1, 2, 4, 8, 1000],
        G: [0, 0, 0, 0, 0],
        B: [0, 0, 0, 0, 0]
      }, 'beauty')]
    };
    const session = createSession('session-1', decoded);
    const ui = createUiMock();
    const renderer = createRendererMock();
    const { windowLike, flush } = createRenderCacheWindowLike();
    const onAutoExposureResolved = vi.fn();
    const service = new RenderCacheService({
      ui,
      renderer,
      windowLike,
      onAutoExposureResolved
    });

    const first = service.requestAutoExposure(session, session.state, 7);
    const second = service.requestAutoExposure(session, session.state, 8);

    expect(first).toEqual({
      autoExposure: null,
      pending: true
    });
    expect(second).toEqual({
      autoExposure: null,
      pending: true
    });

    await flush();

    expect(onAutoExposureResolved).toHaveBeenCalledTimes(1);
    expect(onAutoExposureResolved).toHaveBeenCalledWith({
      requestId: 8,
      requestKey: `${session.id}:${buildDisplayAutoExposureRevisionKey(session.state, 99.5)}`,
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection: session.state.displaySelection,
      autoExposure: {
        scalar: 8,
        exposureEv: -3,
        percentile: 99.5,
        source: 'rgbMax'
      }
    });
    expect(service.requestAutoExposure(session, session.state)).toEqual({
      autoExposure: {
        scalar: 8,
        exposureEv: -3,
        percentile: 99.5,
        source: 'rgbMax'
      },
      pending: false
    });

    expect(service.requestAutoExposure(session, session.state, null, 50)).toEqual({
      autoExposure: null,
      pending: true
    });

    await flush();

    expect(onAutoExposureResolved).toHaveBeenCalledTimes(2);
    expect(onAutoExposureResolved).toHaveBeenLastCalledWith({
      requestId: null,
      requestKey: `${session.id}:${buildDisplayAutoExposureRevisionKey(session.state, 50)}`,
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection: session.state.displaySelection,
      autoExposure: {
        scalar: 4,
        exposureEv: -2,
        percentile: 50,
        source: 'rgbMax'
      }
    });
  });

  it('cancels superseded queued analysis jobs before writing caches or invoking callbacks', async () => {
    const session = createSession('session-1', createDecodedImage(3, 1, { R: 1, G: 4, B: 0 }));
    const firstState = {
      ...session.state,
      displaySelection: createChannelMonoSelection('R')
    };
    const secondState = {
      ...session.state,
      displaySelection: createChannelMonoSelection('G')
    };
    const ui = createUiMock();
    const renderer = createRendererMock();
    const { windowLike, flush } = createRenderCacheWindowLike();
    const onDisplayLuminanceRangeResolved = vi.fn();
    const onImageStatsResolved = vi.fn();
    const onAutoExposureResolved = vi.fn();
    const service = new RenderCacheService({
      ui,
      renderer,
      windowLike,
      onDisplayLuminanceRangeResolved,
      onImageStatsResolved,
      onAutoExposureResolved,
      analysisChunkSize: 1
    });

    expect(service.requestDisplayLuminanceRange(session, firstState, 1).pending).toBe(true);
    expect(service.requestDisplayLuminanceRange(session, secondState, 2).pending).toBe(true);
    expect(service.requestImageStats(session, firstState, 3).pending).toBe(true);
    expect(service.requestImageStats(session, secondState, 4).pending).toBe(true);
    expect(service.requestAutoExposure(session, firstState, 5).pending).toBe(true);
    expect(service.requestAutoExposure(session, secondState, 6).pending).toBe(true);

    await flush();
    await flush();

    expect(service.getCachedLuminanceRange(session.id, firstState)).toBeNull();
    expect(service.getCachedLuminanceRange(session.id, secondState)).toEqual({ min: 4, max: 4 });
    expect(service.getCachedImageStats(session.id, firstState)).toBeNull();
    expect(service.getCachedImageStats(session.id, secondState)?.channels[0]).toMatchObject({
      label: 'Mono',
      min: 4,
      max: 4
    });
    expect(onDisplayLuminanceRangeResolved).toHaveBeenCalledTimes(1);
    expect(onDisplayLuminanceRangeResolved).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 2,
      displaySelection: secondState.displaySelection
    }));
    expect(onImageStatsResolved).toHaveBeenCalledTimes(1);
    expect(onImageStatsResolved).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 4,
      displaySelection: secondState.displaySelection
    }));
    expect(onAutoExposureResolved).toHaveBeenCalledTimes(1);
    expect(onAutoExposureResolved).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 6,
      displaySelection: secondState.displaySelection,
      autoExposure: expect.objectContaining({ scalar: 4 })
    }));
  });

  it('drops pending analysis callbacks when the active target changes', async () => {
    const first = createSession('session-1', createDecodedImage(3, 1, { R: 1, G: 0, B: 0 }));
    const second = createSession('session-2', createDecodedImage(3, 1, { R: 2, G: 0, B: 0 }));
    const ui = createUiMock();
    const renderer = createRendererMock();
    const { windowLike, flush } = createRenderCacheWindowLike();
    const onDisplayLuminanceRangeResolved = vi.fn();
    const onImageStatsResolved = vi.fn();
    const onAutoExposureResolved = vi.fn();
    let activeSessionId: string | null = first.id;
    const service = new RenderCacheService({
      ui,
      renderer,
      windowLike,
      getActiveSessionId: () => activeSessionId,
      onDisplayLuminanceRangeResolved,
      onImageStatsResolved,
      onAutoExposureResolved,
      analysisChunkSize: 1
    });

    expect(service.requestDisplayLuminanceRange(first, first.state, 1).pending).toBe(true);
    expect(service.requestImageStats(first, first.state, 2).pending).toBe(true);
    expect(service.requestAutoExposure(first, first.state, 3).pending).toBe(true);

    activeSessionId = second.id;
    await flush();

    expect(service.getCachedLuminanceRange(first.id, first.state)).toBeNull();
    expect(service.getCachedImageStats(first.id, first.state)).toBeNull();
    expect(onDisplayLuminanceRangeResolved).not.toHaveBeenCalled();
    expect(onImageStatsResolved).not.toHaveBeenCalled();
    expect(onAutoExposureResolved).not.toHaveBeenCalled();
  });

  it('reuses finite mono ranges across alpha-only selection changes', async () => {
    const decoded = createDecodedImage(2, 1, { R: 1, G: 0.5, B: 0, A: 0.25 });
    const session = createSession('session-1', decoded);
    const ui = createUiMock();
    const renderer = createRendererMock();
    const { windowLike, flush } = createRenderCacheWindowLike();
    const service = new RenderCacheService({
      ui,
      renderer,
      windowLike
    });

    const withAlpha = {
      ...session.state,
      displaySelection: createChannelMonoSelection('R', 'A')
    };
    const withoutAlpha = {
      ...session.state,
      displaySelection: createChannelMonoSelection('R')
    };

    expect(service.requestDisplayLuminanceRange(session, withAlpha)).toEqual({
      displayLuminanceRange: null,
      pending: true
    });
    await flush();

    expect(service.requestDisplayLuminanceRange(session, withoutAlpha)).toEqual({
      displayLuminanceRange: { min: 1, max: 1 },
      pending: false
    });
    expect(service.getCachedLuminanceRange(session.id, withoutAlpha)).toEqual({ min: 1, max: 1 });
    expect(session.decoded.layers[0]?.analysis.finiteRangeByChannel.R).toEqual({ min: 1, max: 1 });
  });

  it('tracks decoded plus retained resident bytes in the usage UI and tears down session resources', () => {
    const localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn()
    };
    vi.stubGlobal('window', { localStorage });

    const first = createSession('first');
    const second = createSession('second');
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer
    });

    service.prepareActiveSession(first, first.state);
    service.prepareActiveSession(second, second.state);
    service.setBudgetMb(128);

    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(96, 128 * MB);
    expect(localStorage.setItem).toHaveBeenCalledWith('openexr-viewer:display-cache-budget-mb:v1', '128');

    service.discard(first.id);
    service.clear();

    expect(renderer.discardSessionTextures).toHaveBeenNthCalledWith(1, first.id);
    expect(renderer.discardSessionTextures).toHaveBeenNthCalledWith(2, second.id);
    expect(getEntries(service).size).toBe(0);
  });

  it('tracks decoded sessions before first render and allows decoded-only over-budget totals', () => {
    const session = createSession('session-1', createDecodedImage(20_000, 1_000, { Z: 1 }));
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer
    });

    service.setBudgetMb(64);
    service.trackSession(session);

    expect(renderer.discardChannelSourceTexture).not.toHaveBeenCalled();
    expect(getEntries(service).get(session.id)?.decodedBytes).toBe(80_000_000);
    expect(getEntries(service).get(session.id)?.residentLayers.size).toBe(0);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(80_000_000, 64 * MB);
  });

  it('evicts inactive channels from the active layer while keeping the bound selection resident', () => {
    const session = createSession('session-1', createDecodedImage(20_000, 1_000, { R: 1, G: 0.5, B: 0, Z: 2 }));
    const ui = createUiMock();
    const renderer = createRendererMock();

    const activeSessionId: string | null = session.id;
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => activeSessionId
    });

    service.prepareActiveSession(session, session.state);
    const zState = {
      ...session.state,
      displaySelection: createChannelMonoSelection('Z')
    };
    service.prepareActiveSession(session, zState);

    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledTimes(3);
    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(session.id, 0, 'R');
    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(session.id, 0, 'G');
    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(session.id, 0, 'B');
    expect([...getEntries(service).get(session.id)?.residentLayers.get(0)?.residentChannels.keys() ?? []]).toEqual([
      'Z'
    ]);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(400_000_000, 256 * MB);
  });

  it('evicts older layers from the active session once they fall outside the bound channel set', () => {
    const decoded = createMultiLayerDecodedImage(5_000, 1_000, [{ Z: 1 }, { Z: 2 }, { Z: 3 }, { Z: 4 }]);
    const session = createSession('session-1', decoded);
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => session.id
    });

    service.setBudgetMb(128);

    const secondLayer = buildViewerStateForLayer(session.state, decoded, 1);
    const thirdLayer = buildViewerStateForLayer(secondLayer, decoded, 2);
    const fourthLayer = buildViewerStateForLayer(thirdLayer, decoded, 3);

    service.prepareActiveSession(session, session.state);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(100_000_000, 128 * MB);

    service.prepareActiveSession(session, secondLayer);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(120_000_000, 128 * MB);

    service.prepareActiveSession(session, thirdLayer);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(120_000_000, 128 * MB);

    service.prepareActiveSession(session, fourthLayer);

    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledTimes(2);
    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(session.id, 0, 'Z');
    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(session.id, 1, 'Z');
    expect([...getEntries(service).get(session.id)?.residentLayers.keys() ?? []]).toEqual([2, 3]);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(120_000_000, 128 * MB);
  });

  it('keeps only the active bound layer resident when it alone exceeds the budget', () => {
    const decoded = createMultiLayerDecodedImage(20_000, 1_000, [{ Z: 1 }, { Z: 2 }]);
    const session = createSession('session-1', decoded);
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => session.id
    });

    service.setBudgetMb(64);

    const secondLayer = buildViewerStateForLayer(session.state, decoded, 1);

    service.prepareActiveSession(session, session.state);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(240_000_000, 64 * MB);

    service.prepareActiveSession(session, secondLayer);

    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledTimes(1);
    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(session.id, 0, 'Z');
    expect([...getEntries(service).get(session.id)?.residentLayers.keys() ?? []]).toEqual([1]);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(240_000_000, 64 * MB);
  });

  it('evicts least recently used non-active channels immediately when the budget shrinks', () => {
    const first = createSession('first', createDecodedImage(10_000, 1_000, { Z: 1 }));
    const second = createSession('second', createDecodedImage(10_000, 1_000, { Z: 1 }));
    const ui = createUiMock();
    const renderer = createRendererMock();

    let activeSessionId: string | null = first.id;
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => activeSessionId
    });

    service.prepareActiveSession(first, first.state);
    activeSessionId = second.id;
    service.prepareActiveSession(second, second.state);
    service.setBudgetMb(64);

    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledTimes(1);
    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(first.id, 0, 'Z');
    expect(getEntries(service).get(first.id)?.residentLayers.size).toBe(0);
    expect(getEntries(service).get(second.id)?.residentLayers.size).toBe(1);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(120_000_000, 64 * MB);
  });

  it('keeps pinned sessions exempt and evicts other channels first when protected residency exceeds the budget', () => {
    const first = createSession('first', createDecodedImage(10_000, 1_000, { Z: 1 }));
    const second = createSession('second', createDecodedImage(10_000, 1_000, { Z: 1 }));
    const third = createSession('third', createDecodedImage(10_000, 1_000, { Z: 1 }));
    const ui = createUiMock();
    const renderer = createRendererMock();

    let activeSessionId: string | null = first.id;
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => activeSessionId
    });

    service.prepareActiveSession(first, first.state);
    activeSessionId = second.id;
    service.prepareActiveSession(second, second.state);
    activeSessionId = third.id;
    service.prepareActiveSession(third, third.state);

    service.setSessionPinned(first.id, true);
    expect(service.isSessionPinned(first.id)).toBe(true);

    activeSessionId = second.id;
    service.prepareActiveSession(second, second.state);
    service.setBudgetMb(64);

    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledTimes(1);
    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(third.id, 0, 'Z');
    expect(getEntries(service).get(first.id)?.residentLayers.size).toBe(1);
    expect(getEntries(service).get(second.id)?.residentLayers.size).toBe(1);
    expect(getEntries(service).get(third.id)?.residentLayers.size).toBe(0);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(200_000_000, 64 * MB);
  });

  it('reuploads evicted layers within one session while preserving cached luminance ranges', async () => {
    const decoded = createMultiLayerDecodedImage(20_000, 1_000, [{ Z: 1 }, { Y: 2 }]);
    const session = createSession('session-1', decoded);
    const ui = createUiMock();
    const renderer = createRendererMock();
    const { windowLike, flush } = createRenderCacheWindowLike();
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => session.id,
      windowLike
    });

    service.setBudgetMb(64);

    const secondLayer = buildViewerStateForLayer(session.state, decoded, 1);

    service.prepareActiveSession(session, session.state);
    expect(service.requestDisplayLuminanceRange(session, session.state)).toEqual({
      displayLuminanceRange: null,
      pending: true
    });
    await flush();
    expect(service.getCachedLuminanceRange(session.id, session.state)).toEqual({ min: 1, max: 1 });

    service.prepareActiveSession(session, secondLayer);

    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(session.id, 0, 'Z');
    expect(service.getCachedLuminanceRange(session.id, session.state)).toEqual({ min: 1, max: 1 });

    const reuploaded = service.prepareActiveSession(session, session.state);
    const stable = service.prepareActiveSession(session, session.state);

    expect(reuploaded.textureDirty).toBe(true);
    expect(stable.textureDirty).toBe(false);
    expect(renderer.ensureLayerChannelsResident).toHaveBeenCalledTimes(3);
  });

  it('reuploads evicted channels while preserving cached luminance ranges', async () => {
    const first = createSession('first', createDecodedImage(20_000, 1_000, { Z: 1 }));
    const second = createSession('second', createDecodedImage(20_000, 1_000, { Z: 1 }));
    const ui = createUiMock();
    const renderer = createRendererMock();
    const { windowLike, flush } = createRenderCacheWindowLike();

    let activeSessionId: string | null = first.id;
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => activeSessionId,
      windowLike
    });

    service.prepareActiveSession(first, first.state);
    expect(service.requestDisplayLuminanceRange(first, first.state)).toEqual({
      displayLuminanceRange: null,
      pending: true
    });
    await flush();
    expect(service.getCachedLuminanceRange(first.id, first.state)).toEqual({ min: 1, max: 1 });

    activeSessionId = second.id;
    service.prepareActiveSession(second, second.state);
    service.setBudgetMb(64);

    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(first.id, 0, 'Z');
    expect(service.getCachedLuminanceRange(first.id, first.state)).toEqual({ min: 1, max: 1 });

    activeSessionId = first.id;
    const reuploaded = service.prepareActiveSession(first, first.state);
    const stable = service.prepareActiveSession(first, first.state);

    expect(reuploaded.textureDirty).toBe(true);
    expect(stable.textureDirty).toBe(false);
    expect(renderer.ensureLayerChannelsResident).toHaveBeenCalledTimes(3);
  });

  it('drops pending luminance callbacks after discard, clear, and dispose', async () => {
    const session = createSession('session-1');

    const discarded = createRenderCacheWindowLike();
    const discardedCallback = vi.fn();
    const discardedService = new RenderCacheService({
      ui: createUiMock(),
      renderer: createRendererMock(),
      windowLike: discarded.windowLike,
      onDisplayLuminanceRangeResolved: discardedCallback
    });
    expect(discardedService.requestDisplayLuminanceRange(session, session.state).pending).toBe(true);
    discardedService.discard(session.id);
    await discarded.flush();
    expect(discardedCallback).not.toHaveBeenCalled();
    expect(discardedService.getCachedLuminanceRange(session.id, session.state)).toBeNull();

    const cleared = createRenderCacheWindowLike();
    const clearedCallback = vi.fn();
    const clearedService = new RenderCacheService({
      ui: createUiMock(),
      renderer: createRendererMock(),
      windowLike: cleared.windowLike,
      onDisplayLuminanceRangeResolved: clearedCallback
    });
    expect(clearedService.requestDisplayLuminanceRange(session, session.state).pending).toBe(true);
    clearedService.clear();
    await cleared.flush();
    expect(clearedCallback).not.toHaveBeenCalled();
    expect(clearedService.getCachedLuminanceRange(session.id, session.state)).toBeNull();

    const disposed = createRenderCacheWindowLike();
    const disposedCallback = vi.fn();
    const disposedService = new RenderCacheService({
      ui: createUiMock(),
      renderer: createRendererMock(),
      windowLike: disposed.windowLike,
      onDisplayLuminanceRangeResolved: disposedCallback
    });
    expect(disposedService.requestDisplayLuminanceRange(session, session.state).pending).toBe(true);
    disposedService.dispose();
    await disposed.flush();
    expect(disposedCallback).not.toHaveBeenCalled();
  });

  it('drops pending image stats callbacks after discard, clear, and dispose', async () => {
    const session = createSession('session-1');

    const discarded = createRenderCacheWindowLike();
    const discardedCallback = vi.fn();
    const discardedService = new RenderCacheService({
      ui: createUiMock(),
      renderer: createRendererMock(),
      windowLike: discarded.windowLike,
      onImageStatsResolved: discardedCallback
    });
    expect(discardedService.requestImageStats(session, session.state).pending).toBe(true);
    discardedService.discard(session.id);
    await discarded.flush();
    expect(discardedCallback).not.toHaveBeenCalled();
    expect(discardedService.getCachedImageStats(session.id, session.state)).toBeNull();

    const cleared = createRenderCacheWindowLike();
    const clearedCallback = vi.fn();
    const clearedService = new RenderCacheService({
      ui: createUiMock(),
      renderer: createRendererMock(),
      windowLike: cleared.windowLike,
      onImageStatsResolved: clearedCallback
    });
    expect(clearedService.requestImageStats(session, session.state).pending).toBe(true);
    clearedService.clear();
    await cleared.flush();
    expect(clearedCallback).not.toHaveBeenCalled();
    expect(clearedService.getCachedImageStats(session.id, session.state)).toBeNull();

    const disposed = createRenderCacheWindowLike();
    const disposedCallback = vi.fn();
    const disposedService = new RenderCacheService({
      ui: createUiMock(),
      renderer: createRendererMock(),
      windowLike: disposed.windowLike,
      onImageStatsResolved: disposedCallback
    });
    expect(disposedService.requestImageStats(session, session.state).pending).toBe(true);
    disposedService.dispose();
    await disposed.flush();
    expect(disposedCallback).not.toHaveBeenCalled();
  });

  it('drops pending auto exposure callbacks after discard, clear, and dispose', async () => {
    const session = createSession('session-1');

    const discarded = createRenderCacheWindowLike();
    const discardedCallback = vi.fn();
    const discardedService = new RenderCacheService({
      ui: createUiMock(),
      renderer: createRendererMock(),
      windowLike: discarded.windowLike,
      onAutoExposureResolved: discardedCallback
    });
    expect(discardedService.requestAutoExposure(session, session.state).pending).toBe(true);
    discardedService.discard(session.id);
    await discarded.flush();
    expect(discardedCallback).not.toHaveBeenCalled();

    const cleared = createRenderCacheWindowLike();
    const clearedCallback = vi.fn();
    const clearedService = new RenderCacheService({
      ui: createUiMock(),
      renderer: createRendererMock(),
      windowLike: cleared.windowLike,
      onAutoExposureResolved: clearedCallback
    });
    expect(clearedService.requestAutoExposure(session, session.state).pending).toBe(true);
    clearedService.clear();
    await cleared.flush();
    expect(clearedCallback).not.toHaveBeenCalled();

    const disposed = createRenderCacheWindowLike();
    const disposedCallback = vi.fn();
    const disposedService = new RenderCacheService({
      ui: createUiMock(),
      renderer: createRendererMock(),
      windowLike: disposed.windowLike,
      onAutoExposureResolved: disposedCallback
    });
    expect(disposedService.requestAutoExposure(session, session.state).pending).toBe(true);
    disposedService.dispose();
    await disposed.flush();
    expect(disposedCallback).not.toHaveBeenCalled();
  });
});

function createExpectedStatsChannel(
  label: string,
  min: number | null,
  mean: number | null,
  max: number | null,
  validPixelCount: number,
  nanPixelCount: number,
  negativeInfinityPixelCount: number,
  positiveInfinityPixelCount: number
) {
  return {
    label,
    min,
    mean,
    max,
    validPixelCount,
    nanPixelCount,
    negativeInfinityPixelCount,
    positiveInfinityPixelCount
  };
}
