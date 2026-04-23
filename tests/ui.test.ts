// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChannelViewItems } from '../src/channel-view-items';
import {
  buildPartLayerItemsFromChannelNames,
  clampPanelSplitSizes,
  formatProbeCoordinates,
  formatDisplayCacheUsageText,
  getDisplayCacheUsageState,
  getChannelViewSwatches,
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

  it('reuses keyed probe rows when labels stay stable', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setProbeReadout(
      'Hover',
      {
        x: 1,
        y: 2,
        values: {
          A: 0.1,
          B: 0.2
        }
      },
      {
        cssColor: 'rgb(50, 60, 70)',
        displayValues: [
          { label: 'Mono', value: '0.100' },
          { label: 'A', value: '1.000' }
        ]
      }
    );

    const initialProbeRows = Array.from(document.querySelectorAll('#probe-values .probe-row'));
    const initialColorRows = Array.from(document.querySelectorAll('#probe-color-values .probe-color-row'));

    ui.setProbeReadout(
      'Hover',
      {
        x: 1,
        y: 2,
        values: {
          A: 0.3,
          B: 0.4
        }
      },
      {
        cssColor: 'rgb(80, 90, 100)',
        displayValues: [
          { label: 'Mono', value: '0.300' },
          { label: 'A', value: '0.500' }
        ]
      }
    );

    const nextProbeRows = Array.from(document.querySelectorAll('#probe-values .probe-row'));
    const nextColorRows = Array.from(document.querySelectorAll('#probe-color-values .probe-color-row'));

    expect(nextProbeRows).toHaveLength(2);
    expect(nextColorRows).toHaveLength(2);
    expect(nextProbeRows[0]).toBe(initialProbeRows[0]);
    expect(nextProbeRows[1]).toBe(initialProbeRows[1]);
    expect(nextColorRows[0]).toBe(initialColorRows[0]);
    expect(nextColorRows[1]).toBe(initialColorRows[1]);
    expect(nextProbeRows.map((row) => row.querySelector('.probe-value')?.textContent)).toEqual(['0.300', '0.400']);
    expect(nextColorRows.map((row) => row.querySelector('.probe-color-number')?.textContent)).toEqual(['0.300', '0.500']);
  });
});

describe('metadata inspector', () => {
  it('starts with all inspector readout sections expanded and toggles them independently', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());

    const metadataToggle = document.getElementById('metadata-toggle') as HTMLButtonElement;
    const metadataContent = document.getElementById('metadata-content') as HTMLDivElement;
    const probeToggle = document.getElementById('probe-toggle') as HTMLButtonElement;
    const probeContent = document.getElementById('probe-content') as HTMLDivElement;
    const roiToggle = document.getElementById('roi-toggle') as HTMLButtonElement;
    const roiContent = document.getElementById('roi-content') as HTMLDivElement;

    expect(metadataToggle.getAttribute('aria-expanded')).toBe('true');
    expect(metadataContent.hidden).toBe(false);
    expect(probeToggle.getAttribute('aria-expanded')).toBe('true');
    expect(probeContent.hidden).toBe(false);
    expect(roiToggle.getAttribute('aria-expanded')).toBe('true');
    expect(roiContent.hidden).toBe(false);

    metadataToggle.click();

    expect(metadataToggle.getAttribute('aria-expanded')).toBe('false');
    expect(metadataContent.hidden).toBe(true);
    expect((document.getElementById('metadata-panel') as HTMLElement).classList.contains('is-collapsed')).toBe(true);
    expect(probeContent.hidden).toBe(false);
    expect(roiContent.hidden).toBe(false);

    metadataToggle.click();
    probeToggle.click();
    roiToggle.click();

    expect(metadataToggle.getAttribute('aria-expanded')).toBe('true');
    expect(metadataContent.hidden).toBe(false);
    expect(probeToggle.getAttribute('aria-expanded')).toBe('false');
    expect(probeContent.hidden).toBe(true);
    expect(roiToggle.getAttribute('aria-expanded')).toBe('false');
    expect(roiContent.hidden).toBe(true);
    expect(document.querySelector('#probe-panel .readout-block-header')).not.toBeNull();
    expect(document.querySelector('#roi-panel .readout-block-header')).not.toBeNull();
  });

  it('shows the empty state until metadata is available', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());

    expect((document.getElementById('metadata-empty-state') as HTMLElement).textContent).toContain(
      'No metadata available.'
    );
    expect((document.getElementById('metadata-table') as HTMLElement).classList.contains('hidden')).toBe(true);
  });

  it('renders metadata rows and updates them when the active layer changes', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setMetadata([
      { key: 'compression', label: 'Compression', value: 'PIZ' },
      { key: 'channels', label: 'Channels', value: '3 (R, G, B)' }
    ]);

    expect((document.getElementById('metadata-empty-state') as HTMLElement).classList.contains('hidden')).toBe(true);
    expect((document.getElementById('metadata-table') as HTMLElement).classList.contains('hidden')).toBe(false);
    expect(
      Array.from(document.querySelectorAll('#metadata-table .metadata-row')).map((row) => ({
        key: row.querySelector('.metadata-key')?.textContent,
        value: row.querySelector('.metadata-value')?.textContent
      }))
    ).toEqual([
      { key: 'Compression', value: 'PIZ' },
      { key: 'Channels', value: '3 (R, G, B)' }
    ]);

    ui.setMetadata([{ key: 'owner', label: 'Owner', value: 'render-farm-a' }]);

    expect(
      Array.from(document.querySelectorAll('#metadata-table .metadata-row')).map((row) => ({
        key: row.querySelector('.metadata-key')?.textContent,
        value: row.querySelector('.metadata-value')?.textContent
      }))
    ).toEqual([{ key: 'Owner', value: 'render-farm-a' }]);
  });

  it('updates metadata content while the section is collapsed', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const metadataToggle = document.getElementById('metadata-toggle') as HTMLButtonElement;
    const metadataContent = document.getElementById('metadata-content') as HTMLDivElement;

    metadataToggle.click();
    expect(metadataContent.hidden).toBe(true);

    ui.setMetadata([{ key: 'owner', label: 'Owner', value: 'render-farm-a' }]);

    expect(
      Array.from(document.querySelectorAll('#metadata-table .metadata-row')).map((row) => ({
        key: row.querySelector('.metadata-key')?.textContent,
        value: row.querySelector('.metadata-value')?.textContent
      }))
    ).toEqual([{ key: 'Owner', value: 'render-farm-a' }]);
  });
});

describe('roi inspector', () => {
  it('shows the empty-state hint until an ROI exists', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());

    expect((document.getElementById('roi-empty-state') as HTMLElement).textContent).toContain(
      'Shift-drag in Image viewer to create ROI.'
    );
    expect((document.getElementById('roi-details') as HTMLElement).classList.contains('hidden')).toBe(true);
    expect((document.getElementById('clear-roi-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders ROI summaries and stats and dispatches clear requests', () => {
    installUiFixture();

    const onClearRoi = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onClearRoi }));
    ui.setRoiReadout({
      roi: { x0: 2, y0: 3, x1: 5, y1: 7 },
      stats: {
        roi: { x0: 2, y0: 3, x1: 5, y1: 7 },
        width: 4,
        height: 5,
        pixelCount: 20,
        channels: [
          { label: 'Mono', min: 0.1, mean: 0.25, max: 0.5, validPixelCount: 18 },
          { label: 'A', min: 0, mean: 0.5, max: 1, validPixelCount: 20 }
        ]
      }
    });

    expect((document.getElementById('roi-empty-state') as HTMLElement).classList.contains('hidden')).toBe(true);
    expect((document.getElementById('roi-bounds') as HTMLElement).textContent).toBe('x 2..5  y 3..7');
    expect((document.getElementById('roi-size') as HTMLElement).textContent).toBe('4 × 5 px');
    expect((document.getElementById('roi-pixel-count') as HTMLElement).textContent).toBe('20');
    expect((document.getElementById('roi-valid-count') as HTMLElement).textContent).toBe('Mono 18/20, A 20/20');

    const rows = Array.from(document.querySelectorAll('#roi-stats .roi-stats-row')).map((row) =>
      Array.from(row.children).map((cell) => cell.textContent)
    );
    expect(rows).toEqual([
      ['Channel', 'Min', 'Mean', 'Max'],
      ['Mono', '0.100', '0.250', '0.500'],
      ['A', '0.00', '0.500', '1.00']
    ]);

    (document.getElementById('clear-roi-button') as HTMLButtonElement).click();
    expect(onClearRoi).toHaveBeenCalledTimes(1);
  });

  it('updates probe and roi content while their sections are collapsed', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const probeToggle = document.getElementById('probe-toggle') as HTMLButtonElement;
    const probeContent = document.getElementById('probe-content') as HTMLDivElement;
    const roiToggle = document.getElementById('roi-toggle') as HTMLButtonElement;
    const roiContent = document.getElementById('roi-content') as HTMLDivElement;

    probeToggle.click();
    roiToggle.click();
    expect(probeContent.hidden).toBe(true);
    expect(roiContent.hidden).toBe(true);

    ui.setProbeReadout(
      'Locked',
      {
        x: 1,
        y: 2,
        values: { Y: 0.5 }
      },
      {
        cssColor: 'rgb(128, 128, 128)',
        displayValues: [{ label: 'Mono', value: '0.500' }]
      }
    );
    ui.setRoiReadout({
      roi: { x0: 2, y0: 3, x1: 5, y1: 7 },
      stats: {
        roi: { x0: 2, y0: 3, x1: 5, y1: 7 },
        width: 4,
        height: 5,
        pixelCount: 20,
        channels: [{ label: 'Mono', min: 0.1, mean: 0.25, max: 0.5, validPixelCount: 18 }]
      }
    });

    expect((document.getElementById('probe-mode') as HTMLElement).textContent).toBe('Locked');
    expect((document.getElementById('probe-coords') as HTMLElement).textContent).toBe('x 1   y 2');
    expect(
      Array.from(document.querySelectorAll('#probe-values .probe-row')).map((row) => ({
        key: row.querySelector('.probe-key')?.textContent,
        value: row.querySelector('.probe-value')?.textContent
      }))
    ).toEqual([{ key: 'Y', value: '0.500' }]);
    expect((document.getElementById('roi-bounds') as HTMLElement).textContent).toBe('x 2..5  y 3..7');
    expect((document.getElementById('roi-valid-count') as HTMLElement).textContent).toBe('Mono 18/20');
  });
});

describe('panel split sizing', () => {
  const metrics: PanelSplitMetrics = {
    mainWidth: 900,
    mainHeight: 500,
    imagePanelTabWidth: 18,
    imageResizerWidth: 8,
    rightPanelTabWidth: 18,
    rightResizerWidth: 8,
    bottomPanelTabHeight: 18,
    bottomResizerHeight: 8
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
          bottomPanelHeight: 210,
          rightPanelWidth: 'wide',
          imagePanelCollapsed: true,
          bottomPanelCollapsed: true,
          removedPanelHeight: 180
        })
      )
    ).toEqual({
      imagePanelWidth: 260,
      bottomPanelHeight: 210,
      imagePanelCollapsed: true,
      bottomPanelCollapsed: true
    });
  });

  it('clamps saved panel sizes to keep the viewer usable', () => {
    const sizes = clampPanelSplitSizes(
      {
        imagePanelWidth: 999,
        rightPanelWidth: 999,
        bottomPanelHeight: 999
      },
      metrics
    );

    expect(sizes.imagePanelWidth + sizes.rightPanelWidth).toBeLessThanOrEqual(488);
    expect(sizes.imagePanelWidth).toBeGreaterThanOrEqual(160);
    expect(sizes.rightPanelWidth).toBeGreaterThanOrEqual(240);
    expect(sizes.bottomPanelHeight).toBeLessThanOrEqual(234);
    expect(sizes.bottomPanelHeight).toBeGreaterThanOrEqual(120);
  });

  it('preserves the active side split as much as possible while clamping overflow', () => {
    const sizes = clampPanelSplitSizes(
      {
        imagePanelWidth: 420,
        rightPanelWidth: 520,
        bottomPanelHeight: 180
      },
      metrics,
      'imagePanelWidth'
    );

    expect(sizes.imagePanelWidth).toBe(248);
    expect(sizes.rightPanelWidth).toBe(240);
  });

  it('maps splitter keyboard input to resize actions', () => {
    expect(getPanelSplitKeyboardAction('ArrowRight', false)).toEqual({ type: 'delta', delta: 16 });
    expect(getPanelSplitKeyboardAction('ArrowLeft', true)).toEqual({ type: 'delta', delta: -64 });
    expect(getPanelSplitKeyboardAction('Home', false)).toEqual({ type: 'snap', target: 'min' });
    expect(getPanelSplitKeyboardAction('End', false)).toEqual({ type: 'snap', target: 'max' });
    expect(getPanelSplitKeyboardAction('ArrowDown', false)).toBeNull();
  });

  it('maps vertical splitter keyboard input to resize actions', () => {
    expect(getPanelSplitKeyboardAction('ArrowUp', false, 'vertical')).toEqual({ type: 'delta', delta: -16 });
    expect(getPanelSplitKeyboardAction('ArrowDown', true, 'vertical')).toEqual({ type: 'delta', delta: 64 });
    expect(getPanelSplitKeyboardAction('ArrowRight', false, 'vertical')).toBeNull();
  });

  it('keeps legacy saved panel side layouts open and bottom layout collapsed by default', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();
    window.localStorage.setItem(
      'openexr-viewer:panel-splits:v1',
      JSON.stringify({
        imagePanelWidth: 260,
        rightPanelWidth: 340
      })
    );

    new ViewerUi(createUiCallbacks());

    const imageButton = document.getElementById('image-panel-collapse-button') as HTMLButtonElement;
    const rightButton = document.getElementById('right-panel-collapse-button') as HTMLButtonElement;
    const bottomButton = document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;

    expect(imageButton.getAttribute('aria-expanded')).toBe('true');
    expect(rightButton.getAttribute('aria-expanded')).toBe('true');
    expect(bottomButton.getAttribute('aria-expanded')).toBe('false');
    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('260px');
    expect(mainLayout.style.getPropertyValue('--right-panel-width')).toBe('340px');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('0px');
  });

  it('toggles panel collapse buttons and restores the last expanded widths', () => {
    installUiFixture();
    mockDesktopLayoutGeometry({ imageWidth: 280, rightWidth: 340 });

    new ViewerUi(createUiCallbacks());

    const imageButton = document.getElementById('image-panel-collapse-button') as HTMLButtonElement;
    const rightButton = document.getElementById('right-panel-collapse-button') as HTMLButtonElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;

    imageButton.click();

    expect(imageButton.getAttribute('aria-expanded')).toBe('false');
    expect(imageButton.getAttribute('aria-label')).toBe('Expand left panel');
    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('0px');
    expect(mainLayout.style.getPropertyValue('--image-panel-tab-width')).toBe('18px');
    expect(mainLayout.style.getPropertyValue('--image-panel-resizer-width')).toBe('0px');
    expect(JSON.parse(window.localStorage.getItem('openexr-viewer:panel-splits:v1') ?? '{}')).toMatchObject({
      imagePanelWidth: 280,
      imagePanelCollapsed: true
    });

    rightButton.click();

    expect(rightButton.getAttribute('aria-expanded')).toBe('false');
    expect(rightButton.getAttribute('aria-label')).toBe('Expand right panel');
    expect(mainLayout.style.getPropertyValue('--right-panel-width')).toBe('0px');
    expect(mainLayout.style.getPropertyValue('--right-panel-tab-width')).toBe('18px');
    expect(mainLayout.style.getPropertyValue('--right-panel-resizer-width')).toBe('0px');

    imageButton.click();
    rightButton.click();

    expect(imageButton.getAttribute('aria-expanded')).toBe('true');
    expect(rightButton.getAttribute('aria-expanded')).toBe('true');
    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('280px');
    expect(mainLayout.style.getPropertyValue('--right-panel-width')).toBe('340px');
  });

  it('ignores resizer keyboard input while the matching panel is collapsed', () => {
    installUiFixture();
    mockDesktopLayoutGeometry({ imageWidth: 280, rightWidth: 340 });

    new ViewerUi(createUiCallbacks());

    const imageButton = document.getElementById('image-panel-collapse-button') as HTMLButtonElement;
    const imageResizer = document.getElementById('image-panel-resizer') as HTMLElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;

    imageButton.click();
    imageResizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(imageResizer.getAttribute('aria-disabled')).toBe('true');
    expect(imageResizer.tabIndex).toBe(-1);
    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('0px');
    expect(JSON.parse(window.localStorage.getItem('openexr-viewer:panel-splits:v1') ?? '{}')).toMatchObject({
      imagePanelWidth: 280,
      imagePanelCollapsed: true
    });

    imageButton.click();
    imageResizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(imageResizer.getAttribute('aria-disabled')).toBe('false');
    expect(imageResizer.tabIndex).toBe(0);
    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('296px');
  });

  it('toggles the bottom collapse button and restores the last expanded height', () => {
    installUiFixture();
    mockDesktopLayoutGeometry({ imageWidth: 280, rightWidth: 340, bottomHeight: 210 });

    new ViewerUi(createUiCallbacks());

    const bottomButton = document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;

    bottomButton.click();

    expect(bottomButton.getAttribute('aria-expanded')).toBe('true');
    expect(bottomButton.getAttribute('aria-label')).toBe('Collapse bottom panel');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('210px');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-tab-height')).toBe('18px');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-resizer-height')).toBe('0.5rem');
    expect(JSON.parse(window.localStorage.getItem('openexr-viewer:panel-splits:v1') ?? '{}')).toMatchObject({
      bottomPanelHeight: 210,
      bottomPanelCollapsed: false
    });

    bottomButton.click();

    expect(bottomButton.getAttribute('aria-expanded')).toBe('false');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('0px');
  });

  it('ignores vertical resizer keyboard input while the bottom panel is collapsed', () => {
    installUiFixture();
    mockDesktopLayoutGeometry({ bottomHeight: 210 });

    new ViewerUi(createUiCallbacks());

    const bottomButton = document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement;
    const bottomResizer = document.getElementById('bottom-panel-resizer') as HTMLElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;

    bottomResizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

    expect(bottomResizer.getAttribute('aria-disabled')).toBe('true');
    expect(bottomResizer.tabIndex).toBe(-1);
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('0px');
    expect(window.localStorage.getItem('openexr-viewer:panel-splits:v1')).toBeNull();

    bottomButton.click();
    bottomResizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

    expect(bottomResizer.getAttribute('aria-disabled')).toBe('false');
    expect(bottomResizer.tabIndex).toBe(0);
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('226px');
  });

  it('resets stored panel layout defaults and dispatches reset-settings callbacks', () => {
    installUiFixture();
    mockDesktopLayoutGeometry({ imageWidth: 280, rightWidth: 340, bottomHeight: 210 });
    window.localStorage.setItem(
      'openexr-viewer:panel-splits:v1',
      JSON.stringify({
        imagePanelWidth: 280,
        rightPanelWidth: 340,
        bottomPanelHeight: 210,
        imagePanelCollapsed: true,
        rightPanelCollapsed: true,
        bottomPanelCollapsed: true
      })
    );

    const onResetSettings = vi.fn();
    new ViewerUi(createUiCallbacks({ onResetSettings }));

    const resetSettingsButton = document.getElementById('reset-settings-button') as HTMLButtonElement;
    const imageButton = document.getElementById('image-panel-collapse-button') as HTMLButtonElement;
    const rightButton = document.getElementById('right-panel-collapse-button') as HTMLButtonElement;
    const bottomButton = document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;

    expect(imageButton.getAttribute('aria-expanded')).toBe('false');
    expect(rightButton.getAttribute('aria-expanded')).toBe('false');
    expect(bottomButton.getAttribute('aria-expanded')).toBe('false');
    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('0px');
    expect(mainLayout.style.getPropertyValue('--right-panel-width')).toBe('0px');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('0px');

    resetSettingsButton.click();

    expect(onResetSettings).toHaveBeenCalledTimes(1);
    expect(imageButton.getAttribute('aria-expanded')).toBe('true');
    expect(rightButton.getAttribute('aria-expanded')).toBe('true');
    expect(bottomButton.getAttribute('aria-expanded')).toBe('false');
    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('220px');
    expect(mainLayout.style.getPropertyValue('--right-panel-width')).toBe('280px');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('0px');
    expect(JSON.parse(window.localStorage.getItem('openexr-viewer:panel-splits:v1') ?? '{}')).toEqual({
      imagePanelWidth: 220,
      rightPanelWidth: 280,
      bottomPanelHeight: 120,
      imagePanelCollapsed: false,
      rightPanelCollapsed: false,
      bottomPanelCollapsed: true
    });
  });
});

describe('view menu', () => {
  it('renders file menu items in open-open-folder-export-reload-close order', () => {
    installUiFixture();

    const labels = Array.from(document.querySelectorAll('#file-menu .app-menu-item')).map((item) => item.textContent?.trim());
    expect(labels).toEqual(['Open...', 'Open Folder...', 'Export...', 'Reload All', 'Close All']);
  });

  it('renders the top menu tabs in file-view-gallery-settings order', () => {
    installUiFixture();

    const labels = Array.from(document.querySelectorAll('.app-menu-tab')).map((item) => item.textContent?.trim());
    expect(labels).toEqual(['File', 'View', 'Gallery', 'Settings']);
  });

  it('renders Reset Settings in the settings menu', () => {
    installUiFixture();

    const resetSettingsButton = document.getElementById('reset-settings-button') as HTMLButtonElement;

    expect(resetSettingsButton).not.toBeNull();
    expect(resetSettingsButton.textContent?.trim()).toBe('Reset Settings');
    expect(resetSettingsButton.getAttribute('role')).toBe('menuitem');
  });

  it('keeps viewer mode items disabled until an image is active', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const imageItem = document.getElementById('image-viewer-menu-item') as HTMLButtonElement;
    const panoramaItem = document.getElementById('panorama-viewer-menu-item') as HTMLButtonElement;

    expect(imageItem.disabled).toBe(true);
    expect(panoramaItem.disabled).toBe(true);

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    expect(imageItem.disabled).toBe(false);
    expect(panoramaItem.disabled).toBe(false);
  });

  it('tracks checked state and dispatches panorama mode changes', () => {
    installUiFixture();

    const onViewerModeChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerModeChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    const imageItem = document.getElementById('image-viewer-menu-item') as HTMLButtonElement;
    const panoramaItem = document.getElementById('panorama-viewer-menu-item') as HTMLButtonElement;
    expect(imageItem.getAttribute('aria-checked')).toBe('false');
    expect(panoramaItem.getAttribute('aria-checked')).toBe('true');

    panoramaItem.click();
    expect(onViewerModeChange).toHaveBeenCalledWith('panorama');
  });

  it('temporarily closes top menus over non-tab top-bar space and reopens on tab hover', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const fileButton = document.getElementById('file-menu-button') as HTMLButtonElement;
    const viewButton = document.getElementById('view-menu-button') as HTMLButtonElement;
    const galleryButton = document.getElementById('gallery-menu-button') as HTMLButtonElement;
    const title = document.querySelector('.app-menu-title') as HTMLElement;
    const fileMenuRegion = fileButton.parentElement as HTMLElement;

    fileButton.click();
    expectTopMenuOpen('file-menu-button', 'file-menu');

    fileMenuRegion.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expectTopMenuOpen('file-menu-button', 'file-menu');

    title.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expectTopMenuClosed('file-menu-button', 'file-menu');

    fileButton.dispatchEvent(new Event('pointerenter'));
    expectTopMenuOpen('file-menu-button', 'file-menu');

    viewButton.dispatchEvent(new Event('pointerenter'));
    expectTopMenuOpen('view-menu-button', 'view-menu');
    expectTopMenuClosed('file-menu-button', 'file-menu');

    title.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expectTopMenuClosed('view-menu-button', 'view-menu');

    galleryButton.dispatchEvent(new Event('pointerenter'));
    expectTopMenuOpen('gallery-menu-button', 'gallery-menu');
  });

  it('closes sticky top menus when clicking outside the menu bar', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const fileButton = document.getElementById('file-menu-button') as HTMLButtonElement;

    fileButton.click();
    expectTopMenuOpen('file-menu-button', 'file-menu');

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expectTopMenuClosed('file-menu-button', 'file-menu');
  });

  it('closes keyboard-opened menus on Escape and restores focus to the menu button', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const fileButton = document.getElementById('file-menu-button') as HTMLButtonElement;
    const openFileButton = document.getElementById('open-file-button') as HTMLButtonElement;

    fileButton.focus();
    fileButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expectTopMenuOpen('file-menu-button', 'file-menu');
    expect(document.activeElement).toBe(openFileButton);

    openFileButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expectTopMenuClosed('file-menu-button', 'file-menu');
    expect(document.activeElement).toBe(fileButton);
  });

  it('focuses the settings controls in select-then-reset order from the keyboard', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const settingsButton = document.getElementById('settings-menu-button') as HTMLButtonElement;
    const budgetInput = document.getElementById('display-cache-budget-input') as HTMLSelectElement;
    const resetSettingsButton = document.getElementById('reset-settings-button') as HTMLButtonElement;

    settingsButton.focus();
    settingsButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expectTopMenuOpen('settings-menu-button', 'settings-menu');
    expect(document.activeElement).toBe(budgetInput);

    settingsButton.focus();
    settingsButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

    expectTopMenuOpen('settings-menu-button', 'settings-menu');
    expect(document.activeElement).toBe(resetSettingsButton);
  });

  it('keeps export disabled until an image is active and blocks it during rgb-view loading', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const exportButton = document.getElementById('export-image-button') as HTMLButtonElement;

    expect(exportButton.disabled).toBe(true);

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });
    expect(exportButton.disabled).toBe(false);

    ui.setRgbViewLoading(true);
    expect(exportButton.disabled).toBe(true);
  });

  it('closes the file menu and dispatches open-folder clicks', () => {
    installUiFixture();

    const onOpenFolderClick = vi.fn();
    new ViewerUi(createUiCallbacks({ onOpenFolderClick }));
    const fileButton = document.getElementById('file-menu-button') as HTMLButtonElement;
    const openFolderButton = document.getElementById('open-folder-button') as HTMLButtonElement;

    fileButton.click();
    expectTopMenuOpen('file-menu-button', 'file-menu');

    openFolderButton.click();

    expect(onOpenFolderClick).toHaveBeenCalledTimes(1);
    expectTopMenuClosed('file-menu-button', 'file-menu');
  });

  it('forwards folder input selections and clears the input value', () => {
    installUiFixture();

    const onFolderSelected = vi.fn();
    new ViewerUi(createUiCallbacks({ onFolderSelected }));
    const folderInput = document.getElementById('folder-input') as HTMLInputElement;
    const beautyFile = new File(['beauty'], 'beauty.exr', { type: 'image/exr' });
    const albedoFile = new File(['albedo'], 'albedo.exr', { type: 'image/exr' });

    Object.defineProperty(beautyFile, 'webkitRelativePath', {
      configurable: true,
      value: 'shot/beauty.exr'
    });
    Object.defineProperty(albedoFile, 'webkitRelativePath', {
      configurable: true,
      value: 'shot/aovs/albedo.exr'
    });
    Object.defineProperty(folderInput, 'files', {
      configurable: true,
      value: createFileList([beautyFile, albedoFile])
    });
    Object.defineProperty(folderInput, 'value', {
      configurable: true,
      writable: true,
      value: 'selected-folder'
    });

    folderInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onFolderSelected).toHaveBeenCalledWith([beautyFile, albedoFile]);
    expect(folderInput.value).toBe('');
  });

  it('disables open-folder while loading, matching open-file behavior', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const openFileButton = document.getElementById('open-file-button') as HTMLButtonElement;
    const openFolderButton = document.getElementById('open-folder-button') as HTMLButtonElement;

    expect(openFileButton.disabled).toBe(false);
    expect(openFolderButton.disabled).toBe(false);

    ui.setLoading(true);

    expect(openFileButton.disabled).toBe(true);
    expect(openFolderButton.disabled).toBe(true);

    ui.setLoading(false);

    expect(openFileButton.disabled).toBe(false);
    expect(openFolderButton.disabled).toBe(false);
  });

  it('opens export dialog with defaults and normalizes the filename', async () => {
    installUiFixture();

    const onExportImage = vi.fn(async () => undefined);
    const ui = new ViewerUi(createUiCallbacks({ onExportImage }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const exportButton = document.getElementById('export-image-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-dialog-backdrop') as HTMLDivElement;
    const filenameInput = document.getElementById('export-filename-input') as HTMLInputElement;
    const submitButton = document.getElementById('export-dialog-submit-button') as HTMLButtonElement;

    exportButton.click();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(filenameInput.value).toBe('image.png');

    filenameInput.value = 'graded-output';
    submitButton.click();
    await flushMicrotasks();

    expect(onExportImage).toHaveBeenCalledWith({
      filename: 'graded-output.png',
      format: 'png'
    });
    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);
  });

  it('keeps the export dialog open while the export callback is pending and shows failures inline', async () => {
    installUiFixture();

    const deferred = createDeferred<void>();
    const onExportImage = vi
      .fn<(_: { filename: string; format: 'png' }) => Promise<void>>()
      .mockReturnValueOnce(deferred.promise)
      .mockRejectedValueOnce(new Error('Encode failed'));
    const ui = new ViewerUi(createUiCallbacks({ onExportImage }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const exportButton = document.getElementById('export-image-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-dialog-backdrop') as HTMLDivElement;
    const submitButton = document.getElementById('export-dialog-submit-button') as HTMLButtonElement;
    const cancelButton = document.getElementById('export-dialog-cancel-button') as HTMLButtonElement;
    const error = document.getElementById('export-dialog-error') as HTMLElement;

    exportButton.click();
    submitButton.click();
    await flushMicrotasks();

    expect(submitButton.disabled).toBe(true);
    expect(cancelButton.disabled).toBe(true);
    expect(submitButton.textContent).toBe('Exporting...');

    deferred.resolve();
    await flushMicrotasks();
    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);

    exportButton.click();
    submitButton.click();
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toBe('Encode failed');
    expect(error.classList.contains('hidden')).toBe(false);
    expect(submitButton.disabled).toBe(false);
    expect(cancelButton.disabled).toBe(false);
  });
});

describe('drag and drop', () => {
  it('keeps plain file drops on the existing file-drop callback', async () => {
    installUiFixture();

    const onFilesDropped = vi.fn();
    const onFolderSelected = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onFilesDropped, onFolderSelected }));
    const beautyFile = new File(['beauty'], 'beauty.exr', { type: 'image/exr' });

    ui.viewerContainer.dispatchEvent(createFileDropEvent('drop', [beautyFile]));
    await flushMicrotasks();

    expect(onFilesDropped).toHaveBeenCalledWith([beautyFile]);
    expect(onFolderSelected).not.toHaveBeenCalled();
  });

  it('captures dropped files synchronously before async fallbacks run', async () => {
    installUiFixture();

    const onFilesDropped = vi.fn();
    const onFolderSelected = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onFilesDropped, onFolderSelected }));
    const beautyFile = new File(['beauty'], 'beauty.exr', { type: 'image/exr' });
    let fileReadCount = 0;

    ui.viewerContainer.dispatchEvent(createEphemeralFileDropEvent('drop', [beautyFile]));
    await flushMicrotasks();
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onFilesDropped).toHaveBeenCalledWith([beautyFile]);
    expect(onFolderSelected).not.toHaveBeenCalled();
    expect(fileReadCount).toBeGreaterThanOrEqual(1);

    function createEphemeralFileDropEvent(type: 'drop' | 'dragover', files: File[]): Event {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: {
          types: ['Files'],
          items: [
            {
              kind: 'file'
            }
          ],
          get files() {
            fileReadCount += 1;
            return fileReadCount === 1 ? createFileList(files) : createFileList([]);
          }
        }
      });
      return event;
    }
  });

  it('resolves dropped folders recursively and routes them through the folder callback', async () => {
    installUiFixture();

    const onFilesDropped = vi.fn();
    const onFolderSelected = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onFilesDropped, onFolderSelected }));
    const beautyFile = new File(['beauty'], 'beauty.exr', { type: 'image/exr' });
    const depthFile = new File(['depth'], 'depth.exr', { type: 'image/exr' });
    const notesFile = new File(['notes'], 'notes.txt', { type: 'text/plain' });

    ui.viewerContainer.dispatchEvent(createHandleDropEvent('drop', [
      createDirectoryEntryDropItem(createLegacyDirectoryEntry('shots', [
        createLegacyFileEntry(beautyFile),
        createLegacyDirectoryEntry('aovs', [
          createLegacyFileEntry(depthFile),
          createLegacyFileEntry(notesFile)
        ])
      ]))
    ]));
    await flushMicrotasks();
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onFilesDropped).not.toHaveBeenCalled();
    expect(onFolderSelected).toHaveBeenCalledTimes(1);
    expect(onFolderSelected.mock.calls[0]?.[0].map((file: File) => ({
      name: file.name,
      relativePath: file.webkitRelativePath
    }))).toEqual([
      { name: 'beauty.exr', relativePath: 'shots/beauty.exr' },
      { name: 'depth.exr', relativePath: 'shots/aovs/depth.exr' },
      { name: 'notes.txt', relativePath: 'shots/aovs/notes.txt' }
    ]);
  });
});

describe('ui disposal', () => {
  it('clears pending loading overlay timers when disposed', () => {
    vi.useFakeTimers();
    const phases: LoadingOverlayPhase[] = [];
    const disclosure = new ProgressiveLoadingOverlayDisclosure((phase) => {
      phases.push(phase);
    });

    disclosure.setLoading(true);
    disclosure.dispose();
    vi.advanceTimersByTime(2000);

    expect(phases).toEqual(['hidden']);
  });

  it('removes listeners and disconnects observers on dispose', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const bodyMarkup = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
    document.body.innerHTML = bodyMarkup;

    const disconnectSpy = vi.fn();
    class ResizeObserverMock {
      observe(): void {}
      unobserve(): void {}
      disconnect = disconnectSpy;
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    const onOpenFileClick = vi.fn();
    const onFilesDropped = vi.fn();
    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenFileClick, onFilesDropped, onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' }
    ], 'session-1');

    const firstRow = document.querySelector('.opened-file-row') as HTMLDivElement;
    firstRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 10 }));

    ui.dispose();

    (document.getElementById('open-file-button') as HTMLButtonElement).click();
    window.dispatchEvent(createFileDropEvent('drop'));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientY: 80 }));

    expect(onOpenFileClick).not.toHaveBeenCalled();
    expect(onFilesDropped).not.toHaveBeenCalled();
    expect(onReorderOpenedImage).not.toHaveBeenCalled();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});

describe('display cache UI helpers', () => {
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

  it('describes the usage tooltip as retained GPU texture residency', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setDisplayCacheUsage(64 * 1024 * 1024, 256 * 1024 * 1024);

    expect(document.getElementById('display-cache-usage')?.getAttribute('title')).toBe(
      'Retained GPU texture residency: 64.0 MB / 256.0 MB'
    );
  });
});

describe('opened files actions', () => {
  it('renders a visible reorder grip plus reload and close actions without any pin toggle', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'beauty.exr' }], 'session-1');

    const openedFilesList = document.getElementById('opened-files-list') as HTMLDivElement;
    const actionLabels = Array.from(
      document.querySelectorAll('#opened-files-list .opened-file-action-button')
    ).map((button) => button.getAttribute('aria-label'));

    expect(openedFilesList.getAttribute('aria-describedby')).toBe('opened-files-reorder-hint');
    expect(document.getElementById('opened-files-reorder-hint')?.textContent).toBe('Drag rows to reorder open files.');
    expect(openedFilesList.querySelector('.opened-file-grip')).toBeInstanceOf(HTMLSpanElement);
    expect(actionLabels).toEqual(['Reload beauty.exr', 'Close beauty.exr']);
    expect(openedFilesList.querySelectorAll('button')).toHaveLength(2);
    expect(document.querySelector('[aria-label=\"Pin cache for beauty.exr\"]')).toBeNull();
  });
});

describe('opened files reordering', () => {
  it('dispatches before-placement when dragging into the top half of a row', () => {
    installUiFixture();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' },
      { id: 'session-3', label: 'third.exr' }
    ], 'session-1');

    const rows = mockOpenedFilesListGeometry();
    const secondRow = rows[1] as HTMLDivElement;
    const thirdRow = rows[2] as HTMLDivElement;

    thirdRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 50 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientY: 25 }));

    expect(onReorderOpenedImage).toHaveBeenCalledTimes(1);
    expect(onReorderOpenedImage).toHaveBeenCalledWith('session-3', 'session-2', 'before');
    expect(thirdRow.classList.contains('opened-file-row--dragging')).toBe(true);
    expect(secondRow.classList.contains('opened-file-row--drop-before')).toBe(true);
  });

  it('dispatches after-placement once per boundary when dragging into the bottom half of a row', () => {
    installUiFixture();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' },
      { id: 'session-3', label: 'third.exr' }
    ], 'session-1');

    const rows = mockOpenedFilesListGeometry();
    const firstRow = rows[0] as HTMLDivElement;
    const secondRow = rows[1] as HTMLDivElement;

    firstRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientY: 35 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientY: 36 }));

    expect(onReorderOpenedImage).toHaveBeenCalledTimes(1);
    expect(onReorderOpenedImage).toHaveBeenCalledWith('session-1', 'session-2', 'after');
    expect(secondRow.classList.contains('opened-file-row--drop-after')).toBe(true);
  });

  it('does not start reordering from reload or close action buttons', () => {
    installUiFixture();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' }
    ], 'session-1');

    mockOpenedFilesListGeometry();
    const reloadButton = document.querySelector(
      '#opened-files-list .opened-file-action-button--reload'
    ) as HTMLButtonElement;

    reloadButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientY: 35 }));

    expect(onReorderOpenedImage).not.toHaveBeenCalled();
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

describe('channel thumbnail strip', () => {
  it('shows a no-image message by default', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    new ViewerUi(createUiCallbacks());

    expect(document.getElementById('channel-thumbnail-strip')?.textContent).toContain('Open an image');
  });

  it('renders placeholder thumbnails, syncs click selection, and supports horizontal keyboard navigation', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A', 'depth.Z'];
    const baseItems = buildChannelViewItems(channelNames);
    const channelThumbnailItems = baseItems.map((item) => ({
      ...item,
      thumbnailDataUrl: null
    }));
    const selected = {
      kind: 'channelRgb' as const,
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: 'beauty.A'
    };

    ui.setRgbGroupOptions(channelNames, selected, channelThumbnailItems);

    const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    const depthItem = channelThumbnailItems.find((item) => item.value === 'channel:depth.Z');
    expect(tiles).toHaveLength(2);
    expect(document.querySelectorAll('#channel-thumbnail-strip .channel-thumbnail-placeholder')).toHaveLength(2);
    expect(document.querySelectorAll('#channel-thumbnail-strip .channel-thumbnail-tile-meta')).toHaveLength(0);
    expect(depthItem).toBeTruthy();

    const firstTile = tiles[0]!;
    firstTile.focus();
    firstTile.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(onRgbGroupChange).toHaveBeenLastCalledWith({
      kind: 'channelMono',
      channel: 'depth.Z',
      alpha: null
    });
    expect((document.getElementById('rgb-group-select') as HTMLSelectElement).value).toBe(depthItem?.value);

    const nextItems = channelThumbnailItems.map((item) => ({
      ...item,
      thumbnailDataUrl: 'data:image/png;base64,AAAA'
    }));
    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelMono',
      channel: 'depth.Z',
      alpha: null
    }, nextItems);

    expect(document.querySelectorAll('#channel-thumbnail-strip .channel-thumbnail-image')).toHaveLength(2);
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

function mockDesktopLayoutGeometry(
  args: {
    mainWidth?: number;
    mainHeight?: number;
    imageWidth?: number;
    rightWidth?: number;
    bottomHeight?: number;
  } = {}
): void {
  mockDomRect(document.getElementById('main-layout') as HTMLElement, {
    top: 0,
    bottom: args.mainHeight ?? 800,
    height: args.mainHeight ?? 800,
    width: args.mainWidth ?? 1200
  });
  mockDomRect(document.getElementById('image-panel-content') as HTMLElement, {
    top: 0,
    bottom: args.mainHeight ?? 800,
    height: args.mainHeight ?? 800,
    width: args.imageWidth ?? 220
  });
  mockDomRect(document.getElementById('inspector-panel') as HTMLElement, {
    top: 0,
    bottom: args.mainHeight ?? 800,
    height: args.mainHeight ?? 800,
    width: args.rightWidth ?? 280
  });
  mockDomRect(document.getElementById('bottom-panel-content') as HTMLElement, {
    top: 0,
    bottom: args.bottomHeight ?? 120,
    height: args.bottomHeight ?? 120,
    width: args.mainWidth ?? 1200
  });
}

function mockOpenedFilesListGeometry(rowHeight = 20): Element[] {
  const openedFilesList = document.getElementById('opened-files-list') as HTMLDivElement;
  const rows = Array.from(openedFilesList.querySelectorAll('.opened-file-row'));
  const bottom = rows.length * rowHeight;

  mockDomRect(openedFilesList, { top: 0, bottom, height: bottom });
  rows.forEach((row, index) => {
    const top = index * rowHeight;
    mockDomRect(row as HTMLElement, { top, bottom: top + rowHeight, height: rowHeight });
  });

  return rows;
}

function mockDomRect(
  element: HTMLElement,
  rect: { top: number; bottom: number; height: number; left?: number; right?: number; width?: number }
): void {
  const left = rect.left ?? 0;
  const width = rect.width ?? 240;
  const right = rect.right ?? left + width;
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: left,
      y: rect.top,
      top: rect.top,
      left,
      right,
      bottom: rect.bottom,
      width,
      height: rect.height,
      toJSON: () => ({})
    })
  });
}

function expectTopMenuOpen(buttonId: string, menuId: string): void {
  const button = document.getElementById(buttonId) as HTMLButtonElement;
  const menu = document.getElementById(menuId) as HTMLElement;
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(menu.classList.contains('hidden')).toBe(false);
}

function expectTopMenuClosed(buttonId: string, menuId: string): void {
  const button = document.getElementById(buttonId) as HTMLButtonElement;
  const menu = document.getElementById(menuId) as HTMLElement;
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(menu.classList.contains('hidden')).toBe(true);
}

function createUiCallbacks(overrides: Partial<ReturnType<typeof createUiCallbacksBase>> = {}) {
  return {
    ...createUiCallbacksBase(),
    ...overrides
  };
}

function createUiCallbacksBase() {
  return {
    onOpenFileClick: () => {},
    onOpenFolderClick: () => {},
    onExportImage: async (_request: { filename: string; format: 'png' }) => {},
    onFileSelected: () => {},
    onFolderSelected: () => {},
    onFilesDropped: () => {},
    onGalleryImageSelected: () => {},
    onReloadAllOpenedImages: () => {},
    onReloadSelectedOpenedImage: () => {},
    onCloseSelectedOpenedImage: () => {},
    onCloseAllOpenedImages: () => {},
    onOpenedImageSelected: () => {},
    onReorderOpenedImage: () => {},
    onDisplayCacheBudgetChange: () => {},
    onExposureChange: () => {},
    onViewerModeChange: () => {},
    onLayerChange: () => {},
    onRgbGroupChange: () => {},
    onVisualizationModeChange: () => {},
    onColormapChange: () => {},
    onColormapRangeChange: () => {},
    onColormapAutoRange: () => {},
    onColormapZeroCenterToggle: () => {},
    onStokesDegreeModulationToggle: () => {},
    onClearRoi: () => {},
    onResetSettings: () => {},
    onResetView: () => {}
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createFileDropEvent(type: 'drop' | 'dragover', files: File[] = [new File(['pixels'], 'sample.exr')]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['Files'],
      files: createFileList(files)
    }
  });
  return event;
}

function createHandleDropEvent(type: 'drop' | 'dragover', items: DataTransferItem[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['Files'],
      items,
      files: createFileList([])
    }
  });
  return event;
}

function createFileList(files: File[]): FileList {
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    ...files
  } as unknown as FileList;
}

function createFileHandle(file: File): FileSystemFileHandle {
  return {
    kind: 'file',
    name: file.name,
    getFile: async () => file
  } as unknown as FileSystemFileHandle;
}

function createDirectoryHandle(
  name: string,
  entries: Array<FileSystemFileHandle | FileSystemDirectoryHandle>
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    values: async function* () {
      for (const entry of entries) {
        yield entry;
      }
    }
  } as unknown as FileSystemDirectoryHandle;
}

function createDirectoryDropItem(
  name: string,
  entries: Array<FileSystemFileHandle | FileSystemDirectoryHandle>
): DataTransferItem {
  const handle = createDirectoryHandle(name, entries);
  return {
    kind: 'file',
    getAsFileSystemHandle: () => Promise.resolve(handle)
  } as unknown as DataTransferItem;
}

interface LegacyMockFileEntry {
  isFile: true;
  isDirectory: false;
  name: string;
  file: (success: (nextFile: File) => void) => void;
}

interface LegacyMockDirectoryEntry {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader: () => {
    readEntries: (success: (nextEntries: LegacyMockEntry[]) => void) => void;
  };
}

type LegacyMockEntry = LegacyMockFileEntry | LegacyMockDirectoryEntry;

function createLegacyFileEntry(file: File): LegacyMockFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (success) => {
      success(file);
    }
  };
}

function createLegacyDirectoryEntry(
  name: string,
  entries: LegacyMockEntry[]
): LegacyMockDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let emitted = false;
      return {
        readEntries: (success) => {
          if (emitted) {
            success([]);
            return;
          }

          emitted = true;
          success(entries);
        }
      };
    }
  };
}

function createDirectoryEntryDropItem(
  entry: LegacyMockDirectoryEntry
): DataTransferItem {
  return {
    kind: 'file',
    webkitGetAsEntry: () => entry
  } as unknown as DataTransferItem;
}
