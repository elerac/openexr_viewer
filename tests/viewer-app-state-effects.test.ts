import { describe, expect, it, vi } from 'vitest';
import {
  applyActiveColormapLutEffects,
  applySessionResourceEffects
} from '../src/app/viewer-app-state-effects';
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

function createLayeredSession(id: string): OpenedImageSession {
  const decoded: DecodedExrImage = {
    width: 2,
    height: 1,
    layers: [
      createLayerFromChannels({
        R: [1, 0],
        G: [1, 0],
        B: [1, 0]
      }, 'beauty'),
      createLayerFromChannels({
        R: [0, 1],
        G: [0, 1],
        B: [0, 1]
      }, 'alt')
    ]
  };
  const state = buildViewerStateForLayer(createInitialState(), decoded, 0);
  return {
    id,
    filename: `${id}.exr`,
    displayName: `${id}.exr`,
    fileSizeBytes: 32,
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

  it('ensures the active colormap lut after session and layer state transitions only', () => {
    const core = new ViewerAppCore();
    const ensureActiveColormapLutLoaded = vi.fn(() => Promise.resolve());
    core.subscribeState((transition) => {
      applyActiveColormapLutEffects(transition, { ensureActiveColormapLutLoaded });
    });

    const first = createLayeredSession('session-1');
    const second = createSession('session-2');
    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'activeColormapSet', colormapId: '2' });
    core.dispatch({ type: 'activeLayerSet', activeLayer: 1 });
    core.dispatch({ type: 'activeSessionReset', viewport: { width: 200, height: 100 } });
    core.dispatch({ type: 'sessionLoaded', session: second });

    const inactiveReload = createSession(first.id);
    core.dispatch({
      type: 'sessionReloaded',
      sessionId: first.id,
      session: inactiveReload
    });

    const activeReload = createSession(second.id);
    core.dispatch({
      type: 'sessionReloaded',
      sessionId: second.id,
      session: activeReload
    });

    core.dispatch({
      type: 'activeSessionSwitched',
      sessionId: first.id
    });
    core.dispatch({
      type: 'sessionClosed',
      sessionId: first.id
    });

    expect(ensureActiveColormapLutLoaded).toHaveBeenCalledTimes(7);
  });
});
