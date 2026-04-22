import { describe, expect, it } from 'vitest';
import { buildReloadedSessionState } from '../src/app/session-resource';
import { createInitialState } from '../src/viewer-store';
import { createImage, createLayerFromChannels } from './helpers/state-fixtures';

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
