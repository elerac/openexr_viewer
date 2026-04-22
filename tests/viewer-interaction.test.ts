// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewerInteraction } from '../src/interaction';
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

function createHarness(stateOverrides: Parameters<typeof createViewerState>[0] = {}) {
  const element = document.createElement('div');
  document.body.append(element);

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

  new ViewerInteraction(element, {
    getState: () => state,
    getViewport: () => ({ width: 100, height: 100 }),
    getImageSize: () => ({ width: 10, height: 10 }),
    onViewChange,
    onHoverPixel,
    onToggleLockPixel,
    onDraftRoi,
    onCommitRoi
  });

  return {
    element,
    onViewChange,
    onHoverPixel,
    onToggleLockPixel,
    onDraftRoi,
    onCommitRoi
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
