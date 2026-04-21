import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeDisplaySelectionKey } from '../src/display-model';
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
    setDisplayTexture: vi.fn()
  };
}

function getEntries(service: RenderCacheService): Map<string, {
  displayTexture: Float32Array | null;
  displayLuminanceRange: { min: number; max: number } | null;
  displayLuminanceRangeRevisionKey: string;
  textureRevisionKey: string;
  pinned: boolean;
  lastTouched: number;
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

  it('reuses retained textures by revision key and uploads once per retained revision', () => {
    const session = createSession('session-1');
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => session.id
    });

    const first = service.prepareActiveSession(session, session.state);
    const second = service.prepareActiveSession(session, session.state);

    expect(second.displayTexture).toBe(first.displayTexture);
    expect(second.textureDirty).toBe(false);
    expect(renderer.setDisplayTexture).toHaveBeenCalledTimes(1);
  });

  it('refreshes luminance range lazily only for stale colormap textures', () => {
    const session = createSession('session-1');
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => session.id
    });

    const rgbResult = service.prepareActiveSession(session, session.state);
    const firstColormap = service.prepareActiveSession(session, {
      ...session.state,
      visualizationMode: 'colormap'
    });
    const secondColormap = service.prepareActiveSession(session, {
      ...session.state,
      visualizationMode: 'colormap'
    });

    expect(rgbResult.displayLuminanceRange).toBeNull();
    expect(firstColormap.luminanceRangeDirty).toBe(true);
    expect(firstColormap.displayLuminanceRange).toEqual({ min: 0.5702, max: 0.5702 });
    expect(secondColormap.luminanceRangeDirty).toBe(false);
  });

  it('evicts the least recently used inactive entry, keeps the active session, and preserves pinned entries over budget', () => {
    let activeSessionId = 'c';
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => activeSessionId
    });
    const entries = getEntries(service);
    entries.set('a', {
      displayTexture: new Float32Array((40 * 1024 * 1024) / 4),
      displayLuminanceRange: { min: 0, max: 1 },
      displayLuminanceRangeRevisionKey: 'a-range',
      textureRevisionKey: 'a-texture',
      pinned: false,
      lastTouched: 1
    } as never);
    entries.set('b', {
      displayTexture: new Float32Array((40 * 1024 * 1024) / 4),
      displayLuminanceRange: { min: 0, max: 1 },
      displayLuminanceRangeRevisionKey: 'b-range',
      textureRevisionKey: 'b-texture',
      pinned: true,
      lastTouched: 2
    } as never);
    entries.set('c', {
      displayTexture: new Float32Array((40 * 1024 * 1024) / 4),
      displayLuminanceRange: { min: 0, max: 1 },
      displayLuminanceRangeRevisionKey: 'c-range',
      textureRevisionKey: 'c-texture',
      pinned: false,
      lastTouched: 3
    } as never);

    service.setBudgetMb(64);

    expect(entries.has('a')).toBe(false);
    expect(entries.get('b')?.displayTexture).not.toBeNull();
    expect(entries.get('c')?.displayTexture).not.toBeNull();

    activeSessionId = 'a';
    entries.set('a', {
      displayTexture: new Float32Array((40 * 1024 * 1024) / 4),
      displayLuminanceRange: { min: 0, max: 1 },
      displayLuminanceRangeRevisionKey: 'a-range',
      textureRevisionKey: 'a-texture',
      pinned: false,
      lastTouched: 4
    } as never);
    entries.get('b')!.pinned = false;
    entries.get('b')!.lastTouched = 1;

    service.setBudgetMb(64);

    expect(entries.get('a')?.displayTexture).not.toBeNull();
    expect(entries.has('b')).toBe(false);
  });

  it('persists budget updates and resets upload tracking on discard and clear', () => {
    const localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn()
    };
    vi.stubGlobal('window', { localStorage });

    const session = createSession('session-1');
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => session.id
    });

    service.prepareActiveSession(session, session.state);
    service.setBudgetMb(128);
    service.discard(session.id, { preservePinned: true });
    service.prepareActiveSession(session, session.state);
    service.clear();

    expect(localStorage.setItem).toHaveBeenCalledWith('openexr-viewer:display-cache-budget-mb:v1', '128');
    expect(renderer.setDisplayTexture).toHaveBeenCalledTimes(2);
    expect(getEntries(service).size).toBe(0);
  });

  it('returns snapshot textures without touching retained LRU state or pruning the budget', () => {
    const session = createSession('session-1');
    const ui = createUiMock();
    const renderer = createRendererMock();
    const service = new RenderCacheService({
      ui,
      renderer,
      getActiveSessionId: () => session.id
    });
    const entries = getEntries(service);
    const retainedTexture = new Float32Array([1, 1, 1, 1, 0, 0, 0, 1]);
    entries.set(session.id, {
      displayTexture: retainedTexture,
      displayLuminanceRange: null,
      displayLuminanceRangeRevisionKey: '',
      textureRevisionKey: `0:${serializeDisplaySelectionKey(session.state.displaySelection)}`,
      pinned: false,
      lastTouched: 7
    } as never);

    const retainedResult = service.getTextureForSnapshot(session, session.state);
    const ephemeralResult = service.getTextureForSnapshot(session, {
      ...session.state,
      displaySelection: createChannelMonoSelection('R')
    });

    expect(retainedResult).toBe(retainedTexture);
    expect(entries.get(session.id)?.lastTouched).toBe(7);
    expect(ephemeralResult).not.toBe(retainedTexture);
    expect(getEntries(service).size).toBe(1);
    expect(ui.setDisplayCacheUsage).toHaveBeenCalledTimes(1);
  });
});
