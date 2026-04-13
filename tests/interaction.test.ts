import { describe, expect, it } from 'vitest';
import { DEFAULT_COLORMAP_ID } from '../src/colormaps';
import { clampZoom, exposureToScale, screenToImage, zoomAroundPoint } from '../src/interaction';
import { ViewerState } from '../src/types';

const state: ViewerState = {
  exposureEv: 0,
  visualizationMode: 'rgb',
  activeColormapId: DEFAULT_COLORMAP_ID,
  colormapRange: null,
  colormapRangeMode: 'alwaysAuto',
  colormapZeroCentered: false,
  zoom: 16,
  panX: 100,
  panY: 200,
  activeLayer: 0,
  displaySource: 'channels',
  stokesParameter: null,
  displayR: 'R',
  displayG: 'G',
  displayB: 'B',
  hoveredPixel: null,
  lockedPixel: null
};

describe('interaction math', () => {
  it('clamps zoom bounds', () => {
    expect(clampZoom(0.001)).toBe(0.125);
    expect(clampZoom(999)).toBe(512);
    expect(clampZoom(2)).toBe(2);
  });

  it('maps EV +1 to 2x scale', () => {
    expect(exposureToScale(1)).toBe(2);
    expect(exposureToScale(0)).toBe(1);
    expect(exposureToScale(-1)).toBe(0.5);
  });

  it('maps screen coordinates into image pixels', () => {
    const viewport = { width: 640, height: 480 };
    const pixel = screenToImage(320, 240, state, viewport, 400, 400);
    expect(pixel).toEqual({ ix: 100, iy: 200 });
  });

  it('keeps cursor-anchored position stable during zoom', () => {
    const viewport = { width: 640, height: 480 };
    const sx = 420;
    const sy = 300;

    const before = screenToImage(sx, sy, state, viewport, 10000, 10000);
    const next = zoomAroundPoint(state, viewport, sx, sy, state.zoom * 2);
    const after = screenToImage(sx, sy, { ...state, ...next }, viewport, 10000, 10000);

    expect(before).toEqual(after);
  });

  it('nearest mapping keeps neighboring screen points inside same source pixel at high zoom', () => {
    const viewport = { width: 640, height: 480 };
    const hiZoomState = { ...state, zoom: 32 };

    const pixelA = screenToImage(320.1, 240.1, hiZoomState, viewport, 10000, 10000);
    const pixelB = screenToImage(320.8, 240.8, hiZoomState, viewport, 10000, 10000);

    expect(pixelA).toEqual(pixelB);
  });
});
