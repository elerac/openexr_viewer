import { describe, expect, it } from 'vitest';
import { buildProbeColorPreview, resolveActiveProbePixel, resolveProbeMode } from '../src/probe';
import { ZERO_CHANNEL } from '../src/types';

describe('probe helpers', () => {
  it('prefers the locked pixel over hover for display state', () => {
    const lockedPixel = { ix: 4, iy: 7 };
    const hoveredPixel = { ix: 10, iy: 12 };

    expect(resolveActiveProbePixel(lockedPixel, hoveredPixel)).toEqual(lockedPixel);
    expect(resolveProbeMode(lockedPixel)).toBe('Locked');
  });

  it('falls back to hover when nothing is locked', () => {
    const hoveredPixel = { ix: 10, iy: 12 };

    expect(resolveActiveProbePixel(null, hoveredPixel)).toEqual(hoveredPixel);
    expect(resolveProbeMode(null)).toBe('Hover');
  });

  it('builds an sRGB probe color preview from the selected channels', () => {
    const preview = buildProbeColorPreview(
      {
        x: 4,
        y: 7,
        values: {
          R: 1,
          G: 0.5,
          B: 0.25
        }
      },
      {
        displayR: 'R',
        displayG: 'G',
        displayB: 'B'
      },
      0
    );

    expect(preview).toEqual({
      cssColor: 'rgb(255, 188, 137)',
      rValue: '1',
      gValue: '0.5',
      bValue: '0.25'
    });
  });

  it('applies exposure and clamps missing channels when building the preview swatch', () => {
    const preview = buildProbeColorPreview(
      {
        x: 4,
        y: 7,
        values: {
          A: 0.25
        }
      },
      {
        displayR: 'A',
        displayG: ZERO_CHANNEL,
        displayB: ZERO_CHANNEL
      },
      2
    );

    expect(preview).toEqual({
      cssColor: 'rgb(255, 0, 0)',
      rValue: '0.25',
      gValue: '0',
      bValue: '0'
    });
  });

  it('maps probe swatch colors through the red-black-green colormap', () => {
    const selection = {
      displayR: 'Y',
      displayG: 'Y',
      displayB: 'Y'
    };
    const visualization = {
      mode: 'redBlackGreen' as const,
      colormapRange: { min: 0, max: 2 }
    };

    expect(
      buildProbeColorPreview({ x: 0, y: 0, values: { Y: 0 } }, selection, 0, visualization)?.cssColor
    ).toBe('rgb(255, 0, 0)');
    expect(
      buildProbeColorPreview({ x: 0, y: 0, values: { Y: 1 } }, selection, 0, visualization)?.cssColor
    ).toBe('rgb(0, 0, 0)');
    expect(
      buildProbeColorPreview({ x: 0, y: 0, values: { Y: 2 } }, selection, 0, visualization)?.cssColor
    ).toBe('rgb(0, 255, 0)');
  });

  it('renders collapsed colormap probe ranges as black', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { Y: 1 } },
      {
        displayR: 'Y',
        displayG: 'Y',
        displayB: 'Y'
      },
      0,
      {
        mode: 'redBlackGreen',
        colormapRange: { min: 1, max: 1 }
      }
    );

    expect(preview?.cssColor).toBe('rgb(0, 0, 0)');
  });
});
