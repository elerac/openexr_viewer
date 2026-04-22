import { describe, expect, it, vi } from 'vitest';
import { __debugGetMaterializedChannelCount } from '../src/channel-storage';
import { buildSelectedDisplayTexture } from '../src/display-texture';
import { serializeDisplaySelectionKey } from '../src/display-model';
import { ThumbnailService } from '../src/services/thumbnail-service';
import { DecodedExrImage, OpenedImageSession, ViewerSessionState } from '../src/types';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import { createChannelMonoSelection, createChannelRgbSelection, createLayerFromChannels } from './helpers/state-fixtures';

function createDecodedImage(): DecodedExrImage {
  const layer = createLayerFromChannels({
    R: [0, 1],
    G: [0, 1],
    B: [0, 1]
  }, 'beauty');

  return {
    width: 2,
    height: 1,
    layers: [layer]
  };
}

function createSession(id = 'session-1'): OpenedImageSession {
  const decoded = createDecodedImage();
  const state = buildViewerStateForLayer(createInitialState(), decoded, 0);

  return {
    id,
    filename: `${id}.exr`,
    displayName: `${id}.exr`,
    fileSizeBytes: 16,
    source: { kind: 'url', url: `/${id}.exr` },
    decoded,
    state
  };
}

function createRenderCacheStub(texture?: Float32Array | null) {
  return {
    getTextureForSnapshot: vi.fn(() => texture ?? new Float32Array([0, 0, 0, 1, 1, 1, 1, 1]))
  };
}

describe('thumbnail service', () => {
  it('suppresses stale thumbnail jobs when a newer token replaces them', async () => {
    const session = createSession();
    const renderCache = createRenderCacheStub();
    const updates: string[] = [];
    const service = new ThumbnailService({
      getSession: () => session,
      renderCache: renderCache as never,
      onThumbnailUpdated: () => {
        updates.push('updated');
      },
      windowLike: null,
      createThumbnailDataUrl: ({ stateSnapshot }) => serializeDisplaySelectionKey(stateSnapshot.displaySelection)
    });

    const firstState: ViewerSessionState = { ...session.state, displaySelection: createChannelMonoSelection('first') };
    const secondState: ViewerSessionState = { ...session.state, displaySelection: createChannelMonoSelection('second') };

    const first = service.enqueue(session.id, firstState);
    const second = service.enqueue(session.id, secondState);

    await Promise.all([first, second]);

    expect(service.getThumbnailDataUrl(session.id)).toBe('channelMono:second:');
    expect(updates).toEqual(['updated']);
  });

  it('skips discarded jobs once the backing session is gone', async () => {
    const sessions = new Map<string, OpenedImageSession>([['session-1', createSession()]]);
    const renderCache = createRenderCacheStub();
    const onThumbnailUpdated = vi.fn();
    const service = new ThumbnailService({
      getSession: (sessionId) => sessions.get(sessionId) ?? null,
      renderCache: renderCache as never,
      onThumbnailUpdated,
      windowLike: null,
      createThumbnailDataUrl: () => 'thumb'
    });

    const promise = service.enqueue('session-1', sessions.get('session-1')!.state);
    sessions.delete('session-1');
    service.discard('session-1');

    await promise;

    expect(onThumbnailUpdated).not.toHaveBeenCalled();
    expect(service.getThumbnailDataUrl('session-1')).toBeNull();
  });

  it('clears queued jobs that have not started yet', async () => {
    const firstSession = createSession('first');
    const secondSession = createSession('second');
    const sessions = new Map<string, OpenedImageSession>([
      [firstSession.id, firstSession],
      [secondSession.id, secondSession]
    ]);
    const renderCache = createRenderCacheStub();
    const updates: string[] = [];
    const service = new ThumbnailService({
      getSession: (sessionId) => sessions.get(sessionId) ?? null,
      renderCache: renderCache as never,
      onThumbnailUpdated: () => {
        updates.push('updated');
      },
      windowLike: null,
      createThumbnailDataUrl: ({ session }) => `${session.id}-thumb`
    });

    const first = service.enqueue(firstSession.id, firstSession.state);
    const second = service.enqueue(secondSession.id, secondSession.state);
    service.clear();

    await Promise.all([first, second]);

    expect(service.getThumbnailDataUrl(firstSession.id)).toBe('first-thumb');
    expect(service.getThumbnailDataUrl(secondSession.id)).toBeNull();
    expect(updates).toEqual(['updated']);
  });

  it('preserves the previous thumbnail while reload work is queued', async () => {
    const session = createSession();
    const renderCache = createRenderCacheStub();
    const service = new ThumbnailService({
      getSession: () => session,
      renderCache: renderCache as never,
      onThumbnailUpdated: () => undefined,
      windowLike: null,
      createThumbnailDataUrl: ({ stateSnapshot }) => serializeDisplaySelectionKey(stateSnapshot.displaySelection)
    });

    await service.enqueue(session.id, session.state);
    service.discard(session.id, { preserveDataUrl: true });

    const reloadedState: ViewerSessionState = {
      ...session.state,
      displaySelection: createChannelMonoSelection('reload')
    };
    await service.enqueue(session.id, reloadedState);

    expect(service.getThumbnailDataUrl(session.id)).toBe('channelMono:reload:');
  });

  it('reuses the render cache texture when available', async () => {
    const session = createSession();
    const cachedTexture = new Float32Array([0.5, 0.5, 0.5, 1, 1, 1, 1, 1]);
    const renderCache = createRenderCacheStub(cachedTexture);

    let receivedTexture: Float32Array | null = null;
    const service = new ThumbnailService({
      getSession: () => session,
      renderCache: renderCache as never,
      onThumbnailUpdated: () => undefined,
      windowLike: null,
      createThumbnailDataUrl: ({ displayTexture }) => {
        receivedTexture = displayTexture;
        return 'thumb';
      }
    });

    await service.enqueue(session.id, session.state);

    expect(renderCache.getTextureForSnapshot).toHaveBeenCalledWith(session, session.state);
    expect(receivedTexture).toBe(cachedTexture);
    expect(service.getThumbnailDataUrl(session.id)).toBe('thumb');
  });

  it('does not trigger planar materialization while building thumbnail display textures', async () => {
    const session = createSession();
    const layer = session.decoded.layers[0]!;
    const renderCache = {
      getTextureForSnapshot: vi.fn(() =>
        buildSelectedDisplayTexture(
          layer,
          session.decoded.width,
          session.decoded.height,
          session.state.displaySelection
        )
      )
    };
    const service = new ThumbnailService({
      getSession: () => session,
      renderCache: renderCache as never,
      onThumbnailUpdated: () => undefined,
      windowLike: null,
      createThumbnailDataUrl: () => 'thumb'
    });

    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    await service.enqueue(session.id, session.state);

    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    expect(service.getThumbnailDataUrl(session.id)).toBe('thumb');
  });

  it('stops pending thumbnail work after dispose', async () => {
    const session = createSession();
    const renderCache = createRenderCacheStub();
    const rafCallbacks: FrameRequestCallback[] = [];
    const idleCallbacks: Array<() => void> = [];
    const createThumbnailDataUrl = vi.fn(() => 'thumb');
    const onThumbnailUpdated = vi.fn();
    const service = new ThumbnailService({
      getSession: () => session,
      renderCache: renderCache as never,
      onThumbnailUpdated,
      windowLike: {
        requestAnimationFrame: (callback) => {
          rafCallbacks.push(callback);
          return rafCallbacks.length;
        },
        cancelAnimationFrame: vi.fn(),
        setTimeout,
        clearTimeout,
        requestIdleCallback: (callback) => {
          idleCallbacks.push(() => {
            callback({
              didTimeout: false,
              timeRemaining: () => 1
            });
          });
          return idleCallbacks.length;
        },
        cancelIdleCallback: vi.fn()
      },
      createThumbnailDataUrl
    });

    const pending = service.enqueue(session.id, session.state).catch((error) => error);
    service.dispose();

    for (const callback of rafCallbacks) {
      callback(0);
    }
    for (const callback of idleCallbacks) {
      callback();
    }

    await pending;

    expect(createThumbnailDataUrl).not.toHaveBeenCalled();
    expect(onThumbnailUpdated).not.toHaveBeenCalled();
    expect(service.getThumbnailDataUrl(session.id)).toBeNull();
  });
});
