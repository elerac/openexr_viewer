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
  buildExportBatchOutputFilename,
  buildExportBatchScreenshotOutputFilename
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
import { SPECTRUM_LATTICE_THEME_ID, THEME_STORAGE_KEY } from '../src/theme';
import type { ViewportRect } from '../src/types';
import {
  SPECTRUM_LATTICE_MOTION_ANIMATE,
  SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM,
  SPECTRUM_LATTICE_MOTION_STORAGE_KEY
} from '../src/spectrum-lattice-motion';
import { createDefaultStokesColormapDefaultSettings } from '../src/stokes';
import { AUTO_EXPOSURE_PERCENTILE } from '../src/auto-exposure';

const AUTO_EXPOSURE_PERCENTILE_STORAGE_KEY = 'openexr-viewer:auto-exposure-percentile:v1';
const RULERS_VISIBLE_STORAGE_KEY = 'openexr-viewer:rulers-visible:v1';

interface ResizeObserverRegistration {
  callback: ResizeObserverCallback;
  observedElements: Element[];
}

const resizeObserverRegistrations: ResizeObserverRegistration[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  delete document.documentElement.dataset.theme;
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
    const imageStatsToggle = document.getElementById('image-stats-toggle') as HTMLButtonElement;
    const imageStatsContent = document.getElementById('image-stats-content') as HTMLDivElement;

    expect(metadataToggle.getAttribute('aria-expanded')).toBe('true');
    expect(metadataContent.hidden).toBe(false);
    expect(probeToggle.getAttribute('aria-expanded')).toBe('true');
    expect(probeContent.hidden).toBe(false);
    expect(roiToggle.getAttribute('aria-expanded')).toBe('true');
    expect(roiContent.hidden).toBe(false);
    expect(imageStatsToggle.getAttribute('aria-expanded')).toBe('true');
    expect(imageStatsContent.hidden).toBe(false);

    metadataToggle.click();

    expect(metadataToggle.getAttribute('aria-expanded')).toBe('false');
    expect(metadataContent.hidden).toBe(true);
    expect((document.getElementById('metadata-panel') as HTMLElement).classList.contains('is-collapsed')).toBe(true);
    expect(probeContent.hidden).toBe(false);
    expect(roiContent.hidden).toBe(false);
    expect(imageStatsContent.hidden).toBe(false);

    metadataToggle.click();
    probeToggle.click();
    roiToggle.click();
    imageStatsToggle.click();

    expect(metadataToggle.getAttribute('aria-expanded')).toBe('true');
    expect(metadataContent.hidden).toBe(false);
    expect(probeToggle.getAttribute('aria-expanded')).toBe('false');
    expect(probeContent.hidden).toBe(true);
    expect(roiToggle.getAttribute('aria-expanded')).toBe('false');
    expect(roiContent.hidden).toBe(true);
    expect(imageStatsToggle.getAttribute('aria-expanded')).toBe('false');
    expect(imageStatsContent.hidden).toBe(true);
    expect(document.querySelector('#probe-panel .readout-block-header')).not.toBeNull();
    expect(document.querySelector('#roi-panel .readout-block-header')).not.toBeNull();
    expect(document.querySelector('#image-stats-panel .readout-block-header')).not.toBeNull();
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

describe('top bar and display controls', () => {
  it('persists and dispatches the top-bar auto-fit selected images toggle and immediate fit action', () => {
    installUiFixture();

    const onAutoFitImageOnSelectChange = vi.fn();
    const onAutoFitImage = vi.fn();
    new ViewerUi(createUiCallbacks({ onAutoFitImageOnSelectChange, onAutoFitImage }));
    const button = document.getElementById('app-auto-fit-image-button') as HTMLButtonElement;

    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(onAutoFitImageOnSelectChange).toHaveBeenLastCalledWith(false);
    expect(onAutoFitImage).not.toHaveBeenCalled();

    button.click();

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('openexr-viewer:auto-fit-image-on-select:v1')).toBe('true');
    expect(onAutoFitImageOnSelectChange).toHaveBeenLastCalledWith(true);
    expect(onAutoFitImage).toHaveBeenCalledTimes(1);

    installUiFixture();
    const restoredCallback = vi.fn();
    const restoredAutoFitImage = vi.fn();
    new ViewerUi(createUiCallbacks({
      onAutoFitImageOnSelectChange: restoredCallback,
      onAutoFitImage: restoredAutoFitImage
    }));
    const restoredButton = document.getElementById('app-auto-fit-image-button') as HTMLButtonElement;

    expect(restoredButton.getAttribute('aria-pressed')).toBe('true');
    expect(restoredCallback).toHaveBeenLastCalledWith(true);
    expect(restoredAutoFitImage).not.toHaveBeenCalled();

    restoredButton.click();

    expect(restoredButton.getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem('openexr-viewer:auto-fit-image-on-select:v1')).toBe('false');
    expect(restoredCallback).toHaveBeenLastCalledWith(false);
    expect(restoredAutoFitImage).not.toHaveBeenCalled();
  });

  it('disables the top-bar auto-fit toggle in panorama mode without clearing its pressed state', () => {
    installUiFixture();

    const onAutoFitImageOnSelectChange = vi.fn();
    const onAutoFitImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onAutoFitImageOnSelectChange, onAutoFitImage }));
    const button = document.getElementById('app-auto-fit-image-button') as HTMLButtonElement;

    expect(button.disabled).toBe(false);
    button.click();

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('openexr-viewer:auto-fit-image-on-select:v1')).toBe('true');
    expect(onAutoFitImageOnSelectChange).toHaveBeenLastCalledWith(true);
    expect(onAutoFitImage).toHaveBeenCalledTimes(1);

    onAutoFitImageOnSelectChange.mockClear();
    onAutoFitImage.mockClear();

    ui.setViewerMode('panorama');

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('openexr-viewer:auto-fit-image-on-select:v1')).toBe('true');
    expect(onAutoFitImageOnSelectChange).not.toHaveBeenCalled();
    expect(onAutoFitImage).not.toHaveBeenCalled();

    ui.setViewerMode('image');

    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('persists and dispatches the top-bar auto exposure toggle', () => {
    installUiFixture();

    const onAutoExposureChange = vi.fn();
    new ViewerUi(createUiCallbacks({ onAutoExposureChange }));
    const button = document.getElementById('app-auto-exposure-button') as HTMLButtonElement;

    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(onAutoExposureChange).toHaveBeenLastCalledWith(false);

    button.click();

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('openexr-viewer:auto-exposure:v1')).toBe('true');
    expect(onAutoExposureChange).toHaveBeenLastCalledWith(true);

    installUiFixture();
    const restoredCallback = vi.fn();
    new ViewerUi(createUiCallbacks({ onAutoExposureChange: restoredCallback }));
    const restoredButton = document.getElementById('app-auto-exposure-button') as HTMLButtonElement;

    expect(restoredButton.getAttribute('aria-pressed')).toBe('true');
    expect(restoredCallback).toHaveBeenLastCalledWith(true);

    restoredButton.click();

    expect(restoredButton.getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem('openexr-viewer:auto-exposure:v1')).toBe('false');
    expect(restoredCallback).toHaveBeenLastCalledWith(false);
  });

  it('persists and dispatches the auto exposure percentile setting', () => {
    installUiFixture();

    const onAutoExposurePercentileChange = vi.fn();
    new ViewerUi(createUiCallbacks({ onAutoExposurePercentileChange }));
    const input = document.getElementById('auto-exposure-percentile-input') as HTMLInputElement;

    expect(input.value).toBe('99.5');
    expect(input.min).toBe('1');
    expect(input.max).toBe('100');
    expect(input.step).toBe('0.1');
    expect(onAutoExposurePercentileChange).toHaveBeenLastCalledWith(AUTO_EXPOSURE_PERCENTILE);

    input.value = '98.24';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(input.value).toBe('98.2');
    expect(window.localStorage.getItem(AUTO_EXPOSURE_PERCENTILE_STORAGE_KEY)).toBe('98.2');
    expect(onAutoExposurePercentileChange).toHaveBeenLastCalledWith(98.2);

    input.value = '500';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(input.value).toBe('100.0');
    expect(window.localStorage.getItem(AUTO_EXPOSURE_PERCENTILE_STORAGE_KEY)).toBe('100.0');
    expect(onAutoExposurePercentileChange).toHaveBeenLastCalledWith(100);

    installUiFixture();
    const restoredCallback = vi.fn();
    new ViewerUi(createUiCallbacks({ onAutoExposurePercentileChange: restoredCallback }));
    const restoredInput = document.getElementById('auto-exposure-percentile-input') as HTMLInputElement;

    expect(restoredInput.value).toBe('100.0');
    expect(restoredCallback).toHaveBeenLastCalledWith(100);

    restoredInput.value = 'bad';
    restoredInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(restoredInput.value).toBe('99.5');
    expect(window.localStorage.getItem(AUTO_EXPOSURE_PERCENTILE_STORAGE_KEY)).toBeNull();
    expect(restoredCallback).toHaveBeenLastCalledWith(99.5);
  });

  it('does not retain focus after pointer auto exposure activation', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const button = document.getElementById('app-auto-exposure-button') as HTMLButtonElement;

    button.focus();
    const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true });
    button.dispatchEvent(mouseDownEvent);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(mouseDownEvent.defaultPrevented).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).not.toBe(button);
  });

  it('persists and dispatches the image ruler visibility toggle', () => {
    installUiFixture();

    const onRulersVisibleChange = vi.fn();
    new ViewerUi(createUiCallbacks({ onRulersVisibleChange }));
    const rulersItem = document.getElementById('rulers-menu-item') as HTMLButtonElement;

    expect(rulersItem.getAttribute('aria-checked')).toBe('false');
    expect(onRulersVisibleChange).toHaveBeenLastCalledWith(false);

    rulersItem.click();

    expect(rulersItem.getAttribute('aria-checked')).toBe('true');
    expect(window.localStorage.getItem(RULERS_VISIBLE_STORAGE_KEY)).toBe('true');
    expect(onRulersVisibleChange).toHaveBeenLastCalledWith(true);

    installUiFixture();
    const restoredCallback = vi.fn();
    new ViewerUi(createUiCallbacks({ onRulersVisibleChange: restoredCallback }));
    const restoredRulersItem = document.getElementById('rulers-menu-item') as HTMLButtonElement;

    expect(restoredRulersItem.getAttribute('aria-checked')).toBe('true');
    expect(restoredCallback).toHaveBeenLastCalledWith(true);

    restoredRulersItem.click();

    expect(restoredRulersItem.getAttribute('aria-checked')).toBe('false');
    expect(window.localStorage.getItem(RULERS_VISIBLE_STORAGE_KEY)).toBe('false');
    expect(restoredCallback).toHaveBeenLastCalledWith(false);
  });

  it('does not retain focus after pointer auto-fit activation', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const button = document.getElementById('app-auto-fit-image-button') as HTMLButtonElement;

    button.focus();
    const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true });
    button.dispatchEvent(mouseDownEvent);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(mouseDownEvent.defaultPrevented).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).not.toBe(button);
  });

  it('keeps focus after keyboard auto-fit activation', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const button = document.getElementById('app-auto-fit-image-button') as HTMLButtonElement;

    button.focus();
    button.click();

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(button);
  });

  it('dispatches reset view from the inspector reset button', () => {
    installUiFixture();

    const onResetView = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onResetView }));
    const inspectorResetButton = document.getElementById('reset-view-button') as HTMLButtonElement;

    inspectorResetButton.click();
    expect(onResetView).toHaveBeenCalledTimes(1);

    ui.setLoading(true);
    expect(inspectorResetButton.disabled).toBe(true);

    inspectorResetButton.click();
    expect(onResetView).toHaveBeenCalledTimes(1);

    ui.setLoading(false);
    expect(inspectorResetButton.disabled).toBe(false);
  });

  it('dispatches visualization mode changes from inspector buttons', () => {
    installUiFixture();

    const onVisualizationModeChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onVisualizationModeChange }));
    const inspectorNoneButton = document.getElementById('visualization-none-button') as HTMLButtonElement;
    const inspectorColormapButton = document.getElementById('colormap-toggle-button') as HTMLButtonElement;

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    inspectorColormapButton.click();
    expect(onVisualizationModeChange).toHaveBeenLastCalledWith('colormap');

    inspectorNoneButton.click();
    expect(onVisualizationModeChange).toHaveBeenLastCalledWith('rgb');
  });

  it('syncs inspector visualization mode button state', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const inspectorNoneButton = document.getElementById('visualization-none-button') as HTMLButtonElement;
    const inspectorColormapButton = document.getElementById('colormap-toggle-button') as HTMLButtonElement;

    ui.setVisualizationMode('rgb');

    expect(inspectorNoneButton.getAttribute('aria-pressed')).toBe('true');
    expect(inspectorColormapButton.getAttribute('aria-pressed')).toBe('false');
    expect(inspectorColormapButton.getAttribute('aria-expanded')).toBe('false');

    ui.setVisualizationMode('colormap');

    expect(inspectorNoneButton.getAttribute('aria-pressed')).toBe('false');
    expect(inspectorColormapButton.getAttribute('aria-pressed')).toBe('true');
    expect(inspectorColormapButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('syncs inspector visualization mode disabled state', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const buttons = [
      document.getElementById('visualization-none-button') as HTMLButtonElement,
      document.getElementById('colormap-toggle-button') as HTMLButtonElement
    ];

    expect(buttons.map((button) => button.disabled)).toEqual([true, true]);

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    expect(buttons.map((button) => button.disabled)).toEqual([false, false]);

    ui.setLoading(true);
    expect(buttons.map((button) => button.disabled)).toEqual([true, true]);

    ui.setLoading(false);
    expect(buttons.map((button) => button.disabled)).toEqual([false, false]);
  });

  it('updates inspector exposure controls through the shared exposure state', () => {
    installUiFixture();

    const onExposureChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onExposureChange }));
    const exposureSlider = document.getElementById('exposure-slider') as HTMLInputElement;
    const exposureValue = document.getElementById('exposure-value') as HTMLInputElement;

    ui.setExposure(1.2);

    expect(exposureSlider.value).toBe('1.2');
    expect(exposureValue.value).toBe('1.2');

    exposureSlider.value = '2.3';
    exposureSlider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onExposureChange).toHaveBeenLastCalledWith(2.3);

    exposureValue.value = '-12';
    exposureValue.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onExposureChange).toHaveBeenLastCalledWith(-10);

    ui.setExposure(-0.7);

    expect(exposureSlider.value).toBe('-0.7');
    expect(exposureValue.value).toBe('-0.7');
  });

  it('hides inspector exposure whenever visualization uses colormap', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const exposureControl = document.getElementById('exposure-control') as HTMLDivElement;

    ui.setVisualizationMode('rgb');
    expect(exposureControl.classList.contains('hidden')).toBe(false);

    ui.setVisualizationMode('colormap');
    expect(exposureControl.classList.contains('hidden')).toBe(true);

    ui.setVisualizationMode('rgb');
    expect(exposureControl.classList.contains('hidden')).toBe(false);
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
          createStatsChannel('Mono', 0.1, 0.25, 0.5, 18),
          createStatsChannel('A', 0, 0.5, 1, 20)
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
        channels: [createStatsChannel('Mono', 0.1, 0.25, 0.5, 18)]
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

describe('viewer state inspector', () => {
  it('shows a disabled empty state until an image is active', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());

    expect((document.getElementById('viewer-state-empty-state') as HTMLElement).classList.contains('hidden')).toBe(false);
    expect((document.getElementById('viewer-state-image-fields') as HTMLElement).classList.contains('hidden')).toBe(true);
    expect((document.getElementById('viewer-state-panorama-fields') as HTMLElement).classList.contains('hidden')).toBe(true);
    expect((document.getElementById('viewer-state-zoom-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('renders image view fields and commits edits on Enter or blur', () => {
    installUiFixture();

    const onViewerViewStateChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerViewStateChange }));
    ui.setViewerStateReadout({
      hasActiveImage: true,
      viewerMode: 'image',
      view: {
        zoom: 2,
        panX: 10,
        panY: 12.5,
        panoramaYawDeg: 30,
        panoramaPitchDeg: 5,
        panoramaHfovDeg: 80
      }
    });

    const zoomInput = document.getElementById('viewer-state-zoom-input') as HTMLInputElement;
    const panXInput = document.getElementById('viewer-state-pan-x-input') as HTMLInputElement;

    expect((document.getElementById('viewer-state-empty-state') as HTMLElement).classList.contains('hidden')).toBe(true);
    expect((document.getElementById('viewer-state-image-fields') as HTMLElement).classList.contains('hidden')).toBe(false);
    expect((document.getElementById('viewer-state-panorama-fields') as HTMLElement).classList.contains('hidden')).toBe(true);
    expect(zoomInput.value).toBe('2');
    expect(panXInput.value).toBe('10');
    expect((document.getElementById('viewer-state-pan-y-input') as HTMLInputElement).value).toBe('12.5');

    zoomInput.value = '3.5';
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    zoomInput.dispatchEvent(enterEvent);

    panXInput.value = '11.25';
    panXInput.dispatchEvent(new Event('blur'));

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(onViewerViewStateChange.mock.calls).toEqual([
      [{ zoom: 3.5 }],
      [{ panX: 11.25 }]
    ]);
  });

  it('renders panorama view fields and normalizes typed values', () => {
    installUiFixture();

    const onViewerViewStateChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerViewStateChange }));
    ui.setViewerStateReadout({
      hasActiveImage: true,
      viewerMode: 'panorama',
      view: {
        zoom: 2,
        panX: 10,
        panY: 12.5,
        panoramaYawDeg: 30,
        panoramaPitchDeg: 5,
        panoramaHfovDeg: 80
      }
    });

    const yawInput = document.getElementById('viewer-state-yaw-input') as HTMLInputElement;
    const pitchInput = document.getElementById('viewer-state-pitch-input') as HTMLInputElement;
    const hfovInput = document.getElementById('viewer-state-hfov-input') as HTMLInputElement;

    expect((document.getElementById('viewer-state-image-fields') as HTMLElement).classList.contains('hidden')).toBe(true);
    expect((document.getElementById('viewer-state-panorama-fields') as HTMLElement).classList.contains('hidden')).toBe(false);
    expect(yawInput.value).toBe('30');
    expect(pitchInput.value).toBe('5');
    expect(hfovInput.value).toBe('80');

    yawInput.value = '190';
    yawInput.dispatchEvent(new Event('blur'));
    pitchInput.value = '120';
    pitchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    hfovInput.value = '0';
    hfovInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(yawInput.value).toBe('-170');
    expect(pitchInput.value).toBe('89');
    expect(hfovInput.value).toBe('1');
    expect(onViewerViewStateChange.mock.calls).toEqual([
      [{ panoramaYawDeg: -170 }],
      [{ panoramaPitchDeg: 89 }],
      [{ panoramaHfovDeg: 1 }]
    ]);
  });

  it('rejects invalid typed values without dispatching edits', () => {
    installUiFixture();

    const onViewerViewStateChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerViewStateChange }));
    ui.setViewerStateReadout({
      hasActiveImage: true,
      viewerMode: 'image',
      view: {
        zoom: 2,
        panX: 10,
        panY: 12.5,
        panoramaYawDeg: 30,
        panoramaPitchDeg: 5,
        panoramaHfovDeg: 80
      }
    });

    const zoomInput = document.getElementById('viewer-state-zoom-input') as HTMLInputElement;
    zoomInput.value = '';
    zoomInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(zoomInput.getAttribute('aria-invalid')).toBe('true');
    expect(onViewerViewStateChange).not.toHaveBeenCalled();

    ui.setViewerStateReadout({
      hasActiveImage: true,
      viewerMode: 'image',
      view: {
        zoom: 4,
        panX: 10,
        panY: 12.5,
        panoramaYawDeg: 30,
        panoramaPitchDeg: 5,
        panoramaHfovDeg: 80
      }
    });
    expect(zoomInput.getAttribute('aria-invalid')).toBeNull();
    expect(zoomInput.value).toBe('4');
  });
});

describe('image stats inspector', () => {
  it('places Image Stats after View and before Metadata and renders the compact stats table', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setImageStats({
      hasActiveImage: true,
      isLoading: false,
      stats: {
        width: 5,
        height: 4,
        pixelCount: 20,
        channels: [
          createStatsChannel('R', 0.1, 0.25, 0.5, 18, 1, 0, 1),
          createStatsChannel('G', null, null, null, 0, 20, 0, 0)
        ]
      }
    });

    const panelOrder = Array.from(document.querySelectorAll('.readout-block')).map((section) => section.id);
    expect(panelOrder.indexOf('roi-panel')).toBeLessThan(panelOrder.indexOf('image-stats-panel'));
    expect(panelOrder.indexOf('viewer-state-panel')).toBeGreaterThan(panelOrder.indexOf('roi-panel'));
    expect(panelOrder.indexOf('viewer-state-panel')).toBeLessThan(panelOrder.indexOf('image-stats-panel'));
    expect(panelOrder.indexOf('image-stats-panel')).toBeLessThan(panelOrder.indexOf('metadata-panel'));
    expect((document.getElementById('image-stats-empty-state') as HTMLElement).classList.contains('hidden')).toBe(true);
    expect((document.getElementById('image-stats-loading-state') as HTMLElement).classList.contains('hidden')).toBe(true);

    const rows = Array.from(document.querySelectorAll('#image-stats-table .image-stats-row')).map((row) =>
      Array.from(row.children).map((cell) => cell.textContent)
    );
    expect(rows).toEqual([
      ['Channel', 'Min', 'Mean', 'Max', 'Finite', 'NaN', '-Inf', '+Inf', 'Invalid %'],
      ['R', '0.100', '0.250', '0.500', '18', '1', '0', '1', '10%'],
      ['G', 'n/a', 'n/a', 'n/a', '0', '20', '0', '0', '100%']
    ]);
  });

  it('shows loading state and updates while collapsed', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const imageStatsToggle = document.getElementById('image-stats-toggle') as HTMLButtonElement;
    const imageStatsContent = document.getElementById('image-stats-content') as HTMLDivElement;

    ui.setImageStats({
      hasActiveImage: true,
      isLoading: true,
      stats: null
    });
    expect((document.getElementById('image-stats-loading-state') as HTMLElement).classList.contains('hidden')).toBe(false);
    expect((document.getElementById('image-stats-table') as HTMLElement).classList.contains('hidden')).toBe(true);

    imageStatsToggle.click();
    expect(imageStatsContent.hidden).toBe(true);

    ui.setImageStats({
      hasActiveImage: true,
      isLoading: false,
      stats: {
        width: 1,
        height: 1,
        pixelCount: 1,
        channels: [createStatsChannel('Mono', 1, 1, 1, 1)]
      }
    });

    expect(
      Array.from(document.querySelectorAll('#image-stats-table .image-stats-row')).map((row) =>
        Array.from(row.children).map((cell) => cell.textContent)
      )
    ).toEqual([
      ['Channel', 'Min', 'Mean', 'Max', 'Finite', 'NaN', '-Inf', '+Inf', 'Invalid %'],
      ['Mono', '1.00', '1.00', '1.00', '1', '0', '0', '0', '0%']
    ]);
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
    window.localStorage.setItem(THEME_STORAGE_KEY, SPECTRUM_LATTICE_THEME_ID);
    window.localStorage.setItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY, SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM);

    const onResetSettings = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onResetSettings }));
    ui.setStokesDefaultSettingsOptions([
      { id: '0', label: 'Viridis' },
      { id: '1', label: 'HSV' },
      { id: '2', label: 'Black-Red' },
      { id: '3', label: 'RdBu' },
      { id: '4', label: 'Yellow-Black-Blue' },
      { id: '5', label: 'Yellow-Cyan-Yellow' }
    ], {
      ...createDefaultStokesColormapDefaultSettings(),
      aolp: {
        ...createDefaultStokesColormapDefaultSettings().aolp,
        colormapLabel: 'Viridis'
      }
    });

    const resetSettingsButton = document.getElementById('reset-settings-button') as HTMLButtonElement;
    const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
    const spectrumMotionSelect = document.getElementById('spectrum-lattice-motion-select') as HTMLSelectElement;
    const autoExposurePercentileInput = document.getElementById(
      'auto-exposure-percentile-input'
    ) as HTMLInputElement;
    const stokesAolpSelect = document.getElementById('stokes-default-aolp-colormap-select') as HTMLSelectElement;
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
    expect(themeSelect.value).toBe(SPECTRUM_LATTICE_THEME_ID);
    expect(spectrumMotionSelect.value).toBe(SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM);
    expect(stokesAolpSelect.value).toBe('0');
    autoExposurePercentileInput.value = '97.5';
    autoExposurePercentileInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(window.localStorage.getItem(AUTO_EXPOSURE_PERCENTILE_STORAGE_KEY)).toBe('97.5');

    resetSettingsButton.click();

    expect(onResetSettings).toHaveBeenCalledTimes(1);
    expect(themeSelect.value).toBe('default');
    expect(spectrumMotionSelect.value).toBe(SPECTRUM_LATTICE_MOTION_ANIMATE);
    expect(autoExposurePercentileInput.value).toBe('99.5');
    expect(stokesAolpSelect.value).toBe('1');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(AUTO_EXPOSURE_PERCENTILE_STORAGE_KEY)).toBeNull();
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
  it('renders file menu items with separators between open, export, and reload groups', () => {
    installUiFixture();

    const fileMenu = document.getElementById('file-menu') as HTMLElement;
    const labels = Array.from(fileMenu.querySelectorAll('.app-menu-item')).map((item) => item.textContent?.trim());
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

    const children = Array.from(fileMenu.children).map((element) =>
      element.classList.contains('app-menu-separator') ? 'separator' : element.textContent?.trim()
    );
    expect(children).toEqual([
      'Open...',
      'Open Folder...',
      'separator',
      'Export...',
      'Export Screenshot...',
      'Export Batch...',
      'Export Colormap...',
      'separator',
      'Reload All',
      'Close All'
    ]);

    const separators = Array.from(fileMenu.querySelectorAll('.app-menu-separator'));
    expect(separators).toHaveLength(2);
    expect(separators.map((separator) => separator.getAttribute('role'))).toEqual(['separator', 'separator']);
    expect(separators.map((separator) => separator.getAttribute('aria-orientation'))).toEqual(['horizontal', 'horizontal']);
    expect(fileMenu.querySelectorAll('.app-menu-separator[role="menuitem"]')).toHaveLength(0);
  });

  it('renders the top menu tabs in file-view-window-gallery order without Settings in the menu nav', () => {
    installUiFixture();

    const menuNav = document.querySelector('.app-menu-nav') as HTMLElement;
    const labels = Array.from(menuNav.querySelectorAll('.app-menu-tab')).map((item) => item.textContent?.trim());
    const navButtonLabels = Array.from(menuNav.querySelectorAll('button')).map((item) => item.textContent?.trim());

    expect(labels).toEqual(['File', 'View', 'Window', 'Gallery']);
    expect(navButtonLabels).not.toContain('Settings');
  });

  it('renders top bar icon actions in the expected order', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());

    const actions = document.querySelector('.app-menu-actions') as HTMLElement;
    const autoFitButton = document.getElementById('app-auto-fit-image-button') as HTMLButtonElement;
    const autoExposureButton = document.getElementById('app-auto-exposure-button') as HTMLButtonElement;
    const screenshotButton = document.getElementById('app-screenshot-button') as HTMLButtonElement;
    const fullscreenButton = document.getElementById('app-fullscreen-button') as HTMLButtonElement;
    const settingsButton = document.getElementById('settings-dialog-button') as HTMLButtonElement;

    expect(screenshotButton.closest('#app-menu-bar')).not.toBeNull();
    expect(settingsButton.closest('#app-menu-bar')).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(Array.from(actions.children).map((child) => child.id)).toEqual([
      'app-auto-fit-image-button',
      'app-auto-exposure-button',
      'app-screenshot-button',
      'app-fullscreen-button',
      'settings-dialog-button'
    ]);
    expect(autoExposureButton.previousElementSibling).toBe(autoFitButton);
    expect(screenshotButton.previousElementSibling).toBe(autoExposureButton);
    expect(fullscreenButton.previousElementSibling).toBe(screenshotButton);
    expect(settingsButton.previousElementSibling).toBe(fullscreenButton);
    expect(autoFitButton.getAttribute('aria-label')).toBe('Auto fit selected images');
    expect(autoFitButton.dataset.tooltip).toBe('Auto fit selected images');
    expect(autoFitButton.title).toBe('Auto fit selected images');
    expect(autoExposureButton.getAttribute('aria-label')).toBe('Auto exposure');
    expect(autoExposureButton.getAttribute('aria-pressed')).toBe('false');
    expect(autoExposureButton.dataset.tooltip).toBe('Auto exposure');
    expect(autoExposureButton.title).toBe('Auto exposure');
    expect(screenshotButton.getAttribute('aria-label')).toBe('Export Screenshot...');
    expect(screenshotButton.dataset.tooltip).toBe('Export screenshot');
    expect(screenshotButton.title).toBe('Export Screenshot...');
    expect(screenshotButton.querySelectorAll('.app-menu-icon')).toHaveLength(1);
    expect(settingsButton.getAttribute('aria-label')).toBe('Settings');
    expect(settingsButton.getAttribute('aria-haspopup')).toBe('dialog');
    expect(settingsButton.getAttribute('aria-expanded')).toBe('false');
    expect(settingsButton.getAttribute('aria-controls')).toBe('settings-dialog');
    expect(settingsButton.dataset.tooltip).toBe('Settings');
    expect(settingsButton.title).toBe('Settings');
  });

  it('shows short help for top bar icon buttons on hover and focus', () => {
    vi.useFakeTimers();
    installUiFixture();
    installFullscreenApiMock();

    new ViewerUi(createUiCallbacks());

    const screenshotButton = document.getElementById('app-screenshot-button') as HTMLButtonElement;
    const fullscreenButton = document.getElementById('app-fullscreen-button') as HTMLButtonElement;
    const tooltip = document.getElementById('app-icon-tooltip') as HTMLElement;

    screenshotButton.disabled = false;
    screenshotButton.dispatchEvent(new Event('pointerenter'));
    expect(tooltip.hidden).toBe(true);

    vi.advanceTimersByTime(350);
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toBe('Export screenshot');
    expect(screenshotButton.getAttribute('aria-describedby')).toBe('app-icon-tooltip');

    screenshotButton.dispatchEvent(new Event('pointerleave'));
    expect(tooltip.hidden).toBe(true);
    expect(screenshotButton.hasAttribute('aria-describedby')).toBe(false);

    fullscreenButton.focus();
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toBe('Enter fullscreen');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tooltip.hidden).toBe(true);
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
    expect(button.dataset.tooltip).toBe('Enter fullscreen');
    expect(button.title).toBe('Enter app fullscreen');
    expect(button.querySelectorAll('.app-fullscreen-icon')).toHaveLength(1);
    expect(button.querySelector('.app-fullscreen-icon--enter')).not.toBeNull();
  });

  it('exposes short help when app fullscreen is unavailable', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());

    const button = document.getElementById('app-fullscreen-button') as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('App fullscreen unavailable');
    expect(button.dataset.tooltip).toBe('Fullscreen unavailable');
    expect(button.title).toBe('App fullscreen unavailable');
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
    expect(button.dataset.tooltip).toBe('Exit fullscreen');
    expect(button.title).toBe('Exit app fullscreen');
    expect(button.querySelectorAll('.app-fullscreen-icon')).toHaveLength(1);
    expect(button.querySelector('.app-fullscreen-icon--enter')).not.toBeNull();
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

  it('renders the Window menu items in normal-full-screen-preview order', () => {
    installUiFixture();

    const labels = Array.from(document.querySelectorAll('#window-menu .app-menu-item')).map((item) => item.textContent?.trim());
    expect(labels).toEqual(['Normal', 'Full Screen Preview']);
  });

  it('renders Reset Settings in the settings dialog', () => {
    installUiFixture();

    const settingsDialog = document.getElementById('settings-dialog') as HTMLElement;
    const resetSettingsButton = document.getElementById('reset-settings-button') as HTMLButtonElement;

    expect(settingsDialog.getAttribute('role')).toBe('dialog');
    expect(settingsDialog.getAttribute('aria-modal')).toBe('true');
    expect(settingsDialog.getAttribute('aria-labelledby')).toBe('settings-dialog-title');
    expect(resetSettingsButton).not.toBeNull();
    expect(resetSettingsButton.closest('#settings-dialog')).toBe(settingsDialog);
    expect(resetSettingsButton.textContent?.trim()).toBe('Reset Settings');
    expect(resetSettingsButton.getAttribute('role')).toBeNull();
    expect(resetSettingsButton.type).toBe('button');
  });

  it('renders the theme and Stokes defaults table before the exposure and memory settings', () => {
    installUiFixture();
    new ViewerUi(createUiCallbacks());

    const labels = Array.from(document.querySelectorAll('#settings-dialog .app-menu-setting-label'))
      .map((item) => item.textContent?.trim());
    const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
    const spectrumMotionSelect = document.getElementById('spectrum-lattice-motion-select') as HTMLSelectElement;
    const autoExposurePercentileInput = document.getElementById(
      'auto-exposure-percentile-input'
    ) as HTMLInputElement;

    expect(labels).toEqual([
      'Theme',
      'Spectrum lattice motion',
      'Stokes Defaults',
      'Auto Exposure Percentile',
      'Memory Budget'
    ]);
    expect(autoExposurePercentileInput.value).toBe('99.5');
    expect(autoExposurePercentileInput.min).toBe('1');
    expect(autoExposurePercentileInput.max).toBe('100');
    expect(autoExposurePercentileInput.step).toBe('0.1');
    expect(Array.from(document.querySelectorAll('#stokes-default-settings-table tbody th')).map((cell) => cell.textContent?.trim())).toEqual([
      'AoLP',
      'Degree',
      'CoP',
      'ToP',
      'Normalized'
    ]);
    expect(Array.from(themeSelect.options).map((option) => option.textContent)).toEqual([
      'Default',
      'Spectrum lattice'
    ]);
    expect(Array.from(themeSelect.options).map((option) => option.value)).toEqual([
      'default',
      SPECTRUM_LATTICE_THEME_ID
    ]);
    expect(Array.from(spectrumMotionSelect.options).map((option) => option.textContent)).toEqual([
      'Animate',
      'Follow system'
    ]);
    expect(Array.from(spectrumMotionSelect.options).map((option) => option.value)).toEqual([
      SPECTRUM_LATTICE_MOTION_ANIMATE,
      SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM
    ]);
  });

  it('renders and dispatches Stokes default table settings from Settings', () => {
    installUiFixture();

    const onStokesDefaultSettingChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onStokesDefaultSettingChange }));
    const defaults = createDefaultStokesColormapDefaultSettings();
    const aolpSelect = document.getElementById('stokes-default-aolp-colormap-select') as HTMLSelectElement;
    const degreeSelect = document.getElementById('stokes-default-degree-colormap-select') as HTMLSelectElement;
    const degreeVminInput = document.getElementById('stokes-default-degree-vmin-input') as HTMLInputElement;
    const degreeVmaxInput = document.getElementById('stokes-default-degree-vmax-input') as HTMLInputElement;
    const normalizedZeroCenterCheckbox = document.getElementById(
      'stokes-default-normalized-zero-center-checkbox'
    ) as HTMLInputElement;
    const aolpModulationCheckbox = document.getElementById(
      'stokes-default-aolp-modulation-checkbox'
    ) as HTMLInputElement;
    const aolpModeSelect = document.getElementById('stokes-default-aolp-modulation-mode-select') as HTMLSelectElement;

    ui.setStokesDefaultSettingsOptions([
      { id: '0', label: 'Viridis' },
      { id: '1', label: 'HSV' },
      { id: '2', label: 'Black-Red' },
      { id: '3', label: 'RdBu' }
    ], {
      ...defaults,
      aolp: {
        ...defaults.aolp,
        colormapLabel: 'HSV'
      },
      degree: {
        ...defaults.degree,
        colormapLabel: 'RdBu',
        range: { min: 0.2, max: 0.8 }
      }
    });

    expect(Array.from(aolpSelect.options).map((option) => option.textContent)).toEqual([
      'Viridis',
      'HSV',
      'Black-Red',
      'RdBu'
    ]);
    expect(aolpSelect.value).toBe('1');
    expect(degreeSelect.value).toBe('3');
    expect(degreeVminInput.value).toBe('0.2');
    expect(degreeVmaxInput.value).toBe('0.8');
    expect(normalizedZeroCenterCheckbox.checked).toBe(true);
    expect(aolpModulationCheckbox.checked).toBe(false);
    expect(aolpModeSelect.value).toBe('value');

    degreeSelect.value = '2';
    degreeSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onStokesDefaultSettingChange).toHaveBeenLastCalledWith('degree', {
      ...defaults.degree,
      colormapLabel: 'Black-Red',
      range: { min: 0.2, max: 0.8 }
    });

    onStokesDefaultSettingChange.mockClear();
    degreeVminInput.value = '2';
    degreeVmaxInput.value = '1';
    degreeVminInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onStokesDefaultSettingChange).not.toHaveBeenCalled();
    expect(degreeVminInput.getAttribute('aria-invalid')).toBe('true');
    expect(degreeVmaxInput.getAttribute('aria-invalid')).toBe('true');

    degreeVminInput.value = '0.1';
    degreeVmaxInput.value = '0.9';
    degreeVmaxInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onStokesDefaultSettingChange).toHaveBeenLastCalledWith('degree', {
      ...defaults.degree,
      colormapLabel: 'Black-Red',
      range: { min: 0.1, max: 0.9 }
    });
    expect(degreeVminInput.getAttribute('aria-invalid')).toBe('false');
    expect(degreeVmaxInput.getAttribute('aria-invalid')).toBe('false');

    normalizedZeroCenterCheckbox.checked = false;
    normalizedZeroCenterCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onStokesDefaultSettingChange).toHaveBeenLastCalledWith('normalized', {
      ...defaults.normalized,
      zeroCentered: false
    });

    aolpModulationCheckbox.checked = true;
    aolpModulationCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    aolpModeSelect.value = 'saturation';
    aolpModeSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onStokesDefaultSettingChange).toHaveBeenLastCalledWith('aolp', {
      ...defaults.aolp,
      colormapLabel: 'HSV',
      modulation: { enabled: true, aolpMode: 'saturation' }
    });
  });

  it('applies and persists the Spectrum lattice theme from Settings', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
    const appShell = document.getElementById('app') as HTMLElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;
    const viewer = document.getElementById('viewer-container') as HTMLElement;
    const canvas = document.getElementById('spectrum-lattice-canvas') as HTMLCanvasElement;

    expect(themeSelect.value).toBe('default');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    themeSelect.value = SPECTRUM_LATTICE_THEME_ID;
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(themeSelect.value).toBe(SPECTRUM_LATTICE_THEME_ID);
    expect(document.documentElement.dataset.theme).toBe(SPECTRUM_LATTICE_THEME_ID);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(SPECTRUM_LATTICE_THEME_ID);
    expect(canvas.parentElement).toBe(appShell);
    expect(appShell.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(mainLayout.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(viewer.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(canvas.classList.contains('hidden')).toBe(false);
    expect(canvas.classList.contains('spectrum-lattice-canvas--fallback')).toBe(true);
  });

  it('applies, persists, and reads the Spectrum lattice motion preference from Settings', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const spectrumMotionSelect = document.getElementById('spectrum-lattice-motion-select') as HTMLSelectElement;

    expect(spectrumMotionSelect.value).toBe(SPECTRUM_LATTICE_MOTION_ANIMATE);
    expect(window.localStorage.getItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY)).toBeNull();

    spectrumMotionSelect.value = SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM;
    spectrumMotionSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(spectrumMotionSelect.value).toBe(SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM);
    expect(window.localStorage.getItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY)).toBe(
      SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM
    );

    spectrumMotionSelect.value = SPECTRUM_LATTICE_MOTION_ANIMATE;
    spectrumMotionSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(spectrumMotionSelect.value).toBe(SPECTRUM_LATTICE_MOTION_ANIMATE);
    expect(window.localStorage.getItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY)).toBeNull();
  });

  it('reads the stored Spectrum lattice motion preference during UI initialization', () => {
    installUiFixture();
    window.localStorage.setItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY, SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM);

    new ViewerUi(createUiCallbacks());

    expect((document.getElementById('spectrum-lattice-motion-select') as HTMLSelectElement).value).toBe(
      SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM
    );
  });

  it('defines controller-driven viewer background blend layers for Spectrum lattice', () => {
    const viewerRule = readStyleRule('.viewer-container');
    const spectrumGridRule = readStyleRule('.viewer-container::before');
    const checkerRule = readStyleRule('.viewer-container::after', 1);
    const spectrumTokenRule = readStyleRule(":root[data-theme='spectrum-lattice']");
    const stylesheet = readStyleSheet();
    const indexMarkup = readIndexMarkup();
    const bootstrapIndex = indexMarkup.indexOf("openexr-viewer:theme:v1");
    const stylesheetIndex = indexMarkup.indexOf('<link rel="stylesheet" href="/src/style.css"');

    expect(viewerRule).toContain('background-image: none');
    expect(spectrumTokenRule).toContain('--viewer-background: transparent');
    expect(spectrumTokenRule).toContain('--viewer-checker-opacity: 0');
    expect(spectrumTokenRule).toContain('--viewer-grid-opacity: 1');
    expect(checkerRule).toContain('conic-gradient');
    expect(checkerRule).toContain('opacity: var(--viewer-checker-opacity)');
    expect(spectrumGridRule).toContain('linear-gradient');
    expect(spectrumGridRule).toContain('opacity: var(--viewer-grid-opacity)');
    expect(stylesheet).not.toContain('transition: opacity 3000ms ease-in-out');
    expect(bootstrapIndex).toBeGreaterThanOrEqual(0);
    expect(stylesheetIndex).toBeGreaterThan(bootstrapIndex);
  });

  it('reads the stored theme during UI initialization', () => {
    installUiFixture();
    window.localStorage.setItem(THEME_STORAGE_KEY, SPECTRUM_LATTICE_THEME_ID);

    new ViewerUi(createUiCallbacks());

    expect((document.getElementById('theme-select') as HTMLSelectElement).value).toBe(SPECTRUM_LATTICE_THEME_ID);
    expect(document.documentElement.dataset.theme).toBe(SPECTRUM_LATTICE_THEME_ID);
    expect((document.getElementById('spectrum-lattice-canvas') as HTMLElement).classList.contains('hidden')).toBe(false);
  });

  it('freezes the Spectrum lattice canvas while an image is active', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
    const appShell = document.getElementById('app') as HTMLElement;
    const mainLayout = document.getElementById('main-layout') as HTMLElement;
    const viewer = document.getElementById('viewer-container') as HTMLElement;
    const canvas = document.getElementById('spectrum-lattice-canvas') as HTMLElement;

    themeSelect.value = SPECTRUM_LATTICE_THEME_ID;
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(appShell.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(mainLayout.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(viewer.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(canvas.classList.contains('hidden')).toBe(false);

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    expect(appShell.classList.contains('is-spectrum-lattice-idle')).toBe(false);
    expect(mainLayout.classList.contains('is-spectrum-lattice-idle')).toBe(false);
    expect(viewer.classList.contains('is-spectrum-lattice-idle')).toBe(false);
    expect(canvas.classList.contains('hidden')).toBe(false);
    expect(canvas.classList.contains('spectrum-lattice-canvas--fallback')).toBe(true);

    ui.setOpenedImageOptions([], null);
    expect(appShell.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(mainLayout.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(viewer.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(canvas.classList.contains('hidden')).toBe(false);

    themeSelect.value = 'default';
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(appShell.classList.contains('is-spectrum-lattice-idle')).toBe(false);
    expect(mainLayout.classList.contains('is-spectrum-lattice-idle')).toBe(false);
    expect(viewer.classList.contains('is-spectrum-lattice-idle')).toBe(false);
    expect(canvas.classList.contains('hidden')).toBe(true);
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

  it('focuses the settings dialog controls in settings order and restores focus on Escape', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());
    const settingsButton = document.getElementById('settings-dialog-button') as HTMLButtonElement;
    const settingsBackdrop = document.getElementById('settings-dialog-backdrop') as HTMLElement;
    const settingsDialog = document.getElementById('settings-dialog') as HTMLElement;
    const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
    const spectrumMotionSelect = document.getElementById('spectrum-lattice-motion-select') as HTMLSelectElement;
    const aolpSelect = document.getElementById('stokes-default-aolp-colormap-select') as HTMLSelectElement;
    const aolpVmin = document.getElementById('stokes-default-aolp-vmin-input') as HTMLInputElement;
    const aolpVmax = document.getElementById('stokes-default-aolp-vmax-input') as HTMLInputElement;
    const aolpZeroCenter = document.getElementById('stokes-default-aolp-zero-center-checkbox') as HTMLInputElement;
    const aolpModulation = document.getElementById('stokes-default-aolp-modulation-checkbox') as HTMLInputElement;
    const aolpMode = document.getElementById('stokes-default-aolp-modulation-mode-select') as HTMLSelectElement;
    const degreeSelect = document.getElementById('stokes-default-degree-colormap-select') as HTMLSelectElement;
    const degreeVmin = document.getElementById('stokes-default-degree-vmin-input') as HTMLInputElement;
    const degreeVmax = document.getElementById('stokes-default-degree-vmax-input') as HTMLInputElement;
    const degreeZeroCenter = document.getElementById('stokes-default-degree-zero-center-checkbox') as HTMLInputElement;
    const copSelect = document.getElementById('stokes-default-cop-colormap-select') as HTMLSelectElement;
    const copVmin = document.getElementById('stokes-default-cop-vmin-input') as HTMLInputElement;
    const copVmax = document.getElementById('stokes-default-cop-vmax-input') as HTMLInputElement;
    const copZeroCenter = document.getElementById('stokes-default-cop-zero-center-checkbox') as HTMLInputElement;
    const copModulation = document.getElementById('stokes-default-cop-modulation-checkbox') as HTMLInputElement;
    const topSelect = document.getElementById('stokes-default-top-colormap-select') as HTMLSelectElement;
    const topVmin = document.getElementById('stokes-default-top-vmin-input') as HTMLInputElement;
    const topVmax = document.getElementById('stokes-default-top-vmax-input') as HTMLInputElement;
    const topZeroCenter = document.getElementById('stokes-default-top-zero-center-checkbox') as HTMLInputElement;
    const topModulation = document.getElementById('stokes-default-top-modulation-checkbox') as HTMLInputElement;
    const normalizedSelect = document.getElementById('stokes-default-normalized-colormap-select') as HTMLSelectElement;
    const normalizedVmin = document.getElementById('stokes-default-normalized-vmin-input') as HTMLInputElement;
    const normalizedVmax = document.getElementById('stokes-default-normalized-vmax-input') as HTMLInputElement;
    const normalizedZeroCenter = document.getElementById(
      'stokes-default-normalized-zero-center-checkbox'
    ) as HTMLInputElement;
    const autoExposurePercentileInput = document.getElementById(
      'auto-exposure-percentile-input'
    ) as HTMLInputElement;
    const budgetInput = document.getElementById('display-cache-budget-input') as HTMLSelectElement;
    const resetSettingsButton = document.getElementById('reset-settings-button') as HTMLButtonElement;
    const closeButton = document.getElementById('settings-dialog-close-button') as HTMLButtonElement;
    const focusableSettingsControls = Array.from(
      settingsDialog.querySelectorAll<HTMLElement>('button, input, select, textarea')
    );

    expect(focusableSettingsControls).toEqual([
      themeSelect,
      spectrumMotionSelect,
      aolpSelect,
      aolpVmin,
      aolpVmax,
      aolpZeroCenter,
      aolpModulation,
      aolpMode,
      degreeSelect,
      degreeVmin,
      degreeVmax,
      degreeZeroCenter,
      copSelect,
      copVmin,
      copVmax,
      copZeroCenter,
      copModulation,
      topSelect,
      topVmin,
      topVmax,
      topZeroCenter,
      topModulation,
      normalizedSelect,
      normalizedVmin,
      normalizedVmax,
      normalizedZeroCenter,
      autoExposurePercentileInput,
      budgetInput,
      resetSettingsButton,
      closeButton
    ]);

    settingsButton.focus();
    settingsButton.click();

    expect(settingsBackdrop.classList.contains('hidden')).toBe(false);
    expect(settingsButton.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(themeSelect);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(settingsBackdrop.classList.contains('hidden')).toBe(true);
    expect(settingsButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(settingsButton);
  });

  it('keeps export disabled until an image is active and blocks it during rgb-view loading', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const exportButton = document.getElementById('export-image-button') as HTMLButtonElement;
    const exportScreenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const appScreenshotButton = document.getElementById('app-screenshot-button') as HTMLButtonElement;

    expect(exportButton.disabled).toBe(true);
    expect(exportScreenshotButton.disabled).toBe(true);
    expect(appScreenshotButton.disabled).toBe(true);
    expect(appScreenshotButton.classList.contains('is-display-busy-disabled')).toBe(false);
    expect(appScreenshotButton.hasAttribute('aria-busy')).toBe(false);

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });
    expect(exportButton.disabled).toBe(false);
    expect(exportScreenshotButton.disabled).toBe(false);
    expect(appScreenshotButton.disabled).toBe(false);
    expect(appScreenshotButton.classList.contains('is-display-busy-disabled')).toBe(false);
    expect(appScreenshotButton.hasAttribute('aria-busy')).toBe(false);

    ui.setRgbViewLoading(true);
    expect(exportButton.disabled).toBe(true);
    expect(exportScreenshotButton.disabled).toBe(true);
    expect(appScreenshotButton.disabled).toBe(true);
    expect(appScreenshotButton.classList.contains('is-display-busy-disabled')).toBe(true);
    expect(appScreenshotButton.getAttribute('aria-busy')).toBe('true');

    ui.setRgbViewLoading(false);
    expect(appScreenshotButton.disabled).toBe(false);
    expect(appScreenshotButton.classList.contains('is-display-busy-disabled')).toBe(false);
    expect(appScreenshotButton.hasAttribute('aria-busy')).toBe(false);

    ui.setExportTarget(null);
    expect(appScreenshotButton.disabled).toBe(true);
    expect(appScreenshotButton.classList.contains('is-display-busy-disabled')).toBe(false);
    expect(appScreenshotButton.hasAttribute('aria-busy')).toBe(false);
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

  it('opens the export dialog with the Ctrl+S shortcut and prevents browser save', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect((document.getElementById('export-dialog-backdrop') as HTMLDivElement).classList.contains('hidden')).toBe(false);
    expect((document.getElementById('export-filename-input') as HTMLInputElement).value).toBe('image.png');
  });

  it('opens the export dialog with the Cmd+S shortcut', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'S',
      metaKey: true,
      bubbles: true,
      cancelable: true
    }));

    expect((document.getElementById('export-dialog-backdrop') as HTMLDivElement).classList.contains('hidden')).toBe(false);
  });

  it('opens the export dialog with the save shortcut while focus is in an editable control', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect((document.getElementById('export-dialog-backdrop') as HTMLDivElement).classList.contains('hidden')).toBe(false);
  });

  it('prevents browser save but does not open export when export is disabled', () => {
    installUiFixture();

    new ViewerUi(createUiCallbacks());

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect((document.getElementById('export-dialog-backdrop') as HTMLDivElement).classList.contains('hidden')).toBe(true);
  });

  it('prevents browser save but does not open export while a modal dialog is open', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const settingsBackdrop = document.getElementById('settings-dialog-backdrop') as HTMLDivElement;
    (document.getElementById('settings-dialog-button') as HTMLButtonElement).click();
    expect(settingsBackdrop.classList.contains('hidden')).toBe(false);

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(settingsBackdrop.classList.contains('hidden')).toBe(false);
    expect((document.getElementById('export-dialog-backdrop') as HTMLDivElement).classList.contains('hidden')).toBe(true);
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

  it('fits screenshot selection to the current visible image bounds', () => {
    installUiFixture();

    const getScreenshotFitRect = vi.fn(() => ({ x: 20, y: 10, width: 150, height: 72 }));
    const ui = new ViewerUi(createUiCallbacks({ getScreenshotFitRect }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 120, height: 120, width: 220 });

    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const fitButton = document.getElementById('screenshot-selection-fit-button') as HTMLButtonElement;
    const overlay = document.getElementById('screenshot-selection-overlay') as HTMLDivElement;
    const selectionBox = document.getElementById('screenshot-selection-box') as HTMLDivElement;

    screenshotButton.click();
    ui.setScreenshotSelectionRect({ x: 30, y: 20, width: 80, height: 50 });
    fitButton.click();

    expect(getScreenshotFitRect).toHaveBeenCalledTimes(1);
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(selectionBox.style.left).toBe('20px');
    expect(selectionBox.style.top).toBe('10px');
    expect(selectionBox.style.width).toBe('150px');
    expect(selectionBox.style.height).toBe('72px');

    ui.cancelScreenshotSelection();
  });

  it('fits screenshot selection to clipped visible image bounds', () => {
    installUiFixture();

    const getScreenshotFitRect = vi.fn(() => ({ x: 0, y: 18, width: 96, height: 82 }));
    const ui = new ViewerUi(createUiCallbacks({ getScreenshotFitRect }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 100, height: 100, width: 160 });

    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const fitButton = document.getElementById('screenshot-selection-fit-button') as HTMLButtonElement;
    const selectionBox = document.getElementById('screenshot-selection-box') as HTMLDivElement;

    screenshotButton.click();
    fitButton.click();

    expect(selectionBox.style.left).toBe('0px');
    expect(selectionBox.style.top).toBe('18px');
    expect(selectionBox.style.width).toBe('96px');
    expect(selectionBox.style.height).toBe('82px');

    ui.cancelScreenshotSelection();
  });

  it('leaves screenshot selection unchanged when fit bounds are unavailable', () => {
    installUiFixture();

    const getScreenshotFitRect = vi.fn(() => null);
    const ui = new ViewerUi(createUiCallbacks({ getScreenshotFitRect }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 100, height: 100, width: 200 });

    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const fitButton = document.getElementById('screenshot-selection-fit-button') as HTMLButtonElement;
    const selectionBox = document.getElementById('screenshot-selection-box') as HTMLDivElement;

    screenshotButton.click();
    ui.setScreenshotSelectionRect({ x: 40, y: 20, width: 120, height: 60 });
    fitButton.click();

    expect(getScreenshotFitRect).toHaveBeenCalledTimes(1);
    expect(selectionBox.style.left).toBe('40px');
    expect(selectionBox.style.top).toBe('20px');
    expect(selectionBox.style.width).toBe('120px');
    expect(selectionBox.style.height).toBe('60px');

    ui.cancelScreenshotSelection();
  });

  it('starts screenshot selection from the top bar screenshot button', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 100, height: 100, width: 200 });

    const appScreenshotButton = document.getElementById('app-screenshot-button') as HTMLButtonElement;
    const overlay = document.getElementById('screenshot-selection-overlay') as HTMLDivElement;
    const selectionBox = document.getElementById('screenshot-selection-box') as HTMLDivElement;

    appScreenshotButton.click();

    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(selectionBox.classList.contains('hidden')).toBe(false);

    ui.cancelScreenshotSelection();
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

  it('shows snap guide lines while a screenshot selection is snapped', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 160, height: 160, width: 200 });

    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const verticalGuide = document.getElementById('screenshot-selection-guide-vertical') as HTMLDivElement;
    const horizontalGuide = document.getElementById('screenshot-selection-guide-horizontal') as HTMLDivElement;

    screenshotButton.click();

    expect(verticalGuide.classList.contains('hidden')).toBe(true);
    expect(horizontalGuide.classList.contains('hidden')).toBe(true);

    ui.setScreenshotSelectionRect({ x: 40, y: 24, width: 120, height: 60 }, {
      snapGuide: { x: 100, y: 80 }
    });

    expect(verticalGuide.classList.contains('hidden')).toBe(false);
    expect(verticalGuide.style.left).toBe('100px');
    expect(verticalGuide.style.top).toBe('0px');
    expect(verticalGuide.style.width).toBe('1px');
    expect(verticalGuide.style.height).toBe('160px');
    expect(horizontalGuide.classList.contains('hidden')).toBe(false);
    expect(horizontalGuide.style.left).toBe('0px');
    expect(horizontalGuide.style.top).toBe('80px');
    expect(horizontalGuide.style.width).toBe('200px');
    expect(horizontalGuide.style.height).toBe('1px');

    ui.setScreenshotSelectionSnapGuide({ x: null, y: null });

    expect(verticalGuide.classList.contains('hidden')).toBe(true);
    expect(horizontalGuide.classList.contains('hidden')).toBe(true);

    ui.setScreenshotSelectionRect({ x: 40, y: 24, width: 120, height: 60 }, {
      snapGuide: { x: 100, y: null }
    });

    expect(verticalGuide.classList.contains('hidden')).toBe(false);
    expect(horizontalGuide.classList.contains('hidden')).toBe(true);

    ui.cancelScreenshotSelection();

    expect(verticalGuide.classList.contains('hidden')).toBe(true);
    expect(horizontalGuide.classList.contains('hidden')).toBe(true);
  });

  it('opens screenshot batch export from the selection overlay and submits cropped batch entries', async () => {
    installUiFixture();

    const onExportImageBatch = vi.fn<(_: {
      archiveFilename: string;
      entries: Array<{
        mode?: 'image' | 'screenshot';
        rect?: { x: number; y: number; width: number; height: number };
        sourceViewport?: { width: number; height: number };
        outputWidth?: number;
        outputHeight?: number;
        outputFilename: string;
      }>;
      format: 'png-zip';
    }, _signal: AbortSignal) => Promise<void>>(async () => undefined);
    const onResolveExportImageBatchPreview = vi.fn<(_request: {
      sessionId: string;
      activeLayer: number;
      displaySelection: unknown;
      channelLabel: string;
      mode?: 'image' | 'screenshot';
      outputWidth?: number;
      outputHeight?: number;
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

    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    mockDomRect(viewerContainer, { top: 0, bottom: 100, height: 100, width: 200 });

    const screenshotButton = document.getElementById('export-screenshot-button') as HTMLButtonElement;
    const overlay = document.getElementById('screenshot-selection-overlay') as HTMLDivElement;
    const overlayBatchButton = document.getElementById('screenshot-selection-export-batch-button') as HTMLButtonElement;
    const batchDialog = document.getElementById('export-batch-dialog-backdrop') as HTMLDivElement;
    const title = document.getElementById('export-batch-dialog-title') as HTMLElement;
    const sizeField = document.getElementById('export-batch-size-field') as HTMLDivElement;
    const widthInput = document.getElementById('export-batch-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('export-batch-height-input') as HTMLInputElement;
    const archiveInput = document.getElementById('export-batch-archive-filename-input') as HTMLInputElement;
    const selectAllButton = document.getElementById('export-batch-select-all-button') as HTMLButtonElement;
    const submitButton = document.getElementById('export-batch-dialog-submit-button') as HTMLButtonElement;

    screenshotButton.click();
    ui.setScreenshotSelectionRect({ x: 30, y: 15, width: 140, height: 70 });
    expect(overlayBatchButton.disabled).toBe(false);

    overlayBatchButton.click();

    expect(batchDialog.classList.contains('hidden')).toBe(false);
    expect(title.textContent).toBe('Export Screenshot Batch');
    expect(archiveInput.value).toBe('openexr-screenshot-export.zip');
    expect(sizeField.classList.contains('hidden')).toBe(false);
    expect(widthInput.value).toBe('140');
    expect(heightInput.value).toBe('70');

    widthInput.value = '280';
    widthInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(heightInput.value).toBe('140');

    await flushBatchPreviewQueue();

    expect(onResolveExportImageBatchPreview).toHaveBeenCalledTimes(2);
    expect(onResolveExportImageBatchPreview.mock.calls.map(([request]) => ({
      sessionId: request.sessionId,
      channelLabel: request.channelLabel,
      mode: request.mode,
      outputWidth: request.outputWidth,
      outputHeight: request.outputHeight
    }))).toEqual([
      {
        sessionId: 'session-1',
        channelLabel: 'RGB',
        mode: 'screenshot',
        outputWidth: 280,
        outputHeight: 140
      },
      {
        sessionId: 'session-2',
        channelLabel: 'Z',
        mode: 'screenshot',
        outputWidth: 280,
        outputHeight: 140
      }
    ]);

    expect(getCheckedExportBatchCellColumnKeys()).toEqual(['RGB']);
    selectAllButton.click();
    expect(getCheckedExportBatchCellColumnKeys()).toEqual(['RGB', 'Z']);

    submitButton.click();
    await flushMicrotasks();

    expect(onExportImageBatch).toHaveBeenCalledTimes(1);
    expect(onExportImageBatch.mock.calls[0]?.[0]).toMatchObject({
      archiveFilename: 'openexr-screenshot-export.zip',
      format: 'png-zip',
      entries: [
        {
          mode: 'screenshot',
          rect: { x: 30, y: 15, width: 140, height: 70 },
          sourceViewport: { width: 200, height: 100 },
          outputWidth: 280,
          outputHeight: 140,
          outputFilename: 'shots/beauty-screenshot.RGB.png'
        },
        {
          mode: 'screenshot',
          rect: { x: 30, y: 15, width: 140, height: 70 },
          sourceViewport: { width: 200, height: 100 },
          outputWidth: 280,
          outputHeight: 140,
          outputFilename: 'shots/aovs/depth-screenshot.Z.png'
        }
      ]
    });
    expect(batchDialog.classList.contains('hidden')).toBe(true);
    expect(overlay.classList.contains('hidden')).toBe(true);
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

  it('keeps the screenshot export dialog open when a size input drag ends on the backdrop', async () => {
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
    const dialogCancelButton = document.getElementById('export-dialog-cancel-button') as HTMLButtonElement;
    const widthInput = document.getElementById('export-width-input') as HTMLInputElement;

    screenshotButton.click();
    expect(overlay.classList.contains('hidden')).toBe(false);
    exportButton.click();
    await flushMicrotasks();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);

    widthInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    dialogBackdrop.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    dialogBackdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(overlay.classList.contains('hidden')).toBe(false);

    dialogCancelButton.click();
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
    const resetButton = document.getElementById('reset-view-button') as HTMLButtonElement;
    const overlay = document.getElementById('screenshot-selection-overlay') as HTMLDivElement;
    const overlayExportButton = document.getElementById('screenshot-selection-export-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-dialog-backdrop') as HTMLDivElement;

    screenshotButton.click();
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(appShell.classList.contains('is-screenshot-selecting')).toBe(true);

    openFileButton.click();
    resetButton.click();

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
    const selectAllButton = document.getElementById('export-batch-select-all-button') as HTMLButtonElement;
    const deselectAllButton = document.getElementById('export-batch-deselect-all-button') as HTMLButtonElement;
    const status = document.getElementById('export-batch-dialog-status') as HTMLElement;
    const submitButton = document.getElementById('export-batch-dialog-submit-button') as HTMLButtonElement;

    batchButton.click();

    expect(singleExportDialog.classList.contains('hidden')).toBe(true);
    expect(batchDialog.classList.contains('hidden')).toBe(false);
    expect(archiveInput.value).toBe('openexr-export.zip');
    expect(document.querySelectorAll('.export-batch-cell-disabled')).toHaveLength(1);
    expect(document.querySelectorAll('.export-batch-cell-swatches')).toHaveLength(0);
    expect(document.querySelectorAll('.export-batch-cell-preview')).toHaveLength(3);
    expect(getCheckedExportBatchCellColumnKeys()).toEqual(['RGB']);
    expect(selectAllButton.disabled).toBe(false);
    expect(deselectAllButton.disabled).toBe(false);

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

    selectAllButton.click();
    expect(getCheckedExportBatchCellColumnKeys()).toEqual(['RGB', 'Z', 'Z']);
    expect(selectAllButton.disabled).toBe(true);
    expect(deselectAllButton.disabled).toBe(false);

    deselectAllButton.click();
    expect(getCheckedExportBatchCellColumnKeys()).toEqual([]);
    expect(status.textContent).toBe('0 images selected.');
    expect(submitButton.disabled).toBe(true);
    expect(selectAllButton.disabled).toBe(false);
    expect(deselectAllButton.disabled).toBe(true);

    selectAllButton.click();

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
      'shots/beauty.Z.png',
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

  it('selects only visible split RGB batch columns after switching to split mode', async () => {
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
    const selectAllButton = document.getElementById('export-batch-select-all-button') as HTMLButtonElement;
    splitToggle.click();

    expect(splitToggle.getAttribute('aria-pressed')).toBe('true');
    expect(getExportBatchColumnLabels()).toEqual(['R', 'G', 'B', 'A']);
    expect(getCheckedExportBatchCellColumnKeys()).toEqual(['R']);

    selectAllButton.click();
    expect(getCheckedExportBatchCellColumnKeys()).toEqual(['R', 'G', 'B', 'A']);

    (document.getElementById('export-batch-dialog-submit-button') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(onExportImageBatch).toHaveBeenCalledTimes(1);
    expect(onExportImageBatch.mock.calls[0]?.[0].entries.map((entry) => entry.outputFilename)).toEqual([
      'beauty.R.png',
      'beauty.G.png',
      'beauty.B.png',
      'beauty.A.png'
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
    expect(buildExportBatchScreenshotOutputFilename('shots/a/beauty.exr', 'RGB', used)).toBe('shots/a/beauty-screenshot.RGB.png');
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
    const dataTransfer = createMockDataTransfer();
    firstRow.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));
    expect(document.querySelector('.opened-file-drag-image')).toBeInstanceOf(HTMLDivElement);

    ui.dispose();
    expect(document.querySelector('.opened-file-drag-image')).toBeNull();

    (document.getElementById('open-file-button') as HTMLButtonElement).click();
    window.dispatchEvent(createFileDropEvent('drop'));
    firstRow.dispatchEvent(createOpenedFileDragEvent('dragover', dataTransfer, { clientX: 20, clientY: 80 }));

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
    expect(document.getElementById('opened-files-reorder-hint')?.textContent).toBe(
      'Drag rows to reorder open files or drop a row on the image viewer to select it. Press Alt+Up/Down or Option+Up/Down to reorder open files.'
    );
    expect(openedFilesList.querySelector('.opened-file-grip')).toBeInstanceOf(HTMLSpanElement);
    expect(openedFilesList.querySelector('.opened-file-thumbnail')).toBeInstanceOf(HTMLImageElement);
    expect(firstRow.childElementCount).toBe(4);
    expect(firstRow.draggable).toBe(true);
    expect(actionLabels).toEqual(['Reload beauty.exr', 'Close beauty.exr']);
    expect(openedFilesList.querySelectorAll('button')).toHaveLength(2);
    expect(document.querySelector('[aria-label="Pin cache for beauty.exr"]')).toBeNull();

    ui.setLoading(true);

    expect((openedFilesList.querySelector('.opened-file-row') as HTMLDivElement).draggable).toBe(false);
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

  it('starts inline rename with Enter on a focused open-file row and commits with Enter in the input', () => {
    installUiFixture();

    const onOpenedImageDisplayNameChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageDisplayNameChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const row = document.querySelector('#opened-files-list .opened-file-row') as HTMLDivElement;
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const input = document.querySelector('#opened-files-list .opened-file-rename-input') as HTMLInputElement;
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('image.exr');
    expect(row.draggable).toBe(false);
    expect(input.draggable).toBe(false);

    input.value = '  Hero Plate.exr  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onOpenedImageDisplayNameChange).toHaveBeenCalledWith('session-1', 'Hero Plate.exr');
    expect(document.querySelector('#opened-files-list .opened-file-rename-input')).toBeNull();
  });

  it('starts inline rename with double-click on an open-file label and commits with Enter', () => {
    installUiFixture();

    const onOpenedImageDisplayNameChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageDisplayNameChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const label = document.querySelector('#opened-files-list .opened-file-label') as HTMLSpanElement;
    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));

    const input = document.querySelector('#opened-files-list .opened-file-rename-input') as HTMLInputElement;
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('image.exr');

    input.value = '  Hero Plate.exr  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onOpenedImageDisplayNameChange).toHaveBeenCalledWith('session-1', 'Hero Plate.exr');
    expect(document.querySelector('#opened-files-list .opened-file-rename-input')).toBeNull();
  });

  it('does not reselect the active open-file row before double-click rename', () => {
    installUiFixture();

    const onOpenedImageSelected = vi.fn();
    const onOpenedImageDisplayNameChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected, onOpenedImageDisplayNameChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const row = document.querySelector('#opened-files-list .opened-file-row') as HTMLDivElement;
    const label = row.querySelector('.opened-file-label') as HTMLSpanElement;
    row.click();

    expect(onOpenedImageSelected).not.toHaveBeenCalled();

    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));

    const input = document.querySelector('#opened-files-list .opened-file-rename-input') as HTMLInputElement;
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(input);

    input.value = '  Hero Plate.exr  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onOpenedImageDisplayNameChange).toHaveBeenCalledWith('session-1', 'Hero Plate.exr');
  });

  it('ignores double-click rename outside open-file labels', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const row = document.querySelector('#opened-files-list .opened-file-row') as HTMLDivElement;
    const grip = row.querySelector('.opened-file-grip') as HTMLElement;
    const thumbnail = row.querySelector('.file-row-icon, .opened-file-thumbnail') as HTMLElement;
    const reloadButton = row.querySelector('.opened-file-action-button--reload') as HTMLButtonElement;

    for (const target of [row, grip, thumbnail, reloadButton]) {
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
      expect(document.querySelector('#opened-files-list .opened-file-rename-input')).toBeNull();
    }
  });

  it('cancels inline rename with Escape and ignores blank or unchanged committed names', () => {
    installUiFixture();

    const onOpenedImageDisplayNameChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageDisplayNameChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const row = document.querySelector('#opened-files-list .opened-file-row') as HTMLDivElement;
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    let input = document.querySelector('#opened-files-list .opened-file-rename-input') as HTMLInputElement;
    input.value = 'Cancelled.exr';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input = document.querySelector('#opened-files-list .opened-file-rename-input') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input = document.querySelector('#opened-files-list .opened-file-rename-input') as HTMLInputElement;
    input.value = 'image.exr';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onOpenedImageDisplayNameChange).not.toHaveBeenCalled();
    expect(document.querySelector('#opened-files-list .opened-file-rename-input')).toBeNull();
  });

  it('commits inline rename on blur', () => {
    installUiFixture();

    const onOpenedImageDisplayNameChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageDisplayNameChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');

    const row = document.querySelector('#opened-files-list .opened-file-row') as HTMLDivElement;
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const input = document.querySelector('#opened-files-list .opened-file-rename-input') as HTMLInputElement;
    input.value = 'Blur Name.exr';
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(onOpenedImageDisplayNameChange).toHaveBeenCalledWith('session-1', 'Blur Name.exr');
    expect(document.querySelector('#opened-files-list .opened-file-rename-input')).toBeNull();
  });

  it('keeps rename input keyboard and mouse events from selecting or reordering rows', () => {
    installUiFixture();

    const onOpenedImageSelected = vi.fn();
    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected, onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' }
    ], 'session-1');

    const rows = mockOpenedFilesListGeometry();
    const firstRow = rows[0] as HTMLDivElement;
    firstRow.focus();
    firstRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const input = document.querySelector('#opened-files-list .opened-file-rename-input') as HTMLInputElement;
    const dataTransfer = createMockDataTransfer();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 10 }));
    input.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));

    expect(onOpenedImageSelected).not.toHaveBeenCalled();
    expect(onReorderOpenedImage).not.toHaveBeenCalled();
    expect(document.querySelector('.opened-file-drag-image')).toBeNull();
    expect((document.getElementById('opened-images-select') as HTMLSelectElement).value).toBe('session-1');
  });

  it('updates open-file row, select, and action labels after a renamed option is rendered', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'Hero Plate.exr' }], 'session-1');

    const rowLabel = document.querySelector('#opened-files-list .opened-file-label') as HTMLSpanElement;
    const select = document.getElementById('opened-images-select') as HTMLSelectElement;

    expect(rowLabel.textContent).toBe('Hero Plate.exr');
    expect(select.options[0]?.label).toBe('Hero Plate.exr');
    expect(document.querySelector('.opened-file-action-button--reload')?.getAttribute('aria-label')).toBe(
      'Reload Hero Plate.exr'
    );
    expect(document.querySelector('.opened-file-action-button--close')?.getAttribute('aria-label')).toBe(
      'Close Hero Plate.exr'
    );
  });
});

describe('opened files reordering', () => {
  it('keeps the active image selected when dragging another open file to reorder', () => {
    installUiFixture();

    const onOpenedImageSelected = vi.fn();
    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected, onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' },
      { id: 'session-3', label: 'third.exr' }
    ], 'session-1');

    const rows = mockOpenedFilesListGeometry();
    const secondRow = rows[1] as HTMLDivElement;
    const thirdRow = rows[2] as HTMLDivElement;
    const openedImagesSelect = document.getElementById('opened-images-select') as HTMLSelectElement;
    const dataTransfer = createMockDataTransfer();

    thirdRow.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));
    secondRow.dispatchEvent(createOpenedFileDragEvent('dragover', dataTransfer, { clientX: 20, clientY: 25 }));
    secondRow.dispatchEvent(createOpenedFileDragEvent('drop', dataTransfer, { clientX: 20, clientY: 25 }));

    expect(onReorderOpenedImage).toHaveBeenCalledTimes(1);
    expect(onReorderOpenedImage).toHaveBeenCalledWith('session-3', 'session-2', 'before');
    expect(onOpenedImageSelected).not.toHaveBeenCalled();
    expect(openedImagesSelect.value).toBe('session-1');
    expect(secondRow.classList.contains('opened-file-row--drop-before')).toBe(false);
    expect(thirdRow.classList.contains('opened-file-row--dragging')).toBe(false);
  });

  it('selects another open file when a row click does not become a reorder drag', () => {
    installUiFixture();

    const onOpenedImageSelected = vi.fn();
    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected, onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr', thumbnailDataUrl: 'data:image/png;base64,AAAA' }
    ], 'session-1');

    const rows = mockOpenedFilesListGeometry();
    const secondRow = rows[1] as HTMLDivElement;
    const openedImagesSelect = document.getElementById('opened-images-select') as HTMLSelectElement;

    secondRow.click();

    expect(onReorderOpenedImage).not.toHaveBeenCalled();
    expect(onOpenedImageSelected).toHaveBeenCalledTimes(1);
    expect(onOpenedImageSelected).toHaveBeenCalledWith('session-2');
    expect(openedImagesSelect.value).toBe('session-2');
  });

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
    const dataTransfer = createMockDataTransfer();

    thirdRow.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));
    secondRow.dispatchEvent(createOpenedFileDragEvent('dragover', dataTransfer, { clientX: 20, clientY: 25 }));

    expect(onReorderOpenedImage).toHaveBeenCalledTimes(1);
    expect(onReorderOpenedImage).toHaveBeenCalledWith('session-3', 'session-2', 'before');
    expect(dataTransfer.dropEffect).toBe('move');
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
    const dataTransfer = createMockDataTransfer();

    firstRow.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));
    secondRow.dispatchEvent(createOpenedFileDragEvent('dragover', dataTransfer, { clientX: 20, clientY: 35 }));
    secondRow.dispatchEvent(createOpenedFileDragEvent('dragover', dataTransfer, { clientX: 20, clientY: 36 }));

    expect(onReorderOpenedImage).toHaveBeenCalledTimes(1);
    expect(onReorderOpenedImage).toHaveBeenCalledWith('session-1', 'session-2', 'after');
    expect(secondRow.classList.contains('opened-file-row--drop-after')).toBe(true);
  });

  it('selects an open file when its row is dragged onto the image viewer', () => {
    installUiFixture();

    const onOpenedImageSelected = vi.fn();
    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected, onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr', thumbnailDataUrl: 'data:image/png;base64,AAAA' }
    ], 'session-1');

    const rows = mockOpenedFilesListGeometry();
    const secondRow = rows[1] as HTMLDivElement;
    const openedImagesSelect = document.getElementById('opened-images-select') as HTMLSelectElement;
    const dataTransfer = createMockDataTransfer();
    mockDomRect(ui.viewerContainer, { top: 0, bottom: 120, height: 120, left: 300, width: 420 });

    secondRow.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));

    const dragImage = document.querySelector('.opened-file-drag-image') as HTMLDivElement;
    expect(dataTransfer.effectAllowed).toBe('copyMove');
    expect(dataTransfer.getData('application/x-openexr-viewer-opened-file')).toBe('session-2');
    expect(dataTransfer.getData('text/plain')).toBe('second.exr');
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(dragImage, 16, 16);
    expect(dragImage).toBeInstanceOf(HTMLDivElement);
    expect(dragImage.dataset.sessionId).toBe('session-2');
    expect(dragImage.textContent).toContain('second.exr');
    expect(dragImage.querySelector('.opened-file-drag-image-thumbnail')).toBeInstanceOf(HTMLImageElement);

    ui.viewerContainer.dispatchEvent(createOpenedFileDragEvent('dragover', dataTransfer, {
      clientX: 360,
      clientY: 60
    }));

    expect(dataTransfer.dropEffect).toBe('copy');
    expect(ui.viewerContainer.classList.contains('is-opened-file-drop-target')).toBe(true);
    expect(onReorderOpenedImage).not.toHaveBeenCalled();

    ui.viewerContainer.dispatchEvent(createOpenedFileDragEvent('drop', dataTransfer, {
      clientX: 360,
      clientY: 60
    }));

    expect(ui.viewerContainer.classList.contains('is-opened-file-drop-target')).toBe(false);
    expect(document.querySelector('.opened-file-drag-image')).toBeNull();
    expect(onOpenedImageSelected).toHaveBeenCalledTimes(1);
    expect(onOpenedImageSelected).toHaveBeenCalledWith('session-2');
    expect(onReorderOpenedImage).not.toHaveBeenCalled();
    expect(openedImagesSelect.value).toBe('session-2');
  });

  it('uses a file icon fallback for the open-file native drag image without a thumbnail', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' }
    ], 'session-1');

    const rows = mockOpenedFilesListGeometry();
    const secondRow = rows[1] as HTMLDivElement;
    const dataTransfer = createMockDataTransfer();

    secondRow.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));

    const dragImage = document.querySelector('.opened-file-drag-image') as HTMLDivElement;
    expect(dragImage).toBeInstanceOf(HTMLDivElement);
    expect(dragImage.textContent).toContain('second.exr');
    expect(dragImage.querySelector('.file-row-icon')).toBeInstanceOf(HTMLSpanElement);
    expect(dragImage.querySelector('.opened-file-drag-image-thumbnail')).toBeNull();
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(dragImage, 16, 16);

    secondRow.dispatchEvent(createOpenedFileDragEvent('dragend', dataTransfer));

    expect(document.querySelector('.opened-file-drag-image')).toBeNull();
  });

  it('clears the open-file viewer drop target when the drag leaves the viewer', () => {
    installUiFixture();

    const onOpenedImageSelected = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' }
    ], 'session-1');

    const rows = mockOpenedFilesListGeometry();
    const secondRow = rows[1] as HTMLDivElement;
    const openedImagesSelect = document.getElementById('opened-images-select') as HTMLSelectElement;
    const dataTransfer = createMockDataTransfer();
    mockDomRect(ui.viewerContainer, { top: 0, bottom: 120, height: 120, left: 300, width: 420 });

    secondRow.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));
    ui.viewerContainer.dispatchEvent(createOpenedFileDragEvent('dragover', dataTransfer, {
      clientX: 360,
      clientY: 60
    }));

    expect(ui.viewerContainer.classList.contains('is-opened-file-drop-target')).toBe(true);

    ui.viewerContainer.dispatchEvent(createOpenedFileDragEvent('dragleave', dataTransfer, {
      relatedTarget: document.body
    }));

    expect(ui.viewerContainer.classList.contains('is-opened-file-drop-target')).toBe(false);

    secondRow.dispatchEvent(createOpenedFileDragEvent('dragend', dataTransfer));

    expect(onOpenedImageSelected).not.toHaveBeenCalled();
    expect(document.querySelector('.opened-file-drag-image')).toBeNull();
    expect(openedImagesSelect.value).toBe('session-1');
  });

  it('keeps an open-file drag inert outside the list and viewer', () => {
    installUiFixture();

    const onOpenedImageSelected = vi.fn();
    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onOpenedImageSelected, onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' }
    ], 'session-1');

    const rows = mockOpenedFilesListGeometry();
    const secondRow = rows[1] as HTMLDivElement;
    const openedImagesSelect = document.getElementById('opened-images-select') as HTMLSelectElement;
    const dataTransfer = createMockDataTransfer();
    mockDomRect(ui.viewerContainer, { top: 0, bottom: 120, height: 120, left: 500, width: 420 });

    secondRow.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));
    document.body.dispatchEvent(createOpenedFileDragEvent('dragover', dataTransfer, { clientX: 260, clientY: 30 }));

    expect(secondRow.classList.contains('opened-file-row--dragging')).toBe(true);
    expect(document.querySelector('.opened-file-drag-image')).toBeInstanceOf(HTMLDivElement);
    expect(secondRow.classList.contains('opened-file-row--drop-before')).toBe(false);
    expect(secondRow.classList.contains('opened-file-row--drop-after')).toBe(false);
    expect(onReorderOpenedImage).not.toHaveBeenCalled();

    secondRow.dispatchEvent(createOpenedFileDragEvent('dragend', dataTransfer));

    expect(onOpenedImageSelected).not.toHaveBeenCalled();
    expect(document.querySelector('.opened-file-drag-image')).toBeNull();
    expect(onReorderOpenedImage).not.toHaveBeenCalled();
    expect(openedImagesSelect.value).toBe('session-1');
  });

  it('clears the open-file native drag state on loading and window blur', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' }
    ], 'session-1');

    let rows = mockOpenedFilesListGeometry();
    let secondRow = rows[1] as HTMLDivElement;
    let dataTransfer = createMockDataTransfer();
    secondRow.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));

    expect(document.querySelector('.opened-file-drag-image')).toBeInstanceOf(HTMLDivElement);

    ui.setLoading(true);

    expect(document.querySelector('.opened-file-drag-image')).toBeNull();

    ui.setLoading(false);
    rows = mockOpenedFilesListGeometry();
    secondRow = rows[1] as HTMLDivElement;
    dataTransfer = createMockDataTransfer();
    secondRow.dispatchEvent(createOpenedFileDragEvent('dragstart', dataTransfer));

    expect(document.querySelector('.opened-file-drag-image')).toBeInstanceOf(HTMLDivElement);

    window.dispatchEvent(new Event('blur'));

    expect(document.querySelector('.opened-file-drag-image')).toBeNull();
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
    const dataTransfer = createMockDataTransfer();
    const dragStartEvent = createOpenedFileDragEvent('dragstart', dataTransfer);

    reloadButton.dispatchEvent(dragStartEvent);

    expect(dragStartEvent.defaultPrevented).toBe(true);
    expect(onReorderOpenedImage).not.toHaveBeenCalled();
    expect(document.querySelector('.opened-file-drag-image')).toBeNull();
  });

  it('moves the active file before the previous row with Alt+ArrowUp from a focused row', () => {
    installUiFixture();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' },
      { id: 'session-3', label: 'third.exr' }
    ], 'session-2');

    const secondRow = document.querySelector(
      '#opened-files-list .opened-file-row[data-session-id="session-2"]'
    ) as HTMLDivElement;
    secondRow.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    secondRow.dispatchEvent(event);

    expect(onReorderOpenedImage).toHaveBeenCalledTimes(1);
    expect(onReorderOpenedImage).toHaveBeenCalledWith('session-2', 'session-1', 'before');
    expect(event.defaultPrevented).toBe(true);
    expect((document.getElementById('opened-images-select') as HTMLSelectElement).value).toBe('session-2');
  });

  it('moves the active file after the next row with Alt+ArrowDown from a focused row', () => {
    installUiFixture();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' },
      { id: 'session-3', label: 'third.exr' }
    ], 'session-2');

    const secondRow = document.querySelector(
      '#opened-files-list .opened-file-row[data-session-id="session-2"]'
    ) as HTMLDivElement;
    secondRow.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    secondRow.dispatchEvent(event);

    expect(onReorderOpenedImage).toHaveBeenCalledTimes(1);
    expect(onReorderOpenedImage).toHaveBeenCalledWith('session-2', 'session-3', 'after');
    expect(event.defaultPrevented).toBe(true);
    expect((document.getElementById('opened-images-select') as HTMLSelectElement).value).toBe('session-2');
  });

  it('consumes Alt+ArrowUp and Alt+ArrowDown at open-file reorder boundaries', () => {
    installUiFixture();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
    const items = [
      { id: 'session-1', label: 'first.exr' },
      { id: 'session-2', label: 'second.exr' },
      { id: 'session-3', label: 'third.exr' }
    ];

    ui.setOpenedImageOptions(items, 'session-1');
    const firstRow = document.querySelector(
      '#opened-files-list .opened-file-row[data-session-id="session-1"]'
    ) as HTMLDivElement;
    const upEvent = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    firstRow.dispatchEvent(upEvent);

    ui.setOpenedImageOptions(items, 'session-3');
    const thirdRow = document.querySelector(
      '#opened-files-list .opened-file-row[data-session-id="session-3"]'
    ) as HTMLDivElement;
    const downEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    thirdRow.dispatchEvent(downEvent);

    expect(onReorderOpenedImage).not.toHaveBeenCalled();
    expect(upEvent.defaultPrevented).toBe(true);
    expect(downEvent.defaultPrevented).toBe(true);
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

  it('selects a bottom thumbnail when it is dropped on the image viewer', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange }));
    const viewerContainer = ui.viewerContainer;
    const splitToggle = document.getElementById('rgb-split-toggle-button') as HTMLButtonElement;
    const channelSelect = document.getElementById('rgb-group-select') as HTMLSelectElement;
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B'];

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
    splitToggle.click();
    onRgbGroupChange.mockClear();

    const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    const dataTransfer = createMockDataTransfer();
    tiles[1]!.dispatchEvent(createChannelThumbnailDragEvent('dragstart', dataTransfer));
    viewerContainer.dispatchEvent(createChannelThumbnailDragEvent('dragover', dataTransfer));

    expect(viewerContainer.classList.contains('is-channel-thumbnail-drop-target')).toBe(true);
    expect(onRgbGroupChange).not.toHaveBeenCalled();

    viewerContainer.dispatchEvent(createChannelThumbnailDragEvent('drop', dataTransfer));

    expect(viewerContainer.classList.contains('is-channel-thumbnail-drop-target')).toBe(false);
    expect(channelSelect.value).toBe('channel:beauty.G');
    expect(onRgbGroupChange).toHaveBeenCalledWith({
      kind: 'channelMono',
      channel: 'beauty.G',
      alpha: null
    });
    expect(
      document.querySelector<HTMLButtonElement>(
        '#channel-thumbnail-strip .channel-thumbnail-tile[data-channel-value="channel:beauty.G"]'
      )?.getAttribute('aria-selected')
    ).toBe('true');
  });

  it('clears the viewer thumbnail-drop affordance when the drag leaves the viewer', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const ui = new ViewerUi(createUiCallbacks());
    const viewerContainer = ui.viewerContainer;
    const splitToggle = document.getElementById('rgb-split-toggle-button') as HTMLButtonElement;
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B'];

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
    splitToggle.click();

    const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    const dataTransfer = createMockDataTransfer();
    tiles[1]!.dispatchEvent(createChannelThumbnailDragEvent('dragstart', dataTransfer));
    viewerContainer.dispatchEvent(createChannelThumbnailDragEvent('dragover', dataTransfer));

    expect(viewerContainer.classList.contains('is-channel-thumbnail-drop-target')).toBe(true);

    viewerContainer.dispatchEvent(createChannelThumbnailDragEvent('dragleave', dataTransfer, document.body));

    expect(viewerContainer.classList.contains('is-channel-thumbnail-drop-target')).toBe(false);
  });

  it('does not select a dragged thumbnail outside the viewer or from the drag-generated click', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange }));
    const splitToggle = document.getElementById('rgb-split-toggle-button') as HTMLButtonElement;
    const channelSelect = document.getElementById('rgb-group-select') as HTMLSelectElement;
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B'];

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
    splitToggle.click();
    onRgbGroupChange.mockClear();

    const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    const dataTransfer = createMockDataTransfer();
    tiles[1]!.dispatchEvent(createChannelThumbnailDragEvent('dragstart', dataTransfer));
    tiles[1]!.dispatchEvent(createChannelThumbnailDragEvent('dragend', dataTransfer));
    tiles[1]!.click();

    expect(channelSelect.value).toBe('channel:beauty.R');
    expect(onRgbGroupChange).not.toHaveBeenCalled();
  });

  it('keeps normal thumbnail clicks and file-drop routing unchanged', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onRgbGroupChange = vi.fn();
    const onFilesDropped = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onRgbGroupChange, onFilesDropped }));
    const viewerContainer = ui.viewerContainer;
    const dropOverlay = document.getElementById('drop-overlay') as HTMLDivElement;
    const splitToggle = document.getElementById('rgb-split-toggle-button') as HTMLButtonElement;
    const channelSelect = document.getElementById('rgb-group-select') as HTMLSelectElement;
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B'];

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
    splitToggle.click();
    onRgbGroupChange.mockClear();

    let tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    tiles[2]!.click();

    expect(channelSelect.value).toBe('channel:beauty.B');
    expect(onRgbGroupChange).toHaveBeenCalledWith({
      kind: 'channelMono',
      channel: 'beauty.B',
      alpha: null
    });

    onRgbGroupChange.mockClear();
    tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('#channel-thumbnail-strip .channel-thumbnail-tile'));
    const dataTransfer = createMockDataTransfer();
    tiles[1]!.dispatchEvent(createChannelThumbnailDragEvent('dragstart', dataTransfer));
    viewerContainer.dispatchEvent(createChannelThumbnailDragEvent('dragover', dataTransfer));
    viewerContainer.dispatchEvent(createChannelThumbnailDragEvent('drop', dataTransfer));

    expect(onFilesDropped).not.toHaveBeenCalled();
    expect(dropOverlay.classList.contains('hidden')).toBe(true);
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

  it('uses Alt+ArrowUp and Alt+ArrowDown on the document to reorder Open Files by default', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' },
      { id: 'session-3', label: 'image-c.exr' }
    ], 'session-2');

    const downEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    document.body.dispatchEvent(downEvent);
    const upEvent = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    document.body.dispatchEvent(upEvent);

    expect(onReorderOpenedImage).toHaveBeenNthCalledWith(1, 'session-2', 'session-3', 'after');
    expect(onReorderOpenedImage).toHaveBeenNthCalledWith(2, 'session-2', 'session-1', 'before');
    expect(downEvent.defaultPrevented).toBe(true);
    expect(upEvent.defaultPrevented).toBe(true);
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

  it('does not reorder Open Files with Alt+ArrowDown when Channel View is the vertical target', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
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
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
      cancelable: true
    }));

    expect(onReorderOpenedImage).not.toHaveBeenCalled();
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
    openedFileRows[0]?.click();
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

  it('ignores global Open Files reorder while the export dialog is open', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');
    ui.setExportTarget({ filename: 'image.png' });

    (document.getElementById('export-image-button') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
      cancelable: true
    }));

    expect(onReorderOpenedImage).not.toHaveBeenCalled();
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

  it('ignores global Open Files reorder while a top menu is open', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');

    (document.getElementById('file-menu-button') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
      cancelable: true
    }));

    expect(onReorderOpenedImage).not.toHaveBeenCalled();
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

  it('ignores global Open Files reorder from editable controls', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onReorderOpenedImage = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onReorderOpenedImage }));
    ui.setOpenedImageOptions([
      { id: 'session-1', label: 'image-a.exr' },
      { id: 'session-2', label: 'image-b.exr' }
    ], 'session-1');

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
      cancelable: true
    }));

    expect(onReorderOpenedImage).not.toHaveBeenCalled();
  });

  it('routes viewer keyboard zoom shortcuts while viewer input is available', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardZoomInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardZoomInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('image');

    const plainPlus = dispatchViewerZoomKeyboardEvent(ui, { key: '+' });
    dispatchViewerZoomKeyboardKeyUp(ui, { key: '+' });
    const plainMinus = dispatchViewerZoomKeyboardEvent(ui, { key: '-' });
    dispatchViewerZoomKeyboardKeyUp(ui, { key: '-' });
    const primaryPlus = dispatchViewerZoomKeyboardEvent(ui, { key: '+', ctrlKey: true });
    dispatchViewerZoomKeyboardKeyUp(ui, { key: '+' });
    const primaryEquals = dispatchViewerZoomKeyboardEvent(ui, { key: '=', ctrlKey: true });
    dispatchViewerZoomKeyboardKeyUp(ui, { key: '=' });
    const metaMinus = dispatchViewerZoomKeyboardEvent(ui, { key: '-', metaKey: true });
    dispatchViewerZoomKeyboardKeyUp(ui, { key: '-' });

    expect(onViewerKeyboardZoomInputChange.mock.calls).toEqual([
      [{ zoomIn: true, zoomOut: false }],
      [{ zoomIn: false, zoomOut: false }],
      [{ zoomIn: false, zoomOut: true }],
      [{ zoomIn: false, zoomOut: false }],
      [{ zoomIn: true, zoomOut: false }],
      [{ zoomIn: false, zoomOut: false }],
      [{ zoomIn: true, zoomOut: false }],
      [{ zoomIn: false, zoomOut: false }],
      [{ zoomIn: false, zoomOut: true }],
      [{ zoomIn: false, zoomOut: false }]
    ]);
    expect(plainPlus.defaultPrevented).toBe(true);
    expect(plainMinus.defaultPrevented).toBe(true);
    expect(primaryPlus.defaultPrevented).toBe(true);
    expect(primaryEquals.defaultPrevented).toBe(true);
    expect(metaMinus.defaultPrevented).toBe(true);
  });

  it('releases viewer keyboard zoom by physical key code when shifted keyup reports another key', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardZoomInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardZoomInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('image');

    const minusDown = dispatchViewerZoomKeyboardEvent(ui, { key: '-', code: 'Minus' });
    const shiftDown = dispatchViewerZoomKeyboardEvent(ui, {
      key: 'Shift',
      code: 'ShiftLeft',
      shiftKey: true
    });
    const shiftedMinusUp = dispatchViewerZoomKeyboardKeyUp(ui, {
      key: '_',
      code: 'Minus',
      shiftKey: true
    });
    const shiftUp = dispatchViewerZoomKeyboardKeyUp(ui, { key: 'Shift', code: 'ShiftLeft' });

    expect(onViewerKeyboardZoomInputChange.mock.calls).toEqual([
      [{ zoomIn: false, zoomOut: true }],
      [{ zoomIn: false, zoomOut: false }]
    ]);
    expect(minusDown.defaultPrevented).toBe(true);
    expect(shiftDown.defaultPrevented).toBe(false);
    expect(shiftedMinusUp.defaultPrevented).toBe(true);
    expect(shiftUp.defaultPrevented).toBe(false);
  });

  it('does not start viewer keyboard zoom from shifted minus output alone', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardZoomInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardZoomInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('image');

    const shiftedMinusDown = dispatchViewerZoomKeyboardEvent(ui, {
      key: '_',
      code: 'Minus',
      shiftKey: true
    });

    expect(onViewerKeyboardZoomInputChange).not.toHaveBeenCalled();
    expect(shiftedMinusDown.defaultPrevented).toBe(false);
  });

  it('ignores viewer keyboard zoom shortcuts when there is no opened image', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardZoomInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardZoomInputChange }));
    ui.setViewerMode('image');

    dispatchViewerZoomKeyboardEvent(ui, { key: '+' });

    expect(onViewerKeyboardZoomInputChange).not.toHaveBeenCalled();
  });

  it('ignores viewer keyboard zoom shortcuts from editable controls', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardZoomInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardZoomInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('image');

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    dispatchViewerZoomKeyboardEvent(ui, { key: '+' });

    expect(onViewerKeyboardZoomInputChange).not.toHaveBeenCalled();
  });

  it('ignores viewer keyboard zoom shortcuts while dialogs, menus, or overlays are active', async () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const { requestFullscreen } = installFullscreenApiMock();
    const onViewerKeyboardZoomInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardZoomInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('image');
    ui.setExportTarget({ filename: 'image.png' });

    (document.getElementById('export-image-button') as HTMLButtonElement).click();
    dispatchViewerZoomKeyboardEvent(ui, { key: '+' });

    (document.getElementById('export-dialog-cancel-button') as HTMLButtonElement).click();
    (document.getElementById('file-menu-button') as HTMLButtonElement).click();
    dispatchViewerZoomKeyboardEvent(ui, { key: '+' });

    (document.getElementById('file-menu-button') as HTMLButtonElement).click();
    (document.getElementById('export-screenshot-button') as HTMLButtonElement).click();
    dispatchViewerZoomKeyboardEvent(ui, { key: '+' });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    (document.getElementById('window-full-screen-preview-menu-item') as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    dispatchViewerZoomKeyboardEvent(ui, { key: '+' });

    expect(onViewerKeyboardZoomInputChange).not.toHaveBeenCalled();
  });

  it('ignores repeated viewer keyboard zoom keydown events and clears active zoom on blur', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardZoomInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardZoomInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('image');

    dispatchViewerZoomKeyboardEvent(ui, { key: '+' });
    dispatchViewerZoomKeyboardEvent(ui, { key: '+', repeat: true });
    window.dispatchEvent(new Event('blur'));

    expect(onViewerKeyboardZoomInputChange.mock.calls).toEqual([
      [{ zoomIn: true, zoomOut: false }],
      [{ zoomIn: false, zoomOut: false }]
    ]);
  });

  it('starts and releases viewer keyboard navigation input on global w/a/s/d keydown and keyup', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardNavigationInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardNavigationInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true }));

    expect(onViewerKeyboardNavigationInputChange.mock.calls).toEqual([
      [{ up: true, left: false, down: false, right: false }],
      [{ up: false, left: false, down: false, right: false }],
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('ignores repeated viewer keyboard navigation keydown events after the first pressed-state transition', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardNavigationInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardNavigationInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, repeat: true }));

    expect(onViewerKeyboardNavigationInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }]
    ]);
  });

  it('clears active viewer keyboard navigation input on window blur', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardNavigationInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardNavigationInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    window.dispatchEvent(new Event('blur'));

    expect(onViewerKeyboardNavigationInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('clears active viewer keyboard navigation input when the document becomes hidden', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardNavigationInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardNavigationInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onViewerKeyboardNavigationInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('clears active viewer keyboard navigation input when switching viewer modes', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardNavigationInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardNavigationInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    ui.setViewerMode('image');

    expect(onViewerKeyboardNavigationInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('clears active viewer keyboard navigation input when the active image list becomes empty', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardNavigationInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardNavigationInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    ui.setOpenedImageOptions([], null);

    expect(onViewerKeyboardNavigationInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('clears active viewer keyboard navigation input when the export dialog opens and ignores further input while open', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardNavigationInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardNavigationInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');
    ui.setExportTarget({ filename: 'image.png' });

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    (document.getElementById('export-image-button') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));

    expect(onViewerKeyboardNavigationInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('clears active viewer keyboard navigation input when a top menu opens and ignores further input while open', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardNavigationInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardNavigationInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    (document.getElementById('file-menu-button') as HTMLButtonElement).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));

    expect(onViewerKeyboardNavigationInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('starts viewer keyboard navigation input while image mode is active', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardNavigationInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardNavigationInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('image');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true }));

    expect(onViewerKeyboardNavigationInputChange.mock.calls).toEqual([
      [{ up: false, left: false, down: false, right: true }],
      [{ up: false, left: false, down: false, right: false }]
    ]);
  });

  it('ignores global w/a/s/d from editable controls', () => {
    installUiFixture();
    mockDesktopLayoutGeometry();

    const onViewerKeyboardNavigationInputChange = vi.fn();
    const ui = new ViewerUi(createUiCallbacks({ onViewerKeyboardNavigationInputChange }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setViewerMode('panorama');

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));

    expect(onViewerKeyboardNavigationInputChange).not.toHaveBeenCalled();
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
    openedFileRows[0]?.click();
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
    onOpenedImageDisplayNameChange: () => {},
    onReorderOpenedImage: () => {},
    onDisplayCacheBudgetChange: () => {},
    onExposureChange: () => {},
    onViewerKeyboardNavigationInputChange: () => {},
    onViewerKeyboardZoomInputChange: () => {},
    onViewerViewStateChange: () => {},
    onAutoFitImageOnSelectChange: () => {},
    onAutoFitImage: () => {},
    onAutoExposureChange: () => {},
    onAutoExposurePercentileChange: () => {},
    onRulersVisibleChange: () => {},
    getScreenshotFitRect: (): ViewportRect | null => null,
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
    onStokesDefaultSettingChange: () => {},
    onClearRoi: () => {},
    onResetSettings: () => {},
    onResetView: () => {}
  };
}

function dispatchViewerZoomKeyboardEvent(
  ui: ViewerUi,
  init: KeyboardEventInit & { key: string }
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init
  });
  (ui as unknown as {
    globalKeyboardController: {
      handleGlobalViewerKeyboardZoomKeyDown: (event: KeyboardEvent) => boolean;
    };
  }).globalKeyboardController.handleGlobalViewerKeyboardZoomKeyDown(event);
  return event;
}

function dispatchViewerZoomKeyboardKeyUp(
  ui: ViewerUi,
  init: KeyboardEventInit & { key: string }
): KeyboardEvent {
  const event = new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    ...init
  });
  (ui as unknown as {
    globalKeyboardController: {
      handleGlobalViewerKeyboardZoomKeyUp: (event: KeyboardEvent) => boolean;
    };
  }).globalKeyboardController.handleGlobalViewerKeyboardZoomKeyUp(event);
  return event;
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

function readStyleRule(selector: string, occurrence = 0): string {
  const css = readStyleSheet();
  const pattern = `${selector} {`;
  let ruleStart = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    ruleStart = css.indexOf(pattern, ruleStart + 1);
    if (ruleStart < 0) {
      break;
    }
  }
  if (ruleStart < 0) {
    throw new Error(`Style rule not found: ${selector}`);
  }

  const bodyStart = css.indexOf('{', ruleStart);
  const bodyEnd = css.indexOf('}', bodyStart);
  return css.slice(bodyStart + 1, bodyEnd);
}

function readStyleSheet(): string {
  return readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8');
}

function readIndexMarkup(): string {
  return readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
}

function createStatsChannel(
  label: string,
  min: number | null,
  mean: number | null,
  max: number | null,
  validPixelCount: number,
  nanPixelCount = 0,
  negativeInfinityPixelCount = 0,
  positiveInfinityPixelCount = 0
) {
  return {
    label,
    min,
    mean,
    max,
    validPixelCount,
    nanPixelCount,
    negativeInfinityPixelCount,
    positiveInfinityPixelCount
  };
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

function createChannelThumbnailDragEvent(
  type: 'dragstart' | 'dragover' | 'dragleave' | 'drop' | 'dragend',
  dataTransfer: DataTransfer,
  relatedTarget: EventTarget | null = null
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: dataTransfer
  });
  Object.defineProperty(event, 'relatedTarget', {
    value: relatedTarget
  });
  return event;
}

function createOpenedFileDragEvent(
  type: 'dragstart' | 'dragover' | 'dragleave' | 'drop' | 'dragend',
  dataTransfer: DataTransfer,
  options: { clientX?: number; clientY?: number; relatedTarget?: EventTarget | null } = {}
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: dataTransfer
  });
  Object.defineProperty(event, 'clientX', {
    value: options.clientX ?? 0
  });
  Object.defineProperty(event, 'clientY', {
    value: options.clientY ?? 0
  });
  Object.defineProperty(event, 'relatedTarget', {
    value: options.relatedTarget ?? null
  });
  return event;
}

function createMockDataTransfer(): DataTransfer {
  const dragData = new Map<string, string>();
  const types: string[] = [];
  const transfer = {
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
    files: createFileList([]),
    items: [] as unknown as DataTransferItemList,
    get types() {
      return types;
    },
    clearData: (type?: string) => {
      if (type) {
        dragData.delete(type);
        const index = types.indexOf(type);
        if (index >= 0) {
          types.splice(index, 1);
        }
        return;
      }

      dragData.clear();
      types.length = 0;
    },
    getData: (type: string) => dragData.get(type) ?? '',
    setData: (type: string, value: string) => {
      dragData.set(type, value);
      if (!types.includes(type)) {
        types.push(type);
      }
    },
    setDragImage: vi.fn()
  };

  return transfer as DataTransfer;
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
