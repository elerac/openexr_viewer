import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

interface ColormapManifest {
  colormaps: Array<{
    label: string;
  }>;
}

const colormapManifest = JSON.parse(
  readFileSync(new URL('../public/colormaps/manifest.json', import.meta.url), 'utf8')
) as ColormapManifest;
const expectedColormapLabels = colormapManifest.colormaps.map((colormap) => colormap.label);

test('boots the default demo image and keeps core controls stable', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await expect(page.getByRole('heading', { name: 'Inspector' })).toBeVisible();
  await expect(page.locator('#gl-canvas')).toBeVisible();
  await expect(page.locator('#opened-images-select')).toBeVisible();

  const errorBanner = page.locator('#error-banner');
  const openedImages = page.locator('#opened-images-select');
  const layerControl = page.locator('#layer-control');
  const rgbGroupSelect = page.locator('#rgb-group-select');
  const probeCoords = page.locator('#probe-coords');
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
  await expect(layerControl).toBeHidden();

  await viewer.hover();
  await expect(probeCoords).not.toHaveText('(x: -, y: -)');
  await expect(probeValues).toContainText('R');
  await expect(probeValues).toContainText('G');
  await expect(probeValues).toContainText('B');
  await expect(rgbGroupSelect).toBeEnabled();
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

  await page.getByRole('button', { name: 'Reload', exact: true }).click();
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

  await page.locator('#close-opened-image-button').click();
  await expect(openedImages.locator('option')).toHaveCount(0, { timeout: 30000 });
  await expect(layerControl).toBeHidden();
  await expect(probeCoords).toHaveText('(x: -, y: -)');
});
