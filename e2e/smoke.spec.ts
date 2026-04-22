import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import {
  CompressionMethod,
  ExrEncoder,
  initSync,
  SamplePrecision
} from '../src/vendor/exrs_raw_wasm_bindgen.js';

interface ColormapManifest {
  colormaps: Array<{
    label: string;
  }>;
}

const colormapManifest = JSON.parse(
  readFileSync(new URL('../public/colormaps/manifest.json', import.meta.url), 'utf8')
) as ColormapManifest;
const expectedColormapLabels = colormapManifest.colormaps.map((colormap) => colormap.label);
let exrEncoderInitialized = false;

async function openGalleryCbox(page: Page): Promise<void> {
  const openedImages = page.locator('#opened-images-select');

  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('menuitem', { name: 'cbox_rgb.exr', exact: true }).click();
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr', { timeout: 30000 });
}

async function setExposureValue(exposureValue: Locator, value: string): Promise<void> {
  await exposureValue.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function installIdleCallbackController(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;

    const pendingIds: number[] = [];
    const callbacks = new Map<number, IdleCallback>();
    let nextId = 1;

    const target = window as Window & {
      __thumbnailIdleTestController?: {
        pendingCount: () => number;
        flush: (count?: number) => number;
      };
      requestIdleCallback?: (callback: IdleCallback, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    target.__thumbnailIdleTestController = {
      pendingCount: () => pendingIds.length,
      flush: (count?: number) => {
        let completed = 0;
        const maxRuns = typeof count === 'number' ? count : Number.POSITIVE_INFINITY;

        while (pendingIds.length > 0 && completed < maxRuns) {
          const id = pendingIds.shift();
          if (id === undefined) {
            break;
          }

          const callback = callbacks.get(id);
          if (!callback) {
            continue;
          }

          callbacks.delete(id);
          callback({
            didTimeout: false,
            timeRemaining: () => 50
          });
          completed += 1;
        }

        return completed;
      }
    };

    target.requestIdleCallback = (callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      pendingIds.push(id);
      return id;
    };

    target.cancelIdleCallback = (handle) => {
      callbacks.delete(handle);
      const pendingIndex = pendingIds.indexOf(handle);
      if (pendingIndex >= 0) {
        pendingIds.splice(pendingIndex, 1);
      }
    };
  });
}

async function getPendingIdleCallbackCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const target = window as Window & {
      __thumbnailIdleTestController?: {
        pendingCount: () => number;
      };
    };

    return target.__thumbnailIdleTestController?.pendingCount() ?? 0;
  });
}

async function flushIdleCallbacks(page: Page, count?: number): Promise<number> {
  return await page.evaluate((maxRuns) => {
    const target = window as Window & {
      __thumbnailIdleTestController?: {
        flush: (count?: number) => number;
      };
    };

    return target.__thumbnailIdleTestController?.flush(maxRuns) ?? 0;
  }, count);
}

test('boots empty, opens the gallery demo image, and keeps core controls stable', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await expect(page.locator('#inspector-panel')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inspector' })).toHaveCount(0);
  await expect(page.locator('#gl-canvas')).toBeVisible();
  await expect(page.locator('#opened-images-select')).toBeVisible();

  const errorBanner = page.locator('#error-banner');
  const openedImages = page.locator('#opened-images-select');
  const layerControl = page.locator('#layer-control');
  const rgbGroupSelect = page.locator('#rgb-group-select');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');
  const probeCoords = page.locator('#probe-coords');
  const probeColorValues = page.locator('#probe-color-values');
  const probeValues = page.locator('#probe-values');
  const probeMetadata = page.locator('#probe-metadata');
  const viewer = page.locator('#viewer-container');
  const resetButton = page.getByRole('button', { name: 'Reset', exact: true });
  const noneButton = page.getByRole('button', { name: 'None', exact: true });
  const colormapButton = page.getByRole('button', { name: 'Colormap' });
  const exposureControl = page.locator('#exposure-control');
  const colormapRangeControl = page.locator('#colormap-range-control');
  const colormapSelect = page.locator('#colormap-select');
  const colormapAutoRangeButton = page.getByRole('button', { name: 'Auto Range' });
  const colormapZeroCenterButton = page.getByRole('button', { name: 'Zero Center' });
  const colormapRangeSlider = page.locator('#colormap-range-slider');
  const colormapVminInput = page.locator('#colormap-vmin-input');
  const colormapVmaxInput = page.locator('#colormap-vmax-input');
  const colormapVminSlider = page.locator('#colormap-vmin-slider');
  const colormapVmaxSlider = page.locator('#colormap-vmax-slider');
  const openedFileRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'cbox_rgb.exr' });
  const reloadOpenedFileButton = page.getByRole('button', { name: 'Reload cbox_rgb.exr', exact: true });
  const closeOpenedFileButton = page.getByRole('button', { name: 'Close cbox_rgb.exr', exact: true });
  const appMenuTitle = page.locator('.app-menu-title');
  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const fileMenu = page.locator('#file-menu');
  const galleryMenuButton = page.getByRole('button', { name: 'Gallery', exact: true });
  const galleryMenu = page.locator('#gallery-menu');
  const settingsMenuButton = page.getByRole('button', { name: 'Settings', exact: true });
  const settingsMenu = page.locator('#settings-menu');
  const galleryCboxItem = page.getByRole('menuitem', { name: 'cbox_rgb.exr', exact: true });
  const openMenuItem = page.locator('#open-file-button');
  const exportMenuItem = page.locator('#export-image-button');
  const reloadAllMenuItem = page.locator('#reload-all-opened-images-button');
  const closeAllMenuItem = page.locator('#close-all-opened-images-button');
  const budgetInput = page.locator('#display-cache-budget-input');
  const usageReadout = page.locator('#display-cache-usage');
  const getViewerPoint = async (xRatio: number, yRatio: number) => {
    const box = await viewer.boundingBox();
    if (!box) {
      throw new Error('Viewer container is not visible.');
    }

    return {
      x: box.x + box.width * xRatio,
      y: box.y + box.height * yRatio
    };
  };

  await page.waitForTimeout(1500);

  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  await expect(errorBanner).toBeHidden();
  await expect(appMenuTitle).toHaveText('OpenEXR Viewer');
  await expect(fileMenuButton).toBeVisible();
  await expect(fileMenuButton).toHaveAttribute('aria-haspopup', 'menu');
  await expect(fileMenuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(fileMenu).toBeHidden();
  await expect(galleryMenuButton).toBeVisible();
  await expect(galleryMenuButton).toHaveAttribute('aria-haspopup', 'menu');
  await expect(galleryMenuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(galleryMenu).toBeHidden();
  await expect(settingsMenuButton).toBeVisible();
  await expect(settingsMenuButton).toHaveAttribute('aria-haspopup', 'menu');
  await expect(settingsMenuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsMenu).toBeHidden();
  await expect(page.locator('.image-panel-actions')).toHaveCount(0);
  await expect(page.locator('.image-panel-titlebar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Image', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'View', exact: true })).toHaveCount(0);
  await expect(page.locator('#zoom-readout')).toHaveCount(0);
  await expect(page.locator('#pan-readout')).toHaveCount(0);
  await expect(openedImages.locator('option')).toHaveCount(0);
  await expect(page.locator('#opened-files-list')).toContainText('No open files');

  await fileMenuButton.click();
  await expect(fileMenu).toBeVisible();
  await expect(openMenuItem).toBeEnabled();
  await expect(exportMenuItem).toBeDisabled();
  await expect(reloadAllMenuItem).toBeDisabled();
  await expect(closeAllMenuItem).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(fileMenu).toBeHidden();
  await expect(fileMenuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(fileMenuButton).toBeFocused();

  await galleryMenuButton.click();
  await expect(galleryMenu).toBeVisible();
  await expect(galleryMenuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(galleryCboxItem).toBeVisible();
  await expect(galleryCboxItem).toBeEnabled();
  await galleryCboxItem.click();
  await expect(galleryMenu).toBeHidden();
  await expect(galleryMenuButton).toHaveAttribute('aria-expanded', 'false');

  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await expect(settingsMenuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(budgetInput).toBeVisible();
  await expect(budgetInput).toHaveValue('256');
  await expect(budgetInput.locator('option')).toHaveText(['64', '128', '256', '512', '1024']);
  await expect(usageReadout).toContainText('/ 256 MB');
  await page.keyboard.press('Escape');
  await expect(settingsMenu).toBeHidden();
  await expect(settingsMenuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsMenuButton).toBeFocused();

  await fileMenuButton.hover();
  await expect(fileMenu).toBeHidden();
  await expect(fileMenuButton).toHaveAttribute('aria-expanded', 'false');

  await fileMenuButton.click();
  await expect(fileMenu).toBeVisible();
  await expect(fileMenuButton).toHaveAttribute('aria-expanded', 'true');
  await galleryMenuButton.hover();
  await expect(fileMenu).toBeHidden();
  await expect(fileMenuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(galleryMenu).toBeVisible();
  await expect(galleryMenuButton).toHaveAttribute('aria-expanded', 'true');
  await settingsMenuButton.hover();
  await expect(galleryMenu).toBeHidden();
  await expect(galleryMenuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsMenu).toBeVisible();
  await expect(settingsMenuButton).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(settingsMenu).toBeHidden();
  await expect(settingsMenuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsMenuButton).toBeFocused();
  await galleryMenuButton.hover();
  await expect(galleryMenu).toBeHidden();
  await expect(galleryMenuButton).toHaveAttribute('aria-expanded', 'false');

  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });
  await expect(openedImages.locator('option').first()).toContainText('cbox_rgb.exr');
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(page.locator('#reload-opened-image-button')).toHaveCount(0);
  await expect(page.locator('#close-opened-image-button')).toHaveCount(0);
  await expect(openedFileRow).toHaveCount(1);
  await expect(openedFileRow.locator('.image-browser-row-meta')).toHaveCount(0);
  await expect(openedFileRow.locator('.opened-file-thumbnail')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(openedFileRow.locator('.file-row-icon')).toHaveCount(0);
  await expect(reloadOpenedFileButton).toBeVisible();
  await expect(closeOpenedFileButton).toBeVisible();
  await expect(openedFileRow.locator('.opened-file-label')).toHaveAttribute('title', /Path: .*cbox_rgb\.exr\nSize: .* MB/);
  await expect(layerControl).toBeHidden();
  await expect(probeMetadata).toContainText('compression');
  await expect(probeMetadata).toContainText('PIZ');
  await expect(probeMetadata).toContainText('dataWindow');
  await expect(probeMetadata).toContainText('channels');
  await expect(probeMetadata).toContainText('3 (R, G, B)');

  await fileMenuButton.click();
  await expect(fileMenu).toBeVisible();
  await expect(fileMenuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(openMenuItem).toBeVisible();
  await expect(openMenuItem).toHaveText('Open...');
  await expect(exportMenuItem).toBeVisible();
  await expect(exportMenuItem).toHaveText('Export...');
  await expect(reloadAllMenuItem).toBeVisible();
  await expect(closeAllMenuItem).toBeVisible();
  await expect(openMenuItem).toBeEnabled();
  await expect(exportMenuItem).toBeEnabled();
  await expect(reloadAllMenuItem).toBeEnabled();
  await expect(closeAllMenuItem).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(fileMenu).toBeHidden();
  await expect(fileMenuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(fileMenuButton).toBeFocused();

  await viewer.hover();
  await expect.poll(async () => await probeCoords.evaluate((element) => element.textContent ?? '')).toMatch(/^x +\d+ {3}y +\d+$/);
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['R:', 'G:', 'B:']);
  await expect(probeValues).toContainText('R');
  await expect(probeValues).toContainText('G');
  await expect(probeValues).toContainText('B');
  const lockedProbePoint = await getViewerPoint(0.5, 0.5);
  await page.mouse.click(lockedProbePoint.x, lockedProbePoint.y);
  await expect(page.locator('#probe-mode')).toHaveText('Locked');
  await expect(rgbGroupSelect).toBeEnabled();
  await expect(rgbSplitToggleButton).toBeVisible();
  await expect(rgbSplitToggleButton).toBeEnabled();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-controls', 'rgb-group-select');
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'false');
  await expect(rgbGroupSelect.locator('option:checked')).toHaveText(/R,G,B/);
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^R$/ })).toHaveCount(0);
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^G$/ })).toHaveCount(0);
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^B$/ })).toHaveCount(0);
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^R,G,B$/ })).toHaveCount(0);
  await expect(rgbGroupSelect.locator('option:checked')).toHaveText('R');
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^R$/ })).toHaveCount(1);
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^G$/ })).toHaveCount(1);
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^B$/ })).toHaveCount(1);
  await rgbGroupSelect.selectOption({ label: 'R' });
  await expect(rgbGroupSelect.locator('option:checked')).toHaveText('R');
  await expect(page.locator('#loading-overlay')).toBeHidden();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'false');
  await expect(rgbGroupSelect.locator('option:checked')).toHaveText(/R,G,B/);
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^R$/ })).toHaveCount(0);
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^G$/ })).toHaveCount(0);
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^B$/ })).toHaveCount(0);
  expect(await page.locator('#gl-canvas').evaluate((canvas) => {
    return canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0;
  })).toBe(true);
  await expect(resetButton).toBeVisible();
  await expect(noneButton).toBeVisible();
  await expect(noneButton).toBeEnabled();
  await expect(noneButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapButton).toBeVisible();
  await expect(colormapButton).toBeEnabled();
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapButton).toHaveAttribute('aria-expanded', 'false');
  await expect(exposureControl).toBeVisible();
  const resetBox = await resetButton.boundingBox();
  const noneBox = await noneButton.boundingBox();
  const colormapBox = await colormapButton.boundingBox();
  expect(resetBox).not.toBeNull();
  expect(noneBox).not.toBeNull();
  expect(colormapBox).not.toBeNull();
  expect(resetBox!.y).toBeLessThan(noneBox!.y);
  expect(Math.abs(noneBox!.y - colormapBox!.y)).toBeLessThanOrEqual(1);
  expect(noneBox!.x).toBeLessThan(colormapBox!.x);
  await expect(colormapRangeControl).toBeHidden();
  await expect(colormapAutoRangeButton).toHaveCount(0);
  await expect(colormapZeroCenterButton).toHaveCount(0);
  await expect(colormapSelect).toBeHidden();
  await expect(colormapVminInput).toBeHidden();
  await expect(colormapVmaxInput).toBeHidden();
  await expect(colormapVmaxSlider).toBeHidden();

  await colormapButton.click();
  await expect(noneButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapButton).toHaveAttribute('aria-expanded', 'true');
  await expect(exposureControl).toBeHidden();
  await expect(colormapRangeControl).toBeVisible();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);
  await expect(colormapAutoRangeButton).toBeEnabled();
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapZeroCenterButton).toBeEnabled();
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapSelect).toBeVisible();
  await expect(colormapSelect).toBeEnabled();
  expect(expectedColormapLabels.length).toBeGreaterThanOrEqual(2);
  await expect(colormapSelect.locator('option')).toHaveText(expectedColormapLabels);
  await expect(colormapSelect).toHaveValue('0');
  await colormapSelect.selectOption({ label: expectedColormapLabels[1] });
  await expect(colormapSelect).toHaveValue('1');
  await expect(colormapRangeSlider).toBeVisible();
  await expect(colormapVminInput).toBeEnabled();
  await expect(colormapVmaxInput).toBeEnabled();
  await expect(colormapVmaxSlider).toBeEnabled();
  const autoMin = Number(await colormapVminInput.inputValue());
  const autoMax = Number(await colormapVmaxInput.inputValue());
  expect(Number.isFinite(autoMin)).toBe(true);
  expect(Number.isFinite(autoMax)).toBe(true);
  expect(autoMax).toBeGreaterThan(autoMin);
  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const track = document.querySelector('#colormap-range-slider');
        const slider = document.querySelector('#colormap-vmax-slider');
        if (!track || !slider) {
          return 0;
        }

        return slider.getBoundingClientRect().width - track.getBoundingClientRect().width;
      });
    })
    .toBeCloseTo(0, 1);

  const zeroCenteredAutoMax = Math.max(Math.abs(autoMin), Math.abs(autoMax));
  await colormapZeroCenterButton.click();
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapRangeSlider).toHaveClass(/zero-centered/);
  expect(Number(await colormapVminSlider.getAttribute('max'))).toBeLessThan(0);
  expect(Number(await colormapVmaxSlider.getAttribute('min'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-zeroCenteredAutoMax, 5);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(zeroCenteredAutoMax, 5);

  const manualMax = 1e-16;
  await colormapVmaxInput.fill(String(manualMax));
  await colormapVmaxInput.dispatchEvent('change');
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-manualMax, 12);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(manualMax, 12);

  await reloadOpenedFileButton.click();
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-manualMax, 12);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(manualMax, 12);

  await colormapAutoRangeButton.click();
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-zeroCenteredAutoMax, 5);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(zeroCenteredAutoMax, 5);

  await colormapZeroCenterButton.click();
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapRangeSlider).not.toHaveClass(/zero-centered/);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(autoMin, 5);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(autoMax, 5);

  await colormapAutoRangeButton.click();
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(autoMin, 5);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(autoMax, 5);

  await noneButton.click();
  await expect(noneButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapButton).toHaveAttribute('aria-expanded', 'false');
  await expect(exposureControl).toBeVisible();
  await expect(colormapRangeControl).toBeHidden();
  await expect(colormapAutoRangeButton).toHaveCount(0);
  await expect(colormapZeroCenterButton).toHaveCount(0);
  await expect(colormapSelect).toBeHidden();
  await expect(colormapVminInput).toBeHidden();
  await expect(colormapVmaxInput).toBeHidden();
  await expect(colormapVmaxSlider).toBeHidden();

  await expect(layerControl).toBeHidden();
  await expect(rgbGroupSelect).toBeEnabled();

  await closeOpenedFileButton.click();
  await expect(openedImages.locator('option')).toHaveCount(0, { timeout: 30000 });
  await expect(layerControl).toBeHidden();
  await expect.poll(async () => await probeCoords.evaluate((element) => element.textContent ?? '')).toBe('x -   y -');
  await fileMenuButton.click();
  await expect(fileMenu).toBeVisible();
  await expect(openMenuItem).toBeEnabled();
  await expect(reloadAllMenuItem).toBeDisabled();
  await expect(closeAllMenuItem).toBeDisabled();
});

test('exports the active image as a png download from the file menu', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  await openGalleryCbox(page);

  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const exportMenuItem = page.locator('#export-image-button');
  const exportDialog = page.locator('#export-dialog-form');
  const exportFilenameInput = page.locator('#export-filename-input');
  const exportWidthInput = page.locator('#export-width-input');
  const exportHeightInput = page.locator('#export-height-input');
  const exportSubmitButton = page.locator('#export-dialog-submit-button');

  await fileMenuButton.click();
  await exportMenuItem.click();

  await expect(exportDialog).toBeVisible();
  await expect(exportFilenameInput).toHaveValue('cbox_rgb.png');
  await expect(exportWidthInput).toHaveValue('256');
  await expect(exportHeightInput).toHaveValue('256');

  const downloadPromise = page.waitForEvent('download');
  await exportSubmitButton.click();
  const download = await downloadPromise;

  await expect(exportDialog).toBeHidden();
  expect(download.suggestedFilename()).toBe('cbox_rgb.png');

  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const pngBytes = Buffer.concat(chunks);
  expect(pngBytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
});

test('defers opened-file thumbnails until idle time after first render', async ({ page }) => {
  await installIdleCallbackController(page);
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const openedImages = page.locator('#opened-images-select');
  const openedFileRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'cbox_rgb.exr' });

  await openGalleryCbox(page);
  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });
  await expect(openedFileRow).toHaveCount(1);
  await expect(openedFileRow.locator('.file-row-icon')).toHaveCount(1);
  await expect(openedFileRow.locator('.opened-file-thumbnail')).toHaveCount(0);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(1);

  await flushIdleCallbacks(page, 1);

  await expect(openedFileRow.locator('.opened-file-thumbnail')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(openedFileRow.locator('.file-row-icon')).toHaveCount(0);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(0);
});

test('keeps the previous thumbnail visible until reload thumbnails are regenerated in idle time', async ({ page }) => {
  await installIdleCallbackController(page);
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const openedImages = page.locator('#opened-images-select');
  const openedFileRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'cbox_rgb.exr' });
  const reloadOpenedFileButton = page.getByRole('button', { name: 'Reload cbox_rgb.exr', exact: true });
  const exposureValue = page.locator('#exposure-value');

  await openGalleryCbox(page);
  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(1);
  await flushIdleCallbacks(page, 1);

  const thumbnail = openedFileRow.locator('.opened-file-thumbnail');
  await expect(thumbnail).toHaveAttribute('src', /^data:image\/png;base64,/);
  const initialThumbnailSrc = await thumbnail.getAttribute('src');
  expect(initialThumbnailSrc).not.toBeNull();

  await setExposureValue(exposureValue, '2.0');
  await expect(exposureValue).toHaveValue('2.0');

  await reloadOpenedFileButton.click();
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(1);
  await expect(thumbnail).toHaveAttribute('src', initialThumbnailSrc ?? '');
  await expect(openedFileRow.locator('.file-row-icon')).toHaveCount(0);

  await flushIdleCallbacks(page, 1);

  await expect(thumbnail).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(async () => await thumbnail.getAttribute('src')).not.toBe(initialThumbnailSrc);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(0);
});

test('moves open files and channel view selections with arrow keys', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const openedImages = page.locator('#opened-images-select');
  const channelSelect = page.locator('#rgb-group-select');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');

  await openGalleryCbox(page);
  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });

  await page.setInputFiles('#file-input', {
    name: 'scalar_z.exr',
    mimeType: 'image/exr',
    buffer: buildScalarChannelExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('scalar_z.exr', { timeout: 30000 });

  await page.setInputFiles('#file-input', {
    name: 'spectral.exr',
    mimeType: 'image/exr',
    buffer: buildSpectralExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('spectral.exr', { timeout: 30000 });

  const openedRows = page.locator('#opened-files-list .opened-file-row');
  const cboxRow = openedRows.filter({ hasText: 'cbox_rgb.exr' });
  const scalarRow = openedRows.filter({ hasText: 'scalar_z.exr' });
  const spectralRow = openedRows.filter({ hasText: 'spectral.exr' });
  await expect(openedRows).toHaveCount(3);

  await cboxRow.locator('.opened-file-label').click();
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(cboxRow).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(openedImages.locator('option:checked')).toContainText('scalar_z.exr');
  await expect(scalarRow).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(openedImages.locator('option:checked')).toContainText('spectral.exr');
  await expect(spectralRow).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await expect(openedImages.locator('option:checked')).toContainText('scalar_z.exr');
  await expect(scalarRow).toBeFocused();

  await cboxRow.locator('.opened-file-label').click();
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(channelSelect).toBeEnabled();
  await expect(rgbSplitToggleButton).toBeVisible();
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(channelSelect.locator('option:checked')).toHaveText('R');

  const channelRows = page.locator('#channel-view-list .channel-view-row');
  const redRow = channelRows.filter({ hasText: /^R/ });
  const greenRow = channelRows.filter({ hasText: /^G/ });
  const blueRow = channelRows.filter({ hasText: /^B/ });
  await expect(channelRows).toHaveCount(3);

  await redRow.click();
  await expect(channelSelect.locator('option:checked')).toHaveText('R');
  await expect(redRow).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(channelSelect.locator('option:checked')).toHaveText('G');
  await expect(greenRow).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(channelSelect.locator('option:checked')).toHaveText('B');
  await expect(blueRow).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await expect(channelSelect.locator('option:checked')).toHaveText('G');
  await expect(greenRow).toBeFocused();
});

test('carries exposure when opening and switching files', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const openedImages = page.locator('#opened-images-select');
  const exposureValue = page.locator('#exposure-value');

  await openGalleryCbox(page);
  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });
  await expect(exposureValue).toHaveValue('0.0');

  await setExposureValue(exposureValue, '1.7');
  await expect(exposureValue).toHaveValue('1.7');

  await page.setInputFiles('#file-input', {
    name: 'scalar_z.exr',
    mimeType: 'image/exr',
    buffer: buildScalarChannelExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('scalar_z.exr', { timeout: 30000 });
  await expect(exposureValue).toHaveValue('1.7');

  await setExposureValue(exposureValue, '-2.5');
  await expect(exposureValue).toHaveValue('-2.5');

  const cboxRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'cbox_rgb.exr' });
  await cboxRow.locator('.opened-file-label').click();
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(exposureValue).toHaveValue('-2.5');
});

test('persists the cache budget and keeps open-file actions limited to reload and close', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  const settingsMenuButton = page.getByRole('button', { name: 'Settings', exact: true });
  const settingsMenu = page.locator('#settings-menu');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const budgetInput = page.locator('#display-cache-budget-input');
  const usageReadout = page.locator('#display-cache-usage');

  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await expect(budgetInput).toHaveValue('256');
  await expect(usageReadout).toContainText('/ 256 MB');

  await openGalleryCbox(page);

  await expect(page.getByRole('button', { name: 'Reload cbox_rgb.exr', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close cbox_rgb.exr', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pin cache|Unpin cache/ })).toHaveCount(0);

  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await budgetInput.selectOption('128');

  await expect(budgetInput).toHaveValue('128');
  await expect(usageReadout).toContainText('/ 128 MB');
  await expect.poll(async () => {
    return await page.evaluate(() => {
      return window.localStorage.getItem('openexr-viewer:display-cache-budget-mb:v1');
    });
  }).toBe('128');

  await page.reload();
  await page.waitForTimeout(1500);

  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await expect(budgetInput).toHaveValue('128');
  await expect(usageReadout).toContainText('/ 128 MB');

  await openGalleryCbox(page);
  await expect(page.getByRole('button', { name: 'Reload cbox_rgb.exr', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close cbox_rgb.exr', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pin cache|Unpin cache/ })).toHaveCount(0);
});

test('resizes desktop panel splits and persists them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const imageResizer = page.locator('#image-panel-resizer');
  const rightResizer = page.locator('#right-panel-resizer');
  const imageCollapseButton = page.locator('#image-panel-collapse-button');
  const rightCollapseButton = page.locator('#right-panel-collapse-button');
  const viewer = page.locator('#viewer-container');

  await expect(imageResizer).toBeVisible();
  await expect(rightResizer).toBeVisible();
  await expect(imageCollapseButton).toBeVisible();
  await expect(rightCollapseButton).toBeVisible();

  const readLayout = async () => {
    return await page.evaluate(() => {
      const imagePanel = document.querySelector('#image-panel');
      const imagePanelContent = document.querySelector('#image-panel-content');
      const rightStack = document.querySelector('#right-stack');
      const inspectorPanel = document.querySelector('#inspector-panel');
      const imageResizer = document.querySelector('#image-panel-resizer');
      const rightResizer = document.querySelector('#right-panel-resizer');
      const imageCollapseButton = document.querySelector('#image-panel-collapse-button');
      const rightCollapseButton = document.querySelector('#right-panel-collapse-button');
      const viewerContainer = document.querySelector('#viewer-container');
      const canvas = document.querySelector('#gl-canvas');
      if (
        !(imagePanel instanceof HTMLElement) ||
        !(imagePanelContent instanceof HTMLElement) ||
        !(rightStack instanceof HTMLElement) ||
        !(inspectorPanel instanceof HTMLElement) ||
        !(imageResizer instanceof HTMLElement) ||
        !(rightResizer instanceof HTMLElement) ||
        !(imageCollapseButton instanceof HTMLButtonElement) ||
        !(rightCollapseButton instanceof HTMLButtonElement) ||
        !(viewerContainer instanceof HTMLElement) ||
        !(canvas instanceof HTMLCanvasElement)
      ) {
        throw new Error('Missing layout elements.');
      }

      const imagePanelRect = imagePanel.getBoundingClientRect();
      const imagePanelContentRect = imagePanelContent.getBoundingClientRect();
      const rightStackRect = rightStack.getBoundingClientRect();
      const inspectorPanelRect = inspectorPanel.getBoundingClientRect();
      const imageCollapseButtonRect = imageCollapseButton.getBoundingClientRect();
      const rightCollapseButtonRect = rightCollapseButton.getBoundingClientRect();

      return {
        imageShellWidth: imagePanelRect.width,
        imageWidth: imagePanelContentRect.width,
        imageButtonHeight: imageCollapseButtonRect.height,
        imageShellHeight: imagePanelRect.height,
        imageButtonLeft: imageCollapseButtonRect.left,
        imageShellLeft: imagePanelRect.left,
        rightShellWidth: rightStackRect.width,
        rightWidth: inspectorPanelRect.width,
        rightButtonHeight: rightCollapseButtonRect.height,
        rightShellHeight: rightStackRect.height,
        rightButtonRight: rightCollapseButtonRect.right,
        rightShellRight: rightStackRect.right,
        imageResizerWidth: imageResizer.getBoundingClientRect().width,
        rightResizerWidth: rightResizer.getBoundingClientRect().width,
        viewerWidth: viewerContainer.getBoundingClientRect().width,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        stored: window.localStorage.getItem('openexr-viewer:panel-splits:v1')
      };
    });
  };

  const dragBy = async (locator: Locator, dx: number, dy: number) => {
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error('Resizer is not visible.');
    }

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  };

  const initial = await readLayout();
  expect(Math.abs(initial.imageButtonHeight - initial.imageShellHeight)).toBeLessThan(3);
  expect(Math.abs(initial.rightButtonHeight - initial.rightShellHeight)).toBeLessThan(3);
  expect(Math.abs(initial.imageButtonLeft - initial.imageShellLeft)).toBeLessThan(2);
  expect(Math.abs(initial.rightButtonRight - initial.rightShellRight)).toBeLessThan(2);

  await dragBy(imageResizer, 48, 0);
  const afterImageResize = await readLayout();
  expect(afterImageResize.imageWidth).toBeGreaterThan(initial.imageWidth + 30);
  expect(afterImageResize.viewerWidth).toBeGreaterThan(360);

  await dragBy(rightResizer, -48, 0);
  const afterRightResize = await readLayout();
  expect(afterRightResize.rightWidth).toBeGreaterThan(afterImageResize.rightWidth + 30);
  expect(afterRightResize.canvasWidth).toBeGreaterThan(0);
  expect(afterRightResize.canvasHeight).toBeGreaterThan(0);

  expect(afterRightResize.stored).not.toBeNull();

  const stored = JSON.parse(afterRightResize.stored ?? '{}') as {
    imagePanelWidth?: number;
    rightPanelWidth?: number;
    imagePanelCollapsed?: boolean;
    rightPanelCollapsed?: boolean;
  };
  expect(stored.imagePanelWidth).toBeCloseTo(afterRightResize.imageWidth, 0);
  expect(stored.rightPanelWidth).toBeCloseTo(afterRightResize.rightWidth, 0);
  expect(stored.imagePanelCollapsed).toBe(false);
  expect(stored.rightPanelCollapsed).toBe(false);

  await page.reload();
  await page.waitForTimeout(1500);
  const afterReload = await readLayout();
  expect(afterReload.imageWidth).toBeCloseTo(afterRightResize.imageWidth, 0);
  expect(afterReload.rightWidth).toBeCloseTo(afterRightResize.rightWidth, 0);

  await imageCollapseButton.click();
  await page.waitForTimeout(100);
  const afterImageCollapse = await readLayout();
  expect(afterImageCollapse.imageWidth).toBeLessThan(2);
  expect(afterImageCollapse.imageShellWidth).toBeGreaterThan(10);
  expect(afterImageCollapse.imageResizerWidth).toBeLessThan(2);
  expect(afterImageCollapse.viewerWidth).toBeGreaterThan(afterReload.viewerWidth + 30);
  await expect(imageResizer).toBeHidden();
  await expect(imageCollapseButton).toHaveAttribute('aria-expanded', 'false');

  const storedAfterImageCollapse = JSON.parse(afterImageCollapse.stored ?? '{}') as {
    imagePanelWidth?: number;
    imagePanelCollapsed?: boolean;
  };
  expect(storedAfterImageCollapse.imagePanelWidth).toBeCloseTo(afterReload.imageWidth, 0);
  expect(storedAfterImageCollapse.imagePanelCollapsed).toBe(true);

  await page.reload();
  await page.waitForTimeout(1500);
  const afterImageCollapseReload = await readLayout();
  expect(afterImageCollapseReload.imageWidth).toBeLessThan(2);
  await expect(imageCollapseButton).toHaveAttribute('aria-expanded', 'false');

  await imageCollapseButton.click();
  await page.waitForTimeout(100);
  const afterImageReopen = await readLayout();
  expect(afterImageReopen.imageWidth).toBeCloseTo(afterReload.imageWidth, 0);
  await expect(imageResizer).toBeVisible();
  await expect(imageCollapseButton).toHaveAttribute('aria-expanded', 'true');

  await rightCollapseButton.click();
  await page.waitForTimeout(100);
  const afterRightCollapse = await readLayout();
  expect(afterRightCollapse.rightWidth).toBeLessThan(2);
  expect(afterRightCollapse.rightShellWidth).toBeGreaterThan(10);
  expect(afterRightCollapse.rightResizerWidth).toBeLessThan(2);
  expect(afterRightCollapse.viewerWidth).toBeGreaterThan(afterImageReopen.viewerWidth + 30);
  await expect(rightResizer).toBeHidden();
  await expect(rightCollapseButton).toHaveAttribute('aria-expanded', 'false');

  const storedAfterRightCollapse = JSON.parse(afterRightCollapse.stored ?? '{}') as {
    rightPanelWidth?: number;
    rightPanelCollapsed?: boolean;
  };
  expect(storedAfterRightCollapse.rightPanelWidth).toBeCloseTo(afterImageReopen.rightWidth, 0);
  expect(storedAfterRightCollapse.rightPanelCollapsed).toBe(true);

  await page.reload();
  await page.waitForTimeout(1500);
  const afterRightCollapseReload = await readLayout();
  expect(afterRightCollapseReload.rightWidth).toBeLessThan(2);
  await expect(rightCollapseButton).toHaveAttribute('aria-expanded', 'false');

  await rightCollapseButton.click();
  await page.waitForTimeout(100);
  const afterRightReopen = await readLayout();
  expect(afterRightReopen.rightWidth).toBeCloseTo(afterImageReopen.rightWidth, 0);
  await expect(rightResizer).toBeVisible();
  await expect(rightCollapseButton).toHaveAttribute('aria-expanded', 'true');

  await page.setViewportSize({ width: 800, height: 700 });
  await expect(imageResizer).toBeHidden();
  await expect(rightResizer).toBeHidden();
  await expect(imageCollapseButton).toBeHidden();
  await expect(rightCollapseButton).toBeHidden();
  await expect(viewer).toBeVisible();
});

test('keeps desktop panel heights stable after opening an image', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const imageCollapseButton = page.locator('#image-panel-collapse-button');
  const rightCollapseButton = page.locator('#right-panel-collapse-button');

  await expect(imageCollapseButton).toBeVisible();
  await expect(rightCollapseButton).toBeVisible();

  const readHeights = async () => {
    return await page.evaluate(() => {
      const mainLayout = document.querySelector('#main-layout');
      const imagePanel = document.querySelector('#image-panel');
      const rightStack = document.querySelector('#right-stack');
      const imageCollapseButton = document.querySelector('#image-panel-collapse-button');
      const rightCollapseButton = document.querySelector('#right-panel-collapse-button');

      if (
        !(mainLayout instanceof HTMLElement) ||
        !(imagePanel instanceof HTMLElement) ||
        !(rightStack instanceof HTMLElement) ||
        !(imageCollapseButton instanceof HTMLButtonElement) ||
        !(rightCollapseButton instanceof HTMLButtonElement)
      ) {
        throw new Error('Missing panel height elements.');
      }

      return {
        mainLayoutHeight: mainLayout.getBoundingClientRect().height,
        imageShellHeight: imagePanel.getBoundingClientRect().height,
        rightShellHeight: rightStack.getBoundingClientRect().height,
        imageButtonHeight: imageCollapseButton.getBoundingClientRect().height,
        rightButtonHeight: rightCollapseButton.getBoundingClientRect().height
      };
    });
  };

  const initial = await readHeights();
  expect(Math.abs(initial.imageButtonHeight - initial.imageShellHeight)).toBeLessThan(3);
  expect(Math.abs(initial.rightButtonHeight - initial.rightShellHeight)).toBeLessThan(3);

  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('menuitem', { name: 'cbox_rgb.exr', exact: true }).click();
  await expect(page.locator('#opened-images-select option:checked')).toContainText('cbox_rgb.exr', { timeout: 30000 });
  await page.waitForTimeout(250);

  const afterOpen = await readHeights();
  expect(afterOpen.mainLayoutHeight).toBeCloseTo(initial.mainLayoutHeight, 0);
  expect(afterOpen.imageShellHeight).toBeCloseTo(initial.imageShellHeight, 0);
  expect(afterOpen.rightShellHeight).toBeCloseTo(initial.rightShellHeight, 0);
  expect(Math.abs(afterOpen.imageButtonHeight - afterOpen.imageShellHeight)).toBeLessThan(3);
  expect(Math.abs(afterOpen.rightButtonHeight - afterOpen.rightShellHeight)).toBeLessThan(3);
});

test('loads scalar Stokes channels and applies derived-channel defaults', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const openedImages = page.locator('#opened-images-select');
  await expect(openedImages.locator('option')).toHaveCount(0);

  await page.setInputFiles('#file-input', {
    name: 'stokes_scalar.exr',
    mimeType: 'image/exr',
    buffer: buildScalarStokesExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('stokes_scalar.exr', { timeout: 30000 });

  const channelSelect = page.locator('#rgb-group-select');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');
  await expect(channelSelect).toBeEnabled();
  await expect(rgbSplitToggleButton).toBeHidden();
  await expect(channelSelect.locator('option', { hasText: 'Stokes AoLP' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'Stokes DoLP' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'Stokes DoP' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'Stokes DoCP' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'Stokes CoP' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'Stokes ToP' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'Stokes S1/S0' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'Stokes S2/S0' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'Stokes S3/S0' })).toHaveCount(1);

  const colormapRangeControl = page.locator('#colormap-range-control');
  const colormapSelect = page.locator('#colormap-select');
  const colormapVminInput = page.locator('#colormap-vmin-input');
  const colormapVmaxInput = page.locator('#colormap-vmax-input');
  const colormapAutoRangeButton = page.getByRole('button', { name: 'Auto Range' });
  const colormapZeroCenterButton = page.getByRole('button', { name: 'Zero Center' });
  const stokesDegreeModulationButton = page.locator('#stokes-degree-modulation-button');
  const hsvId = String(expectedColormapLabels.indexOf('HSV'));
  const rdBuId = String(expectedColormapLabels.indexOf('RdBu'));
  const blackRedId = String(expectedColormapLabels.indexOf('Black-Red'));
  const yellowBlackBlueId = String(expectedColormapLabels.indexOf('Yellow-Black-Blue'));
  const yellowCyanYellowId = String(expectedColormapLabels.indexOf('Yellow-Cyan-Yellow'));

  expect(hsvId).not.toBe('-1');
  expect(rdBuId).not.toBe('-1');
  expect(blackRedId).not.toBe('-1');
  expect(yellowBlackBlueId).not.toBe('-1');
  expect(yellowCyanYellowId).not.toBe('-1');

  await channelSelect.selectOption({ label: 'Stokes AoLP' });
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapSelect).toHaveValue(hsvId);
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'false');
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoLP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'false');
  await stokesDegreeModulationButton.click();
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI, 6);

  await channelSelect.selectOption({ label: 'Stokes DoLP' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await channelSelect.selectOption({ label: 'Stokes DoP' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await channelSelect.selectOption({ label: 'Stokes DoCP' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await channelSelect.selectOption({ label: 'Stokes CoP' });
  await expect(colormapSelect).toHaveValue(yellowBlackBlueId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoCP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await stokesDegreeModulationButton.click();
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await channelSelect.selectOption({ label: 'Stokes ToP' });
  await expect(colormapSelect).toHaveValue(yellowCyanYellowId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await channelSelect.selectOption({ label: 'Stokes S1/S0' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(rdBuId);
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-1, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);
});

test('loads RGB Stokes channels and applies grouped and split derived defaults', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const openedImages = page.locator('#opened-images-select');
  await expect(openedImages.locator('option')).toHaveCount(0);

  await page.setInputFiles('#file-input', {
    name: 'stokes_rgb.exr',
    mimeType: 'image/exr',
    buffer: buildRgbStokesExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('stokes_rgb.exr', { timeout: 30000 });

  const channelSelect = page.locator('#rgb-group-select');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');
  await expect(channelSelect).toBeEnabled();
  await expect(rgbSplitToggleButton).toBeVisible();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'false');
  await expect(channelSelect.locator('option', { hasText: 'AoLP.(R,G,B)' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'DoLP.(R,G,B)' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'DoP.(R,G,B)' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'DoCP.(R,G,B)' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'CoP.(R,G,B)' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'ToP.(R,G,B)' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'S1/S0.(R,G,B)' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'S2/S0.(R,G,B)' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'S3/S0.(R,G,B)' })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^AoLP\.R$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^S0\.R$/ })).toHaveCount(0);

  const colormapRangeControl = page.locator('#colormap-range-control');
  const colormapSelect = page.locator('#colormap-select');
  const colormapVminInput = page.locator('#colormap-vmin-input');
  const colormapVmaxInput = page.locator('#colormap-vmax-input');
  const noneButton = page.getByRole('button', { name: 'None', exact: true });
  const colormapButton = page.getByRole('button', { name: 'Colormap' });
  const exposureControl = page.locator('#exposure-control');
  const colormapAutoRangeButton = page.getByRole('button', { name: 'Auto Range' });
  const colormapZeroCenterButton = page.getByRole('button', { name: 'Zero Center' });
  const stokesDegreeModulationButton = page.locator('#stokes-degree-modulation-button');
  const hsvId = String(expectedColormapLabels.indexOf('HSV'));
  const blackRedId = String(expectedColormapLabels.indexOf('Black-Red'));
  const yellowBlackBlueId = String(expectedColormapLabels.indexOf('Yellow-Black-Blue'));
  const yellowCyanYellowId = String(expectedColormapLabels.indexOf('Yellow-Cyan-Yellow'));
  const previousColormapId = String(expectedColormapLabels.indexOf('RdBu'));

  expect(hsvId).not.toBe('-1');
  expect(blackRedId).not.toBe('-1');
  expect(yellowBlackBlueId).not.toBe('-1');
  expect(yellowCyanYellowId).not.toBe('-1');
  expect(previousColormapId).not.toBe('-1');

  await channelSelect.selectOption({ label: 'AoLP.(R,G,B)' });
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapSelect).toHaveValue(hsvId);
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'false');
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoLP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI, 6);

  await channelSelect.selectOption({ label: 'S2/S0.(R,G,B)' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(previousColormapId);
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-1, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await channelSelect.selectOption({ label: 'AoLP.(R,G,B)' });
  await expect(colormapSelect).toHaveValue(hsvId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoLP Modulation');

  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(channelSelect.locator('option:checked')).toHaveText('AoLP.R');
  await expect(channelSelect.locator('option').filter({ hasText: /^AoLP\.\(R,G,B\)$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^AoLP\.R$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^AoLP\.G$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^AoLP\.B$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^S1\/S0\.R$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^S1\/S0\.G$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^S1\/S0\.B$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^S2\/S0\.R$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^S2\/S0\.G$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^S2\/S0\.B$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^S3\/S0\.R$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^S3\/S0\.G$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^S3\/S0\.B$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^S0\.\(R,G,B\)$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^S0\.R$/ })).toHaveCount(1);
  await expect(colormapSelect).toHaveValue(hsvId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoLP Modulation');

  await channelSelect.selectOption({ label: 'DoLP.G' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await channelSelect.selectOption({ label: 'DoP.B' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await channelSelect.selectOption({ label: 'DoCP.R' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await channelSelect.selectOption({ label: 'CoP.B' });
  await expect(colormapSelect).toHaveValue(yellowBlackBlueId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoCP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await channelSelect.selectOption({ label: 'ToP.B' });
  await expect(colormapSelect).toHaveValue(yellowCyanYellowId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await channelSelect.selectOption({ label: 'S3/S0.B' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(previousColormapId);
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-1, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await channelSelect.selectOption({ label: 'ToP.B' });

  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'false');
  await expect(channelSelect.locator('option:checked')).toHaveText('ToP.(R,G,B)');
  await expect(channelSelect.locator('option').filter({ hasText: /^R,G,B$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^ToP\.B$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^S0\.R$/ })).toHaveCount(0);
  await channelSelect.selectOption({ label: 'R,G,B' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(noneButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'false');
  await expect(exposureControl).toBeVisible();
  await expect(colormapRangeControl).toBeHidden();

  await colormapButton.click();
  await colormapSelect.selectOption({ label: 'RdBu' });
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapSelect).toHaveValue(previousColormapId);

  await channelSelect.selectOption({ label: 'ToP.(R,G,B)' });
  await expect(colormapSelect).toHaveValue(yellowCyanYellowId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await channelSelect.selectOption({ label: 'R,G,B' });
  await expect(noneButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(exposureControl).toBeHidden();
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapSelect).toHaveValue(previousColormapId);
});

test('keeps the selected split RGB Stokes channel when opening another matching image', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const openedImages = page.locator('#opened-images-select');
  const channelSelect = page.locator('#rgb-group-select');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');
  const colormapRangeControl = page.locator('#colormap-range-control');
  const colormapSelect = page.locator('#colormap-select');
  const rdBuId = String(expectedColormapLabels.indexOf('RdBu'));

  expect(rdBuId).not.toBe('-1');

  await page.setInputFiles('#file-input', {
    name: 'stokes_rgb_first.exr',
    mimeType: 'image/exr',
    buffer: buildRgbStokesExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('stokes_rgb_first.exr', { timeout: 30000 });

  await channelSelect.selectOption({ label: 'AoLP.(R,G,B)' });
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(channelSelect.locator('option:checked')).toHaveText('AoLP.R');
  await colormapSelect.selectOption({ label: 'RdBu' });
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapSelect).toHaveValue(rdBuId);

  await page.setInputFiles('#file-input', {
    name: 'stokes_rgb_second.exr',
    mimeType: 'image/exr',
    buffer: buildRgbStokesExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('stokes_rgb_second.exr', { timeout: 30000 });
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(channelSelect.locator('option:checked')).toHaveText('AoLP.R');
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapSelect).toHaveValue(rdBuId);
});

test('loads arbitrary scalar channels as grayscale display options', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const openedImages = page.locator('#opened-images-select');
  const channelSelect = page.locator('#rgb-group-select');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');
  const probeColorValues = page.locator('#probe-color-values');
  const viewer = page.locator('#viewer-container');

  await expect(openedImages.locator('option')).toHaveCount(0);

  await page.setInputFiles('#file-input', {
    name: 'scalar_z.exr',
    mimeType: 'image/exr',
    buffer: buildScalarChannelExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('scalar_z.exr', { timeout: 30000 });
  await expect(channelSelect).toBeEnabled();
  await expect(rgbSplitToggleButton).toBeHidden();
  await expect(channelSelect.locator('option:checked')).toHaveText('Z');
  await expect(channelSelect.locator('option').filter({ hasText: /^Z$/ })).toHaveCount(1);

  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);

  await page.setInputFiles('#file-input', {
    name: 'spectral.exr',
    mimeType: 'image/exr',
    buffer: buildSpectralExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('spectral.exr', { timeout: 30000 });
  await expect(channelSelect).toBeEnabled();
  await expect(rgbSplitToggleButton).toBeHidden();
  await expect(channelSelect.locator('option:checked')).toHaveText('400nm');
  await expect(channelSelect.locator('option').filter({ hasText: /^400nm,500nm,600nm$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^400nm$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^500nm$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^600nm$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^700nm$/ })).toHaveCount(1);

  await channelSelect.selectOption({ label: '500nm' });
  await expect(channelSelect.locator('option:checked')).toHaveText('500nm');
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);

  await page.setInputFiles('#file-input', {
    name: 'rgb_aux.exr',
    mimeType: 'image/exr',
    buffer: buildRgbAuxExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('rgb_aux.exr', { timeout: 30000 });
  await expect(channelSelect).toBeEnabled();
  await expect(rgbSplitToggleButton).toBeVisible();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'false');
  await expect(channelSelect.locator('option:checked')).toHaveText('R,G,B,A');
  await expect(channelSelect.locator('option').filter({ hasText: /^R$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^G$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^B$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^A$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^mask,A$/ })).toHaveCount(1);

  await channelSelect.selectOption({ label: 'mask,A' });
  await expect(channelSelect.locator('option:checked')).toHaveText('mask,A');
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:', 'A:']);

  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(channelSelect.locator('option:checked')).toHaveText('mask');
  await expect(channelSelect.locator('option').filter({ hasText: /^R,G,B,A$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^R$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^G$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^B$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^A$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^mask$/ })).toHaveCount(1);
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'false');
  await channelSelect.selectOption({ label: 'R,G,B,A' });
  await expect(channelSelect.locator('option:checked')).toHaveText('R,G,B,A');

  await page.setInputFiles('#file-input', {
    name: 'named_rgba.exr',
    mimeType: 'image/exr',
    buffer: buildNamedRgbaExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('named_rgba.exr', { timeout: 30000 });
  await expect(channelSelect.locator('option:checked')).toHaveText('beauty.(R,G,B,A)');

  await page.setInputFiles('#file-input', {
    name: 'named_rgb_bare_alpha.exr',
    mimeType: 'image/exr',
    buffer: buildNamedRgbBareAlphaExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('named_rgb_bare_alpha.exr', { timeout: 30000 });
  await expect(channelSelect.locator('option:checked')).toHaveText('beauty.(R,G,B)');

  await page.setInputFiles('#file-input', {
    name: 'scalar_alpha.exr',
    mimeType: 'image/exr',
    buffer: buildScalarAlphaExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('scalar_alpha.exr', { timeout: 30000 });
  await expect(channelSelect.locator('option:checked')).toHaveText('Z,A');
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:', 'A:']);

  await page.setInputFiles('#file-input', {
    name: 'depth_alpha.exr',
    mimeType: 'image/exr',
    buffer: buildDepthAlphaExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('depth_alpha.exr', { timeout: 30000 });
  await expect(channelSelect.locator('option:checked')).toHaveText('depth.Z,depth.A');
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:', 'A:']);
});

function buildScalarChannelExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['Z'],
      new Float32Array([
        0.25,
        0.5,
        0.75,
        1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

function buildSpectralExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['400nm', '500nm', '600nm', '700nm'],
      new Float32Array([
        0.1, 0.2, 0.3, 0.4,
        0.2, 0.3, 0.4, 0.5,
        0.3, 0.4, 0.5, 0.6,
        0.4, 0.5, 0.6, 0.7
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

function buildRgbAuxExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['R', 'G', 'B', 'A', 'mask'],
      new Float32Array([
        1, 0, 0, 0.25, 10,
        0, 1, 0, 0.5, 20,
        0, 0, 1, 0.75, 30,
        1, 1, 1, 1, 40
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

function buildNamedRgbaExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A'],
      new Float32Array([
        1, 0, 0, 0.25,
        0, 1, 0, 0.5,
        0, 0, 1, 0.75,
        1, 1, 1, 1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

function buildNamedRgbBareAlphaExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['beauty.R', 'beauty.G', 'beauty.B', 'A'],
      new Float32Array([
        1, 0, 0, 0.25,
        0, 1, 0, 0.5,
        0, 0, 1, 0.75,
        1, 1, 1, 1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

function buildScalarAlphaExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['Z', 'A'],
      new Float32Array([
        1, 0.25,
        0.5, 0.5,
        0.25, 0.75,
        0, 1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

function buildDepthAlphaExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['depth.Z', 'depth.A'],
      new Float32Array([
        1, 0.25,
        0.5, 0.5,
        0.25, 0.75,
        0, 1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

function buildScalarStokesExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['S0', 'S1', 'S2', 'S3'],
      new Float32Array([
        1, 1, 0, 0,
        1, 0, 1, 0,
        1, -1, 0, 0,
        1, 0, -1, 0
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

function buildRgbStokesExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      [
        'R', 'G', 'B',
        'S0.R', 'S0.G', 'S0.B',
        'S1.R', 'S1.G', 'S1.B',
        'S2.R', 'S2.G', 'S2.B',
        'S3.R', 'S3.G', 'S3.B'
      ],
      new Float32Array([
        0.8, 0.7, 0.6, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0,
        0.6, 0.7, 0.8, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0,
        0.4, 0.5, 0.6, 1, 1, 1, -1, 0, 0, 0, -1, 0, 0, 0, 0,
        0.2, 0.3, 0.4, 1, 1, 1, 0, -1, 0, -1, 0, 0, 0, 0, 0
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

function ensureExrEncoderInitialized(): void {
  if (exrEncoderInitialized) {
    return;
  }

  const wasmBytes = readFileSync(new URL('../src/vendor/exrs_raw_wasm_bindgen_bg.wasm', import.meta.url));
  initSync({ module: wasmBytes });
  exrEncoderInitialized = true;
}
