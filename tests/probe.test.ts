import { describe, expect, it } from 'vitest';
import { ColormapLut } from '../src/colormaps';
import { buildProbeColorPreview, resolveActiveProbePixel, resolveProbeMode } from '../src/probe';
import { ZERO_CHANNEL } from '../src/types';

const redBlackGreenLut: ColormapLut = {
  id: '0',
  label: 'Red / Black / Green',
  entryCount: 3,
  rgba8: new Uint8Array([
    255, 0, 0, 255,
    0, 0, 0, 255,
    0, 255, 0, 255
  ])
};

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
        displaySource: 'channels',
        stokesParameter: null,
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
        displaySource: 'channels',
        stokesParameter: null,
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

  it('maps probe swatch colors through the selected colormap LUT', () => {
    const selection = {
      displaySource: 'channels' as const,
      stokesParameter: null,
      displayR: 'Y',
      displayG: 'Y',
      displayB: 'Y'
    };
    const visualization = {
      mode: 'colormap' as const,
      colormapRange: { min: 0, max: 2 },
      colormapLut: redBlackGreenLut
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
        displaySource: 'channels',
        stokesParameter: null,
        displayR: 'Y',
        displayG: 'Y',
        displayB: 'Y'
      },
      0,
      {
        mode: 'colormap',
        colormapRange: { min: 1, max: 1 },
        colormapLut: redBlackGreenLut
      }
    );

    expect(preview?.cssColor).toBe('rgb(0, 0, 0)');
  });

  it('uses scalar Stokes derived values for colormap probe preview', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { S0: 1, S1: 0, S2: 1, S3: 0, AoLP: Math.PI / 4 } },
      {
        displaySource: 'stokesScalar',
        stokesParameter: 'aolp',
        displayR: 'S0',
        displayG: 'S1',
        displayB: 'S2'
      },
      0,
      {
        mode: 'colormap',
        colormapRange: { min: 0, max: Math.PI / 2 },
        colormapLut: redBlackGreenLut
      }
    );

    expect(preview).toEqual({
      cssColor: 'rgb(0, 0, 0)',
      rValue: '0.7854',
      gValue: '0.7854',
      bValue: '0.7854'
    });
  });

  it('uses RGB Stokes derived values for probe preview', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { DoLP: 0.5 } },
      {
        displaySource: 'stokesRgb',
        stokesParameter: 'dolp',
        displayR: 'S0.R',
        displayG: 'S0.G',
        displayB: 'S0.B'
      },
      0
    );

    expect(preview?.rValue).toBe('0.5');
    expect(preview?.gValue).toBe('0.5');
    expect(preview?.bValue).toBe('0.5');
  });

  it('uses new Stokes degree labels for probe preview', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { DoCP: 0.25 } },
      {
        displaySource: 'stokesScalar',
        stokesParameter: 'docp',
        displayR: 'S0',
        displayG: 'S1',
        displayB: 'S2'
      },
      0
    );

    expect(preview?.rValue).toBe('0.25');
    expect(preview?.gValue).toBe('0.25');
    expect(preview?.bValue).toBe('0.25');
  });
});
