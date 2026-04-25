// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChannelViewItems } from '../src/channel-view-items';
import { getChannelViewSwatches } from '../src/ui/channel-panel';
import { getPanelSplitSizeRange } from '../src/ui/layout-split-controller';
import {
  clampPanelSplitSizes,
  getPanelSplitKeyboardAction,
  parsePanelSplitStorageValue
} from '../src/ui/layout-split-controller';
import { buildPartLayerItemsFromChannelNames } from '../src/ui/layer-panel';
import {
  buildExportBatchChannelFilenameToken,
  buildExportBatchOutputFilename
} from '../src/ui/export-image-batch-dialog';
import {
  ProgressiveLoadingOverlayDisclosure,
  type LoadingOverlayPhase
} from '../src/ui/loading-overlay-disclosure';
import { formatDisplayCacheUsageText, getDisplayCacheUsageState } from '../src/ui/opened-images-panel';
import { type PanelSplitMetrics } from '../src/ui/panel-layout-types';
import { formatProbeCoordinates } from '../src/ui/probe-readout';
import { getListboxOptionIndexAtClientY } from '../src/ui/render-helpers';
import { ViewerUi } from '../src/ui/viewer-ui';

interface ResizeObserverRegistration {
  callback: ResizeObserverCallback;
  observedElements: Element[];
}

const resizeObserverRegistrations: ResizeObserverRegistration[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  window.localStorage.clear();
  resizeObserverRegistrations.length = 0;
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

describe('display toolbar', () => {
  it('starts hidden and toggles from the Window menu Tool bar item', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const displayToolbar = document.getElementById('display-toolbar') as HTMLElement;
    const windowMenuButton = document.getElementById('window-menu-button') as HTMLButtonElement;
    const windowMenu = document.getElementById('window-menu') as HTMLElement;
    const toolbarMenuItem = document.getElementById('window-toolbar-menu-item') as HTMLButtonElement;

    expect(displayToolbar.classList.contains('hidden')).toBe(true);
    expect(toolbarMenuItem.getAttribute('aria-checked')).toBe('false');

    windowMenuButton.click();
    expect(windowMenu.classList.contains('hidden')).toBe(false);

    toolbarMenuItem.click();
    expect(displayToolbar.classList.contains('hidden')).toBe(false);
    expect(toolbarMenuItem.getAttribute('aria-checked')).toBe('true');
    expect(windowMenu.classList.contains('hidden')).toBe(true);

    toolbarMenuItem.click();
    expect(displayToolbar.classList.contains('hidden')).toBe(true);
    expect(toolbarMenuItem.getAttribute('aria-checked')).toBe('false');
  });

  it('persists the Window menu Tool bar visibility choice across UI reloads', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const toolbarMenuItem = document.getElementById('window-toolbar-menu-item') as HTMLButtonElement;
    toolbarMenuItem.click();

    installUiFixture();
    new ViewerUi(createUiCallbacks());
    const restoredDisplayToolbar = document.getElementById('display-toolbar') as HTMLElement;
    const restoredToolbarMenuItem = document.getElementById('window-toolbar-menu-item') as HTMLButtonElement;

    expect(restoredDisplayToolbar.classList.contains('hidden')).toBe(false);
    expect(restoredToolbarMenuItem.getAttribute('aria-checked')).toBe('true');

    restoredToolbarMenuItem.click();

    installUiFixture();
    new ViewerUi(createUiCallbacks());
    const hiddenDisplayToolbar = document.getElementById('display-toolbar') as HTMLElement;
    const hiddenToolbarMenuItem = document.getElementById('window-toolbar-menu-item') as HTMLButtonElement;

    expect(hiddenDisplayToolbar.classList.contains('hidden')).toBe(true);
    expect(hiddenToolbarMenuItem.getAttribute('aria-checked')).toBe('false');
  });

  it('dispatches reset view from toolbar and inspector reset buttons', () => {
    installUiFixture();

    const onResetView = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onResetView }));
    const inspectorResetButton = document.getElementById('reset-view-button') as HTMLButtonElement;
    const toolbarResetButton = document.getElementById('toolbar-reset-view-button') as HTMLButtonElement;

    toolbarResetButton.click();
    expect(onResetView).toHaveBeenCalledTimes(1);

    inspectorResetButton.click();
    expect(onResetView).toHaveBeenCalledTimes(2);

    ui.setLoading(true);
    expect(inspectorResetButton.disabled).toBe(true);
    expect(toolbarResetButton.disabled).toBe(true);

    toolbarResetButton.click();
    inspectorResetButton.click();
    expect(onResetView).toHaveBeenCalledTimes(2);

    ui.setLoading(false);
    expect(inspectorResetButton.disabled).toBe(false);
    expect(toolbarResetButton.disabled).toBe(false);
  });

  it('dispatches visualization mode changes from toolbar and inspector buttons', () => {
    installUiFixture();

    const onVisualizationModeChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onVisualizationModeChange }));
    const inspectorNoneButton = document.getElementById('visualization-none-button') as HTMLButtonElement;
    const inspectorColormapButton = document.getElementById('colormap-toggle-button') as HTMLButtonElement;
    const toolbarNoneButton = document.getElementById('toolbar-visualization-none-button') as HTMLButtonElement;
    const toolbarColormapButton = document.getElementById('toolbar-colormap-toggle-button') as HTMLButtonElement;

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    toolbarColormapButton.click();
    expect(onVisualizationModeChange).toHaveBeenLastCalledWith('colormap');

    toolbarNoneButton.click();
    expect(onVisualizationModeChange).toHaveBeenLastCalledWith('rgb');

    inspectorColormapButton.click();
    expect(onVisualizationModeChange).toHaveBeenLastCalledWith('colormap');

    inspectorNoneButton.click();
    expect(onVisualizationModeChange).toHaveBeenLastCalledWith('rgb');
  });

  it('syncs toolbar and inspector visualization mode button state', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const inspectorNoneButton = document.getElementById('visualization-none-button') as HTMLButtonElement;
    const inspectorColormapButton = document.getElementById('colormap-toggle-button') as HTMLButtonElement;
    const toolbarNoneButton = document.getElementById('toolbar-visualization-none-button') as HTMLButtonElement;
    const toolbarColormapButton = document.getElementById('toolbar-colormap-toggle-button') as HTMLButtonElement;

    ui.setVisualizationMode('rgb');

    expect(inspectorNoneButton.getAttribute('aria-pressed')).toBe('true');
    expect(toolbarNoneButton.getAttribute('aria-pressed')).toBe('true');
    expect(inspectorColormapButton.getAttribute('aria-pressed')).toBe('false');
    expect(toolbarColormapButton.getAttribute('aria-pressed')).toBe('false');
    expect(inspectorColormapButton.getAttribute('aria-expanded')).toBe('false');
    expect(toolbarColormapButton.getAttribute('aria-expanded')).toBe('false');

    ui.setVisualizationMode('colormap');

    expect(inspectorNoneButton.getAttribute('aria-pressed')).toBe('false');
    expect(toolbarNoneButton.getAttribute('aria-pressed')).toBe('false');
    expect(inspectorColormapButton.getAttribute('aria-pressed')).toBe('true');
    expect(toolbarColormapButton.getAttribute('aria-pressed')).toBe('true');
    expect(inspectorColormapButton.getAttribute('aria-expanded')).toBe('true');
    expect(toolbarColormapButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('syncs toolbar and inspector visualization mode disabled state', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const buttons = [
      document.getElementById('visualization-none-button') as HTMLButtonElement,
      document.getElementById('colormap-toggle-button') as HTMLButtonElement,
      document.getElementById('toolbar-visualization-none-button') as HTMLButtonElement,
      document.getElementById('toolbar-colormap-toggle-button') as HTMLButtonElement
    ];

    expect(buttons.map((button) => button.disabled)).toEqual([true, true, true, true]);

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    expect(buttons.map((button) => button.disabled)).toEqual([false, false, false, false]);

    ui.setLoading(true);
    expect(buttons.map((button) => button.disabled)).toEqual([true, true, true, true]);

    ui.setLoading(false);
    expect(buttons.map((button) => button.disabled)).toEqual([false, false, false, false]);
  });

  it('syncs toolbar and inspector exposure controls through the shared exposure state', () => {
    installUiFixture();

    const onExposureChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onExposureChange }));
    const exposureSlider = document.getElementById('exposure-slider') as HTMLInputElement;
    const exposureValue = document.getElementById('exposure-value') as HTMLInputElement;
    const toolbarExposureSlider = document.getElementById('toolbar-exposure-slider') as HTMLInputElement;
    const toolbarExposureValue = document.getElementById('toolbar-exposure-value') as HTMLInputElement;

    ui.setExposure(1.2);

    expect(exposureSlider.value).toBe('1.2');
    expect(exposureValue.value).toBe('1.2');
    expect(toolbarExposureSlider.value).toBe('1.2');
    expect(toolbarExposureValue.value).toBe('1.2');

    toolbarExposureSlider.value = '2.3';
    toolbarExposureSlider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onExposureChange).toHaveBeenLastCalledWith(2.3);

    exposureValue.value = '-12';
    exposureValue.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onExposureChange).toHaveBeenLastCalledWith(-10);

    ui.setExposure(-0.7);

    expect(exposureSlider.value).toBe('-0.7');
    expect(exposureValue.value).toBe('-0.7');
    expect(toolbarExposureSlider.value).toBe('-0.7');
    expect(toolbarExposureValue.value).toBe('-0.7');
  });

  it('hides toolbar exposure whenever inspector exposure is hidden', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const exposureControl = document.getElementById('exposure-control') as HTMLDivElement;
    const toolbarExposureControl = document.getElementById('toolbar-exposure-control') as HTMLDivElement;

    ui.setVisualizationMode('rgb');
    expect(exposureControl.classList.contains('hidden')).toBe(false);
    expect(toolbarExposureControl.classList.contains('hidden')).toBe(false);

    ui.setVisualizationMode('colormap');
    expect(exposureControl.classList.contains('hidden')).toBe(true);
    expect(toolbarExposureControl.classList.contains('hidden')).toBe(true);

    ui.setVisualizationMode('rgb');
    expect(exposureControl.classList.contains('hidden')).toBe(false);
    expect(toolbarExposureControl.classList.contains('hidden')).toBe(false);
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
    expect(sizes.bottomPanelHeight).toBeGreaterThanOrEqual(72);
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

  it('reports the reduced bottom-panel minimum height in the resizer range', () => {
    expect(
      getPanelSplitSizeRange(
        'bottomPanelHeight',
        {
          imagePanelWidth: 220,
          rightPanelWidth: 280,
          bottomPanelHeight: 120
        },
        metrics
      )
    ).toEqual({ min: 72, max: 234 });
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
    expect(bottomButton.getAttribute('aria-expanded')).toBe('true');
    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('260px');
    expect(mainLayout.style.getPropertyValue('--right-panel-width')).toBe('340px');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('120px');
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

    expect(bottomButton.getAttribute('aria-expanded')).toBe('false');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('0px');

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
  });

  it('reserves collapsed bottom strip content only while channel labels are available', () => {
    installUiFixture();
    mockDesktopLayoutGeometry({ bottomHeight: 210 });

    const ui = new ViewerUi(createUiCallbacks());
    const bottomButton = document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B'];

    bottomButton.click();

    expect(bottomButton.getAttribute('aria-expanded')).toBe('false');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('0px');

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));

    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('34px');

    ui.setRgbGroupOptions([], null, []);

    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('0px');
  });

  it('ignores vertical resizer keyboard input while the bottom panel is collapsed', () => {
    installUiFixture();
    mockDesktopLayoutGeometry({ bottomHeight: 210 });

    new ViewerUi(createUiCallbacks());

    const bottomButton = document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement;
    const bottomResizer = document.getElementById('bottom-panel-resizer') as HTMLElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;

    bottomButton.click();
    bottomResizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

    expect(bottomResizer.getAttribute('aria-disabled')).toBe('true');
    expect(bottomResizer.tabIndex).toBe(-1);
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('0px');
    expect(JSON.parse(window.localStorage.getItem('openexr-viewer:panel-splits:v1') ?? '{}')).toMatchObject({
      bottomPanelHeight: 210,
      bottomPanelCollapsed: true
    });

    bottomButton.click();
    bottomResizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

    expect(bottomResizer.getAttribute('aria-disabled')).toBe('false');
    expect(bottomResizer.tabIndex).toBe(0);
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('226px');

    bottomResizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));

    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('72px');
    expect(bottomResizer.getAttribute('aria-valuemin')).toBe('72');
    expect(bottomResizer.getAttribute('aria-valuenow')).toBe('72');
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
    expect(bottomButton.getAttribute('aria-expanded')).toBe('true');
    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('220px');
    expect(mainLayout.style.getPropertyValue('--right-panel-width')).toBe('280px');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('120px');
    expect(JSON.parse(window.localStorage.getItem('openexr-viewer:panel-splits:v1') ?? '{}')).toEqual({
      imagePanelWidth: 220,
      rightPanelWidth: 280,
      bottomPanelHeight: 120,
      imagePanelCollapsed: false,
      rightPanelCollapsed: false,
      bottomPanelCollapsed: false
    });
  });
});

describe('view menu', () => {
  it('renders file menu items in open-open-folder-export-screenshot-reload-close order', () => {
    installUiFixture();

    const labels = Array.from(document.querySelectorAll('#file-menu .app-menu-item')).map((item) => item.textContent?.trim());
    expect(labels).toEqual([
      'Open...',
      'Open Folder...',
      'Export...',
      'Export Screenshot...',
      'Export Batch...',
      'Export Colormap...',
      'Reload All',
      'Close All'
    ]);
  });

  it('renders the top menu tabs in file-view-window-gallery-settings order', () => {
    installUiFixture();

    const labels = Array.from(document.querySelectorAll('.app-menu-tab')).map((item) => item.textContent?.trim());
    expect(labels).toEqual(['File', 'View', 'Window', 'Gallery', 'Settings']);
  });

  it('renders the app fullscreen button in the top bar', () => {
    installUiFixture();
    installFullscreenApiMock();

    new ViewerUi(createUiCallbacks());

    const button = document.getElementById('app-fullscreen-button') as HTMLButtonElement;

    expect(button.closest('#app-menu-bar')).not.toBeNull();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Enter app fullscreen');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.title).toBe('Enter app fullscreen');
    expect(button.querySelectorAll('.app-fullscreen-icon')).toHaveLength(2);
  });

  it('toggles app fullscreen without requiring an open image', async () => {
    installUiFixture();

    const { requestFullscreen, getFullscreenElement } = installFullscreenApiMock();
    new ViewerUi(createUiCallbacks());

    const button = document.getElementById('app-fullscreen-button') as HTMLButtonElement;
    const appShell = document.getElementById('app') as HTMLElement;

    button.click();
    await flushMicrotasks();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(getFullscreenElement()).toBe(appShell);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Exit app fullscreen');
    expect(button.title).toBe('Exit app fullscreen');
  });

  it('exits app fullscreen through the app fullscreen button', async () => {
    installUiFixture();

    const { exitFullscreen, getFullscreenElement } = installFullscreenApiMock();
    new ViewerUi(createUiCallbacks());

    const button = document.getElementById('app-fullscreen-button') as HTMLButtonElement;

    button.click();
    await flushMicrotasks();
    button.click();
    await flushMicrotasks();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(getFullscreenElement()).toBeNull();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Enter app fullscreen');
  });

  it('syncs app fullscreen button state when fullscreen exits outside the button handler', async () => {
    installUiFixture();

    const { setFullscreenElement } = installFullscreenApiMock();
    new ViewerUi(createUiCallbacks());

    const button = document.getElementById('app-fullscreen-button') as HTMLButtonElement;
    const appShell = document.getElementById('app') as HTMLElement;

    button.click();
    await flushMicrotasks();

    setFullscreenElement(appShell);
    setFullscreenElement(null);

    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Enter app fullscreen');
  });

  it('does not mark full screen preview active when app fullscreen is entered', async () => {
    installUiFixture();

    installFullscreenApiMock();
    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const button = document.getElementById('app-fullscreen-button') as HTMLButtonElement;
    const normalItem = document.getElementById('window-normal-menu-item') as HTMLButtonElement;
    const previewItem = document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement;

    button.click();
    await flushMicrotasks();

    expect(previewItem.disabled).toBe(false);
    expect(normalItem.getAttribute('aria-checked')).toBe('true');
    expect(previewItem.getAttribute('aria-checked')).toBe('false');
  });

  it('switches from full screen preview to app fullscreen as separate fullscreen modes', async () => {
    installUiFixture();

    const { getFullscreenElement } = installFullscreenApiMock();
    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const button = document.getElementById('app-fullscreen-button') as HTMLButtonElement;
    const appShell = document.getElementById('app') as HTMLElement;
    const normalItem = document.getElementById('window-normal-menu-item') as HTMLButtonElement;
    const previewItem = document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement;

    previewItem.click();
    await flushMicrotasks();
    button.click();
    await flushMicrotasks();

    expect(getFullscreenElement()).toBe(appShell);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(normalItem.getAttribute('aria-checked')).toBe('true');
    expect(previewItem.getAttribute('aria-checked')).toBe('false');
  });

  it('renders the Window menu items in normal-full-screen-preview-tool-bar order', () => {
    installUiFixture();

    const labels = Array.from(document.querySelectorAll('#window-menu .app-menu-item')).map((item) => item.textContent?.trim());
    expect(labels).toEqual(['Normal', 'Full Screen Preview', 'Tool bar']);
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

  it('keeps full screen preview disabled until an image is active', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const normalItem = document.getElementById('window-normal-menu-item') as HTMLButtonElement;
    const previewItem = document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement;

    expect(normalItem.disabled).toBe(false);
    expect(normalItem.getAttribute('aria-checked')).toBe('true');
    expect(previewItem.disabled).toBe(true);

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    expect(previewItem.disabled).toBe(false);
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

  it('requests browser fullscreen and updates checked state when full screen preview is selected', async () => {
    installUiFixture();

    const { requestFullscreen, getFullscreenElement } = installFullscreenApiMock();
    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const normalItem = document.getElementById('window-normal-menu-item') as HTMLButtonElement;
    const previewItem = document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement;
    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;

    previewItem.click();
    await flushMicrotasks();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(getFullscreenElement()).toBe(viewerContainer);
    expect(normalItem.getAttribute('aria-checked')).toBe('false');
    expect(previewItem.getAttribute('aria-checked')).toBe('true');
  });

  it('selecting Normal exits full screen preview and restores checked state', async () => {
    installUiFixture();

    const { exitFullscreen, getFullscreenElement } = installFullscreenApiMock();
    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const normalItem = document.getElementById('window-normal-menu-item') as HTMLButtonElement;
    const previewItem = document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement;

    previewItem.click();
    await flushMicrotasks();

    normalItem.click();
    await flushMicrotasks();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(getFullscreenElement()).toBeNull();
    expect(normalItem.getAttribute('aria-checked')).toBe('true');
    expect(previewItem.getAttribute('aria-checked')).toBe('false');
  });

  it('syncs the Window menu when fullscreenchange exits preview outside the menu handlers', async () => {
    installUiFixture();

    const { setFullscreenElement } = installFullscreenApiMock();
    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const normalItem = document.getElementById('window-normal-menu-item') as HTMLButtonElement;
    const previewItem = document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement;
    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;

    previewItem.click();
    await flushMicrotasks();

    setFullscreenElement(viewerContainer);
    setFullscreenElement(null);

    expect(normalItem.getAttribute('aria-checked')).toBe('true');
    expect(previewItem.getAttribute('aria-checked')).toBe('false');
  });

  it('toggles full screen preview with the F shortcut when focus is not in an editable control', async () => {
    installUiFixture();

    const { requestFullscreen, exitFullscreen } = installFullscreenApiMock();
    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    await flushMicrotasks();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', bubbles: true }));
    await flushMicrotasks();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('ignores the F shortcut while a text input is focused', async () => {
    installUiFixture();

    const { requestFullscreen } = installFullscreenApiMock();
    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const filenameInput = document.createElement('input');
    document.body.append(filenameInput);

    filenameInput.focus();
    expect(document.activeElement).toBe(filenameInput);

    filenameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    await flushMicrotasks();

    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('uses Escape for dialogs before exiting full screen preview', async () => {
    installUiFixture();

    const { exitFullscreen } = installFullscreenApiMock();
    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const previewItem = document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement;
    const exportButton = document.getElementById('export-image-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-dialog-backdrop') as HTMLDivElement;

    previewItem.click();
    await flushMicrotasks();

    exportButton.click();
    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);
    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(previewItem.getAttribute('aria-checked')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushMicrotasks();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(previewItem.getAttribute('aria-checked')).toBe('false');
  });

  it('keeps panel widths and stored layout unchanged across full screen preview enter and exit', async () => {
    installUiFixture();
    mockDesktopLayoutGeometry({ imageWidth: 280, rightWidth: 340, bottomHeight: 210 });
    window.localStorage.setItem(
      'openexr-viewer:panel-splits:v1',
      JSON.stringify({
        imagePanelWidth: 280,
        rightPanelWidth: 340,
        bottomPanelHeight: 210,
        imagePanelCollapsed: false,
        rightPanelCollapsed: false,
        bottomPanelCollapsed: false
      })
    );
    installFullscreenApiMock();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const normalItem = document.getElementById('window-normal-menu-item') as HTMLButtonElement;
    const previewItem = document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;
    const beforeStorage = window.localStorage.getItem('openexr-viewer:panel-splits:v1');

    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('280px');
    expect(mainLayout.style.getPropertyValue('--right-panel-width')).toBe('340px');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('210px');

    previewItem.click();
    await flushMicrotasks();
    normalItem.click();
    await flushMicrotasks();

    expect(mainLayout.style.getPropertyValue('--image-panel-width')).toBe('280px');
    expect(mainLayout.style.getPropertyValue('--right-panel-width')).toBe('340px');
    expect(mainLayout.style.getPropertyValue('--bottom-panel-height')).toBe('210px');
    expect(window.localStorage.getItem('openexr-viewer:panel-splits:v1')).toBe(beforeStorage);
  });

  it('falls back to an immersive in-window preview when the fullscreen API is unavailable', async () => {
    installUiFixture();

    const { exitFullscreen } = installFullscreenApiMock({ requestBehavior: 'missing' });
    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const appShell = document.getElementById('app') as HTMLElement;
    const normalItem = document.getElementById('window-normal-menu-item') as HTMLButtonElement;
    const previewItem = document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement;

    previewItem.click();
    await flushMicrotasks();

    expect(appShell.classList.contains('is-window-preview')).toBe(true);
    expect(normalItem.getAttribute('aria-checked')).toBe('false');
    expect(previewItem.getAttribute('aria-checked')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushMicrotasks();

    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(appShell.classList.contains('is-window-preview')).toBe(false);
    expect(normalItem.getAttribute('aria-checked')).toBe('true');
    expect(previewItem.getAttribute('aria-checked')).toBe('false');
  });

  it('returns to Normal when the last open image is closed during preview', async () => {
    installUiFixture();

    const { exitFullscreen } = installFullscreenApiMock();
    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const normalItem = document.getElementById('window-normal-menu-item') as HTMLButtonElement;
    const previewItem = document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement;

    previewItem.click();
    await flushMicrotasks();

    ui.setOpenedImageOptions([], null);
    await flushMicrotasks();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(normalItem.getAttribute('aria-checked')).toBe('true');
    expect(previewItem.getAttribute('aria-checked')).toBe('false');
    expect(previewItem.disabled).toBe(true);
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

  it('does not show the loading overlay while display selection is only busy', () => {
    vi.useFakeTimers();
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const loadingOverlay = document.getElementById('loading-overlay') as HTMLDivElement;

    ui.setRgbViewLoading(true, false);
    vi.advanceTimersByTime(2000);

    expect(loadingOverlay.classList.contains('hidden')).toBe(true);
    expect(loadingOverlay.classList.contains('loading-overlay--subtle')).toBe(false);
    expect(loadingOverlay.classList.contains('loading-overlay--darkening')).toBe(false);
    expect(loadingOverlay.classList.contains('loading-overlay--message')).toBe(false);
  });

  it('keeps colormap export disabled until colormaps are available and allows it without an active image', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const exportColormapButton = document.getElementById('export-colormap-button') as HTMLButtonElement;

    expect(exportColormapButton.disabled).toBe(true);

    ui.setColormapOptions([{ id: '0', label: 'Viridis' }], '0');
    expect(exportColormapButton.disabled).toBe(false);

    ui.setRgbViewLoading(true);
    expect(exportColormapButton.disabled).toBe(false);
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

  it('asks for confirmation before forwarding over-limit folder input selections', async () => {
    installUiFixture();

    const onFolderSelected = vi.fn();
    new ViewerUi(createUiCallbacks({ onFolderSelected }));
    const folderInput = document.getElementById('folder-input') as HTMLInputElement;
    const files = Array.from({ length: 251 }, (_value, index) => {
      const file = new File(['x'], `${index}.exr`, { type: 'image/exr' });
      Object.defineProperty(file, 'webkitRelativePath', {
        configurable: true,
        value: `shot/${index}.exr`
      });
      return file;
    });

    Object.defineProperty(folderInput, 'files', {
      configurable: true,
      value: createFileList(files)
    });
    folderInput.dispatchEvent(new Event('change', { bubbles: true }));

    const dialogBackdrop = document.getElementById('folder-load-dialog-backdrop') as HTMLDivElement;
    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(onFolderSelected).not.toHaveBeenCalled();

    (document.getElementById('folder-load-dialog-submit-button') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);
    expect(onFolderSelected).toHaveBeenCalledWith(files, { overrideLimits: true });
  });

  it('cancels over-limit folder input selections from the confirmation dialog', async () => {
    installUiFixture();

    const onFolderSelected = vi.fn();
    new ViewerUi(createUiCallbacks({ onFolderSelected }));
    const folderInput = document.getElementById('folder-input') as HTMLInputElement;
    const files = Array.from({ length: 251 }, (_value, index) => {
      return new File(['x'], `${index}.exr`, { type: 'image/exr' });
    });

    Object.defineProperty(folderInput, 'files', {
      configurable: true,
      value: createFileList(files)
    });
    folderInput.dispatchEvent(new Event('change', { bubbles: true }));

    (document.getElementById('folder-load-dialog-cancel-button') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(onFolderSelected).not.toHaveBeenCalled();
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

  it('requests and renders an image export preview when the dialog opens', async () => {
    installUiFixture();

    const onResolveExportImagePreview = vi.fn(async () => createPreviewPixels(32, 16));
    const ui = new ViewerUi(createUiCallbacks({ onResolveExportImagePreview }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const exportButton = document.getElementById('export-image-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-dialog-backdrop') as HTMLDivElement;
    const previewCanvas = document.getElementById('export-preview-canvas') as HTMLCanvasElement;
    const previewStatus = document.getElementById('export-preview-status') as HTMLElement;

    exportButton.click();
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(onResolveExportImagePreview).toHaveBeenCalledWith({ mode: 'image' }, expect.any(AbortSignal));
    expect(previewCanvas.classList.contains('hidden')).toBe(false);
    expect(previewCanvas.width).toBe(32);
    expect(previewCanvas.height).toBe(16);
    expect(previewStatus.classList.contains('hidden')).toBe(true);
  });

  it('shows image preview failures inline without submitting export', async () => {
    installUiFixture();

    const onExportImage = vi.fn(async () => undefined);
    const onResolveExportImagePreview = vi.fn(async () => {
      throw new Error('Preview unavailable');
    });
    const ui = new ViewerUi(createUiCallbacks({ onExportImage, onResolveExportImagePreview }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const exportButton = document.getElementById('export-image-button') as HTMLButtonElement;
    const previewCanvas = document.getElementById('export-preview-canvas') as HTMLCanvasElement;
    const previewStatus = document.getElementById('export-preview-status') as HTMLElement;
    const submitError = document.getElementById('export-dialog-error') as HTMLElement;

    exportButton.click();
    await flushMicrotasks();

    expect(previewCanvas.classList.contains('hidden')).toBe(true);
    expect(previewStatus.textContent).toBe('Preview unavailable');
    expect(submitError.classList.contains('hidden')).toBe(true);
    expect(onExportImage).not.toHaveBeenCalled();
  });

  it('aborts pending image previews on close and ignores stale responses after reopen', async () => {
    installUiFixture();

    const firstPreview = createDeferred<ReturnType<typeof createPreviewPixels>>();
    const secondPreview = createDeferred<ReturnType<typeof createPreviewPixels>>();
    const onResolveExportImagePreview = vi
      .fn<(_: unknown, _signal: AbortSignal) => Promise<ReturnType<typeof createPreviewPixels>>>()
      .mockReturnValueOnce(firstPreview.promise)
      .mockReturnValueOnce(secondPreview.promise);
    const ui = new ViewerUi(createUiCallbacks({ onResolveExportImagePreview }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const exportButton = document.getElementById('export-image-button') as HTMLButtonElement;
    const cancelButton = document.getElementById('export-dialog-cancel-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-dialog-backdrop') as HTMLDivElement;
    const previewCanvas = document.getElementById('export-preview-canvas') as HTMLCanvasElement;
    const previewStatus = document.getElementById('export-preview-status') as HTMLElement;

    exportButton.click();
    await flushMicrotasks();

    const initialSignal = onResolveExportImagePreview.mock.calls[0]?.[1] as AbortSignal;
    cancelButton.click();
    await flushMicrotasks();

    expect(initialSignal.aborted).toBe(true);
    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);
    expect(previewCanvas.classList.contains('hidden')).toBe(true);
    expect(previewStatus.classList.contains('hidden')).toBe(true);

    exportButton.click();
    await flushMicrotasks();
    firstPreview.resolve(createPreviewPixels(10, 5));
    await flushMicrotasks();

    expect(previewCanvas.classList.contains('hidden')).toBe(true);
    expect(previewStatus.textContent).toBe('Loading preview...');

    secondPreview.resolve(createPreviewPixels(20, 10));
    await flushMicrotasks();

    expect(onResolveExportImagePreview).toHaveBeenCalledTimes(2);
    expect(previewCanvas.classList.contains('hidden')).toBe(false);
    expect(previewCanvas.width).toBe(20);
    expect(previewCanvas.height).toBe(10);
    expect(previewStatus.classList.contains('hidden')).toBe(true);
  });

  it('keeps the export dialog open while the export callback is pending and shows failures inline', async () => {
    installUiFixture();

    const deferred = createDeferred<void>();
    const onExportImage = vi
      .fn<(_: unknown) => Promise<void>>()
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

  it('exports an aspect-locked screenshot selection from the viewer overlay', async () => {
    installUiFixture();

    const onExportImage = vi.fn(async () => undefined);
    const onResolveExportImagePreview = vi.fn(async () => createPreviewPixels(32, 16));
    const ui = new ViewerUi(createUiCallbacks({ onExportImage, onResolveExportImagePreview }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 100, height: 100, width: 200 });

    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const overlay = document.getElementById('screenshot-selection-overlay') as HTMLDivElement;
    const selectionBox = document.getElementById('screenshot-selection-box') as HTMLDivElement;
    const selectionSize = document.getElementById('screenshot-selection-size') as HTMLDivElement;
    const overlayExportButton = document.getElementById('screenshot-selection-export-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-dialog-backdrop') as HTMLDivElement;
    const filenameInput = document.getElementById('export-filename-input') as HTMLInputElement;
    const sizeField = document.getElementById('export-size-field') as HTMLDivElement;
    const widthInput = document.getElementById('export-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('export-height-input') as HTMLInputElement;
    const dialogCancelButton = document.getElementById('export-dialog-cancel-button') as HTMLButtonElement;
    const submitButton = document.getElementById('export-dialog-submit-button') as HTMLButtonElement;

    screenshotButton.click();

    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(selectionBox.style.left).toBe('30px');
    expect(selectionBox.style.top).toBe('15px');
    expect(selectionBox.style.width).toBe('140px');
    expect(selectionBox.style.height).toBe('70px');
    expect(selectionSize.classList.contains('hidden')).toBe(true);

    ui.setScreenshotSelectionResizeActive(true);
    ui.setScreenshotSelectionRect({ x: 30, y: 15, width: 92, height: 46 });

    expect(selectionSize.classList.contains('hidden')).toBe(false);
    expect(selectionSize.textContent).toBe('92 x 46');

    ui.setScreenshotSelectionResizeActive(false);

    expect(selectionSize.classList.contains('hidden')).toBe(true);
    ui.setScreenshotSelectionRect({ x: 30, y: 15, width: 140, height: 70 });

    overlayExportButton.click();
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(filenameInput.value).toBe('image-screenshot.png');
    expect(sizeField.classList.contains('hidden')).toBe(false);
    expect(widthInput.value).toBe('140');
    expect(heightInput.value).toBe('70');
    expect(onResolveExportImagePreview).toHaveBeenCalledWith({
      mode: 'screenshot',
      rect: { x: 30, y: 15, width: 140, height: 70 },
      sourceViewport: { width: 200, height: 100 },
      outputWidth: 140,
      outputHeight: 70
    }, expect.any(AbortSignal));

    widthInput.value = '280';
    widthInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(heightInput.value).toBe('140');

    submitButton.click();
    await flushMicrotasks();

    expect(onExportImage).toHaveBeenCalledWith({
      filename: 'image-screenshot.png',
      format: 'png',
      mode: 'screenshot',
      rect: { x: 30, y: 15, width: 140, height: 70 },
      sourceViewport: { width: 200, height: 100 },
      outputWidth: 280,
      outputHeight: 140
    });
    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);

    screenshotButton.click();

    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(selectionBox.style.left).toBe('30px');
    expect(selectionBox.style.top).toBe('15px');
    expect(selectionBox.style.width).toBe('140px');
    expect(selectionBox.style.height).toBe('70px');

    ui.setScreenshotSelectionRect({ x: 40, y: 20, width: 140, height: 70 });

    expect(selectionBox.style.left).toBe('40px');
    expect(selectionBox.style.top).toBe('20px');
    expect(selectionBox.style.width).toBe('140px');
    expect(selectionBox.style.height).toBe('70px');

    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image.exr' },
      { id: 'session-2', label: 'second.exr' }
    ], 'session-2');
    ui.setExportTarget({ filename: 'second.png' });

    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(selectionBox.style.left).toBe('40px');
    expect(selectionBox.style.top).toBe('20px');
    expect(selectionBox.style.width).toBe('140px');
    expect(selectionBox.style.height).toBe('70px');

    const channelNames = ['Y', 'A'];
    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelMono',
      channel: 'Y',
      alpha: null
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));

    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(selectionBox.style.left).toBe('40px');
    expect(selectionBox.style.top).toBe('20px');
    expect(selectionBox.style.width).toBe('140px');
    expect(selectionBox.style.height).toBe('70px');

    overlayExportButton.click();
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(filenameInput.value).toBe('second-screenshot.png');
    expect(widthInput.value).toBe('280');
    expect(heightInput.value).toBe('140');
    expect(onResolveExportImagePreview).toHaveBeenLastCalledWith({
      mode: 'screenshot',
      rect: { x: 40, y: 20, width: 140, height: 70 },
      sourceViewport: { width: 200, height: 100 },
      outputWidth: 280,
      outputHeight: 140
    }, expect.any(AbortSignal));

    dialogCancelButton.click();
    expect(overlay.classList.contains('hidden')).toBe(true);

    screenshotButton.click();
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(selectionBox.style.left).toBe('40px');
    expect(selectionBox.style.top).toBe('20px');
    expect(selectionBox.style.width).toBe('140px');
    expect(selectionBox.style.height).toBe('70px');

    overlayExportButton.click();
    await flushMicrotasks();

    expect(widthInput.value).toBe('280');
    expect(heightInput.value).toBe('140');
    expect(onResolveExportImagePreview).toHaveBeenLastCalledWith({
      mode: 'screenshot',
      rect: { x: 40, y: 20, width: 140, height: 70 },
      sourceViewport: { width: 200, height: 100 },
      outputWidth: 280,
      outputHeight: 140
    }, expect.any(AbortSignal));

    dialogCancelButton.click();
    screenshotButton.click();
    ui.setScreenshotSelectionRect({ x: 40, y: 20, width: 120, height: 60 });

    expect(selectionBox.style.left).toBe('40px');
    expect(selectionBox.style.top).toBe('20px');
    expect(selectionBox.style.width).toBe('120px');
    expect(selectionBox.style.height).toBe('60px');

    overlayExportButton.click();
    await flushMicrotasks();

    expect(widthInput.value).toBe('120');
    expect(heightInput.value).toBe('60');
    expect(onResolveExportImagePreview).toHaveBeenLastCalledWith({
      mode: 'screenshot',
      rect: { x: 40, y: 20, width: 120, height: 60 },
      sourceViewport: { width: 200, height: 100 },
      outputWidth: 120,
      outputHeight: 60
    }, expect.any(AbortSignal));

    dialogCancelButton.click();
  });

  it('shows square snap feedback and exports the snapped screenshot rectangle', async () => {
    installUiFixture();

    const onResolveExportImagePreview = vi.fn(async () => createPreviewPixels(32, 32));
    const ui = new ViewerUi(createUiCallbacks({ onResolveExportImagePreview }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 160, height: 160, width: 200 });

    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const selectionBox = document.getElementById('screenshot-selection-box') as HTMLDivElement;
    const selectionSize = document.getElementById('screenshot-selection-size') as HTMLDivElement;
    const overlayExportButton = document.getElementById('screenshot-selection-export-button') as HTMLButtonElement;
    const widthInput = document.getElementById('export-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('export-height-input') as HTMLInputElement;
    const dialogCancelButton = document.getElementById('export-dialog-cancel-button') as HTMLButtonElement;

    screenshotButton.click();
    ui.setScreenshotSelectionResizeActive(true);
    ui.setScreenshotSelectionRect({ x: 40, y: 24, width: 88, height: 88 }, { squareSnapped: true });

    expect(selectionBox.classList.contains('is-square-snapped')).toBe(true);
    expect(selectionSize.classList.contains('is-square-snapped')).toBe(true);
    expect(selectionSize.classList.contains('hidden')).toBe(false);
    expect(selectionSize.textContent).toBe('1:1 · 88 x 88');

    ui.setScreenshotSelectionSquareSnapActive(false);

    expect(selectionBox.classList.contains('is-square-snapped')).toBe(false);
    expect(selectionSize.classList.contains('is-square-snapped')).toBe(false);
    expect(selectionSize.textContent).toBe('88 x 88');

    ui.setScreenshotSelectionSquareSnapActive(true);
    ui.setScreenshotSelectionResizeActive(false);

    expect(selectionBox.classList.contains('is-square-snapped')).toBe(false);
    expect(selectionSize.classList.contains('is-square-snapped')).toBe(false);
    expect(selectionSize.classList.contains('hidden')).toBe(true);

    overlayExportButton.click();
    await flushMicrotasks();

    expect(widthInput.value).toBe('88');
    expect(heightInput.value).toBe('88');
    expect(onResolveExportImagePreview).toHaveBeenLastCalledWith({
      mode: 'screenshot',
      rect: { x: 40, y: 24, width: 88, height: 88 },
      sourceViewport: { width: 200, height: 160 },
      outputWidth: 88,
      outputHeight: 88
    }, expect.any(AbortSignal));

    dialogCancelButton.click();
  });

  it('cancels screenshot selection from the overlay and Escape without forgetting screenshot info', async () => {
    installUiFixture();

    const onResolveExportImagePreview = vi.fn(async () => createPreviewPixels(32, 16));
    const ui = new ViewerUi(createUiCallbacks({ onResolveExportImagePreview }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 100, height: 100, width: 200 });
    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const cancelButton = document.getElementById('screenshot-selection-cancel-button') as HTMLButtonElement;
    const exportButton = document.getElementById('screenshot-selection-export-button') as HTMLButtonElement;
    const dialogCancelButton = document.getElementById('export-dialog-cancel-button') as HTMLButtonElement;
    const overlay = document.getElementById('screenshot-selection-overlay') as HTMLDivElement;
    const selectionBox = document.getElementById('screenshot-selection-box') as HTMLDivElement;
    const filenameInput = document.getElementById('export-filename-input') as HTMLInputElement;
    const widthInput = document.getElementById('export-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('export-height-input') as HTMLInputElement;

    screenshotButton.click();
    expect(overlay.classList.contains('hidden')).toBe(false);
    ui.setScreenshotSelectionRect({ x: 40, y: 20, width: 120, height: 60 });

    exportButton.click();
    await flushMicrotasks();
    widthInput.value = '240';
    widthInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(heightInput.value).toBe('120');
    await flushMicrotasks();
    expect(onResolveExportImagePreview).toHaveBeenLastCalledWith({
      mode: 'screenshot',
      rect: { x: 40, y: 20, width: 120, height: 60 },
      sourceViewport: { width: 200, height: 100 },
      outputWidth: 240,
      outputHeight: 120
    }, expect.any(AbortSignal));

    dialogCancelButton.click();
    expect(overlay.classList.contains('hidden')).toBe(true);

    screenshotButton.click();
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(selectionBox.style.left).toBe('40px');
    expect(selectionBox.style.top).toBe('20px');
    expect(selectionBox.style.width).toBe('120px');
    expect(selectionBox.style.height).toBe('60px');
    cancelButton.click();
    expect(overlay.classList.contains('hidden')).toBe(true);

    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image.exr' },
      { id: 'session-2', label: 'second.exr' }
    ], 'session-2');
    ui.setExportTarget({ filename: 'second.png' });
    const channelNames = ['Y', 'A'];
    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelMono',
      channel: 'Y',
      alpha: null
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));
    ui.setRgbViewLoading(true);
    ui.setRgbViewLoading(false);

    screenshotButton.click();
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(selectionBox.style.left).toBe('40px');
    expect(selectionBox.style.top).toBe('20px');
    expect(selectionBox.style.width).toBe('120px');
    expect(selectionBox.style.height).toBe('60px');

    exportButton.click();
    await flushMicrotasks();
    expect(filenameInput.value).toBe('second-screenshot.png');
    expect(widthInput.value).toBe('240');
    expect(heightInput.value).toBe('120');
    expect(onResolveExportImagePreview).toHaveBeenLastCalledWith({
      mode: 'screenshot',
      rect: { x: 40, y: 20, width: 120, height: 60 },
      sourceViewport: { width: 200, height: 100 },
      outputWidth: 240,
      outputHeight: 120
    }, expect.any(AbortSignal));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.classList.contains('hidden')).toBe(true);

    screenshotButton.click();
    exportButton.click();
    await flushMicrotasks();
    expect(widthInput.value).toBe('240');
    expect(heightInput.value).toBe('120');

    dialogCancelButton.click();
  });

  it('cancels screenshot selection from the export dialog backdrop', async () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 100, height: 100, width: 200 });
    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const exportButton = document.getElementById('screenshot-selection-export-button') as HTMLButtonElement;
    const overlay = document.getElementById('screenshot-selection-overlay') as HTMLDivElement;
    const dialogBackdrop = document.getElementById('export-dialog-backdrop') as HTMLDivElement;

    screenshotButton.click();
    expect(overlay.classList.contains('hidden')).toBe(false);
    exportButton.click();
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    dialogBackdrop.click();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('blocks unrelated app chrome while screenshot selection is active', async () => {
    installUiFixture();

    const onOpenFileClick = vi.fn();
    const onResetView = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenFileClick, onResetView }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 100, height: 100, width: 200 });
    const appShell = document.getElementById('app') as HTMLElement;
    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const openFileButton = document.getElementById('open-file-button') as HTMLButtonElement;
    const toolbarResetButton = document.getElementById('toolbar-reset-view-button') as HTMLButtonElement;
    const overlay = document.getElementById('screenshot-selection-overlay') as HTMLDivElement;
    const overlayExportButton = document.getElementById('screenshot-selection-export-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-dialog-backdrop') as HTMLDivElement;

    screenshotButton.click();
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(appShell.classList.contains('is-screenshot-selecting')).toBe(true);

    openFileButton.click();
    toolbarResetButton.click();

    expect(onOpenFileClick).not.toHaveBeenCalled();
    expect(onResetView).not.toHaveBeenCalled();

    overlayExportButton.click();
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    (document.getElementById('export-dialog-cancel-button') as HTMLButtonElement).click();
  });

  it('clears remembered screenshot info when all opened images close', async () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 100, height: 100, width: 200 });
    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const cancelButton = document.getElementById('screenshot-selection-cancel-button') as HTMLButtonElement;
    const exportButton = document.getElementById('screenshot-selection-export-button') as HTMLButtonElement;
    const dialogCancelButton = document.getElementById('export-dialog-cancel-button') as HTMLButtonElement;
    const overlay = document.getElementById('screenshot-selection-overlay') as HTMLDivElement;
    const selectionBox = document.getElementById('screenshot-selection-box') as HTMLDivElement;
    const widthInput = document.getElementById('export-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('export-height-input') as HTMLInputElement;

    screenshotButton.click();
    ui.setScreenshotSelectionRect({ x: 40, y: 20, width: 120, height: 60 });
    exportButton.click();
    await flushMicrotasks();
    widthInput.value = '240';
    widthInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(heightInput.value).toBe('120');
    dialogCancelButton.click();
    cancelButton.click();
    expect(overlay.classList.contains('hidden')).toBe(true);

    ui.setOpenedImageOptions([], null);
    ui.setExportTarget(null);
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    screenshotButton.click();
    expect(selectionBox.style.left).toBe('30px');
    expect(selectionBox.style.top).toBe('15px');
    expect(selectionBox.style.width).toBe('140px');
    expect(selectionBox.style.height).toBe('70px');

    exportButton.click();
    await flushMicrotasks();
    expect(widthInput.value).toBe('140');
    expect(heightInput.value).toBe('70');

    dialogCancelButton.click();
  });

  it('opens batch export as a separate dialog and submits selected file-channel cells', async () => {
    installUiFixture();

    const onExportImageBatch = vi.fn<(_: {
      archiveFilename: string;
      entries: Array<{ outputFilename: string }>;
      format: 'png-zip';
    }, _signal: AbortSignal) => Promise<void>>(async () => undefined);
    const onResolveExportImageBatchPreview = vi.fn<(_request: {
      sessionId: string;
      activeLayer: number;
      displaySelection: unknown;
      channelLabel: string;
    }, _signal: AbortSignal) => Promise<ReturnType<typeof createPreviewPixels>>>(async () => createPreviewPixels());
    const ui = new ViewerUi(createUiCallbacks({
      onExportImageBatch,
      onResolveExportImageBatchPreview
    }));
    const rgbSelection = {
      kind: 'channelRgb' as const,
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };
    const depthSelection = {
      kind: 'channelMono' as const,
      channel: 'Z',
      alpha: null
    };
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'beauty.exr' },
      { id: 'session-2', label: 'depth.exr' }
    ], 'session-1');
    ui.setExportTarget({ filename: 'beauty.png' });
    ui.setExportBatchTarget({
      archiveFilename: 'openexr-export.zip',
      activeSessionId: 'session-1',
      files: [
        {
          sessionId: 'session-1',
          filename: 'beauty.exr',
          label: 'beauty.exr',
          sourcePath: 'shots/beauty.exr',
          thumbnailDataUrl: null,
          activeLayer: 0,
          displaySelection: rgbSelection,
          channels: [
            {
              value: 'group:',
              label: 'RGB',
              selectionKey: 'channelRgb:R:G:B:',
              selection: rgbSelection,
              swatches: ['#ff6570', '#6bd66f', '#51aefe'],
              mergedOrder: 0,
              splitOrder: 0
            },
            {
              value: 'channel:Z',
              label: 'Z',
              selectionKey: 'channelMono:Z:',
              selection: depthSelection,
              swatches: ['#8f83e6'],
              mergedOrder: 1,
              splitOrder: 1
            }
          ]
        },
        {
          sessionId: 'session-2',
          filename: 'depth.exr',
          label: 'depth.exr',
          sourcePath: 'shots/aovs/depth.exr',
          thumbnailDataUrl: null,
          activeLayer: 0,
          displaySelection: depthSelection,
          channels: [
            {
              value: 'channel:Z',
              label: 'Z',
              selectionKey: 'channelMono:Z:',
              selection: depthSelection,
              swatches: ['#8f83e6'],
              mergedOrder: 0,
              splitOrder: 0
            }
          ]
        }
      ]
    });

    const singleExportDialog = document.getElementById('export-dialog-backdrop') as HTMLDivElement;
    const batchButton = document.getElementById('export-image-batch-button') as HTMLButtonElement;
    const batchDialog = document.getElementById('export-batch-dialog-backdrop') as HTMLDivElement;
    const archiveInput = document.getElementById('export-batch-archive-filename-input') as HTMLInputElement;
    const submitButton = document.getElementById('export-batch-dialog-submit-button') as HTMLButtonElement;

    batchButton.click();

    expect(singleExportDialog.classList.contains('hidden')).toBe(true);
    expect(batchDialog.classList.contains('hidden')).toBe(false);
    expect(archiveInput.value).toBe('openexr-export.zip');
    expect(document.querySelectorAll('.export-batch-cell-disabled')).toHaveLength(1);
    expect(document.querySelectorAll('.export-batch-cell-swatches')).toHaveLength(0);
    expect(document.querySelectorAll('.export-batch-cell-preview')).toHaveLength(3);

    await flushBatchPreviewQueue();

    expect(document.querySelectorAll('.export-batch-cell-preview-image')).toHaveLength(3);
    expect(onResolveExportImageBatchPreview).toHaveBeenCalledTimes(3);
    expect(onResolveExportImageBatchPreview.mock.calls.map(([request]) => ({
      sessionId: request.sessionId,
      activeLayer: request.activeLayer,
      channelLabel: request.channelLabel,
      displaySelection: request.displaySelection
    }))).toEqual([
      {
        sessionId: 'session-1',
        activeLayer: 0,
        channelLabel: 'RGB',
        displaySelection: rgbSelection
      },
      {
        sessionId: 'session-1',
        activeLayer: 0,
        channelLabel: 'Z',
        displaySelection: depthSelection
      },
      {
        sessionId: 'session-2',
        activeLayer: 0,
        channelLabel: 'Z',
        displaySelection: depthSelection
      }
    ]);

    const depthRowToggle = document.querySelector<HTMLInputElement>(
      'input[data-batch-toggle="row"][data-session-id="session-2"]'
    );
    expect(depthRowToggle).not.toBeNull();
    depthRowToggle!.click();

    archiveInput.value = 'selected-frames';
    submitButton.click();
    await flushMicrotasks();

    expect(onExportImageBatch).toHaveBeenCalledTimes(1);
    const [request, signal] = onExportImageBatch.mock.calls[0] ?? [];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(request).toMatchObject({
      archiveFilename: 'selected-frames.zip',
      format: 'png-zip'
    });
    expect(request?.entries.map((entry) => entry.outputFilename)).toEqual([
      'shots/beauty.RGB.png',
      'shots/aovs/depth.Z.png'
    ]);
    expect(batchDialog.classList.contains('hidden')).toBe(true);
  });

  it('renders wide and tall batch export thumbnails inside fit-to-frame preview elements', async () => {
    installUiFixture();

    const onResolveExportImageBatchPreview = vi
      .fn<(_request: {
        sessionId: string;
        activeLayer: number;
        displaySelection: unknown;
        channelLabel: string;
      }, _signal: AbortSignal) => Promise<ReturnType<typeof createPreviewPixels>>>()
      .mockResolvedValueOnce(createPreviewPixels(96, 12))
      .mockResolvedValueOnce(createPreviewPixels(12, 96));
    const ui = new ViewerUi(createUiCallbacks({ onResolveExportImageBatchPreview }));
    const rgbSelection = {
      kind: 'channelRgb' as const,
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };
    const depthSelection = {
      kind: 'channelMono' as const,
      channel: 'Z',
      alpha: null
    };

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'beauty.exr' }], 'session-1');
    ui.setExportBatchTarget({
      archiveFilename: 'openexr-export.zip',
      activeSessionId: 'session-1',
      files: [{
        sessionId: 'session-1',
        filename: 'beauty.exr',
        label: 'beauty.exr',
        sourcePath: 'beauty.exr',
        thumbnailDataUrl: 'data:image/png;base64,filethumbnail',
        activeLayer: 0,
        displaySelection: rgbSelection,
        channels: [
          {
            value: 'group:',
            label: 'RGB',
            selectionKey: 'channelRgb:R:G:B:',
            selection: rgbSelection,
            swatches: ['#ff6570', '#6bd66f', '#51aefe'],
            mergedOrder: 0,
            splitOrder: 0
          },
          {
            value: 'channel:Z',
            label: 'Z',
            selectionKey: 'channelMono:Z:',
            selection: depthSelection,
            swatches: ['#8f83e6'],
            mergedOrder: 1,
            splitOrder: 1
          }
        ]
      }]
    });

    (document.getElementById('export-image-batch-button') as HTMLButtonElement).click();
    await flushBatchPreviewQueue();

    const previewImages = Array.from(document.querySelectorAll<HTMLImageElement>('.export-batch-cell-preview-image'));
    expect(previewImages).toHaveLength(2);
    expect(previewImages.every((image) => image.closest('.export-batch-cell-preview'))).toBe(true);
    expect(document.querySelector('.export-batch-file-toggle .opened-file-thumbnail')).toBeNull();

    const previewImageRule = readStyleRule('.export-batch-cell-preview-image');
    expect(previewImageRule).toContain('width: 100%;');
    expect(previewImageRule).toContain('height: 100%;');
    expect(previewImageRule).toContain('object-fit: contain;');
    expect(previewImageRule).toContain('object-position: center;');
    expect(previewImageRule).not.toContain('object-fit: cover;');
  });

  it('opens batch export in merged mode and submits the merged RGB default', async () => {
    installUiFixture();

    const onExportImageBatch = vi.fn<(_: {
      archiveFilename: string;
      entries: Array<{ outputFilename: string }>;
      format: 'png-zip';
    }, _signal: AbortSignal) => Promise<void>>(async () => undefined);
    const ui = new ViewerUi(createUiCallbacks({ onExportImageBatch }));
    const rgbSelection = {
      kind: 'channelRgb' as const,
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'beauty.exr' }], 'session-1');
    ui.setExportBatchTarget({
      archiveFilename: 'openexr-export.zip',
      activeSessionId: 'session-1',
      files: [{
        sessionId: 'session-1',
        filename: 'beauty.exr',
        label: 'beauty.exr',
        sourcePath: 'beauty.exr',
        thumbnailDataUrl: null,
        activeLayer: 0,
        displaySelection: rgbSelection,
        channels: createBatchChannels(['R', 'G', 'B', 'Z'])
      }]
    });

    (document.getElementById('export-image-batch-button') as HTMLButtonElement).click();

    const splitToggle = document.getElementById('export-batch-split-toggle-button') as HTMLButtonElement;
    expect(splitToggle.classList.contains('hidden')).toBe(false);
    expect(splitToggle.getAttribute('aria-pressed')).toBe('false');
    expect(getExportBatchColumnLabels()).toEqual(['RGB', 'Z']);

    (document.getElementById('export-batch-dialog-submit-button') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(onExportImageBatch).toHaveBeenCalledTimes(1);
    expect(onExportImageBatch.mock.calls[0]?.[0].entries.map((entry) => entry.outputFilename)).toEqual([
      'beauty.RGB.png'
    ]);
  });

  it('switches batch export to split RGB columns and remaps the RGB default to R', async () => {
    installUiFixture();

    const onExportImageBatch = vi.fn<(_: {
      archiveFilename: string;
      entries: Array<{ outputFilename: string }>;
      format: 'png-zip';
    }, _signal: AbortSignal) => Promise<void>>(async () => undefined);
    const ui = new ViewerUi(createUiCallbacks({ onExportImageBatch }));
    const rgbaSelection = {
      kind: 'channelRgb' as const,
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: 'A'
    };

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'beauty.exr' }], 'session-1');
    ui.setExportBatchTarget({
      archiveFilename: 'openexr-export.zip',
      activeSessionId: 'session-1',
      files: [{
        sessionId: 'session-1',
        filename: 'beauty.exr',
        label: 'beauty.exr',
        sourcePath: 'beauty.exr',
        thumbnailDataUrl: null,
        activeLayer: 0,
        displaySelection: rgbaSelection,
        channels: createBatchChannels(['R', 'G', 'B', 'A'])
      }]
    });

    (document.getElementById('export-image-batch-button') as HTMLButtonElement).click();
    const splitToggle = document.getElementById('export-batch-split-toggle-button') as HTMLButtonElement;
    splitToggle.click();

    expect(splitToggle.getAttribute('aria-pressed')).toBe('true');
    expect(getExportBatchColumnLabels()).toEqual(['R', 'G', 'B', 'A']);
    expect(getCheckedExportBatchCellColumnKeys()).toEqual(['R']);

    (document.getElementById('export-batch-dialog-submit-button') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(onExportImageBatch).toHaveBeenCalledTimes(1);
    expect(onExportImageBatch.mock.calls[0]?.[0].entries.map((entry) => entry.outputFilename)).toEqual([
      'beauty.R.png'
    ]);
  });

  it('dedupes multiple split RGB checks when toggling batch export back to merged mode', async () => {
    installUiFixture();

    const onExportImageBatch = vi.fn<(_: {
      archiveFilename: string;
      entries: Array<{ outputFilename: string }>;
      format: 'png-zip';
    }, _signal: AbortSignal) => Promise<void>>(async () => undefined);
    const ui = new ViewerUi(createUiCallbacks({ onExportImageBatch }));
    const rgbSelection = {
      kind: 'channelRgb' as const,
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'beauty.exr' }], 'session-1');
    ui.setExportBatchTarget({
      archiveFilename: 'openexr-export.zip',
      activeSessionId: 'session-1',
      files: [{
        sessionId: 'session-1',
        filename: 'beauty.exr',
        label: 'beauty.exr',
        sourcePath: 'beauty.exr',
        thumbnailDataUrl: null,
        activeLayer: 0,
        displaySelection: rgbSelection,
        channels: createBatchChannels(['R', 'G', 'B'])
      }]
    });

    (document.getElementById('export-image-batch-button') as HTMLButtonElement).click();
    const splitToggle = document.getElementById('export-batch-split-toggle-button') as HTMLButtonElement;
    splitToggle.click();

    const rowToggle = document.querySelector<HTMLInputElement>(
      'input[data-batch-toggle="row"][data-session-id="session-1"]'
    );
    expect(rowToggle).not.toBeNull();
    rowToggle!.click();

    expect(getCheckedExportBatchCellColumnKeys()).toEqual(['R', 'G', 'B']);

    splitToggle.click();

    expect(splitToggle.getAttribute('aria-pressed')).toBe('false');
    expect(getExportBatchColumnLabels()).toEqual(['RGB']);
    expect(getCheckedExportBatchCellColumnKeys()).toEqual(['RGB']);

    (document.getElementById('export-batch-dialog-submit-button') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(onExportImageBatch).toHaveBeenCalledTimes(1);
    expect(onExportImageBatch.mock.calls[0]?.[0].entries.map((entry) => entry.outputFilename)).toEqual([
      'beauty.RGB.png'
    ]);
  });

  it('hides the batch split RGB button when no batch channels can be split', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const depthSelection = {
      kind: 'channelMono' as const,
      channel: 'Z',
      alpha: null
    };

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'depth.exr' }], 'session-1');
    ui.setExportBatchTarget({
      archiveFilename: 'openexr-export.zip',
      activeSessionId: 'session-1',
      files: [{
        sessionId: 'session-1',
        filename: 'depth.exr',
        label: 'depth.exr',
        sourcePath: 'depth.exr',
        thumbnailDataUrl: null,
        activeLayer: 0,
        displaySelection: depthSelection,
        channels: createBatchChannels(['Z'])
      }]
    });

    (document.getElementById('export-image-batch-button') as HTMLButtonElement).click();

    const splitToggle = document.getElementById('export-batch-split-toggle-button') as HTMLButtonElement;
    expect(splitToggle.classList.contains('hidden')).toBe(true);
    expect(splitToggle.disabled).toBe(true);
    expect(getExportBatchColumnLabels()).toEqual(['Z']);
  });

  it('aborts pending batch exports from the dialog cancel button', async () => {
    installUiFixture();

    const onExportImageBatch = vi.fn<(_: unknown, signal: AbortSignal) => Promise<void>>((_request, signal) => {
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason);
        }, { once: true });
      });
    });
    const ui = new ViewerUi(createUiCallbacks({ onExportImageBatch }));
    const rgbSelection = {
      kind: 'channelRgb' as const,
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'beauty.exr' }], 'session-1');
    ui.setExportBatchTarget({
      archiveFilename: 'openexr-export.zip',
      activeSessionId: 'session-1',
      files: [{
        sessionId: 'session-1',
        filename: 'beauty.exr',
        label: 'beauty.exr',
        sourcePath: 'beauty.exr',
        thumbnailDataUrl: null,
        activeLayer: 0,
        displaySelection: rgbSelection,
        channels: [{
          value: 'group:',
          label: 'RGB',
          selectionKey: 'channelRgb:R:G:B:',
          selection: rgbSelection,
          swatches: ['#ff6570', '#6bd66f', '#51aefe'],
          mergedOrder: 0,
          splitOrder: 0
        }]
      }]
    });

    (document.getElementById('export-image-batch-button') as HTMLButtonElement).click();
    (document.getElementById('export-batch-dialog-submit-button') as HTMLButtonElement).click();
    await flushMicrotasks();

    const signal = onExportImageBatch.mock.calls[0]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    (document.getElementById('export-batch-dialog-cancel-button') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(signal.aborted).toBe(true);
    expect((document.getElementById('export-batch-dialog-backdrop') as HTMLDivElement).classList.contains('hidden')).toBe(true);
  });

  it('builds stable batch export filenames from source paths and channel labels', () => {
    const used = new Map<string, number>();

    expect(buildExportBatchChannelFilenameToken('Stokes AoLP')).toBe('AoLP');
    expect(buildExportBatchChannelFilenameToken('S1/S0.(R,G,B)')).toBe('S1_over_S0.RGB');
    expect(buildExportBatchOutputFilename('shots/a/beauty.exr', 'RGB', used)).toBe('shots/a/beauty.RGB.png');
    expect(buildExportBatchOutputFilename('shots/a/beauty.exr', 'RGB', used)).toBe('shots/a/beauty.RGB (2).png');
  });

  it('requests and renders a colormap export preview when the dialog opens', async () => {
    installUiFixture();

    const onResolveExportColormapPreview = vi.fn(async () => createPreviewPixels(32, 2));
    const ui = new ViewerUi(createUiCallbacks({ onResolveExportColormapPreview }));
    ui.setColormapOptions([{ id: '0', label: 'Viridis' }], '0');
    ui.setActiveColormap('0');

    const exportButton = document.getElementById('export-colormap-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-colormap-dialog-backdrop') as HTMLDivElement;
    const previewCanvas = document.getElementById('export-colormap-preview-canvas') as HTMLCanvasElement;
    const previewStatus = document.getElementById('export-colormap-preview-status') as HTMLElement;

    exportButton.click();
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(onResolveExportColormapPreview).toHaveBeenCalledWith({
      colormapId: '0',
      width: 256,
      height: 16,
      orientation: 'horizontal'
    }, expect.any(AbortSignal));
    expect(previewCanvas.classList.contains('hidden')).toBe(false);
    expect(previewCanvas.width).toBe(32);
    expect(previewCanvas.height).toBe(2);
    expect(previewStatus.classList.contains('hidden')).toBe(true);
  });

  it('refreshes the colormap export preview when dialog settings change', async () => {
    installUiFixture();

    const onResolveExportColormapPreview = vi.fn(async () => createPreviewPixels());
    const ui = new ViewerUi(createUiCallbacks({ onResolveExportColormapPreview }));
    ui.setColormapOptions([
      { id: '0', label: 'Viridis' },
      { id: '1', label: 'RdBu' }
    ], '0');
    ui.setActiveColormap('0');

    const exportButton = document.getElementById('export-colormap-button') as HTMLButtonElement;
    const colormapSelect = document.getElementById('export-colormap-select') as HTMLSelectElement;
    const orientationSelect = document.getElementById('export-colormap-orientation-select') as HTMLSelectElement;
    const widthInput = document.getElementById('export-colormap-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('export-colormap-height-input') as HTMLInputElement;

    exportButton.click();
    await flushMicrotasks();

    colormapSelect.value = '1';
    colormapSelect.dispatchEvent(new Event('change', { bubbles: true }));
    orientationSelect.value = 'vertical';
    orientationSelect.dispatchEvent(new Event('change', { bubbles: true }));
    widthInput.value = '32';
    widthInput.dispatchEvent(new Event('input', { bubbles: true }));
    heightInput.value = '8';
    heightInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushMicrotasks();

    expect(onResolveExportColormapPreview).toHaveBeenNthCalledWith(1, {
      colormapId: '0',
      width: 256,
      height: 16,
      orientation: 'horizontal'
    }, expect.any(AbortSignal));
    expect(onResolveExportColormapPreview).toHaveBeenNthCalledWith(2, {
      colormapId: '1',
      width: 256,
      height: 16,
      orientation: 'horizontal'
    }, expect.any(AbortSignal));
    expect(onResolveExportColormapPreview).toHaveBeenNthCalledWith(3, {
      colormapId: '1',
      width: 256,
      height: 16,
      orientation: 'vertical'
    }, expect.any(AbortSignal));
    expect(onResolveExportColormapPreview).toHaveBeenNthCalledWith(4, {
      colormapId: '1',
      width: 32,
      height: 16,
      orientation: 'vertical'
    }, expect.any(AbortSignal));
    expect(onResolveExportColormapPreview).toHaveBeenNthCalledWith(5, {
      colormapId: '1',
      width: 32,
      height: 8,
      orientation: 'vertical'
    }, expect.any(AbortSignal));
  });

  it('shows preview-specific validation when dimensions are invalid without submitting export', async () => {
    installUiFixture();

    const onExportColormap = vi.fn(async () => undefined);
    const onResolveExportColormapPreview = vi.fn(async () => createPreviewPixels(24, 2));
    const ui = new ViewerUi(createUiCallbacks({ onExportColormap, onResolveExportColormapPreview }));
    ui.setColormapOptions([{ id: '0', label: 'Viridis' }], '0');

    const exportButton = document.getElementById('export-colormap-button') as HTMLButtonElement;
    const widthInput = document.getElementById('export-colormap-width-input') as HTMLInputElement;
    const previewCanvas = document.getElementById('export-colormap-preview-canvas') as HTMLCanvasElement;
    const previewStatus = document.getElementById('export-colormap-preview-status') as HTMLElement;
    const submitError = document.getElementById('export-colormap-dialog-error') as HTMLElement;

    exportButton.click();
    await flushMicrotasks();
    expect(onResolveExportColormapPreview).toHaveBeenCalledTimes(1);
    expect(previewCanvas.classList.contains('hidden')).toBe(false);

    widthInput.value = '';
    widthInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushMicrotasks();

    expect(onResolveExportColormapPreview).toHaveBeenCalledTimes(1);
    expect(previewCanvas.classList.contains('hidden')).toBe(true);
    expect(previewStatus.textContent).toBe('Enter a valid width and height to preview.');
    expect(submitError.classList.contains('hidden')).toBe(true);
    expect(onExportColormap).not.toHaveBeenCalled();
  });

  it('ignores stale preview responses when a newer request resolves later', async () => {
    installUiFixture();

    const firstPreview = createDeferred<ReturnType<typeof createPreviewPixels>>();
    const secondPreview = createDeferred<ReturnType<typeof createPreviewPixels>>();
    const onResolveExportColormapPreview = vi
      .fn<(_: {
        colormapId: string;
        width: number;
        height: number;
        orientation: 'horizontal' | 'vertical';
      }, signal: AbortSignal) => Promise<ReturnType<typeof createPreviewPixels>>>()
      .mockReturnValueOnce(firstPreview.promise)
      .mockReturnValueOnce(secondPreview.promise);
    const ui = new ViewerUi(createUiCallbacks({ onResolveExportColormapPreview }));
    ui.setColormapOptions([{ id: '0', label: 'Viridis' }], '0');

    const exportButton = document.getElementById('export-colormap-button') as HTMLButtonElement;
    const widthInput = document.getElementById('export-colormap-width-input') as HTMLInputElement;
    const previewCanvas = document.getElementById('export-colormap-preview-canvas') as HTMLCanvasElement;
    const previewStatus = document.getElementById('export-colormap-preview-status') as HTMLElement;

    exportButton.click();
    await flushMicrotasks();

    widthInput.value = '512';
    widthInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushMicrotasks();

    firstPreview.resolve(createPreviewPixels(12, 1));
    await flushMicrotasks();

    expect(previewCanvas.classList.contains('hidden')).toBe(true);
    expect(previewStatus.textContent).toBe('Loading preview...');

    secondPreview.resolve(createPreviewPixels(18, 3));
    await flushMicrotasks();

    expect(previewCanvas.classList.contains('hidden')).toBe(false);
    expect(previewCanvas.width).toBe(18);
    expect(previewCanvas.height).toBe(3);
    expect(previewStatus.classList.contains('hidden')).toBe(true);
  });

  it('aborts pending preview work on close and starts cleanly when reopened', async () => {
    installUiFixture();

    const firstPreview = createDeferred<ReturnType<typeof createPreviewPixels>>();
    const onResolveExportColormapPreview = vi
      .fn<(_: {
        colormapId: string;
        width: number;
        height: number;
        orientation: 'horizontal' | 'vertical';
      }, signal: AbortSignal) => Promise<ReturnType<typeof createPreviewPixels>>>()
      .mockReturnValueOnce(firstPreview.promise)
      .mockResolvedValueOnce(createPreviewPixels(20, 4));
    const ui = new ViewerUi(createUiCallbacks({ onResolveExportColormapPreview }));
    ui.setColormapOptions([{ id: '0', label: 'Viridis' }], '0');

    const exportButton = document.getElementById('export-colormap-button') as HTMLButtonElement;
    const cancelButton = document.getElementById('export-colormap-dialog-cancel-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-colormap-dialog-backdrop') as HTMLDivElement;
    const previewCanvas = document.getElementById('export-colormap-preview-canvas') as HTMLCanvasElement;
    const previewStatus = document.getElementById('export-colormap-preview-status') as HTMLElement;

    exportButton.click();
    await flushMicrotasks();

    const initialSignal = onResolveExportColormapPreview.mock.calls[0]?.[1] as AbortSignal;
    cancelButton.click();
    await flushMicrotasks();

    expect(initialSignal.aborted).toBe(true);
    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);
    expect(previewCanvas.classList.contains('hidden')).toBe(true);
    expect(previewStatus.classList.contains('hidden')).toBe(true);

    firstPreview.resolve(createPreviewPixels(10, 2));
    await flushMicrotasks();

    exportButton.click();
    await flushMicrotasks();

    expect(onResolveExportColormapPreview).toHaveBeenCalledTimes(2);
    expect(previewCanvas.classList.contains('hidden')).toBe(false);
    expect(previewCanvas.width).toBe(20);
    expect(previewCanvas.height).toBe(4);
  });

  it('opens the colormap export dialog with defaults and normalizes the filename', async () => {
    installUiFixture();

    const onExportColormap = vi.fn(async () => undefined);
    const ui = new ViewerUi(createUiCallbacks({ onExportColormap }));
    ui.setColormapOptions([{ id: '0', label: 'Red / Black / Green' }], '0');
    ui.setActiveColormap('0');

    const exportButton = document.getElementById('export-colormap-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-colormap-dialog-backdrop') as HTMLDivElement;
    const colormapSelect = document.getElementById('export-colormap-select') as HTMLSelectElement;
    const widthInput = document.getElementById('export-colormap-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('export-colormap-height-input') as HTMLInputElement;
    const orientationSelect = document.getElementById('export-colormap-orientation-select') as HTMLSelectElement;
    const filenameInput = document.getElementById('export-colormap-filename-input') as HTMLInputElement;
    const submitButton = document.getElementById('export-colormap-dialog-submit-button') as HTMLButtonElement;

    exportButton.click();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(colormapSelect.value).toBe('0');
    expect(widthInput.value).toBe('256');
    expect(heightInput.value).toBe('16');
    expect(orientationSelect.value).toBe('horizontal');
    expect(filenameInput.value).toBe('Red-Black-Green.png');

    filenameInput.value = 'paper-ready';
    submitButton.click();
    await flushMicrotasks();

    expect(onExportColormap).toHaveBeenCalledWith({
      colormapId: '0',
      width: 256,
      height: 16,
      orientation: 'horizontal',
      filename: 'paper-ready.png',
      format: 'png'
    });
    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);
  });

  it('validates colormap export dimensions before submitting', async () => {
    installUiFixture();

    const onExportColormap = vi.fn(async () => undefined);
    const ui = new ViewerUi(createUiCallbacks({ onExportColormap }));
    ui.setColormapOptions([{ id: '0', label: 'Viridis' }], '0');

    const exportButton = document.getElementById('export-colormap-button') as HTMLButtonElement;
    const widthInput = document.getElementById('export-colormap-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('export-colormap-height-input') as HTMLInputElement;
    const submitButton = document.getElementById('export-colormap-dialog-submit-button') as HTMLButtonElement;
    const error = document.getElementById('export-colormap-dialog-error') as HTMLElement;

    exportButton.click();

    Object.defineProperty(widthInput, 'value', { configurable: true, writable: true, value: '' });
    submitButton.click();
    await flushMicrotasks();
    expect(error.textContent).toBe('Width must be a positive integer.');

    Object.defineProperty(widthInput, 'value', { configurable: true, writable: true, value: '1.5' });
    submitButton.click();
    await flushMicrotasks();
    expect(error.textContent).toBe('Width must be a positive integer.');

    Object.defineProperty(widthInput, 'value', { configurable: true, writable: true, value: '256' });
    Object.defineProperty(heightInput, 'value', { configurable: true, writable: true, value: '0' });
    submitButton.click();
    await flushMicrotasks();
    expect(error.textContent).toBe('Height must be a positive integer.');

    expect(onExportColormap).not.toHaveBeenCalled();
  });

  it('updates colormap export auto-filenames when the selection changes without overwriting manual edits', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setColormapOptions([
      { id: '0', label: 'Viridis' },
      { id: '1', label: 'RdBu' }
    ], '0');
    ui.setActiveColormap('0');

    const exportButton = document.getElementById('export-colormap-button') as HTMLButtonElement;
    const colormapSelect = document.getElementById('export-colormap-select') as HTMLSelectElement;
    const filenameInput = document.getElementById('export-colormap-filename-input') as HTMLInputElement;

    exportButton.click();
    expect(filenameInput.value).toBe('Viridis.png');

    colormapSelect.value = '1';
    colormapSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(filenameInput.value).toBe('RdBu.png');

    filenameInput.value = 'my-paper-figure';
    colormapSelect.value = '0';
    colormapSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(filenameInput.value).toBe('my-paper-figure');
  });

  it('keeps the colormap export dialog open while the export callback is pending and shows failures inline', async () => {
    installUiFixture();

    const deferred = createDeferred<void>();
    const onExportColormap = vi
      .fn<(_: {
        colormapId: string;
        width: number;
        height: number;
        orientation: 'horizontal' | 'vertical';
        filename: string;
        format: 'png';
      }) => Promise<void>>()
      .mockReturnValueOnce(deferred.promise)
      .mockRejectedValueOnce(new Error('Gradient encode failed'));
    const ui = new ViewerUi(createUiCallbacks({ onExportColormap }));
    ui.setColormapOptions([{ id: '0', label: 'Viridis' }], '0');

    const exportButton = document.getElementById('export-colormap-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-colormap-dialog-backdrop') as HTMLDivElement;
    const submitButton = document.getElementById('export-colormap-dialog-submit-button') as HTMLButtonElement;
    const cancelButton = document.getElementById('export-colormap-dialog-cancel-button') as HTMLButtonElement;
    const error = document.getElementById('export-colormap-dialog-error') as HTMLElement;
    const select = document.getElementById('export-colormap-select') as HTMLSelectElement;
    const widthInput = document.getElementById('export-colormap-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('export-colormap-height-input') as HTMLInputElement;
    const orientationSelect = document.getElementById('export-colormap-orientation-select') as HTMLSelectElement;
    const filenameInput = document.getElementById('export-colormap-filename-input') as HTMLInputElement;

    exportButton.click();
    submitButton.click();
    await flushMicrotasks();

    expect(submitButton.disabled).toBe(true);
    expect(cancelButton.disabled).toBe(true);
    expect(select.disabled).toBe(true);
    expect(widthInput.disabled).toBe(true);
    expect(heightInput.disabled).toBe(true);
    expect(orientationSelect.disabled).toBe(true);
    expect(filenameInput.disabled).toBe(true);
    expect(submitButton.textContent).toBe('Exporting...');

    deferred.resolve();
    await flushMicrotasks();
    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);

    exportButton.click();
    submitButton.click();
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toBe('Gradient encode failed');
    expect(error.classList.contains('hidden')).toBe(false);
    expect(submitButton.disabled).toBe(false);
    expect(cancelButton.disabled).toBe(false);
    expect(select.disabled).toBe(false);
    expect(widthInput.disabled).toBe(false);
    expect(heightInput.disabled).toBe(false);
    expect(orientationSelect.disabled).toBe(false);
    expect(filenameInput.disabled).toBe(false);
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

  it('confirms over-limit recursive folder drops before re-reading and forwarding them', async () => {
    installUiFixture();

    const onFolderSelected = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onFolderSelected }));
    const files = Array.from({ length: 251 }, (_value, index) => {
      return new File(['x'], `${index}.exr`, { type: 'image/exr' });
    });

    ui.viewerContainer.dispatchEvent(createHandleDropEvent('drop', [
      createDirectoryEntryDropItem(createLegacyDirectoryEntry('shots', files.map(createLegacyFileEntry)))
    ]));
    await flushMicrotasks();
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dialogBackdrop = document.getElementById('folder-load-dialog-backdrop') as HTMLDivElement;
    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(onFolderSelected).not.toHaveBeenCalled();

    (document.getElementById('folder-load-dialog-submit-button') as HTMLButtonElement).click();
    await flushMicrotasks();
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onFolderSelected).toHaveBeenCalledTimes(1);
    expect(onFolderSelected.mock.calls[0]?.[0]).toHaveLength(251);
    expect(onFolderSelected.mock.calls[0]?.[1]).toEqual({ overrideLimits: true });
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
    expect(disconnectSpy).toHaveBeenCalledTimes(2);
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

  it('describes the usage tooltip as decoded plus retained CPU/GPU residency', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setDisplayCacheUsage(64 * 1024 * 1024, 256 * 1024 * 1024);

    expect(document.getElementById('display-cache-usage')?.getAttribute('title')).toBe(
      'Decoded + retained CPU/GPU residency: 64.0 MB / 256.0 MB'
    );
  });
});

describe('opened files actions', () => {
  it('renders a visible reorder grip plus reload and close actions without any pin toggle', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{
      id: 'session-1',
      label: 'beauty.exr',
      thumbnailDataUrl: 'data:image/png;base64,AAAA',
      thumbnailAspectRatio: 2
    }], 'session-1');

    const openedFilesList = document.getElementById('opened-files-list') as HTMLDivElement;
    const firstRow = openedFilesList.querySelector('.opened-file-row') as HTMLDivElement;
    const actionLabels = Array.from(
      document.querySelectorAll('#opened-files-list .opened-file-action-button')
    ).map((button) => button.getAttribute('aria-label'));

    expect(openedFilesList.getAttribute('aria-describedby')).toBe('opened-files-reorder-hint');
    expect(document.getElementById('opened-files-reorder-hint')?.textContent).toBe('Drag rows to reorder open files.');
    expect(openedFilesList.querySelector('.opened-file-grip')).toBeInstanceOf(HTMLSpanElement);
    expect(openedFilesList.querySelector('.opened-file-thumbnail')).toBeInstanceOf(HTMLImageElement);
    expect(firstRow.childElementCount).toBe(4);
    expect(actionLabels).toEqual(['Reload beauty.exr', 'Close beauty.exr']);
    expect(openedFilesList.querySelectorAll('button')).toHaveLength(2);
    expect(document.querySelector('[aria-label="Pin cache for beauty.exr"]')).toBeNull();
  });

  it('renders path-aware opened file labels in the row and compatibility select', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([
      {
        id: 'session-1',
        label: 'hoge/image.exr',
        sourceDetail: 'shots/hoge/image.exr'
      },
      {
        id: 'session-2',
        label: 'fuga/image.exr',
        sourceDetail: 'shots/fuga/image.exr'
      }
    ], 'session-1');

    const rowLabels = Array.from(
      document.querySelectorAll('#opened-files-list .opened-file-label')
    ).map((label) => label.textContent);
    const selectLabels = Array.from(
      (document.getElementById('opened-images-select') as HTMLSelectElement).options
    ).map((option) => option.label);
    const firstLabel = document.querySelector('#opened-files-list .opened-file-label') as HTMLSpanElement;

    expect(rowLabels).toEqual(['hoge/image.exr', 'fuga/image.exr']);
    expect(selectLabels).toEqual(['hoge/image.exr', 'fuga/image.exr']);
    expect(firstLabel.title).toContain('Path: shots/hoge/image.exr');
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
  it('renders an empty thumbnail state by default', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    new ViewerUi(createUiCallbacks());

    const strip = document.getElementById('channel-thumbnail-strip') as HTMLElement;
    expect(strip.querySelectorAll('.image-browser-empty')).toHaveLength(1);
    expect(strip.querySelectorAll('.channel-thumbnail-tile')).toHaveLength(0);
    expect(strip.textContent?.trim()).toBe('');
  });

  it('shows a no-channels message for an active image with no visible channel items', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const ui = new ViewerUi(createUiCallbacks());

    ui.setRgbGroupOptions([], null, []);

    const strip = document.getElementById('channel-thumbnail-strip') as HTMLElement;
    expect(strip.querySelectorAll('.image-browser-empty')).toHaveLength(1);
    expect(strip.querySelectorAll('.channel-thumbnail-tile')).toHaveLength(0);
    expect(strip.textContent).toContain('No channels');
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
    expect(Array.from(document.querySelectorAll<HTMLElement>('#channel-thumbnail-strip .channel-thumbnail-tile-preview')).map((preview) => preview.style.getPropertyValue('--thumbnail-aspect-ratio'))).toEqual(['', '']);
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

  it('sizes thumbnail previews from the available strip height', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const ui = new ViewerUi(createUiCallbacks());
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A', 'depth.Z'];
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: 'data:image/png;base64,AAAA'
    }));
    const strip = document.getElementById('channel-thumbnail-strip') as HTMLElement;

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: 'beauty.A'
    }, channelThumbnailItems);

    const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    expect(tiles).toHaveLength(2);

    strip.style.paddingTop = '6px';
    strip.style.paddingBottom = '8px';
    for (const tile of tiles) {
      tile.style.padding = '4px';
      tile.style.rowGap = '3px';
      tile.style.border = '1px solid transparent';
    }

    mockChannelThumbnailStripGeometry({ stripHeight: 120, tileHeight: 106, labelHeight: 16 });
    triggerResizeObserversForElement(strip);

    const firstTile = tiles[0]!;
    const firstPreview = firstTile.querySelector('.channel-thumbnail-tile-preview') as HTMLElement;
    const firstLabel = firstTile.querySelector('.channel-thumbnail-tile-label') as HTMLElement;

    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-height')).toBe('77px');
    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-width')).toBe('77px');
    expect(firstTile.style.getPropertyValue('--channel-thumbnail-tile-width')).toBe('87px');
    expect(firstLabel.style.getPropertyValue('--channel-thumbnail-label-max-width')).toBe('77px');
  });

  it('recomputes thumbnail sizes when the strip height changes', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const ui = new ViewerUi(createUiCallbacks());
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A', 'depth.Z'];
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: 'data:image/png;base64,AAAA'
    }));
    const strip = document.getElementById('channel-thumbnail-strip') as HTMLElement;

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: 'beauty.A'
    }, channelThumbnailItems);

    const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    strip.style.paddingTop = '6px';
    strip.style.paddingBottom = '8px';
    for (const tile of tiles) {
      tile.style.padding = '4px';
      tile.style.rowGap = '3px';
      tile.style.border = '1px solid transparent';
    }

    mockChannelThumbnailStripGeometry({ stripHeight: 120, tileHeight: 106, labelHeight: 16 });
    triggerResizeObserversForElement(strip);

    const firstTile = tiles[0]!;
    const firstPreview = firstTile.querySelector('.channel-thumbnail-tile-preview') as HTMLElement;

    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-height')).toBe('77px');
    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-width')).toBe('77px');
    expect(firstTile.style.getPropertyValue('--channel-thumbnail-tile-width')).toBe('87px');

    mockChannelThumbnailStripGeometry({ stripHeight: 160, tileHeight: 146, labelHeight: 18 });
    triggerResizeObserversForElement(strip);

    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-height')).toBe('115px');
    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-width')).toBe('115px');
    expect(firstTile.style.getPropertyValue('--channel-thumbnail-tile-width')).toBe('125px');
  });

  it('uses label-only sizing while collapsed and restores thumbnail sizing after expanding', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const ui = new ViewerUi(createUiCallbacks());
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'depth.Z'];
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: 'data:image/png;base64,AAAA'
    }));
    const strip = document.getElementById('channel-thumbnail-strip') as HTMLElement;
    const bottomButton = document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement;

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, channelThumbnailItems);

    const firstTile = document.querySelector<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile');
    const firstPreview = firstTile?.querySelector('.channel-thumbnail-tile-preview') as HTMLElement;
    const firstLabel = firstTile?.querySelector('.channel-thumbnail-tile-label') as HTMLElement;

    expect(firstTile).toBeTruthy();
    strip.style.paddingTop = '6px';
    strip.style.paddingBottom = '8px';
    firstTile!.style.padding = '4px';
    firstTile!.style.rowGap = '3px';
    firstTile!.style.border = '1px solid transparent';

    mockChannelThumbnailStripGeometry({ stripHeight: 120, tileHeight: 106, labelHeight: 16 });
    triggerResizeObserversForElement(strip);

    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-height')).toBe('77px');
    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-width')).toBe('77px');
    expect(firstTile!.style.getPropertyValue('--channel-thumbnail-tile-width')).toBe('87px');
    expect(firstLabel.style.getPropertyValue('--channel-thumbnail-label-max-width')).toBe('77px');

    bottomButton.click();
    triggerResizeObserversForElement(strip);

    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-height')).toBe('');
    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-width')).toBe('');
    expect(firstTile!.style.getPropertyValue('--channel-thumbnail-tile-width')).toBe('');
    expect(firstLabel.style.getPropertyValue('--channel-thumbnail-label-max-width')).toBe('');

    bottomButton.click();
    mockChannelThumbnailStripGeometry({ stripHeight: 120, tileHeight: 106, labelHeight: 16 });
    triggerResizeObserversForElement(strip);

    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-height')).toBe('77px');
    expect(firstPreview.style.getPropertyValue('--channel-thumbnail-preview-width')).toBe('77px');
    expect(firstTile!.style.getPropertyValue('--channel-thumbnail-tile-width')).toBe('87px');
    expect(firstLabel.style.getPropertyValue('--channel-thumbnail-label-max-width')).toBe('77px');
  });

  it('shows a delayed thumbnail hover preview while collapsed', () => {
    vi.useFakeTimers();
    installUiFixture();
    mockDesktopLayoutGeometry();

    const ui = new ViewerUi(createUiCallbacks());
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B'];
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: 'data:image/png;base64,AAAA'
    }));
    const bottomButton = document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement;

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, channelThumbnailItems);
    bottomButton.click();

    const tile = document.querySelector<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile');
    expect(tile).toBeTruthy();
    mockChannelThumbnailStripGeometry({ stripHeight: 34, tileHeight: 26, labelHeight: 16 });

    tile!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(499);

    expect(document.querySelector('.channel-thumbnail-hover-preview')).toBeNull();

    vi.advanceTimersByTime(1);

    const preview = document.querySelector('.channel-thumbnail-hover-preview');
    expect(preview).not.toBeNull();
    expect(preview?.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('switches collapsed hover previews immediately after the first preview appears', () => {
    vi.useFakeTimers();
    installUiFixture();
    mockDesktopLayoutGeometry();

    const ui = new ViewerUi(createUiCallbacks());
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'depth.Z'];
    const rgbThumbnailUrl = 'data:image/png;base64,AAAA';
    const depthThumbnailUrl = 'data:image/png;base64,BBBB';
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: item.value === 'channel:depth.Z' ? depthThumbnailUrl : rgbThumbnailUrl
    }));
    const strip = document.getElementById('channel-thumbnail-strip') as HTMLElement;
    const bottomButton = document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement;

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, channelThumbnailItems);
    bottomButton.click();

    const tiles = mockChannelThumbnailStripGeometry({ stripHeight: 34, tileHeight: 26, tileWidth: 82, labelHeight: 16 });
    const firstTile = tiles[0];
    const secondTile = tiles[1];
    expect(firstTile).toBeTruthy();
    expect(secondTile).toBeTruthy();

    firstTile!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    vi.advanceTimersByTime(499);

    expect(document.querySelector('.channel-thumbnail-hover-preview')).toBeNull();

    vi.advanceTimersByTime(1);

    let previews = document.querySelectorAll('.channel-thumbnail-hover-preview');
    expect(previews).toHaveLength(1);
    expect(previews[0]?.querySelector('img')?.getAttribute('src')).toBe(rgbThumbnailUrl);

    firstTile!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: secondTile }));
    secondTile!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: firstTile }));

    previews = document.querySelectorAll('.channel-thumbnail-hover-preview');
    expect(previews).toHaveLength(1);
    expect(previews[0]?.querySelector('img')?.getAttribute('src')).toBe(depthThumbnailUrl);

    secondTile!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: firstTile }));
    firstTile!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: secondTile }));

    previews = document.querySelectorAll('.channel-thumbnail-hover-preview');
    expect(previews).toHaveLength(1);
    expect(previews[0]?.querySelector('img')?.getAttribute('src')).toBe(rgbThumbnailUrl);

    strip.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: document.body }));
    expect(document.querySelector('.channel-thumbnail-hover-preview')).toBeNull();

    secondTile!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    vi.advanceTimersByTime(499);

    expect(document.querySelector('.channel-thumbnail-hover-preview')).toBeNull();

    vi.advanceTimersByTime(1);

    previews = document.querySelectorAll('.channel-thumbnail-hover-preview');
    expect(previews).toHaveLength(1);
    expect(previews[0]?.querySelector('img')?.getAttribute('src')).toBe(depthThumbnailUrl);
  });

  it('cancels the collapsed hover preview when the mouse leaves before the delay', () => {
    vi.useFakeTimers();
    installUiFixture();
    mockDesktopLayoutGeometry();

    const ui = new ViewerUi(createUiCallbacks());
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B'];
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: 'data:image/png;base64,AAAA'
    }));
    const bottomButton = document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement;

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, channelThumbnailItems);
    bottomButton.click();

    const tile = document.querySelector<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile');
    expect(tile).toBeTruthy();
    tile!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(250);
    tile!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    vi.advanceTimersByTime(250);

    expect(document.querySelector('.channel-thumbnail-hover-preview')).toBeNull();
  });

  it('does not show the hover preview while the bottom strip is expanded', () => {
    vi.useFakeTimers();
    installUiFixture();
    mockDesktopLayoutGeometry();

    const ui = new ViewerUi(createUiCallbacks());
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B'];
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: 'data:image/png;base64,AAAA'
    }));

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, channelThumbnailItems);

    const tile = document.querySelector<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile');
    expect(tile).toBeTruthy();
    tile!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(500);

    expect(document.querySelector('.channel-thumbnail-hover-preview')).toBeNull();
  });

  it('keeps thumbnail frame sizing stable when the strip rerenders for another image', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const ui = new ViewerUi(createUiCallbacks());
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A', 'depth.Z'];
    const strip = document.getElementById('channel-thumbnail-strip') as HTMLElement;
    const selected = {
      kind: 'channelRgb' as const,
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: 'beauty.A'
    };

    ui.setRgbGroupOptions(channelNames, selected, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: 'data:image/png;base64,AAAA'
    })));

    strip.style.paddingTop = '6px';
    strip.style.paddingBottom = '8px';

    let tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    for (const tile of tiles) {
      tile.style.padding = '4px';
      tile.style.rowGap = '3px';
      tile.style.border = '1px solid transparent';
    }

    mockChannelThumbnailStripGeometry({ stripHeight: 120, tileHeight: 106, labelHeight: 16 });
    triggerResizeObserversForElement(strip);

    const firstTile = tiles[0]!;
    const firstPreview = firstTile.querySelector('.channel-thumbnail-tile-preview') as HTMLElement;
    const initialPreviewWidth = firstPreview.style.getPropertyValue('--channel-thumbnail-preview-width');
    const initialTileWidth = firstTile.style.getPropertyValue('--channel-thumbnail-tile-width');

    ui.setRgbGroupOptions(channelNames, selected, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: 'data:image/png;base64,BBBB'
    })));

    tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    for (const tile of tiles) {
      tile.style.padding = '4px';
      tile.style.rowGap = '3px';
      tile.style.border = '1px solid transparent';
    }

    mockChannelThumbnailStripGeometry({ stripHeight: 120, tileHeight: 106, labelHeight: 16 });
    triggerResizeObserversForElement(strip);

    const rerenderedTile = tiles[0]!;
    const rerenderedPreview = rerenderedTile.querySelector('.channel-thumbnail-tile-preview') as HTMLElement;

    expect(rerenderedPreview.style.getPropertyValue('--channel-thumbnail-preview-width')).toBe(initialPreviewWidth);
    expect(rerenderedTile.style.getPropertyValue('--channel-thumbnail-tile-width')).toBe(initialTileWidth);
  });

  it('preserves focus across repeated horizontal keyboard navigation in the bottom strip', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B'];
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    }));
    const splitToggle = document.getElementById('rgb-split-toggle-button') as HTMLButtonElement;
    const channelSelect = document.getElementById('rgb-group-select') as HTMLSelectElement;
    const getTiles = (): HTMLButtonElement[] => Array.from(
      document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile')
    );

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, channelThumbnailItems);

    splitToggle.click();
    onRgbGroupChange.mockClear();

    let tiles = getTiles();
    expect(tiles).toHaveLength(3);
    expect(document.querySelectorAll('#channel-thumbnail-strip .channel-thumbnail-placeholder')).toHaveLength(3);

    tiles[0]?.focus();
    tiles[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    tiles = getTiles();
    expect(channelSelect.value).toBe('channel:beauty.G');
    expect(document.activeElement).toBe(tiles[1]);
    expect(tiles[1]?.getAttribute('aria-selected')).toBe('true');
    expect(onRgbGroupChange).toHaveBeenNthCalledWith(1, {
      kind: 'channelMono',
      channel: 'beauty.G',
      alpha: null
    });

    tiles[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    tiles = getTiles();
    expect(channelSelect.value).toBe('channel:beauty.B');
    expect(document.activeElement).toBe(tiles[2]);
    expect(tiles[2]?.getAttribute('aria-selected')).toBe('true');
    expect(onRgbGroupChange).toHaveBeenNthCalledWith(2, {
      kind: 'channelMono',
      channel: 'beauty.B',
      alpha: null
    });

    tiles[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    tiles = getTiles();
    expect(channelSelect.value).toBe('channel:beauty.G');
    expect(document.activeElement).toBe(tiles[1]);
    expect(tiles[1]?.getAttribute('aria-selected')).toBe('true');
    expect(onRgbGroupChange).toHaveBeenNthCalledWith(3, {
      kind: 'channelMono',
      channel: 'beauty.G',
      alpha: null
    });
  });

  it('keeps scalar alpha selections on the scalar channel when split RGB is enabled', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange }));
    const channelNames = ['R', 'G', 'B', 'A', 'mask'];
    const splitToggle = document.getElementById('rgb-split-toggle-button') as HTMLButtonElement;
    const channelSelect = document.getElementById('rgb-group-select') as HTMLSelectElement;

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelMono',
      channel: 'mask',
      alpha: 'A'
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));

    expect(Array.from(channelSelect.selectedOptions).map((option) => option.textContent)).toEqual(['mask,A']);

    splitToggle.click();

    expect(Array.from(channelSelect.selectedOptions).map((option) => option.textContent)).toEqual(['mask']);
    expect(onRgbGroupChange).toHaveBeenCalledWith({
      kind: 'channelMono',
      channel: 'mask',
      alpha: null
    });
  });

  it('preserves horizontal scroll when selecting a thumbnail from a scrolled strip', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A', 'depth.Z'];
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: 'data:image/png;base64,AAAA'
    }));
    const strip = document.getElementById('channel-thumbnail-strip') as HTMLElement;

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: 'beauty.A'
    }, channelThumbnailItems);

    strip.scrollLeft = 96;

    const replaceChildren = strip.replaceChildren.bind(strip) as (...nodes: Array<Node | string>) => void;
    vi.spyOn(strip, 'replaceChildren').mockImplementation((...nodes: Array<Node | string>) => {
      replaceChildren(...nodes);
      strip.scrollLeft = 0;
    });

    const secondTile = document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile')[1];
    secondTile?.click();

    expect(strip.scrollLeft).toBe(96);
    expect(onRgbGroupChange).toHaveBeenLastCalledWith({
      kind: 'channelMono',
      channel: 'depth.Z',
      alpha: null
    });
  });
});

describe('global panel arrow navigation', () => {
  it('uses ArrowUp and ArrowDown on the document to move the open-files selection by default', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onOpenedImageSelected = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' },
      { id: 'session-3', label: 'image-c.exr' }
    ], 'session-2');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

    expect(onOpenedImageSelected).toHaveBeenNthCalledWith(1, 'session-3');
    expect(onOpenedImageSelected).toHaveBeenNthCalledWith(2, 'session-2');
    expect((document.getElementById('opened-images-select') as HTMLSelectElement).value).toBe('session-2');
  });

  it('uses ArrowLeft and ArrowRight on the document to move the bottom channel selection', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'depth.Z', 'mask'];
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    }));

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, channelThumbnailItems);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    expect(onRgbGroupChange).toHaveBeenNthCalledWith(1, {
      kind: 'channelMono',
      channel: 'depth.Z',
      alpha: null
    });
    expect(onRgbGroupChange).toHaveBeenNthCalledWith(2, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    });
  });

  it('switches ArrowUp and ArrowDown to Channel View after a channel-view row click', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onOpenedImageSelected = vi.fn();
    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected, onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'depth.Z'];

    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');
    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));

    const channelRows = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-view-list .channel-view-row'));
    channelRows[0]?.click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(onRgbGroupChange).toHaveBeenLastCalledWith({
      kind: 'channelMono',
      channel: 'depth.Z',
      alpha: null
    });
    expect(onOpenedImageSelected).not.toHaveBeenCalled();
    expect((document.getElementById('rgb-group-select') as HTMLSelectElement).value).toBe('channel:depth.Z');
  });

  it('switches ArrowUp and ArrowDown back to Open Files after an open-files row click', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onOpenedImageSelected = vi.fn();
    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected, onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'depth.Z'];

    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' },
      { id: 'session-3', label: 'image-c.exr' }
    ], 'session-1');
    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));

    const channelRows = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-view-list .channel-view-row'));
    channelRows[0]?.click();

    const openedFileRows = mockOpenedFilesListGeometry() as HTMLDivElement[];
    openedFileRows[0]?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientY: 10
    }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    openedFileRows[0]?.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(onOpenedImageSelected).toHaveBeenLastCalledWith('session-2');
    expect((document.getElementById('opened-images-select') as HTMLSelectElement).value).toBe('session-2');
    expect(onRgbGroupChange).not.toHaveBeenCalledWith({
      kind: 'channelMono',
      channel: 'depth.Z',
      alpha: null
    });
  });

  it('does not switch the vertical target when only the Channel View toggle is clicked', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onOpenedImageSelected = vi.fn();
    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected, onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'depth.Z'];

    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');
    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));

    (document.getElementById('channel-view-toggle') as HTMLButtonElement).click();
    (document.getElementById('channel-view-toggle') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(onOpenedImageSelected).toHaveBeenLastCalledWith('session-2');
    expect(onRgbGroupChange).not.toHaveBeenCalled();
  });

  it('ignores global arrow routing while the export dialog is open', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onOpenedImageSelected = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    (document.getElementById('export-image-button') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(onOpenedImageSelected).not.toHaveBeenCalled();
    expect((document.getElementById('opened-images-select') as HTMLSelectElement).value).toBe('session-1');
  });

  it('ignores global arrow routing while a top menu is open', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onOpenedImageSelected = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');

    (document.getElementById('file-menu-button') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(onOpenedImageSelected).not.toHaveBeenCalled();
    expect((document.getElementById('opened-images-select') as HTMLSelectElement).value).toBe('session-1');
  });

  it('ignores global arrow routing from editable controls', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onOpenedImageSelected = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(onOpenedImageSelected).not.toHaveBeenCalled();
    expect((document.getElementById('opened-images-select') as HTMLSelectElement).value).toBe('session-1');
  });

  it('starts and releases panorama orbit input on global w/a/s/d keydown and keyup', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onPanoramaKeyboardOrbitInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onPanoramaKeyboardOrbitInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true }));

    expect(onPanoramaKeyboardOrbitInputChange.mock.calls).toEqual([
      [{ up: true, left: false, down: false, right: false }],
      [{ up: false, left: false, down: false, right: false }],
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('ignores repeated panorama keydown events after the first pressed-state transition', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onPanoramaKeyboardOrbitInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onPanoramaKeyboardOrbitInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, repeat: true }));

    expect(onPanoramaKeyboardOrbitInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }]
    ]);
  });

  it('clears active panorama orbit input on window blur', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onPanoramaKeyboardOrbitInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onPanoramaKeyboardOrbitInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    window.dispatchEvent(new Event('blur'));

    expect(onPanoramaKeyboardOrbitInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('clears active panorama orbit input when the document becomes hidden', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onPanoramaKeyboardOrbitInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onPanoramaKeyboardOrbitInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onPanoramaKeyboardOrbitInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('clears active panorama orbit input when switching out of panorama mode', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onPanoramaKeyboardOrbitInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onPanoramaKeyboardOrbitInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    ui.setViewerMode('image');

    expect(onPanoramaKeyboardOrbitInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('clears active panorama orbit input when the active image list becomes empty', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onPanoramaKeyboardOrbitInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onPanoramaKeyboardOrbitInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    ui.setOpenedImageOptions([], null);

    expect(onPanoramaKeyboardOrbitInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('clears active panorama orbit input when the export dialog opens and ignores further input while open', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onPanoramaKeyboardOrbitInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onPanoramaKeyboardOrbitInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');
    ui.setExportTarget({ filename: 'image.png' });

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    (document.getElementById('export-image-button') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));

    expect(onPanoramaKeyboardOrbitInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('clears active panorama orbit input when a top menu opens and ignores further input while open', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onPanoramaKeyboardOrbitInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onPanoramaKeyboardOrbitInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    (document.getElementById('file-menu-button') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));

    expect(onPanoramaKeyboardOrbitInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('ignores global w/a/s/d while image mode is active', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onPanoramaKeyboardOrbitInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onPanoramaKeyboardOrbitInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('image');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));

    expect(onPanoramaKeyboardOrbitInputChange).not.toHaveBeenCalled();
  });

  it('ignores global w/a/s/d from editable controls', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onPanoramaKeyboardOrbitInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onPanoramaKeyboardOrbitInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));

    expect(onPanoramaKeyboardOrbitInputChange).not.toHaveBeenCalled();
  });

  it('does not handle a focused strip tile twice when the local handler already consumed the arrow key', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B'];
    const channelThumbnailItems = buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    }));
    const splitToggle = document.getElementById('rgb-split-toggle-button') as HTMLButtonElement;

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, channelThumbnailItems);

    splitToggle.click();
    onRgbGroupChange.mockClear();

    const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    tiles[0]?.focus();
    tiles[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(onRgbGroupChange).toHaveBeenCalledTimes(1);
    expect(onRgbGroupChange).toHaveBeenCalledWith({
      kind: 'channelMono',
      channel: 'beauty.G',
      alpha: null
    });
  });

  it('keeps global left and right routing active while an open-files row is focused', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'depth.Z'];

    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');
    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));

    const openedFileRows = mockOpenedFilesListGeometry() as HTMLDivElement[];
    openedFileRows[0]?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientY: 10
    }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    onRgbGroupChange.mockClear();

    openedFileRows[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(onRgbGroupChange).toHaveBeenCalledTimes(1);
    expect(onRgbGroupChange).toHaveBeenCalledWith({
      kind: 'channelMono',
      channel: 'depth.Z',
      alpha: null
    });
  });

  it('keeps global up and down routing active while a bottom-strip tile is focused', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onOpenedImageSelected = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'depth.Z'];

    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');
    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));

    const tile = document.querySelector<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile');
    tile?.focus();

    tile?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(onOpenedImageSelected).toHaveBeenCalledTimes(1);
    expect(onOpenedImageSelected).toHaveBeenCalledWith('session-2');
  });

  it('keeps global horizontal routing active when the bottom panel is collapsed', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'depth.Z'];

    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));

    (document.getElementById('bottom-panel-collapse-button') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(onRgbGroupChange).toHaveBeenCalledWith({
      kind: 'channelMono',
      channel: 'depth.Z',
      alpha: null
    });
  });

  it('falls back to Open Files when Channel View was active but becomes unavailable', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onOpenedImageSelected = vi.fn();
    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected, onRgbGroupChange }));
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'depth.Z'];

    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');
    ui.setRgbGroupOptions(channelNames, {
      kind: 'channelRgb',
      r: 'beauty.R',
      g: 'beauty.G',
      b: 'beauty.B',
      alpha: null
    }, buildChannelViewItems(channelNames).map((item) => ({
      ...item,
      thumbnailDataUrl: null
    })));

    const channelRows = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-view-list .channel-view-row'));
    channelRows[0]?.click();
    (document.getElementById('channel-view-toggle') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(onOpenedImageSelected).toHaveBeenLastCalledWith('session-2');
    expect(onRgbGroupChange).not.toHaveBeenCalledWith({
      kind: 'channelMono',
      channel: 'depth.Z',
      alpha: null
    });
  });
});

function installUiFixture(): void {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const bodyMarkup = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  document.body.innerHTML = bodyMarkup;
  resizeObserverRegistrations.length = 0;
  installCanvasRenderingMocks();

  class ResizeObserverMock {
    private readonly registration: ResizeObserverRegistration;

    constructor(callback: ResizeObserverCallback) {
      this.registration = {
        callback,
        observedElements: []
      };
      resizeObserverRegistrations.push(this.registration);
    }

    observe(target: Element): void {
      if (!this.registration.observedElements.includes(target)) {
        this.registration.observedElements.push(target);
      }
    }

    unobserve(target: Element): void {
      const index = this.registration.observedElements.indexOf(target);
      if (index >= 0) {
        this.registration.observedElements.splice(index, 1);
      }
    }

    disconnect(): void {
      this.registration.observedElements.length = 0;
    }
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

function createBatchChannels(channelNames: string[]) {
  return buildChannelViewItems(channelNames).map((item) => ({
    value: item.value,
    label: item.label,
    selectionKey: item.selectionKey,
    selection: item.selection,
    swatches: item.swatches,
    mergedOrder: item.mergedOrder,
    splitOrder: item.splitOrder
  }));
}

function getExportBatchColumnLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.export-batch-channel-label'))
    .map((element) => element.textContent ?? '');
}

function getCheckedExportBatchCellColumnKeys(): string[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(
    'input[data-batch-toggle="cell"]:checked'
  )).map((input) => input.dataset.columnKey ?? '');
}

function installCanvasRenderingMocks(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId: string) => {
    if (contextId !== '2d') {
      return null;
    }

    return {
      putImageData: () => {}
    } as never;
  });

  vi.stubGlobal('ImageData', function(this: object, data: Uint8ClampedArray, width: number, height: number) {
    return { data, width, height };
  } as unknown as typeof ImageData);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,preview');
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

function mockChannelThumbnailStripGeometry(
  args: {
    stripHeight: number;
    stripWidth?: number;
    tileHeight: number;
    tileWidth?: number;
    labelHeight: number;
  }
): HTMLButtonElement[] {
  const strip = document.getElementById('channel-thumbnail-strip') as HTMLElement;
  const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
  const tileWidth = args.tileWidth ?? 120;

  mockDomRect(strip, {
    top: 0,
    bottom: args.stripHeight,
    height: args.stripHeight,
    width: args.stripWidth ?? 360
  });

  tiles.forEach((tile, index) => {
    const left = index * (tileWidth + 8);
    mockDomRect(tile, {
      top: 0,
      bottom: args.tileHeight,
      height: args.tileHeight,
      left,
      width: tileWidth
    });

    const label = tile.querySelector('.channel-thumbnail-tile-label') as HTMLElement;
    mockDomRect(label, {
      top: args.tileHeight - args.labelHeight,
      bottom: args.tileHeight,
      height: args.labelHeight,
      left,
      width: tileWidth
    });
  });

  return tiles;
}

function triggerResizeObserversForElement(element: Element): void {
  resizeObserverRegistrations
    .filter((registration) => registration.observedElements.includes(element))
    .forEach((registration) => {
      registration.callback([], {} as ResizeObserver);
    });
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

function installFullscreenApiMock(options: { requestBehavior?: 'resolve' | 'reject' | 'missing' } = {}) {
  const behavior = options.requestBehavior ?? 'resolve';
  const appShell = document.getElementById('app') as HTMLElement;
  const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
  let fullscreenElement: Element | null = null;

  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement
  });

  const requestFullscreen = vi.fn(async function(this: HTMLElement) {
    if (behavior === 'reject') {
      throw new Error('Fullscreen request failed.');
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    fullscreenElement = this;
    document.dispatchEvent(new Event('fullscreenchange'));
  });

  const exitFullscreen = vi.fn(async () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  });

  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: exitFullscreen
  });

  Object.defineProperty(appShell, 'requestFullscreen', {
    configurable: true,
    value: behavior === 'missing' ? undefined : requestFullscreen
  });

  Object.defineProperty(viewerContainer, 'requestFullscreen', {
    configurable: true,
    value: behavior === 'missing' ? undefined : requestFullscreen
  });

  return {
    requestFullscreen,
    exitFullscreen,
    getFullscreenElement: () => fullscreenElement,
    setFullscreenElement: (element: Element | null) => {
      fullscreenElement = element;
      document.dispatchEvent(new Event('fullscreenchange'));
    }
  };
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
    onExportImage: async (_request: unknown) => {},
    onResolveExportImagePreview: async (_request: unknown, _signal: AbortSignal) => createPreviewPixels(),
    onExportImageBatch: async (_request: {
      archiveFilename: string;
      entries: Array<{
        sessionId: string;
        activeLayer: number;
        displaySelection: unknown;
        channelLabel: string;
        outputFilename: string;
      }>;
      format: 'png-zip';
    }, _signal: AbortSignal) => {},
    onResolveExportImageBatchPreview: async (_request: {
      sessionId: string;
      activeLayer: number;
      displaySelection: unknown;
      channelLabel: string;
    }, _signal: AbortSignal) => createPreviewPixels(),
    onExportColormap: async (_request: {
      colormapId: string;
      width: number;
      height: number;
      orientation: 'horizontal' | 'vertical';
      filename: string;
      format: 'png';
    }) => {},
    onResolveExportColormapPreview: async (_request: {
      colormapId: string;
      width: number;
      height: number;
      orientation: 'horizontal' | 'vertical';
    }, _signal: AbortSignal) => createPreviewPixels(),
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
    onPanoramaKeyboardOrbitInputChange: () => {},
    onViewerModeChange: () => {},
    onLayerChange: () => {},
    onRgbGroupChange: () => {},
    onVisualizationModeChange: () => {},
    onColormapChange: () => {},
    onColormapRangeChange: () => {},
    onColormapAutoRange: () => {},
    onColormapZeroCenterToggle: () => {},
    onStokesDegreeModulationToggle: () => {},
    onStokesAolpDegreeModulationModeChange: () => {},
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

function createPreviewPixels(width = 4, height = 1) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4)
  };
}

function readStyleRule(selector: string): string {
  const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8');
  const ruleStart = css.indexOf(`${selector} {`);
  if (ruleStart < 0) {
    throw new Error(`Style rule not found: ${selector}`);
  }

  const bodyStart = css.indexOf('{', ruleStart);
  const bodyEnd = css.indexOf('}', bodyStart);
  return css.slice(bodyStart + 1, bodyEnd);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushBatchPreviewQueue(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks();
  }
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
  const indexedFiles = Object.fromEntries(files.map((file, index) => [String(index), file]));
  return Object.assign(indexedFiles, {
    item: (index: number) => files[index] ?? null,
    length: files.length
  }) as unknown as FileList;
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
