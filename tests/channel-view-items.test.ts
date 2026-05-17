import { describe, expect, it } from 'vitest';
import {
  buildChannelViewStacks,
  buildChannelViewItems,
  findSelectedChannelViewItem,
  hasSplitChannelViewItems,
  pruneExpandedChannelStackKeys,
  selectStackedChannelViewItems,
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

  it('derives RGB/RGBA stack children from existing split descriptors', () => {
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A', 'depth.Z'];
    const items = buildChannelViewItems(channelNames);
    const stacks = buildChannelViewStacks(channelNames, items);

    expect(stacks).toEqual([
      {
        key: 'stack:group:beauty:channelRgb:beauty.R:beauty.G:beauty.B:beauty.A',
        parentValue: 'group:beauty',
        childValues: [
          'channel:beauty.R',
          'channel:beauty.G',
          'channel:beauty.B',
          'channel:beauty.A'
        ]
      }
    ]);
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

  it('splits spectral RGB descriptors into wavelength channels', () => {
    const items = buildChannelViewItems(['410nm', '500nm', '650nm']);

    expect(hasSplitChannelViewItems(items)).toBe(true);
    expect(selectVisibleChannelViewItems(items, false).map((item) => item.value)).toEqual(['spectralRgb:']);
    expect(selectVisibleChannelViewItems(items, true).map((item) => item.value)).toEqual([
      'channel:410nm',
      'channel:500nm',
      'channel:650nm'
    ]);
    expect(findSelectedChannelViewItem(items, createSpectralRgbSelection())?.label).toBe('Spectral RGB');
  });

  it('derives spectral RGB stack children and expands one stack at a time', () => {
    const channelNames = ['410nm', '500nm', '650nm', 'mask'];
    const items = buildChannelViewItems(channelNames);
    const stacks = buildChannelViewStacks(channelNames, items);
    const stackKey = stacks[0]?.key ?? '';

    expect(stacks).toEqual([
      {
        key: 'stack:spectralRgb::spectralRgb:',
        parentValue: 'spectralRgb:',
        childValues: ['channel:410nm', 'channel:500nm', 'channel:650nm']
      }
    ]);
    expect(selectStackedChannelViewItems(channelNames, items, new Set()).map((item) => ({
      value: item.value,
      stack: item.stack && { role: item.stack.role, index: item.stack.index, count: item.stack.count }
    }))).toEqual([
      { value: 'channel:mask', stack: null },
      { value: 'spectralRgb:', stack: { role: 'parent', index: 0, count: 3 } }
    ]);
    expect(selectStackedChannelViewItems(channelNames, items, new Set([stackKey])).map((item) => ({
      value: item.value,
      stack: item.stack && { role: item.stack.role, index: item.stack.index, count: item.stack.count }
    }))).toEqual([
      { value: 'channel:mask', stack: null },
      { value: 'channel:410nm', stack: { role: 'child', index: 0, count: 3 } },
      { value: 'channel:500nm', stack: { role: 'child', index: 1, count: 3 } },
      { value: 'channel:650nm', stack: { role: 'child', index: 2, count: 3 } }
    ]);
    expect([...pruneExpandedChannelStackKeys(channelNames, items, new Set([stackKey, 'missing']))]).toEqual([stackKey]);
  });

  it('keeps auxiliary channels visible while splitting valid spectral series', () => {
    const items = buildChannelViewItems(['410nm', '500nm', '650nm', 'mask']);

    expect(selectVisibleChannelViewItems(items, false).map((item) => item.value)).toEqual([
      'channel:mask',
      'spectralRgb:'
    ]);
    expect(selectVisibleChannelViewItems(items, true).map((item) => item.value)).toEqual([
      'channel:410nm',
      'channel:500nm',
      'channel:650nm',
      'channel:mask'
    ]);
  });

  it('includes signed spectral Stokes RGB descriptors alongside derived Stokes spectral RGB descriptors', () => {
    const items = buildChannelViewItems([
      'S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm', 'S3.500nm'
    ]);
    const mergedVisible = selectVisibleChannelViewItems(items, false);
    const splitVisible = selectVisibleChannelViewItems(items, true);

    expect(mergedVisible.map((item) => item.label)).toContain('S0 Spectral RGB');
    expect(mergedVisible.map((item) => item.label)).toContain('S1 Spectral RGB');
    expect(mergedVisible.map((item) => item.label)).toContain('S2 Spectral RGB');
    expect(mergedVisible.map((item) => item.label)).toContain('S3 Spectral RGB');
    expect(mergedVisible.map((item) => item.label)).toContain('S1/S0 Spectral RGB');
    expect(mergedVisible.map((item) => item.label)).not.toContain('S1/S0.400nm');
    expect(splitVisible.map((item) => item.label)).toContain('S1/S0.400nm');
    expect(splitVisible.map((item) => item.label)).toContain('AoLP.500nm');
    expect(splitVisible.map((item) => item.label)).not.toContain('S1/S0 Spectral RGB');
    expect(findSelectedChannelViewItem(items, createStokesSelection('s1_over_s0', 'stokesSpectralRgb'))?.value)
      .toBe('stokesSpectralRgb:s1_over_s0:group');
  });

  it('derives existing Stokes grouped views as stacks', () => {
    const channelNames = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B',
      'S3.R', 'S3.G', 'S3.B'
    ];
    const items = buildChannelViewItems(channelNames);
    const stack = buildChannelViewStacks(channelNames, items)
      .find((entry) => entry.parentValue === 'stokesRgb:aolp:group');

    expect(stack?.childValues).toEqual([
      'stokesRgb:aolp:R',
      'stokesRgb:aolp:G',
      'stokesRgb:aolp:B'
    ]);
  });
});
