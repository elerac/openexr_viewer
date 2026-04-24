import { describe, expect, it } from 'vitest';
import { DEFAULT_COLORMAP_ID } from '../src/colormaps';
import {
  clampZoom,
  exposureToScale,
  imageToScreen,
  preserveImagePanOnViewportChange,
  screenToImage,
  zoomAroundPoint
} from '../src/interaction/image-geometry';
import {
  clampPanoramaHfov,
  clampPanoramaPitch,
  normalizePanoramaYaw,
  orbitPanorama,
  projectPanoramaPixelToScreen,
  screenToPanoramaPixel,
  zoomPanorama
} from '../src/interaction/panorama-geometry';
import { ViewerState } from '../src/types';
import { createChannelMonoSelection, createChannelRgbSelection } from './helpers/state-fixtures';

const state: ViewerState = {
  exposureEv: 0,
  viewerMode: 'image',
  visualizationMode: 'rgb',
  activeColormapId: DEFAULT_COLORMAP_ID,
  colormapRange: null,
  colormapRangeMode: 'alwaysAuto',
  colormapZeroCentered: false,
  stokesDegreeModulation: { aolp: false, cop: true, top: true },
  stokesAolpDegreeModulationMode: 'value',
  zoom: 16,
  panX: 100,
  panY: 200,
  panoramaYawDeg: 0,
  panoramaPitchDeg: 0,
  panoramaHfovDeg: 100,
  activeLayer: 0,
  displaySelection: createChannelRgbSelection('R', 'G', 'B'),
  hoveredPixel: null,
  lockedPixel: null,
  roi: null,
  draftRoi: null
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

  it('preserves image screen position when the viewport frame changes', () => {
    const previousViewport = { left: 100, top: 40, width: 640, height: 480 };
    const nextViewport = { left: 200, top: 55, width: 520, height: 420 };
    const imagePoint = { x: 130, y: 210 };

    const before = imageToScreen(imagePoint.x, imagePoint.y, state, previousViewport);
    const nextPan = preserveImagePanOnViewportChange(state, previousViewport, nextViewport);
    const after = imageToScreen(imagePoint.x, imagePoint.y, { ...state, ...nextPan }, nextViewport);

    expect(after.x + nextViewport.left).toBeCloseTo(before.x + previousViewport.left);
    expect(after.y + nextViewport.top).toBeCloseTo(before.y + previousViewport.top);
  });

  it('nearest mapping keeps neighboring screen points inside same source pixel at high zoom', () => {
    const viewport = { width: 640, height: 480 };
    const hiZoomState = { ...state, zoom: 32 };

    const pixelA = screenToImage(320.1, 240.1, hiZoomState, viewport, 10000, 10000);
    const pixelB = screenToImage(320.8, 240.8, hiZoomState, viewport, 10000, 10000);

    expect(pixelA).toEqual(pixelB);
  });

  it('maps panorama screen rays to equirectangular probe pixels', () => {
    const viewport = { width: 800, height: 400 };
    const panoramaState = {
      ...state,
      viewerMode: 'panorama' as const,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0
    };

    expect(screenToPanoramaPixel(400, 0, panoramaState, viewport, 400, 200)).toEqual({ ix: 200, iy: 65 });
    expect(screenToPanoramaPixel(400, 200, panoramaState, viewport, 400, 200)).toEqual({ ix: 200, iy: 100 });
    expect(screenToPanoramaPixel(400, 399, panoramaState, viewport, 400, 200)).toEqual({ ix: 200, iy: 134 });
    expect(
      screenToPanoramaPixel(400, 200, { ...panoramaState, panoramaYawDeg: 90 }, viewport, 400, 200)
    ).toEqual({ ix: 300, iy: 100 });
  });

  it('projects the center panorama pixel near the viewport center', () => {
    const viewport = { width: 800, height: 400 };
    const projected = projectPanoramaPixelToScreen(
      500,
      250,
      {
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 90
      },
      viewport,
      1000,
      500
    );

    expect(Math.abs((projected?.centerX ?? 0) - 400)).toBeLessThan(2);
    expect(Math.abs((projected?.centerY ?? 0) - 200)).toBeLessThan(2);
  });

  it('grows projected panorama pixel footprint as hfov decreases', () => {
    const viewport = { width: 800, height: 400 };
    const wide = projectPanoramaPixelToScreen(
      500,
      250,
      {
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 90
      },
      viewport,
      1000,
      500
    );
    const zoomed = projectPanoramaPixelToScreen(
      500,
      250,
      {
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 10
      },
      viewport,
      1000,
      500
    );

    expect(zoomed).not.toBeNull();
    expect(wide).not.toBeNull();
    expect((zoomed?.width ?? 0) > (wide?.width ?? 0)).toBe(true);
    expect((zoomed?.height ?? 0) > (wide?.height ?? 0)).toBe(true);
  });

  it('resolves a panorama footprint center that roundtrips to the same texel', () => {
    const viewport = { width: 800, height: 400 };
    const panoramaState = {
      ...state,
      viewerMode: 'panorama' as const,
      panoramaPitchDeg: 20,
      panoramaHfovDeg: 2,
      displaySelection: createChannelMonoSelection('Y')
    };
    const pixel = screenToPanoramaPixel(400, 200, panoramaState, viewport, 1000, 500);
    const projected = pixel
      ? projectPanoramaPixelToScreen(pixel.ix, pixel.iy, panoramaState, viewport, 1000, 500)
      : null;

    expect(pixel).not.toBeNull();
    expect(projected).not.toBeNull();
    expect(
      screenToPanoramaPixel(
        projected?.centerX ?? Number.NaN,
        projected?.centerY ?? Number.NaN,
        panoramaState,
        viewport,
        1000,
        500
      )
    ).toEqual(pixel);
  });

  it('moves fixed panorama texels upward as positive pitch changes increase', () => {
    const viewport = { width: 800, height: 400 };
    const texel = { ix: 500, iy: 280 };
    const base = projectPanoramaPixelToScreen(
      texel.ix,
      texel.iy,
      {
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 90
      },
      viewport,
      1000,
      500
    );
    const pitched = projectPanoramaPixelToScreen(
      texel.ix,
      texel.iy,
      {
        panoramaYawDeg: 0,
        panoramaPitchDeg: 10,
        panoramaHfovDeg: 90
      },
      viewport,
      1000,
      500
    );
    const morePitched = projectPanoramaPixelToScreen(
      texel.ix,
      texel.iy,
      {
        panoramaYawDeg: 0,
        panoramaPitchDeg: 20,
        panoramaHfovDeg: 90
      },
      viewport,
      1000,
      500
    );

    expect(base).not.toBeNull();
    expect(pitched).not.toBeNull();
    expect(morePitched).not.toBeNull();
    expect((pitched?.centerY ?? 0) < (base?.centerY ?? 0)).toBe(true);
    expect((morePitched?.centerY ?? 0) < (pitched?.centerY ?? 0)).toBe(true);
  });

  it('uses the same panorama mapping for hover and click probe lookups', () => {
    const viewport = { width: 800, height: 400 };
    const panoramaState = {
      ...state,
      viewerMode: 'panorama' as const,
      panoramaYawDeg: -90,
      panoramaPitchDeg: 0
    };

    const hoverPixel = screenToPanoramaPixel(400, 200, panoramaState, viewport, 400, 200);
    const clickPixel = screenToPanoramaPixel(400, 200, panoramaState, viewport, 400, 200);

    expect(hoverPixel).toEqual({ ix: 100, iy: 100 });
    expect(clickPixel).toEqual(hoverPixel);
  });

  it('maps positive panorama pitch toward the lower half of the equirectangular image', () => {
    const viewport = { width: 800, height: 400 };
    const panoramaState = {
      ...state,
      viewerMode: 'panorama' as const,
      panoramaPitchDeg: 45
    };

    expect(screenToPanoramaPixel(400, 200, panoramaState, viewport, 400, 200)).toEqual({ ix: 200, iy: 150 });
  });

  it('suppresses projected panorama labels on the seam and poles', () => {
    const viewport = { width: 800, height: 400 };
    const camera = {
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 10
    };

    expect(projectPanoramaPixelToScreen(0, 100, camera, viewport, 400, 200)).toBeNull();
    expect(projectPanoramaPixelToScreen(399, 100, camera, viewport, 400, 200)).toBeNull();
    expect(projectPanoramaPixelToScreen(200, 0, camera, viewport, 400, 200)).toBeNull();
    expect(projectPanoramaPixelToScreen(200, 199, camera, viewport, 400, 200)).toBeNull();
  });

  it('suppresses partially clipped panorama labels at the viewport edge', () => {
    const viewport = { width: 800, height: 400 };
    const camera = {
      panoramaYawDeg: 0,
      panoramaPitchDeg: 20,
      panoramaHfovDeg: 2
    };

    expect(projectPanoramaPixelToScreen(500, 304, camera, viewport, 1000, 500)).toBeNull();
  });

  it('wraps panorama yaw while orbiting', () => {
    const viewport = { width: 100, height: 100 };
    const next = orbitPanorama(
      {
        ...state,
        viewerMode: 'panorama',
        panoramaYawDeg: -170
      },
      viewport,
      20,
      0
    );

    expect(next.panoramaYawDeg).toBe(170);
    expect(normalizePanoramaYaw(190)).toBe(-170);
  });

  it('clamps panorama pitch while orbiting', () => {
    const viewport = { width: 100, height: 100 };
    const next = orbitPanorama(
      {
        ...state,
        viewerMode: 'panorama',
        panoramaPitchDeg: 85
      },
      viewport,
      0,
      -100
    );

    expect(next.panoramaPitchDeg).toBe(89);
    expect(clampPanoramaPitch(999)).toBe(89);
  });

  it('clamps panorama hfov while zooming', () => {
    const minZoom = zoomPanorama(
      {
        ...state,
        viewerMode: 'panorama',
        panoramaHfovDeg: 60
      },
      -10000
    );
    const maxZoom = zoomPanorama(
      {
        ...state,
        viewerMode: 'panorama',
        panoramaHfovDeg: 60
      },
      10000
    );

    expect(minZoom.panoramaHfovDeg).toBe(1);
    expect(maxZoom.panoramaHfovDeg).toBe(120);
    expect(clampPanoramaHfov(0.1)).toBe(1);
    expect(clampPanoramaHfov(999)).toBe(120);
  });
});
