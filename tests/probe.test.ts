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
      displayValues: [
        { label: 'R', value: '1' },
        { label: 'G', value: '0.5' },
        { label: 'B', value: '0.25' }
      ]
    });
  });

  it('includes active display alpha in probe preview swatches and values', () => {
    const preview = buildProbeColorPreview(
      {
        x: 4,
        y: 7,
        values: {
          R: 1,
          G: 0.5,
          B: 0.25,
          A: 0.25
        }
      },
      {
        displaySource: 'channels',
        stokesParameter: null,
        displayR: 'R',
        displayG: 'G',
        displayB: 'B',
        displayA: 'A'
      },
      0
    );

    expect(preview).toEqual({
      cssColor: 'rgba(255, 188, 137, 0.25)',
      displayValues: [
        { label: 'R', value: '1' },
        { label: 'G', value: '0.5' },
        { label: 'B', value: '0.25' },
        { label: 'A', value: '0.25' }
      ]
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
      displayValues: [
        { label: 'R', value: '0.25' },
        { label: 'G', value: '0' },
        { label: 'B', value: '0' }
      ]
    });
  });

  it('shows one mono display value for single-channel RGB previews', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { Y: 0.25 } },
      {
        displaySource: 'channels',
        stokesParameter: null,
        displayR: 'Y',
        displayG: 'Y',
        displayB: 'Y'
      },
      0
    );

    expect(preview).toEqual({
      cssColor: 'rgb(137, 137, 137)',
      displayValues: [{ label: 'Mono', value: '0.25' }]
    });
  });

  it('shows one mono display value for split RGB channel previews', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { R: 0.25 } },
      {
        displaySource: 'channels',
        stokesParameter: null,
        displayR: 'R',
        displayG: 'R',
        displayB: 'R'
      },
      0
    );

    expect(preview).toEqual({
      cssColor: 'rgb(137, 137, 137)',
      displayValues: [{ label: 'Mono', value: '0.25' }]
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
    expect(
      buildProbeColorPreview({ x: 0, y: 0, values: { Y: 1 } }, selection, 0, visualization)?.displayValues
    ).toEqual([{ label: 'Mono', value: '1' }]);
  });

  it('shows one luma-weighted display value for RGB colormap probe previews', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { R: 1, G: 0.5, B: 0.25 } },
      {
        displaySource: 'channels',
        stokesParameter: null,
        displayR: 'R',
        displayG: 'G',
        displayB: 'B'
      },
      0,
      {
        mode: 'colormap',
        colormapRange: { min: 0, max: 1 },
        colormapLut: redBlackGreenLut
      }
    );

    expect(preview?.displayValues).toEqual([{ label: 'Mono', value: '0.5883' }]);
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
      displayValues: [{ label: 'Mono', value: '0.7854' }]
    });
  });

  it('modulates Stokes angle colormap preview values through paired degree values', () => {
    const selection = {
      displaySource: 'stokesScalar' as const,
      stokesParameter: 'aolp' as const,
      displayR: 'S0',
      displayG: 'S1',
      displayB: 'S2'
    };
    const visualization = {
      mode: 'colormap' as const,
      colormapRange: { min: 0, max: 2 },
      colormapLut: redBlackGreenLut
    };

    const modulated = buildProbeColorPreview(
      { x: 0, y: 0, values: { AoLP: 0, DoLP: 0.5 } },
      selection,
      0,
      {
        ...visualization,
        stokesDegreeModulation: { aolp: true, cop: true, top: true }
      }
    );
    const unmodulated = buildProbeColorPreview(
      { x: 0, y: 0, values: { AoLP: 0, DoLP: 0.5 } },
      selection,
      0,
      {
        ...visualization,
        stokesDegreeModulation: { aolp: false, cop: true, top: true }
      }
    );

    expect(modulated?.cssColor).toBe('rgb(128, 0, 0)');
    expect(unmodulated?.cssColor).toBe('rgb(255, 0, 0)');
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

    expect(preview?.displayValues).toEqual([
      { label: 'R', value: '0.5' },
      { label: 'G', value: '0.5' },
      { label: 'B', value: '0.5' }
    ]);
  });

  it('uses one mono display value for split RGB Stokes probe preview', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { 'DoLP.G': 0.75 } },
      {
        displaySource: 'stokesRgb',
        stokesParameter: 'dolp',
        displayR: 'S0.G',
        displayG: 'S0.G',
        displayB: 'S0.G'
      },
      0
    );

    expect(preview?.displayValues).toEqual([{ label: 'Mono', value: '0.75' }]);
  });

  it('modulates split RGB Stokes angle previews with split degree labels', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { 'AoLP.B': 0, 'DoLP.B': 0.25 } },
      {
        displaySource: 'stokesRgb',
        stokesParameter: 'aolp',
        displayR: 'S0.B',
        displayG: 'S0.B',
        displayB: 'S0.B'
      },
      0,
      {
        mode: 'colormap',
        colormapRange: { min: 0, max: 2 },
        colormapLut: redBlackGreenLut,
        stokesDegreeModulation: { aolp: true, cop: true, top: true }
      }
    );

    expect(preview?.cssColor).toBe('rgb(64, 0, 0)');
    expect(preview?.displayValues).toEqual([{ label: 'Mono', value: '0' }]);
  });

  it('uses additional Stokes labels for probe preview', () => {
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

    expect(preview?.displayValues).toEqual([
      { label: 'R', value: '0.25' },
      { label: 'G', value: '0.25' },
      { label: 'B', value: '0.25' }
    ]);

    const copPreview = buildProbeColorPreview(
      { x: 0, y: 0, values: { CoP: -Math.PI / 4 } },
      {
        displaySource: 'stokesScalar',
        stokesParameter: 'cop',
        displayR: 'S0',
        displayG: 'S1',
        displayB: 'S2'
      },
      0
    );

    expect(copPreview?.displayValues).toEqual([
      { label: 'R', value: '-0.7854' },
      { label: 'G', value: '-0.7854' },
      { label: 'B', value: '-0.7854' }
    ]);

    const topPreview = buildProbeColorPreview(
      { x: 0, y: 0, values: { ToP: Math.PI / 4 } },
      {
        displaySource: 'stokesRgb',
        stokesParameter: 'top',
        displayR: 'S0.R',
        displayG: 'S0.G',
        displayB: 'S0.B'
      },
      0
    );

    expect(topPreview?.displayValues).toEqual([
      { label: 'R', value: '0.7854' },
      { label: 'G', value: '0.7854' },
      { label: 'B', value: '0.7854' }
    ]);

    const normalizedPreview = buildProbeColorPreview(
      { x: 0, y: 0, values: { 'S3/S0.B': -0.5 } },
      {
        displaySource: 'stokesRgb',
        stokesParameter: 's3_over_s0',
        displayR: 'S0.B',
        displayG: 'S0.B',
        displayB: 'S0.B'
      },
      0
    );

    expect(normalizedPreview?.displayValues).toEqual([{ label: 'Mono', value: '-0.5' }]);
  });
});
