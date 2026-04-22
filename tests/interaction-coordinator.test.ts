import { describe, expect, it, vi } from 'vitest';
import { ViewerInteractionCoordinator } from '../src/interaction-coordinator';
import { createInitialState } from '../src/viewer-store';

function createHarness() {
  let sessionState = createInitialState();
  let frameCallback: FrameRequestCallback | null = null;
  const onInteractionChange = vi.fn();
  const commitViewState = vi.fn((view) => {
    sessionState = {
      ...sessionState,
      ...view
    };
  });
  const cancelFrame = vi.fn(() => {
    frameCallback = null;
  });

  const coordinator = new ViewerInteractionCoordinator({
    initialSessionState: sessionState,
    getSessionState: () => sessionState,
    commitViewState,
    onInteractionChange,
    scheduleFrame: (callback) => {
      frameCallback = callback;
      return 1;
    },
    cancelFrame
  });

  return {
    coordinator,
    onInteractionChange,
    commitViewState,
    cancelFrame,
    getSessionState: () => sessionState,
    setSessionState: (next: typeof sessionState) => {
      sessionState = next;
    },
    flush: () => {
      const callback = frameCallback;
      frameCallback = null;
      callback?.(0);
    },
    hasScheduledFrame: () => frameCallback !== null
  };
}

describe('interaction coordinator', () => {
  it('coalesces multiple view and hover updates into one frame publish', () => {
    const harness = createHarness();

    harness.coordinator.enqueueViewPatch({ zoom: 2 });
    harness.coordinator.enqueueHoverPixel({ ix: 1, iy: 0 });
    harness.coordinator.enqueueViewPatch({ panX: 4, panY: 5 });
    harness.coordinator.enqueueHoverPixel({ ix: 2, iy: 1 });

    expect(harness.hasScheduledFrame()).toBe(true);

    harness.flush();

    expect(harness.onInteractionChange).toHaveBeenCalledTimes(1);
    expect(harness.onInteractionChange).toHaveBeenCalledWith(
      {
        view: {
          zoom: 2,
          panX: 4,
          panY: 5,
          panoramaYawDeg: 0,
          panoramaPitchDeg: 0,
          panoramaHfovDeg: 100
        },
        hoveredPixel: { ix: 2, iy: 1 },
        draftRoi: null
      },
      {
        view: {
          zoom: 1,
          panX: 0,
          panY: 0,
          panoramaYawDeg: 0,
          panoramaPitchDeg: 0,
          panoramaHfovDeg: 100
        },
        hoveredPixel: null,
        draftRoi: null
      }
    );
    expect(harness.commitViewState).toHaveBeenCalledTimes(1);
    expect(harness.commitViewState).toHaveBeenCalledWith({
      zoom: 2,
      panX: 4,
      panY: 5,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100
    });
  });

  it('ignores same-pixel hover updates even when object identity changes', () => {
    const harness = createHarness();

    harness.coordinator.enqueueHoverPixel({ ix: 3, iy: 2 });
    harness.flush();
    harness.onInteractionChange.mockClear();
    harness.commitViewState.mockClear();

    harness.coordinator.enqueueHoverPixel({ ix: 3, iy: 2 });

    expect(harness.hasScheduledFrame()).toBe(false);
    expect(harness.onInteractionChange).not.toHaveBeenCalled();
    expect(harness.commitViewState).not.toHaveBeenCalled();
  });

  it('ignores numerically identical view patches', () => {
    const harness = createHarness();

    harness.coordinator.enqueueViewPatch({
      zoom: 1,
      panX: 0,
      panY: 0,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100
    });

    expect(harness.hasScheduledFrame()).toBe(false);
    expect(harness.onInteractionChange).not.toHaveBeenCalled();
    expect(harness.commitViewState).not.toHaveBeenCalled();
  });

  it('rehydrates from session state and clears transient hover on session switches', () => {
    const harness = createHarness();

    harness.coordinator.enqueueViewPatch({ zoom: 3, panX: 6 });
    harness.coordinator.enqueueHoverPixel({ ix: 4, iy: 4 });
    harness.flush();

    const nextSessionState = {
      ...harness.getSessionState(),
      zoom: 7,
      panX: 8,
      panY: 9,
      panoramaYawDeg: 15,
      panoramaPitchDeg: 10,
      panoramaHfovDeg: 70
    };
    harness.setSessionState(nextSessionState);

    const sync = harness.coordinator.syncSessionState(nextSessionState, { clearHover: true });

    expect(sync.changed).toBe(true);
    expect(sync.state).toEqual({
      view: {
        zoom: 7,
        panX: 8,
        panY: 9,
        panoramaYawDeg: 15,
        panoramaPitchDeg: 10,
        panoramaHfovDeg: 70
      },
      hoveredPixel: null,
      draftRoi: null
    });
    expect(sync.previous.hoveredPixel).toEqual({ ix: 4, iy: 4 });
    expect(harness.cancelFrame).toHaveBeenCalledTimes(0);
  });
});
