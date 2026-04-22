import { describe, expect, it } from 'vitest';
import {
  clampImageRoiToBounds,
  createImageRoiFromPixels,
  normalizeImageRoi
} from '../src/roi';

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
});
