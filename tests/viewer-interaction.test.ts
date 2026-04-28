// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screenToImage } from '../src/interaction/image-geometry';
import { getPanoramaVerticalFovDeg, screenToPanoramaPixel } from '../src/interaction/panorama-geometry';
import { ViewerInteraction } from '../src/interaction/viewer-interaction';
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

  it('ignores secondary-button drags outside screenshot selection', () => {
    const harness = createHarness();

    dispatchPointer(harness.element, 'pointerdown', {
      pointerId: 1,
      button: 2,
      buttons: 2,
      clientX: 50,
      clientY: 50
    });
    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      button: 2,
      buttons: 2,
      clientX: 70,
      clientY: 50
    });
    dispatchPointer(harness.element, 'pointerup', {
      pointerId: 1,
      button: 2,
      clientX: 70,
      clientY: 50
    });

    expect(harness.onViewChange).not.toHaveBeenCalled();
    expect(harness.onToggleLockPixel).not.toHaveBeenCalled();
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

  it('edits screenshot selection instead of panning, probing, or drawing ROI', () => {
    const harness = createHarness({}, {
      screenshotRect: { x: 20, y: 20, width: 40, height: 30 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 40, clientY: 35 });
    dispatchPointer(harness.element, 'pointermove', { pointerId: 1, clientX: 50, clientY: 28 });
    dispatchPointer(harness.element, 'pointerup', { pointerId: 1, clientX: 50, clientY: 28 });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 30,
        y: 13,
        width: 40,
        height: 30
      },
      squareSnapped: false,
      snapGuide: { x: 50, y: null }
    });
    expect(harness.onViewChange).not.toHaveBeenCalled();
    expect(harness.onToggleLockPixel).not.toHaveBeenCalled();
    expect(harness.onDraftRoi).not.toHaveBeenCalled();
    expect(harness.onCommitRoi).not.toHaveBeenCalled();
  });

  it('edits screenshot selection in panorama mode instead of orbiting', () => {
    const harness = createHarness({
      viewerMode: 'panorama'
    }, {
      screenshotRect: { x: 20, y: 20, width: 40, height: 30 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 60, clientY: 35 });
    dispatchPointer(harness.element, 'pointermove', { pointerId: 1, clientX: 75, clientY: 35 });
    dispatchPointer(harness.element, 'pointerup', { pointerId: 1, clientX: 75, clientY: 35 });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 20,
        y: 20,
        width: 60,
        height: 30
      },
      squareSnapped: false,
      snapGuide: { x: 50, y: null }
    });
    expect(harness.onViewChange).not.toHaveBeenCalled();
  });

  it('snaps screenshot moves to the rendered image center in image mode', () => {
    const harness = createHarness({
      panX: 4
    }, {
      screenshotRect: { x: 10, y: 20, width: 40, height: 20 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 20, clientY: 30 });
    dispatchPointer(harness.element, 'pointermove', { pointerId: 1, clientX: 48, clientY: 50 });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 40,
        y: 40,
        width: 40,
        height: 20
      },
      squareSnapped: false,
      snapGuide: { x: 60, y: 50 }
    });
  });

  it('snaps panorama screenshot moves to the fisheye projection center', () => {
    const harness = createHarness({
      viewerMode: 'panorama',
      panoramaYawDeg: 90,
      panoramaPitchDeg: 20
    }, {
      screenshotRect: { x: 10, y: 20, width: 40, height: 20 },
      imageSize: { width: 360, height: 180 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 20, clientY: 30 });
    dispatchPointer(harness.element, 'pointermove', { pointerId: 1, clientX: 38, clientY: 50 });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 30,
        y: 40,
        width: 40,
        height: 20
      },
      squareSnapped: false,
      snapGuide: { x: 50, y: 50 }
    });

    dispatchPointer(harness.element, 'pointerup', { pointerId: 1, clientX: 38, clientY: 50 });
    expect(harness.onScreenshotSelectionSnapGuideChange).toHaveBeenCalledWith({ x: null, y: null });
  });

  it('snaps screenshot moves to rendered image edges in image mode', () => {
    const harness = createHarness({}, {
      screenshotRect: { x: 20, y: 20, width: 40, height: 20 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 30, clientY: 30 });
    dispatchPointer(harness.element, 'pointermove', { pointerId: 1, clientX: 68, clientY: 30 });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 60,
        y: 20,
        width: 40,
        height: 20
      },
      squareSnapped: false,
      snapGuide: { x: 100, y: null }
    });
  });

  it('snaps panorama screenshot moves to fisheye projection edges', () => {
    const harness = createHarness({
      viewerMode: 'panorama',
      panoramaHfovDeg: 180
    }, {
      screenshotRect: { x: 80, y: 20, width: 40, height: 20 },
      imageSize: { width: 360, height: 180 },
      viewport: { width: 160, height: 90 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 90, clientY: 30 });
    dispatchPointer(harness.element, 'pointermove', { pointerId: 1, clientX: 94, clientY: 30 });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 85,
        y: 20,
        width: 40,
        height: 20
      },
      squareSnapped: false,
      snapGuide: { x: 125, y: null }
    });
  });

  it('snaps near-square screenshot resize drags and reports active snap feedback', () => {
    const harness = createHarness({}, {
      screenshotRect: { x: 20, y: 20, width: 40, height: 40 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 60, clientY: 60 });
    dispatchPointer(harness.element, 'pointermove', { pointerId: 1, clientX: 72, clientY: 70 });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 20,
        y: 20,
        width: 51,
        height: 51
      },
      squareSnapped: true,
      snapGuide: { x: null, y: null }
    });
    expect(harness.onScreenshotSelectionSquareSnapChange).toHaveBeenCalledWith(true);
  });

  it('preserves screenshot selection aspect ratio while resizing with shift held', () => {
    const harness = createHarness({}, {
      screenshotRect: { x: 20, y: 20, width: 80, height: 40 },
      viewport: { width: 200, height: 160 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 60 });
    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      clientX: 140,
      clientY: 65,
      shiftKey: true
    });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 20,
        y: 20,
        width: 120,
        height: 60
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
    expect(harness.onScreenshotSelectionSquareSnapChange).toHaveBeenLastCalledWith(false);
  });

  it('resizes screenshot selection from center while resizing with ctrl held', () => {
    const harness = createHarness({}, {
      imageSize: null,
      screenshotRect: { x: 40, y: 20, width: 80, height: 40 },
      viewport: { width: 200, height: 160 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 120, clientY: 40 });
    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      clientX: 140,
      clientY: 40,
      ctrlKey: true
    });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 20,
        y: 20,
        width: 120,
        height: 40
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
  });

  it('resizes screenshot selection from center with ctrl secondary-button drags', () => {
    const harness = createHarness({}, {
      imageSize: null,
      screenshotRect: { x: 40, y: 20, width: 80, height: 40 },
      viewport: { width: 200, height: 160 }
    });

    dispatchPointer(harness.element, 'pointerdown', {
      pointerId: 1,
      button: 2,
      buttons: 2,
      clientX: 120,
      clientY: 40,
      ctrlKey: true
    });
    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      button: 2,
      buttons: 2,
      clientX: 140,
      clientY: 40,
      ctrlKey: true
    });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 20,
        y: 20,
        width: 120,
        height: 40
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
    expect(harness.onScreenshotSelectionResizeActiveChange).toHaveBeenCalledWith(true);

    dispatchPointer(harness.element, 'pointerup', {
      pointerId: 1,
      button: 2,
      clientX: 140,
      clientY: 40
    });

    expect(harness.onScreenshotSelectionResizeActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('suppresses viewer context menus during screenshot selection', () => {
    const harness = createHarness({}, {
      screenshotRect: { x: 20, y: 20, width: 40, height: 30 }
    });
    const surfaceEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 35
    });

    expect(harness.element.dispatchEvent(surfaceEvent)).toBe(false);
    expect(surfaceEvent.defaultPrevented).toBe(true);

    const controls = document.createElement('div');
    controls.className = 'screenshot-selection-controls';
    harness.element.append(controls);
    const controlsEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true
    });

    expect(controls.dispatchEvent(controlsEvent)).toBe(true);
    expect(controlsEvent.defaultPrevented).toBe(false);
  });

  it('keeps ctrl move drags as move drags', () => {
    const harness = createHarness({}, {
      imageSize: null,
      screenshotRect: { x: 20, y: 20, width: 40, height: 30 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 40, clientY: 35 });
    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      clientX: 50,
      clientY: 45,
      ctrlKey: true
    });

    expect(harness.onScreenshotSelectionRectChange).toHaveBeenCalledWith({
      rect: {
        x: 30,
        y: 30,
        width: 40,
        height: 30
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
  });

  it('clears screenshot square snap feedback on pointer up', () => {
    const harness = createHarness({}, {
      screenshotRect: { x: 20, y: 20, width: 40, height: 40 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 60, clientY: 60 });
    dispatchPointer(harness.element, 'pointermove', { pointerId: 1, clientX: 72, clientY: 70 });
    dispatchPointer(harness.element, 'pointerup', { pointerId: 1, clientX: 72, clientY: 70 });

    expect(harness.onScreenshotSelectionSquareSnapChange).toHaveBeenLastCalledWith(false);
  });

  it('does not activate screenshot square snap feedback for move drags', () => {
    const harness = createHarness({}, {
      screenshotRect: { x: 20, y: 20, width: 40, height: 40 }
    });

    dispatchPointer(harness.element, 'pointerdown', { pointerId: 1, clientX: 40, clientY: 40 });
    dispatchPointer(harness.element, 'pointermove', { pointerId: 1, clientX: 50, clientY: 50 });
    dispatchPointer(harness.element, 'pointerup', { pointerId: 1, clientX: 50, clientY: 50 });

    expect(harness.onScreenshotSelectionSquareSnapChange).not.toHaveBeenCalledWith(true);
  });

  it('reports active screenshot resize only for edge and corner drags', () => {
    const moveHarness = createHarness({}, {
      screenshotRect: { x: 20, y: 20, width: 40, height: 30 }
    });

    dispatchPointer(moveHarness.element, 'pointerdown', { pointerId: 1, clientX: 40, clientY: 35 });
    dispatchPointer(moveHarness.element, 'pointermove', { pointerId: 1, clientX: 50, clientY: 45 });
    dispatchPointer(moveHarness.element, 'pointerup', { pointerId: 1, clientX: 50, clientY: 45 });

    expect(moveHarness.onScreenshotSelectionResizeActiveChange).toHaveBeenCalledWith(false);

    const resizeHarness = createHarness({}, {
      screenshotRect: { x: 20, y: 20, width: 40, height: 30 }
    });

    dispatchPointer(resizeHarness.element, 'pointerdown', { pointerId: 1, clientX: 60, clientY: 35 });
    dispatchPointer(resizeHarness.element, 'pointermove', { pointerId: 1, clientX: 72, clientY: 35 });

    expect(resizeHarness.onScreenshotSelectionResizeActiveChange).toHaveBeenCalledWith(true);

    dispatchPointer(resizeHarness.element, 'pointerup', { pointerId: 1, clientX: 72, clientY: 35 });

    expect(resizeHarness.onScreenshotSelectionResizeActiveChange).toHaveBeenLastCalledWith(false);
  });
});

describe('viewer interaction image keyboard panning', () => {
  it('pans image horizontally with left and right keyboard input', () => {
    const harness = createHarness();

    harness.interaction.handleViewerKeyboardNavigation('right');
    expect(harness.getState().panX).toBeCloseTo(5.25);

    harness.interaction.handleViewerKeyboardNavigation('left');
    expect(harness.getState().panX).toBeCloseTo(5);
  });

  it('pans image vertically with up and down keyboard input', () => {
    const harness = createHarness();

    harness.interaction.handleViewerKeyboardNavigation('up');
    expect(harness.getState().panY).toBeCloseTo(4.75);

    harness.interaction.handleViewerKeyboardNavigation('down');
    expect(harness.getState().panY).toBeCloseTo(5);
  });

  it('keeps tap nudge behavior and advances continuously while an image pan key is held', () => {
    const harness = createHarness();

    harness.interaction.setViewerKeyboardNavigationInput(createViewerKeyboardNavigationInput({ right: true }));
    expect(harness.getState().panX).toBeCloseTo(5.25);
    expect(harness.hasScheduledFrame()).toBe(true);

    harness.flushFrame(1000);
    expect(harness.getState().panX).toBeCloseTo(5.25);

    harness.flushFrame(1020);
    expect(harness.getState().panX).toBeCloseTo(5.55);
    expect(harness.hasScheduledFrame()).toBe(true);

    harness.interaction.setViewerKeyboardNavigationInput(createViewerKeyboardNavigationInput());
    expect(harness.hasScheduledFrame()).toBe(false);

    harness.flushFrame(1040);
    expect(harness.getState().panX).toBeCloseTo(5.55);
  });

  it('cancels opposite held image pan keys on each axis', () => {
    const harness = createHarness();

    harness.interaction.setViewerKeyboardNavigationInput(createViewerKeyboardNavigationInput({
      left: true,
      right: true,
      up: true,
      down: true
    }));

    expect(harness.getState().panX).toBe(5);
    expect(harness.getState().panY).toBe(5);

    harness.flushFrame(1000);
    harness.flushFrame(1020);

    expect(harness.getState().panX).toBe(5);
    expect(harness.getState().panY).toBe(5);
    expect(harness.onViewChange).not.toHaveBeenCalled();
  });

  it('is a no-op when image keyboard panning has no active image or no valid viewport', () => {
    const noImageHarness = createHarness({}, {
      imageSize: null
    });
    noImageHarness.interaction.handleViewerKeyboardNavigation('right');
    expect(noImageHarness.onViewChange).not.toHaveBeenCalled();
    expect(noImageHarness.onHoverPixel).not.toHaveBeenCalled();

    const invalidViewportHarness = createHarness({}, {
      viewport: { width: 0, height: 0 }
    });
    invalidViewportHarness.interaction.handleViewerKeyboardNavigation('right');
    expect(invalidViewportHarness.onViewChange).not.toHaveBeenCalled();
    expect(invalidViewportHarness.onHoverPixel).not.toHaveBeenCalled();
  });

  it('refreshes image hover from the last pointer position after keyboard panning', () => {
    const harness = createHarness({}, {
      imageSize: { width: 20, height: 20 },
      viewport: { width: 200, height: 100 }
    });

    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      clientX: 50,
      clientY: 50
    });
    harness.onHoverPixel.mockClear();

    harness.interaction.handleViewerKeyboardNavigation('right');

    const expected = screenToImage(50, 50, harness.getState(), { width: 200, height: 100 }, 20, 20);
    expect(expected).not.toBeNull();
    expect(harness.onHoverPixel).toHaveBeenCalledWith(expected);
  });
});

describe('viewer interaction keyboard zoom', () => {
  it('zooms image in and out around the viewport center when no pointer is available', () => {
    const harness = createHarness();

    harness.interaction.handleViewerKeyboardZoom('in');
    expect(harness.getState().zoom).toBeCloseTo(12.5);
    expect(harness.getState().panX).toBeCloseTo(5);
    expect(harness.getState().panY).toBeCloseTo(5);

    harness.interaction.handleViewerKeyboardZoom('out');
    expect(harness.getState().zoom).toBeCloseTo(10);
    expect(harness.getState().panX).toBeCloseTo(5);
    expect(harness.getState().panY).toBeCloseTo(5);
  });

  it('zooms image around the last pointer position and refreshes hover', () => {
    const harness = createHarness({}, {
      imageSize: { width: 20, height: 20 },
      viewport: { width: 100, height: 100 }
    });

    dispatchPointer(harness.element, 'pointermove', {
      pointerId: 1,
      clientX: 75,
      clientY: 50
    });
    harness.onHoverPixel.mockClear();

    harness.interaction.handleViewerKeyboardZoom('in');

    expect(harness.getState().zoom).toBeCloseTo(12.5);
    expect(harness.getState().panX).toBeCloseTo(5.5);
    expect(harness.getState().panY).toBeCloseTo(5);

    const expected = screenToImage(75, 50, harness.getState(), { width: 100, height: 100 }, 20, 20);
    expect(expected).not.toBeNull();
    expect(harness.onHoverPixel).toHaveBeenCalledWith(expected);
  });

  it('keeps tap zoom behavior and advances smoothly while an image zoom key is held', () => {
    const harness = createHarness();

    harness.interaction.setViewerKeyboardZoomInput(createViewerKeyboardZoomInput({ zoomIn: true }));
    expect(harness.getState().zoom).toBeCloseTo(12.5);
    expect(harness.hasScheduledFrame()).toBe(true);

    harness.flushFrame(1000);
    expect(harness.getState().zoom).toBeCloseTo(12.5);

    harness.flushFrame(1020);
    expect(harness.getState().zoom).toBeGreaterThan(12.5);
    expect(harness.getState().zoom).toBeGreaterThan(12.65);
    expect(harness.getState().zoom).toBeLessThan(12.7);
    expect(harness.hasScheduledFrame()).toBe(true);

    const zoomAfterHeldFrame = harness.getState().zoom;
    harness.interaction.setViewerKeyboardZoomInput(createViewerKeyboardZoomInput());
    expect(harness.hasScheduledFrame()).toBe(false);

    harness.flushFrame(1040);
    expect(harness.getState().zoom).toBe(zoomAfterHeldFrame);
  });

  it('is a no-op for image zoom when there is no active image or no valid viewport', () => {
    const noImageHarness = createHarness({}, {
      imageSize: null
    });
    noImageHarness.interaction.handleViewerKeyboardZoom('in');
    expect(noImageHarness.onViewChange).not.toHaveBeenCalled();
    expect(noImageHarness.onHoverPixel).not.toHaveBeenCalled();

    const invalidViewportHarness = createHarness({}, {
      viewport: { width: 0, height: 0 }
    });
    invalidViewportHarness.interaction.handleViewerKeyboardZoom('out');
    expect(invalidViewportHarness.onViewChange).not.toHaveBeenCalled();
    expect(invalidViewportHarness.onHoverPixel).not.toHaveBeenCalled();
  });

  it('zooms panorama FOV in and out while respecting clamps', () => {
    const harness = createHarness({
      viewerMode: 'panorama',
      panoramaHfovDeg: 100
    }, {
      imageSize: { width: 360, height: 180 }
    });

    harness.interaction.handleViewerKeyboardZoom('in');
    expect(harness.getState().panoramaHfovDeg).toBeCloseTo(80);

    harness.interaction.handleViewerKeyboardZoom('out');
    expect(harness.getState().panoramaHfovDeg).toBeCloseTo(100);

    const minHarness = createHarness({
      viewerMode: 'panorama',
      panoramaHfovDeg: 1
    });
    minHarness.interaction.handleViewerKeyboardZoom('in');
    expect(minHarness.getState().panoramaHfovDeg).toBe(1);

    const maxHarness = createHarness({
      viewerMode: 'panorama',
      panoramaHfovDeg: 180
    });
    maxHarness.interaction.handleViewerKeyboardZoom('out');
    expect(maxHarness.getState().panoramaHfovDeg).toBe(180);
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
    screenshotRect?: { x: number; y: number; width: number; height: number } | null;
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
  let screenshotRect = options.screenshotRect ?? null;
  const onScreenshotSelectionRectChange = vi.fn((update) => {
    screenshotRect = update.rect;
  });
  const onScreenshotSelectionHandleHover = vi.fn();
  const onScreenshotSelectionResizeActiveChange = vi.fn();
  const onScreenshotSelectionSquareSnapChange = vi.fn();
  const onScreenshotSelectionSnapGuideChange = vi.fn();
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
    onCommitRoi,
    getScreenshotSelection: () => ({
      active: screenshotRect !== null,
      rect: screenshotRect
    }),
    onScreenshotSelectionRectChange,
    onScreenshotSelectionHandleHover,
    onScreenshotSelectionResizeActiveChange,
    onScreenshotSelectionSquareSnapChange,
    onScreenshotSelectionSnapGuideChange
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
    onScreenshotSelectionRectChange,
    onScreenshotSelectionHandleHover,
    onScreenshotSelectionResizeActiveChange,
    onScreenshotSelectionSquareSnapChange,
    onScreenshotSelectionSnapGuideChange,
    getScreenshotRect: () => screenshotRect,
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

function createViewerKeyboardNavigationInput(overrides: Partial<{
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

function createViewerKeyboardZoomInput(overrides: Partial<{
  zoomIn: boolean;
  zoomOut: boolean;
}> = {}) {
  return {
    zoomIn: false,
    zoomOut: false,
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
