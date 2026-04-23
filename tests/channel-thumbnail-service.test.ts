import { describe, expect, it, vi } from 'vitest';
import { serializeDisplaySelectionKey } from '../src/display-model';
import { ChannelThumbnailService } from '../src/services/channel-thumbnail-service';
import { DecodedExrImage, OpenedImageSession, ViewerSessionState } from '../src/types';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayerFromChannels
} from './helpers/state-fixtures';

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

describe('channel thumbnail service', () => {
  it('suppresses stale jobs when a newer token replaces the same request key', async () => {
    const session = createSession();
    const updates: Array<{ requestKey: string; token: number; thumbnailDataUrl: string | null }> = [];
    const service = new ChannelThumbnailService({
      getSession: () => session,
      onThumbnailReady: (event) => {
        updates.push(event);
      },
      windowLike: null,
      createThumbnailDataUrl: ({ selection }) => serializeDisplaySelectionKey(selection)
    });

    const firstState: ViewerSessionState = { ...session.state, exposureEv: 0 };
    const secondState: ViewerSessionState = { ...session.state, exposureEv: 1 };

    const first = service.enqueue({
      sessionId: session.id,
      requestKey: 'request-1',
      contextKey: 'context-1',
      token: 1,
      stateSnapshot: firstState,
      selection: createChannelMonoSelection('R')
    });
    const second = service.enqueue({
      sessionId: session.id,
      requestKey: 'request-1',
      contextKey: 'context-1',
      token: 2,
      stateSnapshot: secondState,
      selection: createChannelMonoSelection('G')
    });

    await Promise.all([first, second]);

    expect(updates).toEqual([
      {
        sessionId: session.id,
        requestKey: 'request-1',
        contextKey: 'context-1',
        token: 2,
        thumbnailDataUrl: 'channelMono:G:'
      }
    ]);
  });

  it('processes distinct request keys for refreshed thumbnails independently', async () => {
    const session = createSession();
    const updates: string[] = [];
    const service = new ChannelThumbnailService({
      getSession: () => session,
      onThumbnailReady: (event) => {
        updates.push(`${event.requestKey}:${event.thumbnailDataUrl}`);
      },
      windowLike: null,
      createThumbnailDataUrl: ({ stateSnapshot }) => `exp-${stateSnapshot.exposureEv}`
    });

    await Promise.all([
      service.enqueue({
        sessionId: session.id,
        requestKey: 'request-exposure-0',
        contextKey: 'context-r',
        token: 1,
        stateSnapshot: { ...session.state, exposureEv: 0 },
        selection: createChannelRgbSelection('R', 'G', 'B')
      }),
      service.enqueue({
        sessionId: session.id,
        requestKey: 'request-exposure-1',
        contextKey: 'context-r',
        token: 2,
        stateSnapshot: { ...session.state, exposureEv: 1 },
        selection: createChannelRgbSelection('R', 'G', 'B')
      })
    ]);

    expect(updates).toEqual([
      'request-exposure-0:exp-0',
      'request-exposure-1:exp-1'
    ]);
  });

  it('skips discarded session jobs once the backing session is gone', async () => {
    const sessions = new Map<string, OpenedImageSession>([['session-1', createSession()]]);
    const onThumbnailReady = vi.fn();
    const service = new ChannelThumbnailService({
      getSession: (sessionId) => sessions.get(sessionId) ?? null,
      onThumbnailReady,
      windowLike: null,
      createThumbnailDataUrl: () => 'thumb'
    });

    const promise = service.enqueue({
      sessionId: 'session-1',
      requestKey: 'request-1',
      contextKey: 'context-1',
      token: 1,
      stateSnapshot: sessions.get('session-1')!.state,
      selection: createChannelMonoSelection('R')
    });
    sessions.delete('session-1');
    service.discardSession('session-1');

    await promise;

    expect(onThumbnailReady).not.toHaveBeenCalled();
  });

  it('passes session, layer, state snapshot, and selection to the thumbnail renderer', async () => {
    const session = createSession();
    const createThumbnailDataUrl = vi.fn(() => 'thumb');
    const service = new ChannelThumbnailService({
      getSession: () => session,
      onThumbnailReady: () => undefined,
      windowLike: null,
      createThumbnailDataUrl
    });

    const selection = createChannelMonoSelection('R');
    await service.enqueue({
      sessionId: session.id,
      requestKey: 'request-1',
      contextKey: 'context-1',
      token: 1,
      stateSnapshot: session.state,
      selection
    });

    expect(createThumbnailDataUrl).toHaveBeenCalledWith({
      session,
      layer: session.decoded.layers[0],
      stateSnapshot: session.state,
      selection
    });
  });
});
