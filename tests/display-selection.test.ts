import { describe, expect, it } from 'vitest';
import {
  buildChannelDisplayOptions,
  extractRgbChannelGroups,
  findMergedSelectionForSplitDisplay,
  findSelectedChannelDisplayOption,
  findSelectedRgbGroup,
  findSplitSelectionForMergedDisplay,
  pickDefaultDisplaySelection,
  resolveDisplaySelectionForLayer
} from '../src/display-selection';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createMuellerMatrixSelection,
  createRgbMuellerMatrixSelection,
  createSpectralRgbSelection,
  createStokesSelection
} from './helpers/state-fixtures';
import { MUELLER_MATRIX_ELEMENTS } from '../src/mueller';
import { createDefaultChannelRecognitionSettings } from '../src/channel-recognition-settings';

describe('display selection', () => {
  it('extracts RGB groups from channel namespaces', () => {
    const groups = extractRgbChannelGroups([
      'HOGE.R',
      'HOGE.G',
      'HOGE.B',
      'FUGA.R',
      'FUGA.G',
      'FUGA.B',
      'mask'
    ]);

    expect(groups.map((group) => group.key)).toEqual(['FUGA', 'HOGE']);
    expect(groups[0]).toEqual({
      key: 'FUGA',
      label: 'FUGA.(R,G,B)',
      r: 'FUGA.R',
      g: 'FUGA.G',
      b: 'FUGA.B'
    });
  });

  it('matches selected display channels to an RGB group', () => {
    const groups = extractRgbChannelGroups(['HOGE.R', 'HOGE.G', 'HOGE.B']);

    const match = findSelectedRgbGroup(groups, 'HOGE.R', 'HOGE.G', 'HOGE.B');
    expect(match?.key).toBe('HOGE');

    const noMatch = findSelectedRgbGroup(groups, 'HOGE.R', 'HOGE.G', '__ZERO__');
    expect(noMatch).toBeNull();
  });

  it('labels bare R/G/B group as R,G,B', () => {
    const groups = extractRgbChannelGroups(['R', 'G', 'B']);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('R,G,B');
  });

  it('builds grouped channel display options for bare RGB by default', () => {
    const options = buildChannelDisplayOptions(['R', 'G', 'B']);

    expect(options.map((option) => option.label)).toEqual(['R,G,B']);
    expect(options[0]?.selection).toEqual(createChannelRgbSelection('R', 'G', 'B'));
  });

  it('groups auxiliary channels with alpha while keeping RGB grouped by default', () => {
    const options = buildChannelDisplayOptions(['R', 'G', 'B', 'A', 'mask']);

    expect(options.map((option) => option.label)).toEqual(['R,G,B,A', 'mask,A']);
    expect(options[0]?.selection).toEqual(createChannelRgbSelection('R', 'G', 'B', 'A'));
    expect(options[1]?.selection).toEqual(createChannelMonoSelection('mask', 'A'));
  });

  it('builds grouped and split channel display options for bare RGB when requested', () => {
    const options = buildChannelDisplayOptions(['R', 'G', 'B'], { includeSplitChannels: true });

    expect(options.map((option) => option.label)).toEqual(['R,G,B', 'R', 'G', 'B']);
    expect(options[1]?.selection).toEqual(createChannelMonoSelection('R'));
    expect(options[2]?.selection).toEqual(createChannelMonoSelection('G'));
    expect(options[3]?.selection).toEqual(createChannelMonoSelection('B'));
  });

  it('keeps auxiliary and alpha channel options visible when RGB split mode is requested', () => {
    const splitOptions = buildChannelDisplayOptions(['R', 'G', 'B', 'A', 'mask'], {
      includeSplitChannels: true
    });
    const splitOnlyOptions = buildChannelDisplayOptions(['R', 'G', 'B', 'A', 'mask'], {
      includeRgbGroups: false,
      includeSplitChannels: true
    });

    expect(splitOptions.map((option) => option.label)).toEqual([
      'R,G,B,A',
      'R',
      'G',
      'B',
      'A',
      'mask'
    ]);
    expect(splitOnlyOptions.map((option) => option.label)).toEqual(['R', 'G', 'B', 'A', 'mask']);
  });

  it('builds grouped and split channel display options for namespaced RGB when requested', () => {
    const defaultOptions = buildChannelDisplayOptions(['HOGE.R', 'HOGE.G', 'HOGE.B', 'HOGE.A']);
    const splitOptions = buildChannelDisplayOptions(['HOGE.R', 'HOGE.G', 'HOGE.B', 'HOGE.A'], {
      includeSplitChannels: true
    });
    const splitOnlyOptions = buildChannelDisplayOptions(['HOGE.R', 'HOGE.G', 'HOGE.B', 'HOGE.A'], {
      includeRgbGroups: false,
      includeSplitChannels: true
    });

    expect(defaultOptions.map((option) => option.label)).toEqual(['HOGE.(R,G,B,A)']);
    expect(splitOptions.map((option) => option.label)).toEqual([
      'HOGE.(R,G,B,A)',
      'HOGE.R',
      'HOGE.G',
      'HOGE.B',
      'HOGE.A'
    ]);
    expect(splitOptions[1]?.selection).toEqual(createChannelMonoSelection('HOGE.R'));
    expect(splitOnlyOptions.map((option) => option.label)).toEqual(['HOGE.R', 'HOGE.G', 'HOGE.B', 'HOGE.A']);
  });

  it('builds grouped XYZ and UV display options with split components', () => {
    const defaultOptions = buildChannelDisplayOptions([
      'vector.X',
      'vector.Y',
      'vector.Z',
      'normal.X',
      'normal.Y',
      'normal.Z',
      'motion.U',
      'motion.V',
      'motion.A',
      'mask'
    ]);
    const splitOptions = buildChannelDisplayOptions(['motion.U', 'motion.V', 'motion.A'], {
      includeSplitChannels: true
    });

    expect(defaultOptions.map((option) => option.label)).toEqual([
      'normal Normal Map',
      'vector.(X,Y,Z)',
      'motion.(U,V,A)',
      'mask'
    ]);
    expect(defaultOptions[0]?.key).toBe('normalMap:normal');
    expect(defaultOptions[0]?.selection).toEqual(createChannelRgbSelection('normal.X', 'normal.Y', 'normal.Z', null, 'normalMap'));
    expect(defaultOptions[1]?.key).toBe('groupXYZ:vector');
    expect(defaultOptions[1]?.selection).toEqual(createChannelRgbSelection('vector.X', 'vector.Y', 'vector.Z'));
    expect(defaultOptions[2]?.key).toBe('groupUV:motion');
    expect(defaultOptions[2]?.selection).toEqual(createChannelRgbSelection('motion.U', 'motion.V', null, 'motion.A'));
    expect(defaultOptions[2]?.mapping).toEqual({
      displayR: 'motion.U',
      displayG: 'motion.V',
      displayB: null,
      displayA: 'motion.A'
    });
    expect(splitOptions.map((option) => option.label)).toEqual([
      'motion.(U,V,A)',
      'motion.U',
      'motion.V',
      'motion.A'
    ]);
  });

  it('keeps RGB channel display options before recognized normal maps', () => {
    const options = buildChannelDisplayOptions(['normal.X', 'normal.Y', 'normal.Z', 'R', 'G', 'B']);

    expect(options.map((option) => option.key)).toEqual([
      'group:',
      'normalMap:normal'
    ]);
    expect(options.map((option) => option.label)).toEqual([
      'R,G,B',
      'normal Normal Map'
    ]);
  });

  it('prioritizes exact Y after grouped channel options', () => {
    const scalarOptions = buildChannelDisplayOptions(['Z', 'Y', 'A', 'mask']);
    const splitScalarOptions = buildChannelDisplayOptions(['Z', 'Y', 'mask'], {
      includeRgbGroups: false,
      includeSplitChannels: true
    });
    const rgbOptions = buildChannelDisplayOptions(['R', 'G', 'B', 'Y', 'mask']);
    const xyzOptions = buildChannelDisplayOptions(['vector.X', 'vector.Y', 'vector.Z', 'Y'], {
      includeSplitChannels: true
    });
    const namespacedOptions = buildChannelDisplayOptions(['foo.Z', 'foo.Y', 'Y']);

    expect(scalarOptions.map((option) => option.label)).toEqual(['Y,A', 'Z,A', 'mask,A']);
    expect(splitScalarOptions.map((option) => option.label)).toEqual(['Y', 'Z', 'mask']);
    expect(rgbOptions.map((option) => option.label)).toEqual(['R,G,B', 'Y', 'mask']);
    expect(xyzOptions.map((option) => option.label)).toEqual([
      'vector.(X,Y,Z)',
      'vector.X',
      'vector.Y',
      'vector.Z',
      'Y'
    ]);
    expect(namespacedOptions.map((option) => option.label)).toEqual(['Y', 'foo.Z', 'foo.Y']);
  });

  it('resolves alpha companions for scalar options and splits alpha companions into separate rows', () => {
    const bareOptions = buildChannelDisplayOptions(['Z', 'A']);
    const namespacedOptions = buildChannelDisplayOptions(['depth.Z', 'depth.A', 'A']);
    const splitRgbOptions = buildChannelDisplayOptions(['R', 'G', 'B', 'A'], {
      includeRgbGroups: false,
      includeSplitChannels: true
    });

    expect(bareOptions.map((option) => option.label)).toEqual(['Z,A']);
    expect(bareOptions[0]?.selection).toEqual(createChannelMonoSelection('Z', 'A'));
    expect(namespacedOptions.map((option) => option.label)).toEqual(['depth.Z,depth.A', 'A']);
    expect(splitRgbOptions.find((option) => option.label === 'R')?.selection).toEqual(createChannelMonoSelection('R'));
  });

  it('finds the selected channel option by semantic equality', () => {
    const options = buildChannelDisplayOptions(['R', 'G', 'B', 'A', 'mask']);
    expect(findSelectedChannelDisplayOption(options, createChannelMonoSelection('mask', 'A'))?.label).toBe('mask,A');
    expect(findSelectedChannelDisplayOption(options, createStokesSelection('aolp'))).toBeNull();
  });

  it('remaps scalar alpha selections when toggling split mode', () => {
    const grouped = createChannelMonoSelection('mask', 'A');
    const split = findSplitSelectionForMergedDisplay(['R', 'G', 'B', 'A', 'mask'], grouped);

    expect(split).toEqual(createChannelMonoSelection('mask'));
    expect(findMergedSelectionForSplitDisplay(['R', 'G', 'B', 'A', 'mask'], split)).toEqual(grouped);
  });

  it('remaps split RGB alpha selections to their merged RGBA group', () => {
    expect(findMergedSelectionForSplitDisplay(['R', 'G', 'B', 'A'], createChannelMonoSelection('A'))).toEqual(
      createChannelRgbSelection('R', 'G', 'B', 'A')
    );
    expect(findMergedSelectionForSplitDisplay(
      ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A'],
      createChannelMonoSelection('beauty.A')
    )).toEqual(createChannelRgbSelection('beauty.R', 'beauty.G', 'beauty.B', 'beauty.A'));
    expect(findMergedSelectionForSplitDisplay(['A'], createChannelMonoSelection('A'))).toBeNull();
  });

  it('keeps alpha-only layers inspectable', () => {
    const options = buildChannelDisplayOptions(['A']);
    expect(options.map((option) => option.label)).toEqual(['A']);
    expect(options[0]?.selection).toEqual(createChannelMonoSelection('A'));
  });

  it('builds grayscale options for scalar-only and non-grouped channel lists', () => {
    const scalarOptions = buildChannelDisplayOptions(['Z']);
    const nonRgbOptions = buildChannelDisplayOptions(['P', 'Q', 'T']);

    expect(scalarOptions.map((option) => option.label)).toEqual(['Z']);
    expect(nonRgbOptions.map((option) => option.label)).toEqual(['P', 'Q', 'T']);
    expect(findSelectedChannelDisplayOption(nonRgbOptions, createChannelRgbSelection('X', 'Y', 'Z'))).toBeNull();
  });

  it('remaps grouped and split XYZ/UV selections when toggling split mode', () => {
    const xyzChannels = ['vector.X', 'vector.Y', 'vector.Z'];
    const uvChannels = ['motion.U', 'motion.V', 'motion.A'];
    const xyzGrouped = createChannelRgbSelection('vector.X', 'vector.Y', 'vector.Z');
    const uvGrouped = createChannelRgbSelection('motion.U', 'motion.V', null, 'motion.A');

    expect(findSplitSelectionForMergedDisplay(xyzChannels, xyzGrouped)).toEqual(
      createChannelMonoSelection('vector.X')
    );
    expect(findMergedSelectionForSplitDisplay(xyzChannels, createChannelMonoSelection('vector.Z'))).toEqual(
      xyzGrouped
    );
    expect(findSplitSelectionForMergedDisplay(uvChannels, uvGrouped)).toEqual(
      createChannelMonoSelection('motion.U')
    );
    expect(findMergedSelectionForSplitDisplay(uvChannels, createChannelMonoSelection('motion.V'))).toEqual(
      uvGrouped
    );
    expect(findMergedSelectionForSplitDisplay(uvChannels, createChannelMonoSelection('motion.A'))).toEqual(
      uvGrouped
    );
  });

  it('remaps grouped and split normal-map selections while preserving color mapping', () => {
    const channelNames = ['normal.X', 'normal.Y', 'normal.Z'];
    const grouped = createChannelRgbSelection('normal.X', 'normal.Y', 'normal.Z', null, 'normalMap');

    expect(findSplitSelectionForMergedDisplay(channelNames, grouped)).toEqual(
      createChannelMonoSelection('normal.X')
    );
    expect(findMergedSelectionForSplitDisplay(channelNames, createChannelMonoSelection('normal.Z'))).toEqual(
      grouped
    );
  });

  it('remaps grouped and split RGB Stokes selections when toggling split mode', () => {
    const rgbStokesNames = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B',
      'S3.R', 'S3.G', 'S3.B'
    ];
    const grouped = createStokesSelection('aolp', 'stokesRgb');
    const split = findSplitSelectionForMergedDisplay(rgbStokesNames, grouped);

    expect(split).toEqual(createStokesSelection('aolp', 'stokesRgb', 'R'));
    expect(findMergedSelectionForSplitDisplay(rgbStokesNames, split)).toEqual(grouped);
  });

  it('remaps grouped and split spectral Stokes selections when toggling split mode', () => {
    const spectralStokesNames = [
      'S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm', 'S3.500nm'
    ];
    const grouped = createStokesSelection('aolp', 'stokesSpectralRgb');
    const split = findSplitSelectionForMergedDisplay(spectralStokesNames, grouped);

    expect(split).toEqual(createStokesSelection('aolp', 'stokesScalar', null, '400nm'));
    expect(findMergedSelectionForSplitDisplay(spectralStokesNames, split)).toEqual(grouped);
  });

  it('remaps spectral RGB selections when toggling split mode', () => {
    const channelNames = ['410nm', '500nm', '650nm'];
    const grouped = createSpectralRgbSelection();
    const split = findSplitSelectionForMergedDisplay(channelNames, grouped);

    expect(split).toEqual(createChannelMonoSelection('410nm'));
    expect(findMergedSelectionForSplitDisplay(channelNames, split)).toEqual(grouped);
  });

  it('remaps split spectral channels to the matching named spectral RGB series', () => {
    const channelNames = [
      'hoge.650nm',
      'fuga.450nm',
      'hoge.450nm',
      'fuga.650nm'
    ];

    expect(findSplitSelectionForMergedDisplay(channelNames, createSpectralRgbSelection('fuga'))).toEqual(
      createChannelMonoSelection('fuga.450nm')
    );
    expect(findMergedSelectionForSplitDisplay(channelNames, createChannelMonoSelection('hoge.650nm'))).toEqual(
      createSpectralRgbSelection('hoge')
    );
  });

  it('prefers detected RGB group as default display selection', () => {
    expect(pickDefaultDisplaySelection(['AOV.X', 'HOGE.B', 'HOGE.R', 'HOGE.G'])).toEqual(
      createChannelRgbSelection('HOGE.R', 'HOGE.G', 'HOGE.B')
    );
    expect(pickDefaultDisplaySelection(['R', 'G', 'B', 'Y'])).toEqual(
      createChannelRgbSelection('R', 'G', 'B')
    );
  });

  it('uses XYZ and UV groups as defaults when RGB is unavailable', () => {
    expect(pickDefaultDisplaySelection(['normal.X', 'normal.Y', 'normal.Z'])).toEqual(
      createChannelRgbSelection('normal.X', 'normal.Y', 'normal.Z', null, 'normalMap')
    );
    expect(pickDefaultDisplaySelection(['normal.X', 'normal.Y', 'normal.Z', 'Y'])).toEqual(
      createChannelRgbSelection('normal.X', 'normal.Y', 'normal.Z', null, 'normalMap')
    );
    expect(pickDefaultDisplaySelection(['normal.X', 'normal.Y', 'normal.Z'], {
      channelRecognitionSettings: {
        ...createDefaultChannelRecognitionSettings(),
        'normal.map': false
      }
    })).toEqual(
      createChannelRgbSelection('normal.X', 'normal.Y', 'normal.Z')
    );
    expect(pickDefaultDisplaySelection(['motion.U', 'motion.V'])).toEqual(
      createChannelRgbSelection('motion.U', 'motion.V', null)
    );
  });

  it('uses scalar and arbitrary channel lists as mono defaults', () => {
    expect(pickDefaultDisplaySelection(['Y'])).toEqual(createChannelMonoSelection('Y'));
    expect(pickDefaultDisplaySelection(['Y', 'A'])).toEqual(createChannelMonoSelection('Y', 'A'));
    expect(pickDefaultDisplaySelection(['Z', 'Y', 'mask'])).toEqual(createChannelMonoSelection('Y'));
    expect(pickDefaultDisplaySelection(['foo.Z', 'foo.Y'])).toEqual(createChannelMonoSelection('foo.Z'));
    expect(pickDefaultDisplaySelection(['A', 'Z'])).toEqual(createChannelMonoSelection('Z', 'A'));
  });

  it('uses spectral RGB as the default when no RGB groups are available', () => {
    expect(pickDefaultDisplaySelection(['400nm', '500nm', '600nm', '700nm'])).toEqual(
      createSpectralRgbSelection()
    );
    expect(pickDefaultDisplaySelection(['400nm', '500nm', 'mask'])).toEqual(
      createSpectralRgbSelection()
    );
    expect(pickDefaultDisplaySelection(['R', 'G', 'B', '400nm', '500nm'])).toEqual(
      createChannelRgbSelection('R', 'G', 'B')
    );
    expect(pickDefaultDisplaySelection(['400nm', '500nm', 'Y'])).toEqual(
      createSpectralRgbSelection()
    );
  });

  it('uses a complete Mueller matrix as the default before falling back to M00', () => {
    const muellerNames = [...MUELLER_MATRIX_ELEMENTS];
    const rgbMuellerNames = MUELLER_MATRIX_ELEMENTS.flatMap((element) => [
      `${element}.R`,
      `${element}.G`,
      `${element}.B`
    ]);
    expect(pickDefaultDisplaySelection(muellerNames)).toEqual(createMuellerMatrixSelection());
    expect(pickDefaultDisplaySelection(rgbMuellerNames)).toEqual(createRgbMuellerMatrixSelection());
    expect(pickDefaultDisplaySelection(['R', 'G', 'B', ...rgbMuellerNames])).toEqual(
      createChannelRgbSelection('R', 'G', 'B')
    );
    expect(pickDefaultDisplaySelection(muellerNames.map((element) => `${element}.Y`))).toEqual(
      createMuellerMatrixSelection('Y')
    );
    expect(pickDefaultDisplaySelection(muellerNames.slice(0, -1))).toEqual(createChannelMonoSelection('M00'));
  });

  it('falls back to wavelength channels when spectral RGB grouping is disabled', () => {
    expect(pickDefaultDisplaySelection(['400nm', '500nm', '600nm', '700nm'], {
      spectralRgbGroupingEnabled: false
    })).toEqual(createChannelMonoSelection('400nm'));
    expect(resolveDisplaySelectionForLayer(
      ['hoge.450nm', 'hoge.550nm'],
      createSpectralRgbSelection('hoge'),
      { spectralRgbGroupingEnabled: false }
    )).toEqual(createChannelMonoSelection('hoge.450nm'));
    expect(resolveDisplaySelectionForLayer(
      ['S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm', 'S0.500nm', 'S1.500nm', 'S2.500nm', 'S3.500nm'],
      createStokesSelection('s1_over_s0', 'stokesSpectralRgb'),
      { spectralRgbGroupingEnabled: false }
    )).toEqual(createChannelMonoSelection('S0.400nm'));
  });

  it('falls back when the active recognized rule family is disabled', () => {
    expect(resolveDisplaySelectionForLayer(
      ['R', 'G', 'B', 'Y'],
      createChannelRgbSelection('R', 'G', 'B'),
      {
        channelRecognitionSettings: {
          ...createDefaultChannelRecognitionSettings(),
          'component.rgb': false
        }
      }
    )).toEqual(createChannelMonoSelection('Y'));
    expect(resolveDisplaySelectionForLayer(
      ['400nm', '500nm', '600nm'],
      createSpectralRgbSelection(),
      {
        channelRecognitionSettings: {
          ...createDefaultChannelRecognitionSettings(),
          'spectral.series': false
        }
      }
    )).toEqual(createChannelMonoSelection('400nm'));
  });

  it('preserves valid channel and stokes selections per layer and falls back otherwise', () => {
    expect(resolveDisplaySelectionForLayer(['R', 'G', 'B', 'A'], createChannelRgbSelection('R', 'G', 'B'))).toEqual(
      createChannelRgbSelection('R', 'G', 'B', 'A')
    );
    expect(resolveDisplaySelectionForLayer(['Y', 'A'], createChannelMonoSelection('Y'))).toEqual(
      createChannelMonoSelection('Y', 'A')
    );
    expect(resolveDisplaySelectionForLayer(['S0', 'S1', 'S2', 'S3'], createStokesSelection('aolp'))).toEqual(
      createStokesSelection('aolp')
    );
    expect(resolveDisplaySelectionForLayer(['S0', 'S1', 'S2'], createStokesSelection('dolp'))).toEqual(
      createStokesSelection('dolp')
    );
    expect(resolveDisplaySelectionForLayer(['S0', 'S1', 'S2'], createStokesSelection('dop'))).toEqual(
      createChannelMonoSelection('S0')
    );
    expect(resolveDisplaySelectionForLayer(['S0', 'S1', 'S2'], createStokesSelection('s3_over_s0'))).toEqual(
      createChannelMonoSelection('S0')
    );
    expect(resolveDisplaySelectionForLayer(['R', 'G', 'B'], createStokesSelection('aolp'))).toEqual(
      createChannelRgbSelection('R', 'G', 'B')
    );
    expect(resolveDisplaySelectionForLayer(['hoge.450nm', 'hoge.550nm'], createSpectralRgbSelection('hoge'))).toEqual(
      createSpectralRgbSelection('hoge')
    );
    expect(resolveDisplaySelectionForLayer(['hoge.450nm', 'hoge.550nm'], createSpectralRgbSelection('missing'))).toEqual(
      createSpectralRgbSelection('hoge')
    );
    expect(resolveDisplaySelectionForLayer([...MUELLER_MATRIX_ELEMENTS], createMuellerMatrixSelection())).toEqual(
      createMuellerMatrixSelection()
    );
    expect(resolveDisplaySelectionForLayer(
      MUELLER_MATRIX_ELEMENTS.flatMap((element) => [`${element}.R`, `${element}.G`, `${element}.B`]),
      createRgbMuellerMatrixSelection()
    )).toEqual(createRgbMuellerMatrixSelection());
    expect(resolveDisplaySelectionForLayer([...MUELLER_MATRIX_ELEMENTS].slice(0, -1), createMuellerMatrixSelection())).toEqual(
      createChannelMonoSelection('M00')
    );
  });
});
