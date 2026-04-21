import { describe, expect, it, vi } from 'vitest';
import { __debugGetMaterializedChannelCount } from '../src/channel-storage';
import { serializeDisplaySelectionKey } from '../src/display-model';
import { ThumbnailService } from '../src/services/thumbnail-service';
import { DecodedExrImage, OpenedImageSession, ViewerState } from '../src/types';
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
    thumbnailDataUrl: null,
    thumbnailGenerationToken: 0,
    thumbnailStateSnapshot: state,
    state,
    textureRevisionKey: '',
    displayTexture: null,
    displayLuminanceRangeRevisionKey: '',
    displayLuminanceRange: null,
    displayCachePinned: false,
    displayCacheLastTouched: 0
  };
}

describe('thumbnail service', () => {
  it('suppresses stale thumbnail jobs when a newer token replaces them', async () => {
    const session = createSession();
    const updates: string[] = [];
    const service = new ThumbnailService({
      getSession: () => session,
      onThumbnailUpdated: () => {
        updates.push('updated');
      },
      windowLike: null,
      createThumbnailDataUrl: ({ stateSnapshot }) => serializeDisplaySelectionKey(stateSnapshot.displaySelection)
    });

    const firstState: ViewerState = { ...session.state, displaySelection: createChannelMonoSelection('first') };
    const secondState: ViewerState = { ...session.state, displaySelection: createChannelMonoSelection('second') };

    const first = service.enqueue(session.id, firstState);
    const second = service.enqueue(session.id, secondState);

    await Promise.all([first, second]);

    expect(session.thumbnailDataUrl).toBe('channelMono:second:');
    expect(updates).toEqual(['updated']);
  });

  it('skips discarded jobs once the backing session is gone', async () => {
    const sessions = new Map<string, OpenedImageSession>([['session-1', createSession()]]);
    const onThumbnailUpdated = vi.fn();
    const service = new ThumbnailService({
      getSession: (sessionId) => sessions.get(sessionId) ?? null,
      onThumbnailUpdated,
      windowLike: null,
      createThumbnailDataUrl: () => 'thumb'
    });

    const promise = service.enqueue('session-1', sessions.get('session-1')!.state);
    sessions.delete('session-1');
    service.discard('session-1');

    await promise;

    expect(onThumbnailUpdated).not.toHaveBeenCalled();
  });

  it('clears queued jobs that have not started yet', async () => {
    const firstSession = createSession('first');
    const secondSession = createSession('second');
    const sessions = new Map<string, OpenedImageSession>([
      [firstSession.id, firstSession],
      [secondSession.id, secondSession]
    ]);
    const updates: string[] = [];
    const service = new ThumbnailService({
      getSession: (sessionId) => sessions.get(sessionId) ?? null,
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

    expect(firstSession.thumbnailDataUrl).toBe('first-thumb');
    expect(secondSession.thumbnailDataUrl).toBeNull();
    expect(updates).toEqual(['updated']);
  });

  it('reuses the cached display texture when the revision key matches', async () => {
    const session = createSession();
    const cachedTexture = new Float32Array([0.5, 0.5, 0.5, 1, 1, 1, 1, 1]);
    session.displayTexture = cachedTexture;
    session.textureRevisionKey = `0:${serializeDisplaySelectionKey(createChannelRgbSelection('R', 'G', 'B'))}`;

    let receivedTexture: Float32Array | null = null;
    const service = new ThumbnailService({
      getSession: () => session,
      onThumbnailUpdated: () => undefined,
      windowLike: null,
      createThumbnailDataUrl: ({ displayTexture }) => {
        receivedTexture = displayTexture;
        return 'thumb';
      }
    });

    await service.enqueue(session.id, session.state);

    expect(receivedTexture).toBe(cachedTexture);
    expect(session.thumbnailDataUrl).toBe('thumb');
  });

  it('does not trigger planar materialization while building thumbnail display textures', async () => {
    const session = createSession();
    const layer = session.decoded.layers[0]!;
    const service = new ThumbnailService({
      getSession: () => session,
      onThumbnailUpdated: () => undefined,
      windowLike: null,
      createThumbnailDataUrl: () => 'thumb'
    });

    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    await service.enqueue(session.id, session.state);

    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    expect(session.thumbnailDataUrl).toBe('thumb');
  });
});
