import { describe, expect, it, vi } from 'vitest';
import { serializeDisplaySelectionKey } from '../src/display-model';
import { ThumbnailService } from '../src/services/thumbnail-service';
import { DecodedExrImage, OpenedImageSession, ViewerSessionState } from '../src/types';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import { createChannelMonoSelection, createLayerFromChannels } from './helpers/state-fixtures';

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

describe('thumbnail service', () => {
  it('suppresses stale thumbnail jobs when a newer token replaces them', async () => {
    const session = createSession();
    const updates: Array<{ sessionId: string; token: number; thumbnailDataUrl: string | null }> = [];
    const service = new ThumbnailService({
      getSession: () => session,
      onThumbnailReady: (event) => {
        updates.push(event);
      },
      windowLike: null,
      createThumbnailDataUrl: ({ stateSnapshot }) => serializeDisplaySelectionKey(stateSnapshot.displaySelection)
    });

    const firstState: ViewerSessionState = { ...session.state, displaySelection: createChannelMonoSelection('first') };
    const secondState: ViewerSessionState = { ...session.state, displaySelection: createChannelMonoSelection('second') };

    const first = service.enqueue(session.id, firstState, 1);
    const second = service.enqueue(session.id, secondState, 2);

    await Promise.all([first, second]);

    expect(updates).toEqual([
      {
        sessionId: session.id,
        token: 2,
        thumbnailDataUrl: 'channelMono:second:'
      }
    ]);
  });

  it('skips discarded jobs once the backing session is gone', async () => {
    const sessions = new Map<string, OpenedImageSession>([['session-1', createSession()]]);
    const onThumbnailReady = vi.fn();
    const service = new ThumbnailService({
      getSession: (sessionId) => sessions.get(sessionId) ?? null,
      onThumbnailReady,
      windowLike: null,
      createThumbnailDataUrl: () => 'thumb'
    });

    const promise = service.enqueue('session-1', sessions.get('session-1')!.state, 1);
    sessions.delete('session-1');
    service.discard('session-1');

    await promise;

    expect(onThumbnailReady).not.toHaveBeenCalled();
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
      onThumbnailReady: (event) => {
        updates.push(`${event.sessionId}:${event.thumbnailDataUrl}`);
      },
      windowLike: null,
      createThumbnailDataUrl: ({ session }) => `${session.id}-thumb`
    });

    const first = service.enqueue(firstSession.id, firstSession.state, 1);
    const second = service.enqueue(secondSession.id, secondSession.state, 2);
    service.clear();

    await Promise.all([first, second]);

    expect(updates).toEqual(['first:first-thumb']);
  });

  it('passes session, layer, and state snapshot to the thumbnail renderer', async () => {
    const session = createSession();
    const createThumbnailDataUrl = vi.fn(() => 'thumb');
    const service = new ThumbnailService({
      getSession: () => session,
      onThumbnailReady: () => undefined,
      windowLike: null,
      createThumbnailDataUrl
    });

    await service.enqueue(session.id, session.state, 1);

    expect(createThumbnailDataUrl).toHaveBeenCalledWith({
      session,
      layer: session.decoded.layers[0],
      stateSnapshot: session.state,
      thumbnailOptions: {}
    });
  });

  it('passes thumbnail auto exposure options to the renderer', async () => {
    const session = createSession();
    const createThumbnailDataUrl = vi.fn(() => 'thumb');
    const service = new ThumbnailService({
      getSession: () => session,
      onThumbnailReady: () => undefined,
      windowLike: null,
      createThumbnailDataUrl
    });

    await service.enqueue(session.id, session.state, 1, {
      autoExposureEnabled: true,
      autoExposurePercentile: 98.2
    });

    expect(createThumbnailDataUrl).toHaveBeenCalledWith({
      session,
      layer: session.decoded.layers[0],
      stateSnapshot: session.state,
      thumbnailOptions: {
        autoExposureEnabled: true,
        autoExposurePercentile: 98.2
      }
    });
  });

  it('stops pending thumbnail work after dispose', async () => {
    const session = createSession();
    const rafCallbacks: FrameRequestCallback[] = [];
    const idleCallbacks: Array<() => void> = [];
    const createThumbnailDataUrl = vi.fn(() => 'thumb');
    const onThumbnailReady = vi.fn();
    const service = new ThumbnailService({
      getSession: () => session,
      onThumbnailReady,
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

    const pending = service.enqueue(session.id, session.state, 1).catch((error) => error);
    service.dispose();

    for (const callback of rafCallbacks) {
      callback(0);
    }
    for (const callback of idleCallbacks) {
      callback();
    }

    await pending;

    expect(createThumbnailDataUrl).not.toHaveBeenCalled();
    expect(onThumbnailReady).not.toHaveBeenCalled();
  });
});
