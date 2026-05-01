import { describe, expect, it, vi } from 'vitest';
import { applySessionResourceEffects } from '../src/app/viewer-app-state-effects';
import { ViewerAppCore } from '../src/app/viewer-app-core';
import type { RenderCacheService } from '../src/services/render-cache-service';
import type { ThumbnailService } from '../src/services/thumbnail-service';
import type { OpenedImageThumbnailOptions } from '../src/thumbnail';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import { createLayerFromChannels } from './helpers/state-fixtures';
import type { DecodedExrImage, OpenedImageSession, ViewerSessionState } from '../src/types';

function createDecodedImage(): DecodedExrImage {
  return {
    width: 2,
    height: 1,
    layers: [createLayerFromChannels({
      R: [1, 0],
      G: [1, 0],
      B: [1, 0]
    }, 'beauty')]
  };
}

function createSession(id: string): OpenedImageSession {
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

describe('viewer app state effects', () => {
  it('requeues opened image thumbnails when auto exposure preferences change', () => {
    const core = new ViewerAppCore();
    const enqueue = vi.fn<(
      sessionId: string,
      stateSnapshot: ViewerSessionState,
      token: number,
      thumbnailOptions?: OpenedImageThumbnailOptions
    ) => Promise<void>>(() => Promise.resolve());
    const renderCache = {
      trackSession: vi.fn(),
      discard: vi.fn(),
      clear: vi.fn()
    } as unknown as RenderCacheService;
    const thumbnailService = {
      enqueue,
      discard: vi.fn(),
      clear: vi.fn()
    } as unknown as ThumbnailService;

    core.subscribeState((transition) => {
      applySessionResourceEffects(transition, core, renderCache, thumbnailService);
    });

    core.dispatch({ type: 'sessionLoaded', session: createSession('session-1') });
    core.dispatch({ type: 'sessionLoaded', session: createSession('session-2') });
    enqueue.mockClear();

    core.dispatch({ type: 'autoExposureSet', enabled: true });

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map(([sessionId]) => sessionId)).toEqual(['session-1', 'session-2']);
    expect(enqueue.mock.calls.map((call) => call[3])).toEqual([
      { autoExposureEnabled: true, autoExposurePercentile: 99.5 },
      { autoExposureEnabled: true, autoExposurePercentile: 99.5 }
    ]);

    enqueue.mockClear();
    core.dispatch({ type: 'autoExposurePercentileSet', percentile: 98.24 });

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map((call) => call[3])).toEqual([
      { autoExposureEnabled: true, autoExposurePercentile: 98.2 },
      { autoExposureEnabled: true, autoExposurePercentile: 98.2 }
    ]);

    enqueue.mockClear();
    core.dispatch({ type: 'autoExposureSet', enabled: false });

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map((call) => call[3])).toEqual([
      { autoExposureEnabled: false, autoExposurePercentile: 98.2 },
      { autoExposureEnabled: false, autoExposurePercentile: 98.2 }
    ]);
  });
});
