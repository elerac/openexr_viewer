import { describe, expect, it } from 'vitest';
import {
  computeStokesAolp,
  computeStokesDocp,
  computeStokesDop,
  computeStokesDolp,
  computeStokesDisplayValue,
  computeStokesDegreeModulationDisplayValue,
  computeStokesDegreeModulationValue,
  computeStokesEang,
  computeStokesNormalizedComponent,
  createDefaultStokesColormapDefaultSettings,
  createDefaultStokesParameterVisibilitySettings,
  buildScalarStokesSelection,
  buildSpectralStokesRgbSelection,
  detectRgbStokesChannels,
  detectScalarStokesChannelSets,
  detectScalarStokesChannels,
  getStokesColormapDefault,
  getStokesColormapDefaultGroup,
  getStokesDisplayOptions,
  isStokesDisplayAvailable,
  isPhysicallyValidStokesVector,
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
    expect(detectScalarStokesChannelSets(['S0', 'S1', 'S2', 'S3'])).toEqual([{
      s0: 'S0',
      s1: 'S1',
      s2: 'S2',
      s3: 'S3'
    }]);
    expect(detectScalarStokesChannels(['S0', 'S1', 'S2'])).toEqual({
      s0: 'S0',
      s1: 'S1',
      s2: 'S2',
      s3: null
    });
    expect(getStokesDisplayOptions(['S0', 'S1', 'S2']).map((option) => option.label)).toEqual([
      'Stokes S1/S0',
      'Stokes S2/S0',
      'Stokes AoLP',
      'Stokes DoLP'
    ]);

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
    const linearRgbNames = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B'
    ];
    expect(detectRgbStokesChannels(linearRgbNames)?.r).toEqual({
      s0: 'S0.R',
      s1: 'S1.R',
      s2: 'S2.R',
      s3: null
    });
    expect(getStokesDisplayOptions(linearRgbNames).map((option) => option.label)).toEqual([
      'S1/S0.(R,G,B)',
      'S2/S0.(R,G,B)',
      'AoLP.(R,G,B)',
      'DoLP.(R,G,B)'
    ]);
    expect(getStokesDisplayOptions([...linearRgbNames, 'S3.R']).map((option) => option.label)).toEqual([
      'S1/S0.(R,G,B)',
      'S2/S0.(R,G,B)',
      'AoLP.(R,G,B)',
      'DoLP.(R,G,B)'
    ]);
    expect(getStokesDisplayOptions(linearRgbNames, {
      includeRgbGroups: false,
      includeSplitChannels: true
    }).map((option) => option.label)).toEqual([
      'S1/S0.R',
      'S1/S0.G',
      'S1/S0.B',
      'S2/S0.R',
      'S2/S0.G',
      'S2/S0.B',
      'AoLP.R',
      'AoLP.G',
      'AoLP.B',
      'DoLP.R',
      'DoLP.G',
      'DoLP.B'
    ]);
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

  it('filters derived Stokes parameters by visibility group', () => {
    const channelNames = ['S0', 'S1', 'S2', 'S3'];
    const visibility = {
      ...createDefaultStokesParameterVisibilitySettings(),
      degree: false,
      normalized: false
    };

    expect(getStokesDisplayOptions(channelNames, {
      parameterVisibility: visibility
    }).map((option) => option.label)).toEqual([
      'Stokes AoLP',
      'Stokes CoP',
      'Stokes ToP'
    ]);
    expect(isStokesDisplayAvailable(channelNames, buildScalarStokesSelection('dop'), visibility)).toBe(false);
  });

  it('applies visibility filtering after S3 availability filtering', () => {
    const visibility = {
      ...createDefaultStokesParameterVisibilitySettings(),
      degree: false
    };

    expect(getStokesDisplayOptions(['S0', 'S1', 'S2'], {
      parameterVisibility: visibility
    }).map((option) => option.label)).toEqual([
      'Stokes S1/S0',
      'Stokes S2/S0',
      'Stokes AoLP'
    ]);
  });

  it('detects every complete non-RGB suffixed scalar Stokes channel set', () => {
    const channelNames = [
      'S0.500nm', 'S0.Y',
      'S1.Y', 'S2.Y', 'S3.Y',
      'S1.500nm', 'S2.500nm', 'S3.500nm',
      'S0', 'S1', 'S2', 'S3',
      'S0.mask', 'S1.mask', 'S3.mask'
    ];

    expect(detectScalarStokesChannels(channelNames, 'Y')).toEqual({
      s0: 'S0.Y',
      s1: 'S1.Y',
      s2: 'S2.Y',
      s3: 'S3.Y',
      suffix: 'Y'
    });
    expect(detectScalarStokesChannels(channelNames, 'mask')).toBeNull();
    expect(detectScalarStokesChannelSets(channelNames)).toEqual([
      { s0: 'S0', s1: 'S1', s2: 'S2', s3: 'S3' },
      { s0: 'S0.500nm', s1: 'S1.500nm', s2: 'S2.500nm', s3: 'S3.500nm', suffix: '500nm' },
      { s0: 'S0.Y', s1: 'S1.Y', s2: 'S2.Y', s3: 'S3.Y', suffix: 'Y' }
    ]);
    expect(getStokesDisplayOptions(['S0.Y', 'S1.Y', 'S2.Y']).map((option) => option.label)).toEqual([
      'S1/S0.Y',
      'S2/S0.Y',
      'AoLP.Y',
      'DoLP.Y'
    ]);
    expect(getStokesDisplayOptions(['S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm']).map((option) => option.label))
      .toEqual([
        'S1/S0.400nm',
        'S2/S0.400nm',
        'S3/S0.400nm',
        'AoLP.400nm',
        'DoP.400nm',
        'DoLP.400nm',
        'DoCP.400nm',
        'CoP.400nm',
        'ToP.400nm'
      ]);
    expect(getStokesDisplayOptions(['S0.Y', 'S1.Y', 'S2.Y', 'S3.Y']).map((option) => option.label)).toEqual([
      'S1/S0.Y',
      'S2/S0.Y',
      'S3/S0.Y',
      'AoLP.Y',
      'DoP.Y',
      'DoLP.Y',
      'DoCP.Y',
      'CoP.Y',
      'ToP.Y'
    ]);
  });

  it('keeps RGB Stokes components out of scalar suffix detection', () => {
    const rgbNames = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B',
      'S3.R', 'S3.G', 'S3.B'
    ];

    expect(detectScalarStokesChannelSets(rgbNames)).toEqual([]);
    expect(getStokesDisplayOptions(rgbNames).filter((option) => option.key.startsWith('stokesScalar:'))).toEqual([]);
  });

  it('exposes complete spectral Stokes sets as grouped spectral RGB Stokes options', () => {
    const channelNames = [
      'S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm', 'S3.500nm'
    ];
    const options = getStokesDisplayOptions(channelNames);
    const spectralOptions = options.filter((option) => option.key.startsWith('stokesSpectralRgb:'));

    expect(options.map((option) => option.label)).not.toContain('S1/S0.400nm');
    expect(options.map((option) => option.label)).not.toContain('AoLP.500nm');
    expect(spectralOptions.map((option) => option.label)).toEqual([
      'S1/S0 Spectral RGB',
      'S2/S0 Spectral RGB',
      'S3/S0 Spectral RGB',
      'AoLP Spectral RGB',
      'DoP Spectral RGB',
      'DoLP Spectral RGB',
      'DoCP Spectral RGB',
      'CoP Spectral RGB',
      'ToP Spectral RGB'
    ]);
    expect(spectralOptions[0]?.selection).toEqual(buildSpectralStokesRgbSelection('s1_over_s0'));
    expect(spectralOptions[0]?.mapping).toEqual({
      displayR: 'S1/S0 Spectral RGB.R',
      displayG: 'S1/S0 Spectral RGB.G',
      displayB: 'S1/S0 Spectral RGB.B',
      displayA: null
    });

    const splitOptions = getStokesDisplayOptions(channelNames, {
      includeRgbGroups: false,
      includeSplitChannels: true
    });
    expect(splitOptions.some((option) => option.key.startsWith('stokesSpectralRgb:'))).toBe(false);
    expect(splitOptions.map((option) => option.label)).toEqual([
      'S1/S0.400nm',
      'S2/S0.400nm',
      'S3/S0.400nm',
      'AoLP.400nm',
      'DoP.400nm',
      'DoLP.400nm',
      'DoCP.400nm',
      'CoP.400nm',
      'ToP.400nm',
      'S1/S0.500nm',
      'S2/S0.500nm',
      'S3/S0.500nm',
      'AoLP.500nm',
      'DoP.500nm',
      'DoLP.500nm',
      'DoCP.500nm',
      'CoP.500nm',
      'ToP.500nm'
    ]);

    const mixedOptions = getStokesDisplayOptions([
      ...channelNames,
      'S0.Y', 'S1.Y', 'S2.Y', 'S3.Y'
    ]);
    expect(mixedOptions.map((option) => option.label)).toContain('S1/S0.Y');
    expect(mixedOptions.map((option) => option.label)).not.toContain('S1/S0.400nm');
  });

  it('does not group spectral Stokes RGB when spectral grouping is disabled', () => {
    const channelNames = [
      'S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm', 'S3.500nm'
    ];
    const options = getStokesDisplayOptions(channelNames, {
      spectralRgbGroupingEnabled: false
    });

    expect(options.some((option) => option.key.startsWith('stokesSpectralRgb:'))).toBe(false);
    expect(options.map((option) => option.label)).toContain('S1/S0.400nm');
    expect(options.map((option) => option.label)).toContain('AoLP.500nm');
    expect(options.map((option) => option.label)).not.toContain('S1/S0 Spectral RGB');
  });

  it('exposes linear-only spectral Stokes options without full-vector entries', () => {
    const channelNames = [
      'S0.400nm', 'S1.400nm', 'S2.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm'
    ];
    const options = getStokesDisplayOptions(channelNames);
    const spectralOptions = options.filter((option) => option.key.startsWith('stokesSpectralRgb:'));

    expect(spectralOptions.map((option) => option.label)).toEqual([
      'S1/S0 Spectral RGB',
      'S2/S0 Spectral RGB',
      'AoLP Spectral RGB',
      'DoLP Spectral RGB'
    ]);

    const splitOptions = getStokesDisplayOptions(channelNames, {
      includeRgbGroups: false,
      includeSplitChannels: true
    });
    expect(splitOptions.map((option) => option.label)).toEqual([
      'S1/S0.400nm',
      'S2/S0.400nm',
      'AoLP.400nm',
      'DoLP.400nm',
      'S1/S0.500nm',
      'S2/S0.500nm',
      'AoLP.500nm',
      'DoLP.500nm'
    ]);
  });

  it('omits DoP for partial spectral Stokes sets with incomplete S3 wavelengths', () => {
    const channelNames = [
      'S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm'
    ];
    const groupedLabels = getStokesDisplayOptions(channelNames).map((option) => option.label);
    const splitLabels = getStokesDisplayOptions(channelNames, {
      includeRgbGroups: false,
      includeSplitChannels: true
    }).map((option) => option.label);

    expect(groupedLabels).toContain('DoLP Spectral RGB');
    expect(groupedLabels).not.toContain('DoP Spectral RGB');
    expect(splitLabels).toContain('DoLP.400nm');
    expect(splitLabels).toContain('DoLP.500nm');
    expect(splitLabels).not.toContain('DoP.400nm');
    expect(splitLabels).not.toContain('DoP.500nm');
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
    expect(getStokesColormapDefault('top')).toEqual({
      colormapLabel: 'Yellow-Cyan-Yellow',
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
    expect(computeStokesAolp(0, 0)).toBeNaN();
    expect(computeStokesAolp(Number.NaN, 1)).toBeNaN();

    expect(computeStokesDolp(1, 1, 0)).toBeCloseTo(1, 6);
    expect(computeStokesDolp(2, 1, Math.sqrt(3))).toBeCloseTo(1, 6);
    expect(computeStokesDolp(0, 1, 1)).toBeNaN();
    expect(computeStokesDolp(1, Number.NaN, 1)).toBeNaN();

    expect(computeStokesDop(1, 0, 0, 0)).toBe(0);
    expect(computeStokesDop(1, 1, 0, 0)).toBeCloseTo(1, 6);
    expect(computeStokesDop(2, 1, 1, Math.sqrt(2))).toBeCloseTo(1, 6);
    expect(computeStokesDop(0, 1, 1, 1)).toBeNaN();
    expect(computeStokesDop(1, 1, Number.NaN, 1)).toBeNaN();

    expect(computeStokesDocp(1, 0)).toBe(0);
    expect(computeStokesDocp(2, -1)).toBeCloseTo(0.5, 6);
    expect(computeStokesDocp(0, 1)).toBeNaN();
    expect(computeStokesDocp(1, Number.NaN)).toBeNaN();

    expect(computeStokesEang(0, 0, 1)).toBeCloseTo(Math.PI / 4, 6);
    expect(computeStokesEang(0, 0, -1)).toBeCloseTo(-Math.PI / 4, 6);
    expect(computeStokesEang(1, 0, 0)).toBe(0);
    expect(computeStokesEang(0, 0, 0)).toBeNaN();
    expect(computeStokesEang(Number.NaN, 0, 1)).toBeNaN();

    expect(computeStokesNormalizedComponent(2, 1)).toBeCloseTo(0.5, 6);
    expect(computeStokesNormalizedComponent(2, -1)).toBeCloseTo(-0.5, 6);
    expect(computeStokesNormalizedComponent(0, 1)).toBeNaN();
    expect(computeStokesNormalizedComponent(Number.NaN, 1)).toBeNaN();
    expect(computeStokesNormalizedComponent(1, Number.NaN)).toBeNaN();
  });

  it('checks physical Stokes vector validity with relative tolerance', () => {
    expect(isPhysicallyValidStokesVector(1, 1, 0, 0)).toBe(true);
    expect(isPhysicallyValidStokesVector(0, 0, 0, 0)).toBe(true);
    expect(isPhysicallyValidStokesVector(0, 1, 0, 0)).toBe(false);
    expect(isPhysicallyValidStokesVector(-1, 0, 0, 0)).toBe(false);
    expect(isPhysicallyValidStokesVector(1, Number.NaN, 0, 0)).toBe(false);
    expect(isPhysicallyValidStokesVector(1, Math.sqrt(1 + 5.0e-9), 0, 0)).toBe(true);
    expect(isPhysicallyValidStokesVector(1, Math.sqrt(1 + 2.0e-8), 0, 0)).toBe(false);

    const scale = 100;
    expect(isPhysicallyValidStokesVector(scale, scale * Math.sqrt(1 + 5.0e-9), 0, 0)).toBe(true);
    expect(isPhysicallyValidStokesVector(scale, scale * Math.sqrt(1 + 2.0e-8), 0, 0)).toBe(false);
  });

  it('returns NaN for computed Stokes values with invalid full vectors', () => {
    expect(computeStokesDisplayValue('aolp', 1, 2, 0, 0)).toBeNaN();
    expect(computeStokesDisplayValue('dolp', 1, 2, 0, 0)).toBeNaN();
    expect(computeStokesDisplayValue('dop', 1, 2, 0, 0)).toBeNaN();
    expect(computeStokesDisplayValue('s1_over_s0', 1, 2, 0, 0)).toBeNaN();

    expect(computeStokesDisplayValue('aolp', 0, 0, 0, 0)).toBeNaN();
    expect(computeStokesDisplayValue('top', 0, 0, 0, 0)).toBeNaN();
    expect(computeStokesDisplayValue('dolp', 0, 0, 0, 0)).toBeNaN();
    expect(computeStokesDisplayValue('dop', 0, 0, 0, 0)).toBeNaN();
    expect(computeStokesDisplayValue('s1_over_s0', 0, 0, 0, 0)).toBeNaN();

    expect(computeStokesDisplayValue('aolp', 1, 0, 0, 0)).toBeNaN();
    expect(computeStokesDisplayValue('top', 1, 0, 0, 0)).toBeNaN();
    expect(computeStokesDisplayValue('dolp', 1, 0, 0, 0)).toBe(0);
    expect(computeStokesDisplayValue('dop', 1, 0, 0, 0)).toBe(0);

    expect(computeStokesDegreeModulationValue('aolp', 1, 2, 0, 0)).toBeNaN();
    expect(computeStokesDegreeModulationValue('top', 0, 0, 0, 0)).toBeNaN();
    expect(computeStokesDegreeModulationValue('dolp', 1, 2, 0, 0)).toBeNull();
    expect(computeStokesDegreeModulationDisplayValue('aolp', 1, 2, 0, 0)).toBeNaN();
  });

  it('can compute finite physically invalid Stokes vectors when masking is disabled', () => {
    const options = { maskInvalidStokesVectors: false };

    expect(computeStokesDisplayValue('aolp', 1, 2, 0, 0, options)).toBe(0);
    expect(computeStokesDisplayValue('dolp', 1, 2, 0, 0, options)).toBe(2);
    expect(computeStokesDisplayValue('dop', 1, 2, 0, 0, options)).toBe(2);
    expect(computeStokesDisplayValue('s1_over_s0', 1, 2, 0, 0, options)).toBe(2);
    expect(computeStokesDegreeModulationValue('aolp', 1, 2, 0, 0, options)).toBe(2);
    expect(computeStokesDegreeModulationDisplayValue('aolp', 1, 2, 0, 0, options)).toBe(1);
  });

  it('keeps undefined Stokes formulas as NaN when physical masking is disabled', () => {
    const options = { maskInvalidStokesVectors: false };

    expect(computeStokesDisplayValue('dolp', 0, 2, 0, 0, options)).toBeNaN();
    expect(computeStokesDisplayValue('s1_over_s0', 0, 2, 0, 0, options)).toBeNaN();
    expect(computeStokesDisplayValue('aolp', 1, 0, 0, 0, options)).toBeNaN();
    expect(computeStokesDisplayValue('aolp', Number.NaN, 2, 0, 0, options)).toBeNaN();
  });
});
