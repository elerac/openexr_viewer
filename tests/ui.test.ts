import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPartLayerItemsFromChannelNames,
  clampPanelSplitSizes,
  formatProbeCoordinates,
  getChannelViewSwatches,
  getListboxOptionIndexAtClientY,
  getPanelSplitKeyboardAction,
  parsePanelSplitStorageValue,
  ProgressiveLoadingOverlayDisclosure,
  type LoadingOverlayPhase,
  type PanelSplitMetrics
} from '../src/ui';

afterEach(() => {
  vi.useRealTimers();
});

describe('progressive loading overlay disclosure', () => {
  function createDisclosure(): {
    disclosure: ProgressiveLoadingOverlayDisclosure;
    phases: LoadingOverlayPhase[];
  } {
    const phases: LoadingOverlayPhase[] = [];
    return {
      disclosure: new ProgressiveLoadingOverlayDisclosure((phase) => {
        phases.push(phase);
      }),
      phases
    };
  }

  it('does not reveal loading UI when loading finishes before 200 ms', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(199);
    disclosure.setLoading(false);
    vi.advanceTimersByTime(1000);

    expect(phases).toEqual(['hidden', 'hidden']);
    expect(phases).not.toContain('subtle');
    expect(phases).not.toContain('message');
  });

  it('shows only the subtle indicator from 200 ms until 1 s', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(799);

    expect(phases).toEqual(['hidden', 'subtle']);
  });

  it('shows the explicit message after 1 s', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(1000);

    expect(phases).toEqual(['hidden', 'subtle', 'message']);
  });

  it('hides and clears pending phases after the subtle state', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(200);
    disclosure.setLoading(false);
    vi.advanceTimersByTime(1000);

    expect(phases).toEqual(['hidden', 'subtle', 'hidden']);
  });

  it('hides after the explicit message state', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(1000);
    disclosure.setLoading(false);

    expect(phases).toEqual(['hidden', 'subtle', 'message', 'hidden']);
  });

  it('keeps the original disclosure schedule while loading remains active', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(500);
    disclosure.setLoading(true);
    vi.advanceTimersByTime(500);

    expect(phases).toEqual(['hidden', 'subtle', 'message']);
  });
});

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

describe('probe coordinate formatting', () => {
  it('pads x and y to the maximum digit width for the image size', () => {
    expect(formatProbeCoordinates({ x: 7, y: 42 }, { width: 1024, height: 100 })).toBe('x    7   y 42');
  });

  it('uses the same widths for empty probe coordinates', () => {
    expect(formatProbeCoordinates(null, { width: 1024, height: 100 })).toBe('x    -   y  -');
  });
});

describe('panel split sizing', () => {
  const metrics: PanelSplitMetrics = {
    mainWidth: 900,
    imageResizerWidth: 8,
    rightResizerWidth: 8
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
          removedPanelHeight: 180
        })
      )
    ).toEqual({ imagePanelWidth: 260 });
  });

  it('clamps saved panel sizes to keep the viewer usable', () => {
    const sizes = clampPanelSplitSizes(
      {
        imagePanelWidth: 999,
        rightPanelWidth: 999
      },
      metrics
    );

    expect(sizes.imagePanelWidth + sizes.rightPanelWidth).toBeLessThanOrEqual(524);
    expect(sizes.imagePanelWidth).toBeGreaterThanOrEqual(160);
    expect(sizes.rightPanelWidth).toBeGreaterThanOrEqual(240);
  });

  it('preserves the active side split as much as possible while clamping overflow', () => {
    const sizes = clampPanelSplitSizes(
      {
        imagePanelWidth: 420,
        rightPanelWidth: 520
      },
      metrics,
      'imagePanelWidth'
    );

    expect(sizes.imagePanelWidth).toBe(284);
    expect(sizes.rightPanelWidth).toBe(240);
  });

  it('maps splitter keyboard input to resize actions', () => {
    expect(getPanelSplitKeyboardAction('ArrowRight', false)).toEqual({ type: 'delta', delta: 16 });
    expect(getPanelSplitKeyboardAction('ArrowLeft', true)).toEqual({ type: 'delta', delta: -64 });
    expect(getPanelSplitKeyboardAction('Home', false)).toEqual({ type: 'snap', target: 'min' });
    expect(getPanelSplitKeyboardAction('End', false)).toEqual({ type: 'snap', target: 'max' });
    expect(getPanelSplitKeyboardAction('ArrowDown', false)).toBeNull();
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

describe('channel view icons', () => {
  it('uses semantic channel colors instead of positional RGB colors', () => {
    expect(getChannelViewSwatches({
      displayR: 'R',
      displayG: 'G',
      displayB: 'B',
      displayA: 'A'
    })).toEqual(['#ff6570', '#6bd66f', '#51aefe']);

    const scalarAlphaSwatches = getChannelViewSwatches({
      displayR: 'mask',
      displayG: 'mask',
      displayB: 'mask',
      displayA: 'A'
    });
    expect(scalarAlphaSwatches).not.toEqual(['#ff6570', '#6bd66f']);
    expect(scalarAlphaSwatches[1]).toBe('#c6cbd2');

    expect(getChannelViewSwatches({
      displayR: 'G',
      displayG: 'G',
      displayB: 'G',
      displayA: null
    })).toEqual(['#6bd66f']);
  });
});
