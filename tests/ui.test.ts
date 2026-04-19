import { describe, expect, it } from 'vitest';
import {
  buildPartLayerItemsFromChannelNames,
  clampPanelSplitSizes,
  getListboxOptionIndexAtClientY,
  getPanelSplitKeyboardAction,
  parsePanelSplitStorageValue,
  type PanelSplitMetrics
} from '../src/ui';

describe('listbox hit testing', () => {
  it('maps client coordinates using the full scrollable content height', () => {
    const index = getListboxOptionIndexAtClientY(150, {
      top: 100,
      height: 200,
      scrollTop: 0,
      scrollHeight: 400,
      optionCount: 20
    });

    expect(index).toBe(2);
  });

  it('accounts for scroll offset when the listbox has been scrolled', () => {
    const index = getListboxOptionIndexAtClientY(110, {
      top: 100,
      height: 200,
      scrollTop: 120,
      scrollHeight: 400,
      optionCount: 20
    });

    expect(index).toBe(6);
  });

  it('returns -1 for points outside the listbox bounds', () => {
    const index = getListboxOptionIndexAtClientY(90, {
      top: 100,
      height: 200,
      scrollTop: 0,
      scrollHeight: 200,
      optionCount: 5
    });

    expect(index).toBe(-1);
  });
});

describe('panel split sizing', () => {
  const metrics: PanelSplitMetrics = {
    mainWidth: 900,
    rightStackHeight: 500,
    imageResizerWidth: 8,
    rightResizerWidth: 8,
    histogramResizerHeight: 8
  };

  it('ignores corrupt panel split storage', () => {
    expect(parsePanelSplitStorageValue('{not-json')).toEqual({});
    expect(parsePanelSplitStorageValue('"not-an-object"')).toEqual({});
  });

  it('keeps valid partial panel split storage values', () => {
    expect(
      parsePanelSplitStorageValue(
        JSON.stringify({
          imagePanelWidth: 260,
          rightPanelWidth: 'wide',
          histogramPanelHeight: -20
        })
      )
    ).toEqual({ imagePanelWidth: 260 });
  });

  it('clamps saved panel sizes to keep the viewer usable', () => {
    const sizes = clampPanelSplitSizes(
      {
        imagePanelWidth: 999,
        rightPanelWidth: 999,
        histogramPanelHeight: 999
      },
      metrics
    );

    expect(sizes.imagePanelWidth + sizes.rightPanelWidth).toBeLessThanOrEqual(524);
    expect(sizes.imagePanelWidth).toBeGreaterThanOrEqual(160);
    expect(sizes.rightPanelWidth).toBeGreaterThanOrEqual(240);
    expect(sizes.histogramPanelHeight).toBe(272);
  });

  it('preserves the active side split as much as possible while clamping overflow', () => {
    const sizes = clampPanelSplitSizes(
      {
        imagePanelWidth: 420,
        rightPanelWidth: 520,
        histogramPanelHeight: 160
      },
      metrics,
      'imagePanelWidth'
    );

    expect(sizes.imagePanelWidth).toBe(284);
    expect(sizes.rightPanelWidth).toBe(240);
  });

  it('maps splitter keyboard input to resize actions', () => {
    expect(getPanelSplitKeyboardAction('ArrowRight', false, 'vertical')).toEqual({ type: 'delta', delta: 16 });
    expect(getPanelSplitKeyboardAction('ArrowLeft', true, 'vertical')).toEqual({ type: 'delta', delta: -64 });
    expect(getPanelSplitKeyboardAction('ArrowDown', false, 'horizontal')).toEqual({ type: 'delta', delta: 16 });
    expect(getPanelSplitKeyboardAction('Home', false, 'horizontal')).toEqual({ type: 'snap', target: 'min' });
    expect(getPanelSplitKeyboardAction('End', false, 'vertical')).toEqual({ type: 'snap', target: 'max' });
    expect(getPanelSplitKeyboardAction('ArrowDown', false, 'vertical')).toBeNull();
  });
});

describe('image panel layer summaries', () => {
  it('groups RGB channel families and scalar channels for parts/layers rows', () => {
    expect(
      buildPartLayerItemsFromChannelNames([
        'beauty.R',
        'beauty.G',
        'beauty.B',
        'beauty.A',
        'depth.Z',
        'albedo.R',
        'albedo.G',
        'albedo.B',
        'variance.V',
        'Y'
      ]).map(({ label, channelCount, selectable }) => ({ label, channelCount, selectable }))
    ).toEqual([
      { label: 'beauty', channelCount: 4, selectable: false },
      { label: 'depth', channelCount: 1, selectable: false },
      { label: 'albedo', channelCount: 3, selectable: false },
      { label: 'variance', channelCount: 1, selectable: false },
      { label: 'Y', channelCount: 1, selectable: false }
    ]);
  });
});
