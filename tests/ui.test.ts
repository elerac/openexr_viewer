// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPartLayerItemsFromChannelNames,
  clampPanelSplitSizes,
  formatProbeCoordinates,
  formatDisplayCacheUsageText,
  getDisplayCacheUsageState,
  getChannelViewSwatches,
  getOpenedFilePinButtonLabel,
  getListboxOptionIndexAtClientY,
  getPanelSplitKeyboardAction,
  parsePanelSplitStorageValue,
  ProgressiveLoadingOverlayDisclosure,
  ViewerUi,
  type LoadingOverlayPhase,
  type PanelSplitMetrics
} from '../src/ui';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  window.localStorage.clear();
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
    expect(phases).not.toContain('darkening');
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

  it('starts darkening at 1 s without showing the explicit message yet', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(1000);

    expect(phases).toEqual(['hidden', 'subtle', 'darkening']);
    expect(phases).not.toContain('message');
  });

  it('shows the explicit message after the 0.5 s darkening transition', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(1499);

    expect(phases).toEqual(['hidden', 'subtle', 'darkening']);

    vi.advanceTimersByTime(1);

    expect(phases).toEqual(['hidden', 'subtle', 'darkening', 'message']);
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

  it('hides and clears pending phases after the darkening state', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(1000);
    disclosure.setLoading(false);
    vi.advanceTimersByTime(500);

    expect(phases).toEqual(['hidden', 'subtle', 'darkening', 'hidden']);
  });

  it('hides after the explicit message state', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(1500);
    disclosure.setLoading(false);

    expect(phases).toEqual(['hidden', 'subtle', 'darkening', 'message', 'hidden']);
  });

  it('keeps the original disclosure schedule while loading remains active', () => {
    vi.useFakeTimers();
    const { disclosure, phases } = createDisclosure();

    disclosure.setLoading(true);
    vi.advanceTimersByTime(500);
    disclosure.setLoading(true);
    vi.advanceTimersByTime(1000);

    expect(phases).toEqual(['hidden', 'subtle', 'darkening', 'message']);
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

  it('renders lower probe raw-value rows with the shared overlay formatter', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setProbeReadout(
      'Hover',
      {
        x: 4,
        y: 7,
        values: {
          big: 1234,
          normal: 0.25,
          tiny: 0.0005,
          zero: 0
        }
      },
      {
        cssColor: 'rgb(137, 137, 137)',
        displayValues: [{ label: 'Mono', value: '0.250' }]
      }
    );

    const rows = Array.from(document.querySelectorAll('#probe-values .probe-row')).map((row) => ({
      key: row.querySelector('.probe-key')?.textContent,
      value: row.querySelector('.probe-value')?.textContent
    }));

    expect(rows).toEqual([
      { key: 'big', value: '1.2e+3' },
      { key: 'normal', value: '0.250' },
      { key: 'tiny', value: '5.0e-4' },
      { key: 'zero', value: '0.00' }
    ]);
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

describe('display cache UI helpers', () => {
  it('formats pin button labels from the pinned state', () => {
    expect(getOpenedFilePinButtonLabel('beauty.exr', false)).toBe('Pin cache for beauty.exr');
    expect(getOpenedFilePinButtonLabel('beauty.exr', true)).toBe('Unpin cache for beauty.exr');
  });

  it('formats display cache usage readouts in MB', () => {
    expect(formatDisplayCacheUsageText(0, 256 * 1024 * 1024)).toBe('0 / 256 MB');
    expect(formatDisplayCacheUsageText(126 * 1024 * 1024, 256 * 1024 * 1024)).toBe('126 / 256 MB');
  });

  it('marks the usage state when retained caches exceed the budget', () => {
    expect(getDisplayCacheUsageState(64 * 1024 * 1024, 256 * 1024 * 1024)).toEqual({
      text: '64 / 256 MB',
      overBudget: false
    });
    expect(getDisplayCacheUsageState(300 * 1024 * 1024, 256 * 1024 * 1024)).toEqual({
      text: '300 / 256 MB',
      overBudget: true
    });
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

function installUiFixture(): void {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const bodyMarkup = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  document.body.innerHTML = bodyMarkup;

  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

function createUiCallbacks() {
  return {
    onOpenFileClick: () => {},
    onFileSelected: () => {},
    onFilesDropped: () => {},
    onGalleryImageSelected: () => {},
    onReloadAllOpenedImages: () => {},
    onReloadSelectedOpenedImage: () => {},
    onCloseSelectedOpenedImage: () => {},
    onCloseAllOpenedImages: () => {},
    onOpenedImageSelected: () => {},
    onReorderOpenedImage: () => {},
    onDisplayCacheBudgetChange: () => {},
    onToggleOpenedImagePin: () => {},
    onExposureChange: () => {},
    onLayerChange: () => {},
    onRgbGroupChange: () => {},
    onVisualizationModeChange: () => {},
    onColormapChange: () => {},
    onColormapRangeChange: () => {},
    onColormapAutoRange: () => {},
    onColormapZeroCenterToggle: () => {},
    onStokesDegreeModulationToggle: () => {},
    onResetView: () => {}
  };
}
