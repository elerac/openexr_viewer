import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderCacheService } from '../src/services/render-cache-service';
import { DecodedExrImage, OpenedImageSession } from '../src/types';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import { createChannelMonoSelection, createLayerFromChannels } from './helpers/state-fixtures';

function createDecodedImage(width = 2, height = 1): DecodedExrImage {
  const pixelCount = width * height;
  const layer = createLayerFromChannels({
    R: new Float32Array(pixelCount).fill(1),
    G: new Float32Array(pixelCount).fill(0.5),
    B: new Float32Array(pixelCount).fill(0)
  }, 'beauty');

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
    ensureLayerSourceTextures: vi.fn(),
    setDisplaySelectionBindings: vi.fn(),
    discardSessionTextures: vi.fn()
  };
}

function getEntries(service: RenderCacheService): Map<string, {
  decodedBytes: number;
  layerUploads: Set<number>;
  luminanceRangeByRevision: Map<string, { min: number; max: number } | null>;
  activeTextureRevisionKey: string;
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

  it('uploads each session layer once and only rebinds when the active revision changes', () => {
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
    expect(renderer.ensureLayerSourceTextures).toHaveBeenCalledTimes(2);
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
  });

  it('tracks decoded session bytes in the usage UI and tears down session resources on discard and clear', () => {
    const localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn()
    };
    vi.stubGlobal('window', { localStorage });

    const first = createSession('first', createDecodedImage(2, 1));
    const second = createSession('second', createDecodedImage(4, 1));
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer
    });

    service.prepareActiveSession(first, first.state);
    service.prepareActiveSession(second, second.state);
    service.setBudgetMb(128);

    expect(ui.setDisplayCacheUsage).toHaveBeenLastCalledWith(
      first.decoded.layers[0]!.channelStorage.pixels.byteLength +
        second.decoded.layers[0]!.channelStorage.pixels.byteLength,
      128 * 1024 * 1024
    );
    expect(localStorage.setItem).toHaveBeenCalledWith('openexr-viewer:display-cache-budget-mb:v1', '128');

    service.discard(first.id);
    service.clear();

    expect(renderer.discardSessionTextures).toHaveBeenNthCalledWith(1, first.id);
    expect(renderer.discardSessionTextures).toHaveBeenNthCalledWith(2, second.id);
    expect(getEntries(service).size).toBe(0);
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
