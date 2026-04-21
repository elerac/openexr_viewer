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
  createStokesSelection
} from './helpers/state-fixtures';

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

  it('builds grayscale options for scalar-only and non-RGB channel lists', () => {
    const scalarOptions = buildChannelDisplayOptions(['Z']);
    const nonRgbOptions = buildChannelDisplayOptions(['X', 'Y', 'Z']);

    expect(scalarOptions.map((option) => option.label)).toEqual(['Z']);
    expect(nonRgbOptions.map((option) => option.label)).toEqual(['X', 'Y', 'Z']);
    expect(findSelectedChannelDisplayOption(nonRgbOptions, createChannelRgbSelection('X', 'Y', 'Z'))).toBeNull();
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

  it('prefers detected RGB group as default display selection', () => {
    expect(pickDefaultDisplaySelection(['AOV.X', 'HOGE.B', 'HOGE.R', 'HOGE.G'])).toEqual(
      createChannelRgbSelection('HOGE.R', 'HOGE.G', 'HOGE.B')
    );
  });

  it('uses scalar and arbitrary channel lists as mono defaults', () => {
    expect(pickDefaultDisplaySelection(['Y'])).toEqual(createChannelMonoSelection('Y'));
    expect(pickDefaultDisplaySelection(['Y', 'A'])).toEqual(createChannelMonoSelection('Y', 'A'));
    expect(pickDefaultDisplaySelection(['A', 'Z'])).toEqual(createChannelMonoSelection('Z', 'A'));
    expect(pickDefaultDisplaySelection(['400nm', '500nm', '600nm', '700nm'])).toEqual(
      createChannelMonoSelection('400nm')
    );
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
    expect(resolveDisplaySelectionForLayer(['R', 'G', 'B'], createStokesSelection('aolp'))).toEqual(
      createChannelRgbSelection('R', 'G', 'B')
    );
  });
});
