import { expect, test, type Locator } from '@playwright/test';
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

test('boots the default demo image and keeps core controls stable', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await expect(page.getByRole('heading', { name: 'Inspector' })).toBeVisible();
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
  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });
  await expect(openedImages.locator('option').first()).toContainText('cbox_rgb.exr');
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(page.locator('#reload-opened-image-button')).toHaveCount(0);
  await expect(page.locator('#close-opened-image-button')).toHaveCount(0);
  await expect(openedFileRow).toHaveCount(1);
  await expect(openedFileRow.locator('.image-browser-row-meta')).toHaveCount(0);
  await expect(reloadOpenedFileButton).toBeVisible();
  await expect(closeOpenedFileButton).toBeVisible();
  await expect(openedFileRow.locator('.opened-file-label')).toHaveAttribute('title', /Path: .*cbox_rgb\.exr\nSize: .* MB/);
  await expect(layerControl).toBeHidden();

  await viewer.hover();
  await expect(probeCoords).not.toHaveText('(x: -, y: -)');
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

  const zoomBeforeWheel = (await page.locator('#zoom-readout').innerText()).trim();
  const wheelPoint = await getViewerPoint(0.5, 0.5);
  await page.mouse.move(wheelPoint.x, wheelPoint.y);
  await page.mouse.wheel(0, -500);
  await expect(page.locator('#zoom-readout')).not.toHaveText(zoomBeforeWheel);

  const panBeforeDrag = (await page.locator('#pan-readout').innerText()).trim();
  const dragStart = await getViewerPoint(0.45, 0.45);
  const dragEnd = await getViewerPoint(0.55, 0.5);
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y);
  await page.mouse.up();
  await expect(page.locator('#pan-readout')).not.toHaveText(panBeforeDrag);

  await expect(layerControl).toBeHidden();
  await expect(rgbGroupSelect).toBeEnabled();

  await closeOpenedFileButton.click();
  await expect(openedImages.locator('option')).toHaveCount(0, { timeout: 30000 });
  await expect(layerControl).toBeHidden();
  await expect(probeCoords).toHaveText('(x: -, y: -)');
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

test('resizes desktop panel splits and persists them', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await page.waitForTimeout(1500);

  const errorBanner = page.locator('#error-banner');
  if (await errorBanner.isVisible()) {
    await expect(errorBanner).toContainText('WebGL2 is required');
    return;
  }

  const imageResizer = page.locator('#image-panel-resizer');
  const rightResizer = page.locator('#right-panel-resizer');
  const histogramResizer = page.locator('#histogram-panel-resizer');
  const viewer = page.locator('#viewer-container');

  await expect(imageResizer).toBeVisible();
  await expect(rightResizer).toBeVisible();
  await expect(histogramResizer).toBeVisible();

  const readLayout = async () => {
    return await page.evaluate(() => {
      const imagePanel = document.querySelector('#image-panel');
      const rightStack = document.querySelector('#right-stack');
      const histogramPanel = document.querySelector('#histogram-panel');
      const histogramSvg = document.querySelector('#histogram-svg');
      const viewerContainer = document.querySelector('#viewer-container');
      const canvas = document.querySelector('#gl-canvas');
      if (
        !(imagePanel instanceof HTMLElement) ||
        !(rightStack instanceof HTMLElement) ||
        !(histogramPanel instanceof HTMLElement) ||
        !(histogramSvg instanceof SVGSVGElement) ||
        !(viewerContainer instanceof HTMLElement) ||
        !(canvas instanceof HTMLCanvasElement)
      ) {
        throw new Error('Missing layout elements.');
      }

      return {
        imageWidth: imagePanel.getBoundingClientRect().width,
        rightWidth: rightStack.getBoundingClientRect().width,
        histogramHeight: histogramPanel.getBoundingClientRect().height,
        histogramSvgHeight: histogramSvg.getBoundingClientRect().height,
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
  await dragBy(imageResizer, 48, 0);
  const afterImageResize = await readLayout();
  expect(afterImageResize.imageWidth).toBeGreaterThan(initial.imageWidth + 30);
  expect(afterImageResize.viewerWidth).toBeGreaterThan(360);

  await dragBy(rightResizer, -48, 0);
  const afterRightResize = await readLayout();
  expect(afterRightResize.rightWidth).toBeGreaterThan(afterImageResize.rightWidth + 30);
  expect(afterRightResize.canvasWidth).toBeGreaterThan(0);
  expect(afterRightResize.canvasHeight).toBeGreaterThan(0);

  await dragBy(histogramResizer, 0, 48);
  const afterHistogramResize = await readLayout();
  expect(afterHistogramResize.histogramHeight).toBeGreaterThan(afterRightResize.histogramHeight + 30);
  expect(afterHistogramResize.histogramSvgHeight).toBeGreaterThan(afterRightResize.histogramSvgHeight + 20);
  expect(afterHistogramResize.stored).not.toBeNull();

  const stored = JSON.parse(afterHistogramResize.stored ?? '{}') as {
    imagePanelWidth?: number;
    rightPanelWidth?: number;
    histogramPanelHeight?: number;
  };
  expect(stored.imagePanelWidth).toBeCloseTo(afterHistogramResize.imageWidth, 0);
  expect(stored.rightPanelWidth).toBeCloseTo(afterHistogramResize.rightWidth, 0);
  expect(stored.histogramPanelHeight).toBeCloseTo(afterHistogramResize.histogramHeight, 0);

  await page.reload();
  await page.waitForTimeout(1500);
  const afterReload = await readLayout();
  expect(afterReload.imageWidth).toBeCloseTo(afterHistogramResize.imageWidth, 0);
  expect(afterReload.rightWidth).toBeCloseTo(afterHistogramResize.rightWidth, 0);
  expect(afterReload.histogramHeight).toBeCloseTo(afterHistogramResize.histogramHeight, 0);

  await page.setViewportSize({ width: 800, height: 700 });
  await expect(imageResizer).toBeHidden();
  await expect(rightResizer).toBeHidden();
  await expect(histogramResizer).toBeHidden();
  await expect(viewer).toBeVisible();
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
  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });

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
  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });

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

  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });

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
  await expect(channelSelect.locator('option').filter({ hasText: /^A$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^mask$/ })).toHaveCount(1);

  await channelSelect.selectOption({ label: 'mask' });
  await expect(channelSelect.locator('option:checked')).toHaveText('mask');
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);

  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(channelSelect.locator('option:checked')).toHaveText('mask');
  await expect(channelSelect.locator('option').filter({ hasText: /^R,G,B,A$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^R$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^G$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^B$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^A$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^mask$/ })).toHaveCount(1);
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
