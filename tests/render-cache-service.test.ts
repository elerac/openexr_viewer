import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderCacheService } from '../src/services/render-cache-service';
import { DecodedExrImage, OpenedImageSession } from '../src/types';
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
  const pixelCount = width * height;
  const channelValues = Object.fromEntries(
    Object.entries(fillByChannel).map(([channelName, value]) => {
      return [channelName, new Float32Array(pixelCount).fill(value)];
    })
  );
  const layer = createLayerFromChannels(channelValues, 'beauty');

  return {
    width,
    height,
    layers: [layer]
  };
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
      (_sessionId, _layerIndex, _width, _height, _layer, channelNames: string[]) => [...channelNames]
    ),
    setDisplaySelectionBindings: vi.fn(),
    discardChannelSourceTexture: vi.fn(),
    discardLayerSourceTextures: vi.fn(),
    discardSessionTextures: vi.fn()
  };
}

function getEntries(service: RenderCacheService): Map<string, {
  pinned: boolean;
  residentLayers: Map<number, {
    residentChannels: Map<string, { textureBytes: number; lastAccessToken: number }>;
  }>;
  luminanceRangeByRevision: Map<string, { min: number; max: number } | null>;
}> {
  return (service as unknown as { entries: Map<string, never> }).entries as never;
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

  it('caches luminance ranges by selection revision for colormap mode', () => {
    const session = createSession('session-1');
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer
    });

    const firstColormap = service.prepareActiveSession(session, {
      ...session.state,
      visualizationMode: 'colormap'
    });
    const secondColormap = service.prepareActiveSession(session, {
      ...session.state,
      visualizationMode: 'colormap'
    });
    const monoState = {
      ...session.state,
      visualizationMode: 'colormap' as const,
      displaySelection: createChannelMonoSelection('R')
    };
    const monoColormap = service.prepareActiveSession(session, monoState);

    expect(firstColormap.luminanceRangeDirty).toBe(true);
    expect(firstColormap.displayLuminanceRange).toEqual({ min: 0.5702, max: 0.5702 });
    expect(secondColormap.luminanceRangeDirty).toBe(false);
    expect(monoColormap.luminanceRangeDirty).toBe(true);
    expect(service.getCachedLuminanceRange(session.id, monoState)).toEqual({ min: 1, max: 1 });
    expect(session.decoded.layers[0]?.analysis.finiteRangeByChannel.R).toEqual({ min: 1, max: 1 });
  });

  it('reuses luminance ranges across alpha-only selection changes', () => {
    const decoded = createDecodedImage(2, 1, { R: 1, G: 0.5, B: 0, A: 0.25 });
    const session = createSession('session-1', decoded);
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer
    });

    const withAlpha = {
      ...session.state,
      displaySelection: createChannelMonoSelection('R', 'A')
    };
    const withoutAlpha = {
      ...session.state,
      displaySelection: createChannelMonoSelection('R')
    };

    const first = service.prepareActiveSession(session, withAlpha);
    const second = service.prepareActiveSession(session, withoutAlpha);

    expect(first.displayLuminanceRange).toEqual({ min: 1, max: 1 });
    expect(first.luminanceRangeDirty).toBe(true);
    expect(second.textureDirty).toBe(true);
    expect(second.luminanceRangeDirty).toBe(false);
    expect(second.displayLuminanceRange).toEqual({ min: 1, max: 1 });
    expect(renderer.ensureLayerChannelsResident).toHaveBeenCalledTimes(1);
  });

  it('tracks resident texture bytes in the usage UI and tears down session resources on discard and clear', () => {
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

    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(48, 128 * MB);
    expect(localStorage.setItem).toHaveBeenCalledWith('openexr-viewer:display-cache-budget-mb:v1', '128');

    service.discard(first.id);
    service.clear();

    expect(renderer.discardSessionTextures).toHaveBeenNthCalledWith(1, first.id);
    expect(renderer.discardSessionTextures).toHaveBeenNthCalledWith(2, second.id);
    expect(getEntries(service).size).toBe(0);
  });

  it('evicts inactive channels from the active layer while keeping the bound selection resident', () => {
    const session = createSession('session-1', createDecodedImage(20_000, 1_000, { R: 1, G: 0.5, B: 0, Z: 2 }));
    const ui = createUiMock();
    const renderer = createRendererMock();

    let activeSessionId: string | null = session.id;
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

    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledTimes(1);
    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(session.id, 0, 'R');
    expect([...getEntries(service).get(session.id)?.residentLayers.get(0)?.residentChannels.keys() ?? []]).toEqual([
      'G',
      'B',
      'Z'
    ]);
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(240_000_000, 256 * MB);
  });

  it('evicts least recently used non-active channels immediately when the budget shrinks', () => {
    const first = createSession('first', createDecodedImage(20_000, 1_000, { Z: 1 }));
    const second = createSession('second', createDecodedImage(20_000, 1_000, { Z: 1 }));
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
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(80_000_000, 64 * MB);
  });

  it('keeps pinned sessions exempt and evicts other channels first when protected residency exceeds the budget', () => {
    const first = createSession('first', createDecodedImage(20_000, 1_000, { Z: 1 }));
    const second = createSession('second', createDecodedImage(20_000, 1_000, { Z: 1 }));
    const third = createSession('third', createDecodedImage(20_000, 1_000, { Z: 1 }));
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
    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(160_000_000, 64 * MB);
  });

  it('reuploads evicted channels while preserving cached luminance ranges', () => {
    const first = createSession('first', createDecodedImage(20_000, 1_000, { Z: 1 }));
    const second = createSession('second', createDecodedImage(20_000, 1_000, { Z: 1 }));
    const ui = createUiMock();
    const renderer = createRendererMock();

    let activeSessionId: string | null = first.id;
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => activeSessionId
    });

    const initial = service.prepareActiveSession(first, first.state);
    expect(initial.luminanceRangeDirty).toBe(true);

    activeSessionId = second.id;
    service.prepareActiveSession(second, second.state);
    service.setBudgetMb(64);

    expect(renderer.discardChannelSourceTexture).toHaveBeenCalledWith(first.id, 0, 'Z');
    expect(service.getCachedLuminanceRange(first.id, first.state)).toEqual({ min: 1, max: 1 });

    activeSessionId = first.id;
    const reuploaded = service.prepareActiveSession(first, first.state);
    const stable = service.prepareActiveSession(first, first.state);

    expect(reuploaded.textureDirty).toBe(true);
    expect(reuploaded.luminanceRangeDirty).toBe(false);
    expect(stable.textureDirty).toBe(false);
    expect(renderer.ensureLayerChannelsResident).toHaveBeenCalledTimes(3);
  });

  it('returns snapshot textures without retaining CPU display buffers', () => {
    const session = createSession('session-1');
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer
    });

    const rgbSnapshot = service.getTextureForSnapshot(session, session.state);
    const monoSnapshot = service.getTextureForSnapshot(session, {
      ...session.state,
      displaySelection: createChannelMonoSelection('R')
    });

    expect(rgbSnapshot).not.toBeNull();
    expect(monoSnapshot).not.toBeNull();
    expect(rgbSnapshot).not.toBe(monoSnapshot);
    expect(getEntries(service).size).toBe(0);
    expect(ui.setDisplayCacheUsage).toHaveBeenCalledTimes(1);
  });
});
