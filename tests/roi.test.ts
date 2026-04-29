import { describe, expect, it } from 'vitest';
import {
  clampImageRoiToBounds,
  createImageRoiFromPixels,
  normalizeImageRoi
} from '../src/roi';
import {
  createRoiAdjustmentDrag,
  resolveRoiAdjustmentHandle,
  updateRoiFromAdjustmentDrag
} from '../src/interaction/roi-mode';
import { createViewerState } from './helpers/state-fixtures';

describe('roi helpers', () => {
  it('normalizes unordered inclusive ROI bounds', () => {
    expect(normalizeImageRoi({ x0: 7, y0: 5, x1: 3, y1: 2 })).toEqual({
      x0: 3,
      y0: 2,
      x1: 7,
      y1: 5
    });
  });

  it('creates a 1x1 ROI when both pixels are the same', () => {
    expect(createImageRoiFromPixels({ ix: 4, iy: 6 }, { ix: 4, iy: 6 })).toEqual({
      x0: 4,
      y0: 6,
      x1: 4,
      y1: 6
    });
  });

  it('clamps ROIs to image bounds and preserves inclusive extents', () => {
    expect(clampImageRoiToBounds({ x0: -3, y0: 1, x1: 6, y1: 9 }, 5, 4)).toEqual({
      x0: 0,
      y0: 1,
      x1: 4,
      y1: 3
    });
  });

  it('returns null when the ROI no longer intersects the image', () => {
    expect(clampImageRoiToBounds({ x0: 8, y0: 8, x1: 10, y1: 10 }, 4, 4)).toBeNull();
  });

  it('resolves ROI adjustment handles from screen-projected ROI bounds', () => {
    const state = createViewerState({ zoom: 10, panX: 5, panY: 5 });
    const viewport = { width: 100, height: 100 };
    const roi = { x0: 4, y0: 4, x1: 5, y1: 5 };

    expect(resolveRoiAdjustmentHandle({ x: 40, y: 40 }, roi, state, viewport)).toBe('corner-nw');
    expect(resolveRoiAdjustmentHandle({ x: 50, y: 40 }, roi, state, viewport)).toBe('edge-n');
    expect(resolveRoiAdjustmentHandle({ x: 60, y: 50 }, roi, state, viewport)).toBe('edge-e');
    expect(resolveRoiAdjustmentHandle({ x: 50, y: 50 }, roi, state, viewport)).toBe('move');
    expect(resolveRoiAdjustmentHandle({ x: 25, y: 50 }, roi, state, viewport)).toBeNull();
  });

  it('moves and resizes ROI adjustment drags in inclusive image coordinates', () => {
    const state = createViewerState({ zoom: 10, panX: 5, panY: 5 });
    const imageSize = { width: 10, height: 10 };

    expect(updateRoiFromAdjustmentDrag(
      createRoiAdjustmentDrag('move', { x: 50, y: 50 }, { x0: 4, y0: 4, x1: 5, y1: 5 }),
      { x: 70, y: 70 },
      state,
      imageSize
    )).toEqual({ x0: 6, y0: 6, x1: 7, y1: 7 });

    expect(updateRoiFromAdjustmentDrag(
      createRoiAdjustmentDrag('edge-e', { x: 60, y: 50 }, { x0: 4, y0: 4, x1: 5, y1: 5 }),
      { x: 86, y: 50 },
      state,
      imageSize
    )).toEqual({ x0: 4, y0: 4, x1: 8, y1: 5 });
  });

  it('clamps ROI moves to decoded image bounds', () => {
    const state = createViewerState({ zoom: 10, panX: 5, panY: 5 });

    expect(updateRoiFromAdjustmentDrag(
      createRoiAdjustmentDrag('move', { x: 20, y: 20 }, { x0: 0, y0: 0, x1: 1, y1: 1 }),
      { x: -10, y: -20 },
      state,
      { width: 10, height: 10 }
    )).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });

    expect(updateRoiFromAdjustmentDrag(
      createRoiAdjustmentDrag('move', { x: 80, y: 80 }, { x0: 7, y0: 7, x1: 9, y1: 9 }),
      { x: 120, y: 120 },
      state,
      { width: 10, height: 10 }
    )).toEqual({ x0: 7, y0: 7, x1: 9, y1: 9 });
  });

  it('supports centered ROI resize with ctrl-style options', () => {
    const state = createViewerState({ zoom: 10, panX: 5, panY: 5 });

    expect(updateRoiFromAdjustmentDrag(
      createRoiAdjustmentDrag('edge-e', { x: 60, y: 50 }, { x0: 2, y0: 3, x1: 5, y1: 4 }),
      { x: 70, y: 50 },
      state,
      { width: 10, height: 10 },
      { resizeFromCenter: true }
    )).toEqual({ x0: 1, y0: 3, x1: 6, y1: 4 });
  });

  it('preserves ROI aspect ratio when requested', () => {
    const state = createViewerState({ zoom: 10, panX: 5, panY: 5 });

    expect(updateRoiFromAdjustmentDrag(
      createRoiAdjustmentDrag('corner-se', { x: 60, y: 40 }, { x0: 2, y0: 2, x1: 5, y1: 3 }),
      { x: 80, y: 43 },
      state,
      { width: 10, height: 10 },
      { preserveAspectRatio: true }
    )).toEqual({ x0: 2, y0: 2, x1: 7, y1: 4 });
  });

  it('leaves near-aligned ROI moves unsnapped', () => {
    const state = createViewerState({ zoom: 10, panX: 5, panY: 5 });

    expect(updateRoiFromAdjustmentDrag(
      createRoiAdjustmentDrag('move', { x: 30, y: 30 }, { x0: 2, y0: 2, x1: 3, y1: 3 }),
      { x: 42, y: 30 },
      state,
      { width: 10, height: 10 }
    )).toEqual({ x0: 3, y0: 2, x1: 4, y1: 3 });
  });
});
