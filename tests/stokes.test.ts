import { describe, expect, it } from 'vitest';
import {
  computeStokesAolp,
  computeStokesDocp,
  computeStokesDop,
  computeStokesDolp,
  computeStokesEang,
  computeStokesNormalizedComponent,
  createDefaultStokesColormapDefaultSettings,
  detectRgbStokesChannels,
  detectScalarStokesChannels,
  getStokesColormapDefault,
  getStokesColormapDefaultGroup,
  getStokesDisplayOptions,
  resolveStokesColormapDefaultLabel
} from '../src/stokes';

describe('stokes', () => {
  it('detects scalar and RGB Stokes channel layouts', () => {
    expect(detectScalarStokesChannels(['S0', 'S1', 'S2', 'S3'])).toEqual({
      s0: 'S0',
      s1: 'S1',
      s2: 'S2',
      s3: 'S3'
    });
    expect(detectScalarStokesChannels(['S0', 'S1', 'S2'])).toBeNull();

    const rgbNames = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B',
      'S3.R', 'S3.G', 'S3.B'
    ];
    expect(detectRgbStokesChannels(rgbNames)?.r).toEqual({
      s0: 'S0.R',
      s1: 'S1.R',
      s2: 'S2.R',
      s3: 'S3.R'
    });
    expect(getStokesDisplayOptions(['S0', 'S1', 'S2', 'S3']).map((option) => option.label)).toEqual([
      'Stokes S1/S0',
      'Stokes S2/S0',
      'Stokes S3/S0',
      'Stokes AoLP',
      'Stokes DoP',
      'Stokes DoLP',
      'Stokes DoCP',
      'Stokes CoP',
      'Stokes ToP'
    ]);
    expect(getStokesDisplayOptions(rgbNames).map((option) => option.label)).toEqual([
      'S1/S0.(R,G,B)',
      'S2/S0.(R,G,B)',
      'S3/S0.(R,G,B)',
      'AoLP.(R,G,B)',
      'DoP.(R,G,B)',
      'DoLP.(R,G,B)',
      'DoCP.(R,G,B)',
      'CoP.(R,G,B)',
      'ToP.(R,G,B)'
    ]);
    expect(getStokesDisplayOptions(rgbNames, {
      includeRgbGroups: false,
      includeSplitChannels: true
    }).map((option) => option.label)).toEqual([
      'S1/S0.R',
      'S1/S0.G',
      'S1/S0.B',
      'S2/S0.R',
      'S2/S0.G',
      'S2/S0.B',
      'S3/S0.R',
      'S3/S0.G',
      'S3/S0.B',
      'AoLP.R',
      'AoLP.G',
      'AoLP.B',
      'DoP.R',
      'DoP.G',
      'DoP.B',
      'DoLP.R',
      'DoLP.G',
      'DoLP.B',
      'DoCP.R',
      'DoCP.G',
      'DoCP.B',
      'CoP.R',
      'CoP.G',
      'CoP.B',
      'ToP.R',
      'ToP.G',
      'ToP.B'
    ]);
    expect(getStokesDisplayOptions(rgbNames, {
      includeRgbGroups: false,
      includeSplitChannels: true
    })[0]?.mapping).toEqual({
      displayR: 'S0.R',
      displayG: 'S0.R',
      displayB: 'S0.R',
      displayA: null
    });
  });

  it('groups Stokes parameters by default colormap behavior', () => {
    expect(getStokesColormapDefaultGroup('aolp')).toBe('aolp');
    expect(getStokesColormapDefaultGroup('dolp')).toBe('degree');
    expect(getStokesColormapDefaultGroup('dop')).toBe('degree');
    expect(getStokesColormapDefaultGroup('docp')).toBe('degree');
    expect(getStokesColormapDefaultGroup('cop')).toBe('cop');
    expect(getStokesColormapDefaultGroup('top')).toBe('top');
    expect(getStokesColormapDefaultGroup('s1_over_s0')).toBe('normalized');
    expect(getStokesColormapDefaultGroup('s2_over_s0')).toBe('normalized');
    expect(getStokesColormapDefaultGroup('s3_over_s0')).toBe('normalized');
    expect(getStokesColormapDefaultGroup(null)).toBeNull();
  });

  it('defines default colormap ranges for specialized Stokes parameters', () => {
    expect(getStokesColormapDefault('aolp')).toEqual({
      colormapLabel: 'HSV',
      range: { min: 0, max: Math.PI },
      zeroCentered: false,
      modulation: { enabled: false, aolpMode: 'value' }
    });
    expect(getStokesColormapDefault('dolp')).toEqual({
      colormapLabel: 'Black-Red',
      range: { min: 0, max: 1 },
      zeroCentered: false,
      modulation: null
    });
    expect(getStokesColormapDefault('cop')).toEqual({
      colormapLabel: 'Yellow-Black-Blue',
      range: { min: -Math.PI / 4, max: Math.PI / 4 },
      zeroCentered: true,
      modulation: { enabled: true }
    });
    expect(getStokesColormapDefault('s2_over_s0')).toEqual({
      colormapLabel: 'RdBu',
      range: { min: -1, max: 1 },
      zeroCentered: true,
      modulation: null
    });
    expect(getStokesColormapDefault(null)).toBeNull();
  });

  it('overrides Stokes defaults per group', () => {
    const settings = {
      ...createDefaultStokesColormapDefaultSettings(),
      aolp: {
        colormapLabel: 'Viridis',
        range: { min: -1, max: 1 },
        zeroCentered: true,
        modulation: { enabled: true, aolpMode: 'saturation' as const }
      },
      degree: {
        colormapLabel: 'coolwarm',
        range: { min: 0.2, max: 0.8 },
        zeroCentered: true,
        modulation: null
      },
      normalized: {
        colormapLabel: 'HSV',
        range: { min: -2, max: 2 },
        zeroCentered: false,
        modulation: null
      }
    };

    expect(resolveStokesColormapDefaultLabel('dop', settings)).toBe('coolwarm');
    expect(resolveStokesColormapDefaultLabel('s3_over_s0', settings)).toBe('HSV');
    expect(resolveStokesColormapDefaultLabel(null, settings)).toBeNull();
    expect(getStokesColormapDefault('aolp', settings)).toEqual({
      colormapLabel: 'Viridis',
      range: { min: -1, max: 1 },
      zeroCentered: true,
      modulation: { enabled: true, aolpMode: 'saturation' }
    });
    expect(getStokesColormapDefault('dolp', settings)).toEqual({
      colormapLabel: 'coolwarm',
      range: { min: 0.2, max: 0.8 },
      zeroCentered: true,
      modulation: null
    });
    expect(getStokesColormapDefault('s2_over_s0', settings)).toEqual({
      colormapLabel: 'HSV',
      range: { min: -2, max: 2 },
      zeroCentered: false,
      modulation: null
    });
  });

  it('computes derived Stokes values', () => {
    expect(computeStokesAolp(1, 0)).toBeCloseTo(0, 6);
    expect(computeStokesAolp(0, 1)).toBeCloseTo(Math.PI / 4, 6);
    expect(computeStokesAolp(-1, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(computeStokesAolp(0, -1)).toBeCloseTo((3 * Math.PI) / 4, 6);
    expect(computeStokesAolp(Number.NaN, 1)).toBe(0);

    expect(computeStokesDolp(1, 1, 0)).toBeCloseTo(1, 6);
    expect(computeStokesDolp(2, 1, Math.sqrt(3))).toBeCloseTo(1, 6);
    expect(computeStokesDolp(0, 1, 1)).toBe(0);
    expect(computeStokesDolp(1, Number.NaN, 1)).toBe(0);

    expect(computeStokesDop(1, 0, 0, 0)).toBe(0);
    expect(computeStokesDop(1, 1, 0, 0)).toBeCloseTo(1, 6);
    expect(computeStokesDop(2, 1, 1, Math.sqrt(2))).toBeCloseTo(1, 6);
    expect(computeStokesDop(0, 1, 1, 1)).toBe(0);
    expect(computeStokesDop(1, 1, Number.NaN, 1)).toBe(0);

    expect(computeStokesDocp(1, 0)).toBe(0);
    expect(computeStokesDocp(2, -1)).toBeCloseTo(0.5, 6);
    expect(computeStokesDocp(0, 1)).toBe(0);
    expect(computeStokesDocp(1, Number.NaN)).toBe(0);

    expect(computeStokesEang(0, 0, 1)).toBeCloseTo(Math.PI / 4, 6);
    expect(computeStokesEang(0, 0, -1)).toBeCloseTo(-Math.PI / 4, 6);
    expect(computeStokesEang(1, 0, 0)).toBe(0);
    expect(computeStokesEang(Number.NaN, 0, 1)).toBe(0);

    expect(computeStokesNormalizedComponent(2, 1)).toBeCloseTo(0.5, 6);
    expect(computeStokesNormalizedComponent(2, -1)).toBeCloseTo(-0.5, 6);
    expect(computeStokesNormalizedComponent(0, 1)).toBe(0);
    expect(computeStokesNormalizedComponent(Number.NaN, 1)).toBe(0);
    expect(computeStokesNormalizedComponent(1, Number.NaN)).toBe(0);
  });
});
