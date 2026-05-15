import { describe, expect, it } from 'vitest';
import {
  buildChannelViewItems,
  findSelectedChannelViewItem,
  hasSplitChannelViewItems,
  selectVisibleChannelViewItems
} from '../src/channel-view-items';
import { createChannelMonoSelection, createSpectralRgbSelection, createStokesSelection } from './helpers/state-fixtures';

describe('channel view items', () => {
  it('keeps merged and split channel ordering stable from one shared descriptor list', () => {
    const items = buildChannelViewItems(['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A', 'depth.Z']);

    expect(hasSplitChannelViewItems(items)).toBe(true);
    expect(selectVisibleChannelViewItems(items, false).map((item) => item.value)).toEqual([
      'group:beauty',
      'channel:depth.Z'
    ]);
    expect(selectVisibleChannelViewItems(items, true).map((item) => item.value)).toEqual([
      'channel:beauty.R',
      'channel:beauty.G',
      'channel:beauty.B',
      'channel:beauty.A',
      'channel:depth.Z'
    ]);

    const depthItem = items.find((item) => item.value === 'channel:depth.Z');
    expect(depthItem?.mergedOrder).not.toBeNull();
    expect(depthItem?.splitOrder).not.toBeNull();
  });

  it('builds merged and split stokes descriptors from the same item set', () => {
    const items = buildChannelViewItems([
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B',
      'S3.R', 'S3.G', 'S3.B'
    ]);

    expect(selectVisibleChannelViewItems(items, false).some((item) => item.value === 'stokesRgb:s1_over_s0:group')).toBe(true);
    expect(selectVisibleChannelViewItems(items, true).some((item) => item.value === 'stokesRgb:s1_over_s0:R')).toBe(true);
  });

  it('builds suffixed scalar stokes descriptors', () => {
    const items = buildChannelViewItems(['S0.Y', 'S1.Y', 'S2.Y', 'S3.Y']);
    const stokesItem = selectVisibleChannelViewItems(items, false)
      .find((item) => item.value === 'stokesScalar:aolp:Y');

    expect(stokesItem?.label).toBe('AoLP.Y');
    expect(stokesItem?.meta).toBe('32f x 3');
    expect(findSelectedChannelViewItem(items, createStokesSelection('aolp', 'stokesScalar', null, 'Y'))?.value)
      .toBe('stokesScalar:aolp:Y');
  });

  it('finds the selected descriptor by display selection', () => {
    const items = buildChannelViewItems(['depth.Z']);

    expect(findSelectedChannelViewItem(items, createChannelMonoSelection('depth.Z'))?.value).toBe('channel:depth.Z');
  });

  it('includes spectral RGB descriptors in merged and split channel lists', () => {
    const items = buildChannelViewItems(['410nm', '500nm', '650nm']);

    expect(selectVisibleChannelViewItems(items, false).map((item) => item.value)).toContain('spectralRgb:');
    expect(selectVisibleChannelViewItems(items, true).map((item) => item.value)).toContain('spectralRgb:');
    expect(findSelectedChannelViewItem(items, createSpectralRgbSelection())?.label).toBe('Spectral RGB');
  });

  it('includes signed spectral Stokes RGB descriptors alongside derived Stokes spectral RGB descriptors', () => {
    const items = buildChannelViewItems([
      'S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm', 'S3.500nm'
    ]);
    const visible = selectVisibleChannelViewItems(items, false);

    expect(visible.map((item) => item.label)).toContain('S0 Spectral RGB');
    expect(visible.map((item) => item.label)).toContain('S1 Spectral RGB');
    expect(visible.map((item) => item.label)).toContain('S2 Spectral RGB');
    expect(visible.map((item) => item.label)).toContain('S3 Spectral RGB');
    expect(visible.map((item) => item.label)).toContain('S1/S0 Spectral RGB');
    expect(findSelectedChannelViewItem(items, createStokesSelection('s1_over_s0', 'stokesSpectralRgb'))?.value)
      .toBe('stokesSpectralRgb:s1_over_s0:group');
  });
});
