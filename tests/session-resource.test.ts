import { describe, expect, it } from 'vitest';
import { buildLoadedSession, buildReloadedSessionState } from '../src/app/session-resource';
import { createInitialState } from '../src/viewer-store';
import { createImage, createLayerFromChannels } from './helpers/state-fixtures';
import type { DecodedExrImage } from '../src/types';

describe('session resource ROI handling', () => {
  it('clamps ROIs to the reloaded image bounds', () => {
    const previousImage = createImage([
      createLayerFromChannels({
        R: [1, 2, 3, 4],
        G: [1, 2, 3, 4],
        B: [1, 2, 3, 4]
      })
    ]);
    const decoded = {
      width: 1,
      height: 2,
      layers: [createLayerFromChannels({ R: [1, 2], G: [1, 2], B: [1, 2] })]
    };

    const nextState = buildReloadedSessionState(
      {
        ...createInitialState(),
        roi: { x0: 0, y0: 0, x1: 1, y1: 1 }
      },
      previousImage,
      decoded
    );

    expect(nextState.roi).toEqual({ x0: 0, y0: 0, x1: 0, y1: 1 });
  });

  it('clears ROIs that no longer intersect the reloaded image', () => {
    const previousImage = createImage([
      createLayerFromChannels({
        R: [1, 2, 3, 4],
        G: [1, 2, 3, 4],
        B: [1, 2, 3, 4]
      })
    ]);
    const decoded = {
      width: 1,
      height: 1,
      layers: [createLayerFromChannels({ R: [1], G: [1], B: [1] })]
    };

    const nextState = buildReloadedSessionState(
      {
        ...createInitialState(),
        roi: { x0: 3, y0: 3, x1: 4, y1: 4 }
      },
      previousImage,
      decoded
    );

    expect(nextState.roi).toBeNull();
  });
});

describe('session resource auto-fit handling', () => {
  it('preserves the carried image view when loading with auto-fit disabled', () => {
    const session = buildLoadedSession({
      sessionId: 'session-2',
      decoded: createSizedImage(8, 8),
      filename: 'second.exr',
      fileSizeBytes: 16,
      source: { kind: 'url', url: '/second.exr' },
      existingSessions: [],
      defaultColormapId: '0',
      viewport: { width: 200, height: 100 },
      currentSessionState: {
        ...createInitialState(),
        zoom: 3,
        panX: 4,
        panY: 5
      },
      hasActiveSession: true,
      previousImage: createSizedImage(6, 6),
      autoFitImageOnSelect: false
    });

    expect(session.state).toMatchObject({
      zoom: 3,
      panX: 5,
      panY: 6
    });
  });

  it('fits the newly active image when loading with auto-fit enabled', () => {
    const session = buildLoadedSession({
      sessionId: 'session-2',
      decoded: createSizedImage(8, 8),
      filename: 'second.exr',
      fileSizeBytes: 16,
      source: { kind: 'url', url: '/second.exr' },
      existingSessions: [],
      defaultColormapId: '0',
      viewport: { width: 200, height: 100 },
      currentSessionState: {
        ...createInitialState(),
        zoom: 3,
        panX: 4,
        panY: 5
      },
      hasActiveSession: true,
      previousImage: createSizedImage(6, 6),
      autoFitImageOnSelect: true
    });

    expect(session.state).toMatchObject({
      zoom: 12.5,
      panX: 4,
      panY: 4
    });
  });
});

function createSizedImage(width: number, height: number): DecodedExrImage {
  const pixelCount = width * height;
  return {
    width,
    height,
    layers: [
      createLayerFromChannels({
        R: new Float32Array(pixelCount).fill(1),
        G: new Float32Array(pixelCount).fill(1),
        B: new Float32Array(pixelCount).fill(1)
      })
    ]
  };
}
