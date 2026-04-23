// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPanoramaVerticalFovDeg, screenToPanoramaPixel, ViewerInteraction } from '../src/interaction';
import { createChannelRgbSelection, createViewerState } from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('viewer interaction roi gestures', () => {
  it('keeps plain drag for panning', () => {
    const harness = createHarness();

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 50, clientY: 50 });
    dispatchPointer(harness.element, 'pointermove', { pointerId: 1, clientX: 70, clientY: 50 });
    dispatchPointer(harness.element, 'pointerup', { pointerId: 1, clientX: 70, clientY: 50 });

    expect(harness.onViewChange).toHaveBeenCalled();
    expect(harness.onDraftRoi).not.toHaveBeenCalled();
    expect(harness.onCommitRoi).not.toHaveBeenCalled();
  });

  it('keeps plain click for probe lock toggling', () => {
    const harness = createHarness();

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 50, clientY: 50 });
    dispatchPointer(harness.element, 'pointerup', { pointerId: 1, clientX: 50, clientY: 50 });

    expect(harness.onToggleLockPixel).toHaveBeenCalledWith({ ix: 5, iy: 5 });
    expect(harness.onDraftRoi).not.toHaveBeenCalled();
    expect(harness.onCommitRoi).not.toHaveBeenCalled();
  });

  it('creates and commits a rectangular ROI with shift-drag', () => {
    const harness = createHarness();

    dispatchPointer(harness.element, 'pointerdown', {
      pointerId: 1,
      clientX: 50,
      clientY: 50,
      shiftKey: true
    });
    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      clientX: 79,
      clientY: 69,
      shiftKey: true
    });
    dispatchPointer(harness.element, 'pointerup', {
      pointerId: 1,
      clientX: 79,
      clientY: 69,
      shiftKey: true
    });

    expect(harness.onDraftRoi).toHaveBeenCalledWith({ x0: 5, y0: 5, x1: 5, y1: 5 });
    expect(harness.onCommitRoi).toHaveBeenCalledWith({ x0: 5, y0: 5, x1: 7, y1: 6 });
    expect(harness.onToggleLockPixel).not.toHaveBeenCalled();
  });

  it('clears ROI when shift-drag resolves to a single image pixel', () => {
    const harness = createHarness();

    dispatchPointer(harness.element, 'pointerdown', {
      pointerId: 1,
      clientX: 50,
      clientY: 50,
      shiftKey: true
    });
    dispatchPointer(harness.element, 'pointerup', {
      pointerId: 1,
      clientX: 50,
      clientY: 50,
      shiftKey: true
    });

    expect(harness.onDraftRoi).toHaveBeenCalledWith({ x0: 5, y0: 5, x1: 5, y1: 5 });
    expect(harness.onCommitRoi).toHaveBeenCalledWith(null);
    expect(harness.onToggleLockPixel).not.toHaveBeenCalled();
  });

  it('does not start ROI interaction in panorama mode', () => {
    const harness = createHarness({
      viewerMode: 'panorama'
    });

    dispatchPointer(harness.element, 'pointerdown', {
      pointerId: 1,
      clientX: 50,
      clientY: 50,
      shiftKey: true
    });
    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      clientX: 70,
      clientY: 60,
      shiftKey: true
    });
    dispatchPointer(harness.element, 'pointerup', {
      pointerId: 1,
      clientX: 70,
      clientY: 60,
      shiftKey: true
    });

    expect(harness.onDraftRoi).not.toHaveBeenCalled();
    expect(harness.onCommitRoi).not.toHaveBeenCalled();
    expect(harness.onViewChange).toHaveBeenCalled();
  });
});

describe('viewer interaction panorama keyboard orbit', () => {
  it('orbits panorama yaw with left and right keyboard input', () => {
    const harness = createHarness({
      viewerMode: 'panorama'
    }, {
      imageSize: { width: 360, height: 180 }
    });

    harness.interaction.handlePanoramaKeyboardOrbit('right');
    expect(harness.getState().panoramaYawDeg).toBeCloseTo(5);

    harness.interaction.handlePanoramaKeyboardOrbit('left');
    expect(harness.getState().panoramaYawDeg).toBeCloseTo(0);
  });

  it('orbits panorama pitch with up and down keyboard input while respecting clamps', () => {
    const harness = createHarness({
      viewerMode: 'panorama',
      panoramaPitchDeg: 88
    });

    harness.interaction.handlePanoramaKeyboardOrbit('up');
    expect(harness.getState().panoramaPitchDeg).toBe(89);

    harness.interaction.handlePanoramaKeyboardOrbit('up');
    expect(harness.getState().panoramaPitchDeg).toBe(89);

    harness.interaction.handlePanoramaKeyboardOrbit('down');
    expect(harness.getState().panoramaPitchDeg).toBe(84);
  });

  it('refreshes panorama hover from the last pointer position after keyboard orbiting', () => {
    const harness = createHarness({
      viewerMode: 'panorama'
    }, {
      imageSize: { width: 360, height: 180 }
    });

    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      clientX: 50,
      clientY: 50
    });
    harness.onHoverPixel.mockClear();

    harness.interaction.handlePanoramaKeyboardOrbit('right');

    const expected = screenToPanoramaPixel(50, 50, harness.getState(), { width: 100, height: 100 }, 360, 180);
    expect(expected).not.toBeNull();
    expect(harness.onHoverPixel).toHaveBeenCalledWith(expected);
  });

  it('is a no-op when there is no active image or no valid viewport', () => {
    const noImageHarness = createHarness({
      viewerMode: 'panorama'
    }, {
      imageSize: null
    });
    noImageHarness.interaction.handlePanoramaKeyboardOrbit('right');
    expect(noImageHarness.onViewChange).not.toHaveBeenCalled();
    expect(noImageHarness.onHoverPixel).not.toHaveBeenCalled();

    const invalidViewportHarness = createHarness({
      viewerMode: 'panorama'
    }, {
      viewport: { width: 0, height: 0 }
    });
    invalidViewportHarness.interaction.handlePanoramaKeyboardOrbit('right');
    expect(invalidViewportHarness.onViewChange).not.toHaveBeenCalled();
    expect(invalidViewportHarness.onHoverPixel).not.toHaveBeenCalled();
  });

  it('keeps tap nudge behavior and advances continuously while a key is held', () => {
    const harness = createHarness({
      viewerMode: 'panorama'
    });

    harness.interaction.setPanoramaKeyboardOrbitInput(createPanoramaKeyboardOrbitInput({ right: true }));
    expect(harness.getState().panoramaYawDeg).toBeCloseTo(5);
    expect(harness.hasScheduledFrame()).toBe(true);

    harness.flushFrame(1000);
    expect(harness.getState().panoramaYawDeg).toBeCloseTo(5);

    harness.flushFrame(1020);
    expect(harness.getState().panoramaYawDeg).toBeCloseTo(8);
    expect(harness.hasScheduledFrame()).toBe(true);

    harness.interaction.setPanoramaKeyboardOrbitInput(createPanoramaKeyboardOrbitInput());
    expect(harness.hasScheduledFrame()).toBe(false);

    harness.flushFrame(1040);
    expect(harness.getState().panoramaYawDeg).toBeCloseTo(8);
  });

  it('matches the current vertical orbit feel for single-key nudges on a wide viewport', () => {
    const viewport = { width: 160, height: 90 };
    const rightHarness = createHarness({
      viewerMode: 'panorama'
    }, {
      viewport
    });
    const upHarness = createHarness({
      viewerMode: 'panorama'
    }, {
      viewport
    });
    const expectedDeltaDeg = getPanoramaVerticalFovDeg(rightHarness.getState().panoramaHfovDeg, viewport) * 0.05;

    rightHarness.interaction.handlePanoramaKeyboardOrbit('right');
    upHarness.interaction.handlePanoramaKeyboardOrbit('up');

    expect(rightHarness.getState().panoramaYawDeg).toBeCloseTo(expectedDeltaDeg);
    expect(upHarness.getState().panoramaPitchDeg).toBeCloseTo(expectedDeltaDeg);
  });

  it('combines diagonal held input into a single panorama update', () => {
    const harness = createHarness({
      viewerMode: 'panorama'
    });

    harness.interaction.setPanoramaKeyboardOrbitInput(createPanoramaKeyboardOrbitInput({
      up: true,
      right: true
    }));
    expect(harness.getState().panoramaYawDeg).toBeCloseTo(5);
    expect(harness.getState().panoramaPitchDeg).toBeCloseTo(5);

    harness.flushFrame(1000);
    harness.flushFrame(1020);

    expect(harness.getState().panoramaYawDeg).toBeCloseTo(8);
    expect(harness.getState().panoramaPitchDeg).toBeCloseTo(8);
  });

  it('keeps diagonal held input normalized on a wide viewport', () => {
    const viewport = { width: 160, height: 90 };
    const harness = createHarness({
      viewerMode: 'panorama'
    }, {
      viewport
    });
    const expectedTapDeltaDeg = getPanoramaVerticalFovDeg(harness.getState().panoramaHfovDeg, viewport) * 0.05;
    const expectedHeldDeltaDeg = getPanoramaVerticalFovDeg(harness.getState().panoramaHfovDeg, viewport) * 0.08;

    harness.interaction.setPanoramaKeyboardOrbitInput(createPanoramaKeyboardOrbitInput({
      up: true,
      right: true
    }));
    expect(harness.getState().panoramaYawDeg).toBeCloseTo(expectedTapDeltaDeg);
    expect(harness.getState().panoramaPitchDeg).toBeCloseTo(expectedTapDeltaDeg);

    harness.flushFrame(1000);
    harness.flushFrame(1020);

    expect(harness.getState().panoramaYawDeg).toBeCloseTo(expectedHeldDeltaDeg);
    expect(harness.getState().panoramaPitchDeg).toBeCloseTo(expectedHeldDeltaDeg);
  });

  it('cancels opposite held keys on each axis', () => {
    const harness = createHarness({
      viewerMode: 'panorama'
    });

    harness.interaction.setPanoramaKeyboardOrbitInput(createPanoramaKeyboardOrbitInput({
      left: true,
      right: true,
      up: true,
      down: true
    }));

    expect(harness.getState().panoramaYawDeg).toBe(0);
    expect(harness.getState().panoramaPitchDeg).toBe(0);

    harness.flushFrame(1000);
    harness.flushFrame(1020);

    expect(harness.getState().panoramaYawDeg).toBe(0);
    expect(harness.getState().panoramaPitchDeg).toBe(0);
    expect(harness.onViewChange).not.toHaveBeenCalled();
  });

  it('clamps large frame deltas while held to avoid jumpy camera motion', () => {
    const harness = createHarness({
      viewerMode: 'panorama'
    });

    harness.interaction.setPanoramaKeyboardOrbitInput(createPanoramaKeyboardOrbitInput({ right: true }));
    harness.flushFrame(1000);
    harness.flushFrame(1200);

    expect(harness.getState().panoramaYawDeg).toBeCloseTo(12.5);
  });

  it('refreshes panorama hover from the last pointer position during continuous keyboard orbiting', () => {
    const harness = createHarness({
      viewerMode: 'panorama'
    }, {
      imageSize: { width: 360, height: 180 }
    });

    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      clientX: 50,
      clientY: 50
    });

    harness.interaction.setPanoramaKeyboardOrbitInput(createPanoramaKeyboardOrbitInput({ right: true }));
    harness.onHoverPixel.mockClear();

    harness.flushFrame(1000);
    harness.flushFrame(1020);

    const expected = screenToPanoramaPixel(50, 50, harness.getState(), { width: 100, height: 100 }, 360, 180);
    expect(expected).not.toBeNull();
    expect(harness.onHoverPixel).toHaveBeenCalledWith(expected);
  });
});

function createHarness(
  stateOverrides: Parameters<typeof createViewerState>[0] = {},
  options: {
    imageSize?: { width: number; height: number } | null;
    viewport?: { width: number; height: number };
  } = {}
) {
  const element = document.createElement('div');
  document.body.append(element);
  const viewport = options.viewport ?? { width: 100, height: 100 };
  const imageSize = options.imageSize === undefined ? { width: 10, height: 10 } : options.imageSize;

  let capturedPointerId: number | null = null;
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
  });
  element.setPointerCapture = ((pointerId: number) => {
    capturedPointerId = pointerId;
  }) as typeof element.setPointerCapture;
  element.releasePointerCapture = ((pointerId: number) => {
    if (capturedPointerId === pointerId) {
      capturedPointerId = null;
    }
  }) as typeof element.releasePointerCapture;
  element.hasPointerCapture = ((pointerId: number) => capturedPointerId === pointerId) as typeof element.hasPointerCapture;

  let state = createViewerState({
    zoom: 10,
    panX: 5,
    panY: 5,
    displaySelection: createChannelRgbSelection('R', 'G', 'B'),
    ...stateOverrides
  });

  const onViewChange = vi.fn((next) => {
    state = { ...state, ...next };
  });
  const onHoverPixel = vi.fn();
  const onToggleLockPixel = vi.fn();
  const onDraftRoi = vi.fn();
  const onCommitRoi = vi.fn();
  let frameCallback: FrameRequestCallback | null = null;
  let nextFrameId = 1;
  const cancelFrame = vi.fn((frameId: number) => {
    if (frameId >= 1) {
      frameCallback = null;
    }
  });

  const interaction = new ViewerInteraction(element, {
    getState: () => state,
    getViewport: () => viewport,
    getImageSize: () => imageSize,
    onViewChange,
    onHoverPixel,
    onToggleLockPixel,
    onDraftRoi,
    onCommitRoi
  }, {
    scheduleFrame: (callback) => {
      frameCallback = callback;
      return nextFrameId++;
    },
    cancelFrame
  });

  return {
    interaction,
    element,
    getState: () => state,
    onViewChange,
    onHoverPixel,
    onToggleLockPixel,
    onDraftRoi,
    onCommitRoi,
    flushFrame: (timestamp: number) => {
      const callback = frameCallback;
      frameCallback = null;
      callback?.(timestamp);
    },
    hasScheduledFrame: () => frameCallback !== null,
    cancelFrame
  };
}

function createPanoramaKeyboardOrbitInput(overrides: Partial<{
  up: boolean;
  left: boolean;
  down: boolean;
  right: boolean;
}> = {}) {
  return {
    up: false,
    left: false,
    down: false,
    right: false,
    ...overrides
  };
}

function dispatchPointer(
  element: HTMLElement,
  type: string,
  init: Partial<PointerEventInit> & { pointerId: number; clientX: number; clientY: number }
): void {
  element.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    button: 0,
    ...init
  }));
}
