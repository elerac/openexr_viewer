// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { serializeDisplaySelectionKey } from '../src/display-model';
import { ChannelThumbnailService } from '../src/services/channel-thumbnail-service';
import type { ThumbnailWindowLike } from '../src/services/thumbnail-service';
import { createChannelViewThumbnailDataUrl } from '../src/thumbnail';
import { DecodedExrImage, OpenedImageSession, ViewerSessionState } from '../src/types';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayerFromChannels,
  createStokesSelection
} from './helpers/state-fixtures';

function createDecodedImage(channelValues: Record<string, number[]> = {
  R: [0, 1],
  G: [0, 1],
  B: [0, 1]
}): DecodedExrImage {
  const layer = createLayerFromChannels(channelValues, 'beauty');

  return {
    width: 2,
    height: 1,
    layers: [layer]
  };
}

function createSession(
  id = 'session-1',
  decoded = createDecodedImage()
): OpenedImageSession {
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

function createImmediateThumbnailWindowLike(): ThumbnailWindowLike {
  return {
    setTimeout,
    clearTimeout,
    requestIdleCallback: (callback) => {
      queueMicrotask(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => 50
        });
      });
      return 1;
    },
    cancelIdleCallback: () => undefined
  };
}

describe('channel thumbnail service', () => {
  it('suppresses stale async jobs when a newer token replaces the same request key', async () => {
    const session = createSession();
    const updates: Array<{ requestKey: string; token: number; thumbnailDataUrl: string | null }> = [];
    let resolveFirstThumbnail!: (value: string) => void;
    const firstThumbnail = new Promise<string>((resolve) => {
      resolveFirstThumbnail = resolve;
    });
    const service = new ChannelThumbnailService({
      getSession: () => session,
      onThumbnailReady: (event) => {
        updates.push(event);
      },
      windowLike: createImmediateThumbnailWindowLike(),
      createThumbnailDataUrl: ({ selection }) => {
        if (serializeDisplaySelectionKey(selection) === 'channelMono:R:') {
          return firstThumbnail;
        }

        return Promise.resolve(serializeDisplaySelectionKey(selection));
      }
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

    resolveFirstThumbnail('channelMono:R:');
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
      windowLike: createImmediateThumbnailWindowLike(),
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

  it('promotes a queued clicked-channel request without interrupting active work', async () => {
    const session = createSession();
    const updates: string[] = [];
    const started: string[] = [];
    let resolveFirstThumbnail!: (value: string) => void;
    const firstThumbnail = new Promise<string>((resolve) => {
      resolveFirstThumbnail = resolve;
    });
    const service = new ChannelThumbnailService({
      getSession: () => session,
      onThumbnailReady: (event) => {
        updates.push(`${event.requestKey}:${event.thumbnailDataUrl}`);
      },
      windowLike: createImmediateThumbnailWindowLike(),
      createThumbnailDataUrl: ({ selection }) => {
        const selectionKey = serializeDisplaySelectionKey(selection);
        started.push(selectionKey);
        if (selectionKey === 'channelMono:R:') {
          return firstThumbnail;
        }

        return selectionKey;
      }
    });

    const first = service.enqueue({
      sessionId: session.id,
      requestKey: 'request-r',
      contextKey: 'context-r',
      token: 1,
      stateSnapshot: session.state,
      selection: createChannelMonoSelection('R')
    });
    const second = service.enqueue({
      sessionId: session.id,
      requestKey: 'request-g',
      contextKey: 'context-g',
      token: 2,
      stateSnapshot: session.state,
      selection: createChannelMonoSelection('G')
    });
    const third = service.enqueue({
      sessionId: session.id,
      requestKey: 'request-b',
      contextKey: 'context-b',
      token: 3,
      stateSnapshot: session.state,
      selection: createChannelMonoSelection('B')
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['channelMono:R:']);
    expect(service.promoteRequest('request-b')).toBe(true);
    expect(started).toEqual(['channelMono:R:']);

    resolveFirstThumbnail('channelMono:R:');
    await Promise.all([first, second, third]);

    expect(started).toEqual(['channelMono:R:', 'channelMono:B:', 'channelMono:G:']);
    expect(updates).toEqual([
      'request-r:channelMono:R:',
      'request-b:channelMono:B:',
      'request-g:channelMono:G:'
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
    const registry = {
      defaultId: '0',
      assets: [{ label: 'RdBu', file: 'RdBu.npy', diverging: true }],
      options: [{ id: '0', label: 'RdBu' }]
    };
    const createThumbnailDataUrl = vi.fn(() => 'thumb');
    const service = new ChannelThumbnailService({
      getSession: () => session,
      getColormapRegistry: () => registry,
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
      selection,
      colormapRegistry: registry,
      abortSignal: expect.any(AbortSignal)
    });
  });

  it('falls back to the grayscale thumbnail when a registered colormap preview cannot be loaded', async () => {
    const selection = createStokesSelection('s1_over_s0');
    const decoded = createDecodedImage({
      S0: [1, 1],
      S1: [1, -1],
      S2: [0, 0],
      S3: [0, 0]
    });
    const session = createSession('session-1', decoded);
    const onThumbnailReady = vi.fn();
    vi.stubGlobal('ImageData', class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number
      ) {}
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData: vi.fn()
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,fallback');
    const service = new ChannelThumbnailService({
      getSession: () => session,
      getColormapRegistry: () => ({
        defaultId: '0',
        assets: [{ label: 'RdBu', file: 'RdBu.npy', diverging: true }],
        options: [{ id: '0', label: 'RdBu' }]
      }),
      onThumbnailReady,
      windowLike: null,
      findColormapIdByLabel: () => '0',
      loadColormapLut: vi.fn(async () => {
        throw new Error('thumbnail colormap failed');
      })
    });

    await service.enqueue({
      sessionId: session.id,
      requestKey: 'request-1',
      contextKey: 'context-1',
      token: 1,
      stateSnapshot: session.state,
      selection
    });

    expect(onThumbnailReady).toHaveBeenCalledWith({
      sessionId: session.id,
      requestKey: 'request-1',
      contextKey: 'context-1',
      token: 1,
      thumbnailDataUrl: createChannelViewThumbnailDataUrl(session.decoded, session.state, selection)
    });
  });
});
