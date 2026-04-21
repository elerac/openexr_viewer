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

describe('view menu', () => {
  it('renders file menu items in open-export-reload-close order', () => {
    installUiFixture();

    const labels = Array.from(document.querySelectorAll('#file-menu .app-menu-item')).map((item) => item.textContent?.trim());
    expect(labels).toEqual(['Open...', 'Export...', 'Reload All', 'Close All']);
  });

  it('renders the top menu tabs in file-view-gallery-settings order', () => {
    installUiFixture();

    const labels = Array.from(document.querySelectorAll('.app-menu-tab')).map((item) => item.textContent?.trim());
    expect(labels).toEqual(['File', 'View', 'Gallery', 'Settings']);
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

  it('keeps export disabled until an image is active and blocks it during rgb-view loading', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    const exportButton = document.getElementById('export-image-button') as HTMLButtonElement;

    expect(exportButton.disabled).toBe(true);

    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png', sourceWidth: 640, sourceHeight: 320 });
    expect(exportButton.disabled).toBe(false);

    ui.setRgbViewLoading(true);
    expect(exportButton.disabled).toBe(true);
  });

  it('opens export dialog with defaults, syncs aspect ratio, and normalizes the filename', async () => {
    installUiFixture();

    const onExportImage = vi.fn(async () => undefined);
    const ui = new ViewerUi(createUiCallbacks({ onExportImage }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png', sourceWidth: 640, sourceHeight: 320 });

    const exportButton = document.getElementById('export-image-button') as HTMLButtonElement;
    const dialogBackdrop = document.getElementById('export-dialog-backdrop') as HTMLDivElement;
    const filenameInput = document.getElementById('export-filename-input') as HTMLInputElement;
    const widthInput = document.getElementById('export-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('export-height-input') as HTMLInputElement;
    const submitButton = document.getElementById('export-dialog-submit-button') as HTMLButtonElement;

    exportButton.click();

    expect(dialogBackdrop.classList.contains('hidden')).toBe(false);
    expect(filenameInput.value).toBe('image.png');
    expect(widthInput.value).toBe('640');
    expect(heightInput.value).toBe('320');

    widthInput.value = '320';
    widthInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(heightInput.value).toBe('160');

    filenameInput.value = 'graded-output';
    submitButton.click();
    await flushMicrotasks();

    expect(onExportImage).toHaveBeenCalledWith({
      filename: 'graded-output.png',
      format: 'png',
      width: 320,
      height: 160
    });
    expect(dialogBackdrop.classList.contains('hidden')).toBe(true);
  });

  it('keeps the export dialog open while the export callback is pending and shows failures inline', async () => {
    installUiFixture();

    const deferred = createDeferred<void>();
    const onExportImage = vi
      .fn<(_: { filename: string; format: 'png'; width: number; height: number }) => Promise<void>>()
      .mockReturnValueOnce(deferred.promise)
      .mockRejectedValueOnce(new Error('Encode failed'));
    const ui = new ViewerUi(createUiCallbacks({ onExportImage }));
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'image.exr' }], 'session-1');
    ui.setExportTarget({ filename: 'image.png', sourceWidth: 640, sourceHeight: 320 });

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
});

describe('opened files actions', () => {
  it('renders reload and close actions without any pin toggle', () => {
    installUiFixture();

    const ui = new ViewerUi(createUiCallbacks());
    ui.setOpenedImageOptions([{ id: 'session-1', label: 'beauty.exr' }], 'session-1');

    const actionLabels = Array.from(
      document.querySelectorAll('#opened-files-list .opened-file-action-button')
    ).map((button) => button.getAttribute('aria-label'));

    expect(actionLabels).toEqual(['Reload beauty.exr', 'Close beauty.exr']);
    expect(document.querySelector('[aria-label=\"Pin cache for beauty.exr\"]')).toBeNull();
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
    onExportImage: async (_request: { filename: string; format: 'png'; width: number; height: number }) => {},
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

function createFileDropEvent(type: 'drop' | 'dragover'): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['Files'],
      files: {
        length: 1,
        0: new File(['pixels'], 'sample.exr')
      }
    }
  });
  return event;
}
