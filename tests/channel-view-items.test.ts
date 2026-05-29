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
import { createDefaultStokesParameterVisibilitySettings } from '../src/stokes';
import { MUELLER_MATRIX_ELEMENTS } from '../src/mueller';
import {
  createChannelMonoSelection,
  createMuellerMatrixSelection,
  createRgbMuellerMatrixSelection,
  createSpectralRgbSelection,
  createStokesSelection
} from './helpers/state-fixtures';

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

  it('prioritizes exact Y channel view items without changing grouped component order', () => {
    const scalarItems = buildChannelViewItems(['Z', 'Y', 'mask']);
    const rgbItems = buildChannelViewItems(['R', 'G', 'B', 'Y', 'mask']);
    const xyzItems = buildChannelViewItems(['normal.X', 'normal.Y', 'normal.Z', 'Y']);
    const namespacedItems = buildChannelViewItems(['foo.Z', 'foo.Y', 'Y']);

    expect(selectVisibleChannelViewItems(scalarItems, false).map((item) => item.value)).toEqual([
      'channel:Y',
      'channel:Z',
      'channel:mask'
    ]);
    expect(selectVisibleChannelViewItems(rgbItems, false).map((item) => item.value)).toEqual([
      'group:',
      'channel:Y',
      'channel:mask'
    ]);
    expect(selectVisibleChannelViewItems(xyzItems, false).map((item) => item.value)).toEqual([
      'groupXYZ:normal',
      'channel:Y'
    ]);
    expect(selectVisibleChannelViewItems(xyzItems, true).map((item) => item.value)).toEqual([
      'channel:normal.X',
      'channel:normal.Y',
      'channel:normal.Z',
      'channel:Y'
    ]);
    expect(selectVisibleChannelViewItems(namespacedItems, false).map((item) => item.value)).toEqual([
      'channel:Y',
      'channel:foo.Z',
      'channel:foo.Y'
    ]);
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

  it('derives XYZ and UV stack children from existing split descriptors', () => {
    const channelNames = [
      'normal.X',
      'normal.Y',
      'normal.Z',
      'motion.U',
      'motion.V',
      'motion.A',
      'depth.Z'
    ];
    const items = buildChannelViewItems(channelNames);
    const merged = selectVisibleChannelViewItems(items, false);
    const split = selectVisibleChannelViewItems(items, true);
    const stacks = buildChannelViewStacks(channelNames, items);

    expect(merged.map((item) => ({ value: item.value, label: item.label, meta: item.meta, swatches: item.swatches })))
      .toEqual([
        {
          value: 'groupXYZ:normal',
          label: 'normal.XYZ',
          meta: '32f x 3',
          swatches: ['#ff6570', '#6bd66f', '#51aefe']
        },
        {
          value: 'groupUV:motion',
          label: 'motion.UVA',
          meta: '32f x 3',
          swatches: ['#ff6570', '#6bd66f']
        },
        {
          value: 'channel:depth.Z',
          label: 'depth.Z',
          meta: '32f',
          swatches: ['#8f83e6']
        }
      ]);
    expect(split.map((item) => item.value)).toEqual([
      'channel:normal.X',
      'channel:normal.Y',
      'channel:normal.Z',
      'channel:motion.U',
      'channel:motion.V',
      'channel:motion.A',
      'channel:depth.Z'
    ]);
    expect(stacks).toEqual([
      {
        key: 'stack:groupXYZ:normal:channelRgb:normal.X:normal.Y:normal.Z:',
        parentValue: 'groupXYZ:normal',
        childValues: [
          'channel:normal.X',
          'channel:normal.Y',
          'channel:normal.Z'
        ]
      },
      {
        key: 'stack:groupUV:motion:channelRgb:motion.U:motion.V::motion.A',
        parentValue: 'groupUV:motion',
        childValues: [
          'channel:motion.U',
          'channel:motion.V',
          'channel:motion.A'
        ]
      }
    ]);
  });

  it('shows UV groups as two-channel displays when no alpha companion exists', () => {
    const uvItem = selectVisibleChannelViewItems(buildChannelViewItems(['U', 'V']), false)[0];

    expect(uvItem).toMatchObject({
      value: 'groupUV:',
      label: 'UV',
      meta: '32f x 2',
      swatches: ['#ff6570', '#6bd66f']
    });
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

  it('builds Mueller matrix descriptors for complete bare and suffixed sets', () => {
    const items = buildChannelViewItems([
      ...MUELLER_MATRIX_ELEMENTS,
      ...MUELLER_MATRIX_ELEMENTS.map((element) => `${element}.Y`)
    ]);
    const visible = selectVisibleChannelViewItems(items, false);
    const bare = visible.find((item) => item.value === 'muellerMatrix:');
    const suffixed = visible.find((item) => item.value === 'muellerMatrix:Y');

    expect(bare?.label).toBe('Mueller Matrix');
    expect(bare?.meta).toBe('32f x 16');
    expect(suffixed?.label).toBe('Mueller Matrix.Y');
    expect(suffixed?.meta).toBe('32f x 16');
    expect(findSelectedChannelViewItem(items, createMuellerMatrixSelection())?.value).toBe('muellerMatrix:');
    expect(findSelectedChannelViewItem(items, createMuellerMatrixSelection('Y'))?.value).toBe('muellerMatrix:Y');
  });

  it('builds grouped and split RGB Mueller matrix descriptors', () => {
    const channelNames = MUELLER_MATRIX_ELEMENTS.flatMap((element) => [
      `${element}.R`,
      `${element}.G`,
      `${element}.B`
    ]);
    const items = buildChannelViewItems(channelNames);
    const merged = selectVisibleChannelViewItems(items, false);
    const split = selectVisibleChannelViewItems(items, true);

    expect(merged.some((item) => (
      item.value === 'muellerMatrixRgb:' &&
      item.label === 'Mueller Matrix.RGB' &&
      item.meta === '32f x 48'
    ))).toBe(true);
    expect(split.map((item) => item.value)).toEqual(expect.arrayContaining([
      'muellerMatrix:R',
      'muellerMatrix:G',
      'muellerMatrix:B'
    ]));
    expect(findSelectedChannelViewItem(items, createRgbMuellerMatrixSelection())?.value).toBe('muellerMatrixRgb:');
    expect(findSelectedChannelViewItem(items, createMuellerMatrixSelection('G'))?.value).toBe('muellerMatrix:G');
    expect(buildChannelViewStacks(channelNames, items).some((stack) => (
      stack.parentValue === 'muellerMatrixRgb:' &&
      stack.childValues.includes('muellerMatrix:R') &&
      stack.childValues.includes('muellerMatrix:G') &&
      stack.childValues.includes('muellerMatrix:B')
    ))).toBe(true);
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

  it('shows spectral wavelength channels individually when spectral RGB grouping is disabled', () => {
    const items = buildChannelViewItems(['410nm', '500nm', '650nm'], {
      spectralRgbGroupingEnabled: false
    });
    const values = selectVisibleChannelViewItems(items, false).map((item) => item.value);

    expect(hasSplitChannelViewItems(items)).toBe(false);
    expect(values).toEqual([
      'channel:410nm',
      'channel:500nm',
      'channel:650nm'
    ]);
    expect(values.some((value) => value.startsWith('spectralRgb:'))).toBe(false);
    expect(findSelectedChannelViewItem(items, createSpectralRgbSelection())).toBeNull();
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

  it('keeps spectral Stokes wavelength entries ungrouped when spectral RGB grouping is disabled', () => {
    const items = buildChannelViewItems([
      'S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm', 'S3.500nm'
    ], {
      spectralRgbGroupingEnabled: false
    });
    const values = selectVisibleChannelViewItems(items, false).map((item) => item.value);
    const labels = selectVisibleChannelViewItems(items, false).map((item) => item.label);

    expect(values.some((value) => value.startsWith('spectralRgb:'))).toBe(false);
    expect(values.some((value) => value.startsWith('stokesSpectralRgb:'))).toBe(false);
    expect(labels).toContain('S1/S0.400nm');
    expect(labels).toContain('AoLP.500nm');
    expect(labels).not.toContain('S1/S0 Spectral RGB');
    expect(findSelectedChannelViewItem(items, createStokesSelection('s1_over_s0', 'stokesSpectralRgb')))
      .toBeNull();
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

  it('omits disabled Stokes parameter groups from channel items and stacks', () => {
    const channelNames = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B',
      'S3.R', 'S3.G', 'S3.B'
    ];
    const items = buildChannelViewItems(channelNames, {
      stokesParameterVisibility: {
        ...createDefaultStokesParameterVisibilitySettings(),
        aolp: false,
        degree: false
      }
    });
    const labels = items.map((item) => item.label);
    const values = items.map((item) => item.value);

    expect(labels).not.toContain('AoLP.(R,G,B)');
    expect(labels).not.toContain('DoP.(R,G,B)');
    expect(labels).not.toContain('DoLP.(R,G,B)');
    expect(labels).not.toContain('DoCP.(R,G,B)');
    expect(values).toContain('stokesRgb:s1_over_s0:group');
    expect(values).toContain('stokesRgb:cop:group');
    expect(buildChannelViewStacks(channelNames, items).some((stack) => stack.parentValue === 'stokesRgb:aolp:group'))
      .toBe(false);
  });
});
