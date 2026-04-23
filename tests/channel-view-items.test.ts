import { describe, expect, it } from 'vitest';
import {
  buildChannelViewItems,
  findSelectedChannelViewItem,
  hasSplitChannelViewItems,
  selectVisibleChannelViewItems
} from '../src/channel-view-items';
import { createChannelMonoSelection } from './helpers/state-fixtures';

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

  it('finds the selected descriptor by display selection', () => {
    const items = buildChannelViewItems(['depth.Z']);

    expect(findSelectedChannelViewItem(items, createChannelMonoSelection('depth.Z'))?.value).toBe('channel:depth.Z');
  });
});
