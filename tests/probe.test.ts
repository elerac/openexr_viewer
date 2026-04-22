import { describe, expect, it } from 'vitest';
import { ColormapLut } from '../src/colormaps';
import { buildProbeColorPreview, resolveActiveProbePixel, resolveProbeMode } from '../src/probe';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createStokesSelection
} from './helpers/state-fixtures';

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

  it('builds an sRGB probe color preview from the selected RGB channels', () => {
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
      createChannelRgbSelection('R', 'G', 'B'),
      0
    );

    expect(preview).toEqual({
      cssColor: 'rgb(255, 188, 137)',
      displayValues: [
        { label: 'R', value: '1.00' },
        { label: 'G', value: '0.500' },
        { label: 'B', value: '0.250' }
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
      createChannelRgbSelection('R', 'G', 'B', 'A'),
      0
    );

    expect(preview).toEqual({
      cssColor: 'rgba(255, 188, 137, 0.25)',
      displayValues: [
        { label: 'R', value: '1.00' },
        { label: 'G', value: '0.500' },
        { label: 'B', value: '0.250' },
        { label: 'A', value: '0.250' }
      ]
    });
  });

  it('shows one mono display value for mono channel previews', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { Y: 0.25 } },
      createChannelMonoSelection('Y'),
      0
    );

    expect(preview).toEqual({
      cssColor: 'rgb(137, 137, 137)',
      displayValues: [{ label: 'Mono', value: '0.250' }]
    });
  });

  it('applies exposure to mono probe previews', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { A: 0.25 } },
      createChannelMonoSelection('A'),
      2
    );

    expect(preview).toEqual({
      cssColor: 'rgb(255, 255, 255)',
      displayValues: [{ label: 'Mono', value: '0.250' }]
    });
  });

  it('maps probe swatch colors through the selected colormap LUT', () => {
    const selection = createChannelMonoSelection('Y');
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
    ).toEqual([{ label: 'Mono', value: '1.00' }]);
  });

  it('shows one luma-weighted display value for RGB colormap probe previews', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { R: 1, G: 0.5, B: 0.25 } },
      createChannelRgbSelection('R', 'G', 'B'),
      0,
      {
        mode: 'colormap',
        colormapRange: { min: 0, max: 1 },
        colormapLut: redBlackGreenLut
      }
    );

    expect(preview?.displayValues).toEqual([{ label: 'Mono', value: '0.588' }]);
  });

  it('renders collapsed colormap probe ranges as black', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { Y: 1 } },
      createChannelMonoSelection('Y'),
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
      createStokesSelection('aolp'),
      0,
      {
        mode: 'colormap',
        colormapRange: { min: 0, max: Math.PI / 2 },
        colormapLut: redBlackGreenLut
      }
    );

    expect(preview).toEqual({
      cssColor: 'rgb(0, 0, 0)',
      displayValues: [{ label: 'Mono', value: '0.785' }]
    });
  });

  it('modulates Stokes angle colormap preview values through paired degree values', () => {
    const selection = createStokesSelection('aolp');
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

  it('uses grouped RGB Stokes derived values for probe preview', () => {
    const preview = buildProbeColorPreview(
      {
        x: 0,
        y: 0,
        values: {
          'DoLP.R': 0.25,
          'DoLP.G': 0.5,
          'DoLP.B': 0.75
        }
      },
      createStokesSelection('dolp', 'stokesRgb'),
      0
    );

    expect(preview?.displayValues).toEqual([
      { label: 'R', value: '0.250' },
      { label: 'G', value: '0.500' },
      { label: 'B', value: '0.750' }
    ]);
  });

  it('keeps grouped RGB Stokes colormap probe previews mono-valued', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { DoLP: 0.5 } },
      createStokesSelection('dolp', 'stokesRgb'),
      0,
      {
        mode: 'colormap',
        colormapRange: { min: 0, max: 1 },
        colormapLut: redBlackGreenLut
      }
    );

    expect(preview?.displayValues).toEqual([{ label: 'Mono', value: '0.500' }]);
  });

  it('uses one mono display value for split RGB Stokes probe preview', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { 'DoLP.G': 0.75 } },
      createStokesSelection('dolp', 'stokesRgb', 'G'),
      0
    );

    expect(preview?.displayValues).toEqual([{ label: 'Mono', value: '0.750' }]);
  });

  it('modulates split RGB Stokes angle previews with split degree labels', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { 'AoLP.B': 0, 'DoLP.B': 0.25 } },
      createStokesSelection('aolp', 'stokesRgb', 'B'),
      0,
      {
        mode: 'colormap',
        colormapRange: { min: 0, max: 2 },
        colormapLut: redBlackGreenLut,
        stokesDegreeModulation: { aolp: true, cop: true, top: true }
      }
    );

    expect(preview?.cssColor).toBe('rgb(64, 0, 0)');
    expect(preview?.displayValues).toEqual([{ label: 'Mono', value: '0.00' }]);
  });

  it('uses additional Stokes labels for probe preview', () => {
    const preview = buildProbeColorPreview(
      { x: 0, y: 0, values: { DoCP: 0.25 } },
      createStokesSelection('docp'),
      0
    );

    expect(preview?.displayValues).toEqual([
      { label: 'R', value: '0.250' },
      { label: 'G', value: '0.250' },
      { label: 'B', value: '0.250' }
    ]);

    const copPreview = buildProbeColorPreview(
      { x: 0, y: 0, values: { CoP: -Math.PI / 4 } },
      createStokesSelection('cop'),
      0
    );

    expect(copPreview?.displayValues).toEqual([
      { label: 'R', value: '-0.785' },
      { label: 'G', value: '-0.785' },
      { label: 'B', value: '-0.785' }
    ]);

    const topPreview = buildProbeColorPreview(
      { x: 0, y: 0, values: { ToP: Math.PI / 4 } },
      createStokesSelection('top', 'stokesRgb'),
      0
    );

    expect(topPreview?.displayValues).toEqual([
      { label: 'R', value: '0.785' },
      { label: 'G', value: '0.785' },
      { label: 'B', value: '0.785' }
    ]);

    const normalizedPreview = buildProbeColorPreview(
      { x: 0, y: 0, values: { 'S3/S0.B': -0.5 } },
      createStokesSelection('s3_over_s0', 'stokesRgb', 'B'),
      0
    );

    expect(normalizedPreview?.displayValues).toEqual([{ label: 'Mono', value: '-0.500' }]);
  });
});
