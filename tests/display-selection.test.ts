import { describe, expect, it } from 'vitest';
import {
  buildChannelDisplayOptions,
  extractRgbChannelGroups,
  findMergedSelectionForSplitDisplay,
  findSelectedChannelDisplayOption,
  findSelectedRgbGroup,
  findSplitSelectionForMergedDisplay,
  pickDefaultDisplayChannels
} from '../src/display-selection';
import { createViewerState } from './helpers/state-fixtures';

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
    expect(options[0]?.mapping).toEqual({
      displayR: 'R',
      displayG: 'G',
      displayB: 'B',
      displayA: null
    });
  });

  it('groups auxiliary channels with alpha while keeping RGB grouped by default', () => {
    const options = buildChannelDisplayOptions(['R', 'G', 'B', 'A', 'mask']);

    expect(options.map((option) => option.label)).toEqual(['R,G,B,A', 'mask,A']);
    expect(options[0]?.mapping).toEqual({
      displayR: 'R',
      displayG: 'G',
      displayB: 'B',
      displayA: 'A'
    });
    expect(options[1]?.mapping).toEqual({
      displayR: 'mask',
      displayG: 'mask',
      displayB: 'mask',
      displayA: 'A'
    });
  });

  it('builds grouped and split channel display options for bare RGB when requested', () => {
    const options = buildChannelDisplayOptions(['R', 'G', 'B'], { includeSplitChannels: true });

    expect(options.map((option) => option.label)).toEqual(['R,G,B', 'R', 'G', 'B']);
    expect(options[0]?.mapping).toEqual({
      displayR: 'R',
      displayG: 'G',
      displayB: 'B',
      displayA: null
    });
    expect(options[1]?.mapping).toEqual({
      displayR: 'R',
      displayG: 'R',
      displayB: 'R',
      displayA: null
    });
    expect(options[2]?.mapping).toEqual({
      displayR: 'G',
      displayG: 'G',
      displayB: 'G',
      displayA: null
    });
    expect(options[3]?.mapping).toEqual({
      displayR: 'B',
      displayG: 'B',
      displayB: 'B',
      displayA: null
    });
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

  it('builds split-only channel display options for bare RGB when groups are hidden', () => {
    const options = buildChannelDisplayOptions(['R', 'G', 'B'], {
      includeRgbGroups: false,
      includeSplitChannels: true
    });

    expect(options.map((option) => option.label)).toEqual(['R', 'G', 'B']);
    expect(options[0]?.mapping).toEqual({
      displayR: 'R',
      displayG: 'R',
      displayB: 'R',
      displayA: null
    });
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
    expect(splitOptions[1]?.mapping).toEqual({
      displayR: 'HOGE.R',
      displayG: 'HOGE.R',
      displayB: 'HOGE.R',
      displayA: null
    });
    expect(splitOnlyOptions.map((option) => option.label)).toEqual(['HOGE.R', 'HOGE.G', 'HOGE.B', 'HOGE.A']);
  });

  it('resolves alpha companions for scalar options and splits alpha companions into separate rows', () => {
    const bareOptions = buildChannelDisplayOptions(['Z', 'A']);
    const namespacedOptions = buildChannelDisplayOptions(['depth.Z', 'depth.A', 'A']);
    const splitRgbOptions = buildChannelDisplayOptions(['R', 'G', 'B', 'A'], {
      includeRgbGroups: false,
      includeSplitChannels: true
    });
    const splitNamespacedOptions = buildChannelDisplayOptions(['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A'], {
      includeRgbGroups: false,
      includeSplitChannels: true
    });
    const rgbWithoutAlphaOptions = buildChannelDisplayOptions(['beauty.R', 'beauty.G', 'beauty.B', 'A']);

    expect(bareOptions.map((option) => option.label)).toEqual(['Z,A']);
    expect(bareOptions.find((option) => option.label === 'Z,A')?.mapping.displayA).toBe('A');
    expect(namespacedOptions.map((option) => option.label)).toEqual(['depth.Z,depth.A', 'A']);
    expect(namespacedOptions.find((option) => option.label === 'depth.Z,depth.A')?.mapping.displayA).toBe('depth.A');
    expect(splitRgbOptions.map((option) => option.label)).toEqual(['R', 'G', 'B', 'A']);
    expect(splitRgbOptions.find((option) => option.label === 'R')?.mapping.displayA).toBeNull();
    expect(splitNamespacedOptions.find((option) => option.label === 'beauty.R')?.mapping.displayA).toBeNull();
    expect(rgbWithoutAlphaOptions.find((option) => option.label === 'beauty.(R,G,B)')?.mapping.displayA).toBeNull();
  });

  it('remaps scalar alpha selections when toggling split mode', () => {
    const grouped = {
      ...createViewerState(),
      displayR: 'mask',
      displayG: 'mask',
      displayB: 'mask',
      displayA: 'A'
    };
    const split = findSplitSelectionForMergedDisplay(['R', 'G', 'B', 'A', 'mask'], grouped);

    expect(split).toEqual({
      displaySource: 'channels',
      stokesParameter: null,
      displayR: 'mask',
      displayG: 'mask',
      displayB: 'mask',
      displayA: null
    });
    if (!split) {
      throw new Error('Expected split scalar alpha selection.');
    }
    expect(findMergedSelectionForSplitDisplay(['R', 'G', 'B', 'A', 'mask'], split)).toEqual({
      displaySource: 'channels',
      stokesParameter: null,
      displayR: 'mask',
      displayG: 'mask',
      displayB: 'mask',
      displayA: 'A'
    });
  });

  it('remaps split RGB alpha selections to their merged RGBA group', () => {
    const bareAlpha = {
      ...createViewerState(),
      displayR: 'A',
      displayG: 'A',
      displayB: 'A',
      displayA: null
    };
    const namespacedAlpha = {
      ...createViewerState(),
      displayR: 'beauty.A',
      displayG: 'beauty.A',
      displayB: 'beauty.A',
      displayA: null
    };

    expect(findMergedSelectionForSplitDisplay(['R', 'G', 'B', 'A'], bareAlpha)).toEqual({
      displaySource: 'channels',
      stokesParameter: null,
      displayR: 'R',
      displayG: 'G',
      displayB: 'B',
      displayA: 'A'
    });
    expect(findMergedSelectionForSplitDisplay(
      ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A'],
      namespacedAlpha
    )).toEqual({
      displaySource: 'channels',
      stokesParameter: null,
      displayR: 'beauty.R',
      displayG: 'beauty.G',
      displayB: 'beauty.B',
      displayA: 'beauty.A'
    });
    expect(findMergedSelectionForSplitDisplay(['A'], bareAlpha)).toBeNull();
  });

  it('keeps alpha-only layers inspectable', () => {
    const options = buildChannelDisplayOptions(['A']);

    expect(options.map((option) => option.label)).toEqual(['A']);
    expect(options[0]?.mapping).toEqual({
      displayR: 'A',
      displayG: 'A',
      displayB: 'A',
      displayA: null
    });
  });

  it('builds grayscale options for scalar-only and non-RGB channel lists', () => {
    const scalarOptions = buildChannelDisplayOptions(['Z']);
    const nonRgbOptions = buildChannelDisplayOptions(['X', 'Y', 'Z']);

    expect(scalarOptions.map((option) => option.label)).toEqual(['Z']);
    expect(scalarOptions[0]?.mapping).toEqual({
      displayR: 'Z',
      displayG: 'Z',
      displayB: 'Z',
      displayA: null
    });
    expect(nonRgbOptions.map((option) => option.label)).toEqual(['X', 'Y', 'Z']);
    expect(findSelectedChannelDisplayOption(nonRgbOptions, 'X', 'Y', 'Z')).toBeNull();
  });

  it('remaps grouped and split RGB Stokes selections when toggling split mode', () => {
    const rgbStokesNames = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B',
      'S3.R', 'S3.G', 'S3.B'
    ];
    const grouped = {
      ...createViewerState(),
      displaySource: 'stokesRgb' as const,
      stokesParameter: 'aolp' as const,
      displayR: 'S0.R',
      displayG: 'S0.G',
      displayB: 'S0.B'
    };
    const split = findSplitSelectionForMergedDisplay(rgbStokesNames, grouped);

    expect(split).toEqual({
      displaySource: 'stokesRgb',
      stokesParameter: 'aolp',
      displayR: 'S0.R',
      displayG: 'S0.R',
      displayB: 'S0.R',
      displayA: null
    });
    if (!split) {
      throw new Error('Expected split Stokes selection.');
    }
    expect(findMergedSelectionForSplitDisplay(rgbStokesNames, split)).toEqual({
      displaySource: 'stokesRgb',
      stokesParameter: 'aolp',
      displayR: 'S0.R',
      displayG: 'S0.G',
      displayB: 'S0.B',
      displayA: null
    });
  });

  it('labels RGB groups with alpha as R,G,B,A', () => {
    const bare = extractRgbChannelGroups(['R', 'G', 'B', 'A']);
    expect(bare).toHaveLength(1);
    expect(bare[0]?.label).toBe('R,G,B,A');

    const namespaced = extractRgbChannelGroups(['HOGE.R', 'HOGE.G', 'HOGE.B', 'HOGE.A']);
    expect(namespaced).toHaveLength(1);
    expect(namespaced[0]?.label).toBe('HOGE.(R,G,B,A)');
  });

  it('prefers detected RGB group as default display mapping', () => {
    const defaults = pickDefaultDisplayChannels(['AOV.X', 'HOGE.B', 'HOGE.R', 'HOGE.G']);

    expect(defaults).toEqual({
      displayR: 'HOGE.R',
      displayG: 'HOGE.G',
      displayB: 'HOGE.B',
      displayA: null
    });
  });

  it('uses single-channel layers as grayscale default display mapping', () => {
    const defaults = pickDefaultDisplayChannels(['Y']);

    expect(defaults).toEqual({
      displayR: 'Y',
      displayG: 'Y',
      displayB: 'Y',
      displayA: null
    });
  });

  it('uses the non-alpha channel as grayscale default display mapping', () => {
    const defaults = pickDefaultDisplayChannels(['Y', 'A']);

    expect(defaults).toEqual({
      displayR: 'Y',
      displayG: 'Y',
      displayB: 'Y',
      displayA: 'A'
    });
  });

  it('uses the non-alpha grayscale default even when alpha is listed first', () => {
    const defaults = pickDefaultDisplayChannels(['A', 'Z']);

    expect(defaults).toEqual({
      displayR: 'Z',
      displayG: 'Z',
      displayB: 'Z',
      displayA: 'A'
    });
  });

  it('uses the first non-alpha arbitrary channel as grayscale default display mapping', () => {
    const defaults = pickDefaultDisplayChannels(['400nm', '500nm', '600nm', '700nm']);

    expect(defaults).toEqual({
      displayR: '400nm',
      displayG: '400nm',
      displayB: '400nm',
      displayA: null
    });
  });
});
