import { expect, test, type Page } from '@playwright/test';

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
  const colormapButton = page.getByRole('button', { name: 'Colormap' });
  const colormapRangeControl = page.locator('#colormap-range-control');
  const colormapAutoRangeButton = page.getByRole('button', { name: 'Auto Range' });
  const colormapRangeSlider = page.locator('#colormap-range-slider');
  const colormapVminInput = page.locator('#colormap-vmin-input');
  const colormapVmaxInput = page.locator('#colormap-vmax-input');
  const colormapVmaxSlider = page.locator('#colormap-vmax-slider');

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
  await expect(colormapButton).toBeVisible();
  await expect(colormapButton).toBeEnabled();
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapButton).toHaveAttribute('aria-expanded', 'false');
  await expect(colormapRangeControl).toBeHidden();
  await expect(colormapAutoRangeButton).toHaveCount(0);
  await expect(colormapVminInput).toBeHidden();
  await expect(colormapVmaxInput).toBeHidden();
  await expect(colormapVmaxSlider).toBeHidden();

  const normalCanvasSamples = await sampleCanvasRgbGrid(page);
  expect(normalCanvasSamples.length).toBeGreaterThan(0);

  await colormapButton.click();
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapButton).toHaveAttribute('aria-expanded', 'true');
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapAutoRangeButton).toBeEnabled();
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'true');
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
  const colormapCanvasSamples = await waitForCanvasSamplesToChange(
    page,
    normalCanvasSamples,
    'canvas should re-render after enabling colormap'
  );

  const manualMax = (autoMin + autoMax) * 0.5;
  await colormapVmaxInput.fill(String(manualMax));
  await colormapVmaxInput.dispatchEvent('change');
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(manualMax, 5);
  await waitForCanvasSamplesToChange(
    page,
    colormapCanvasSamples,
    'canvas should re-render after updating vmax'
  );

  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(manualMax, 5);

  await colormapAutoRangeButton.click();
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(autoMin, 5);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(autoMax, 5);
  await expect.poll(() => sampleCanvasRgbGrid(page)).toEqual(colormapCanvasSamples);

  await colormapAutoRangeButton.click();
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(autoMin, 5);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(autoMax, 5);

  await colormapButton.click();
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapButton).toHaveAttribute('aria-expanded', 'false');
  await expect(colormapRangeControl).toBeHidden();
  await expect(colormapAutoRangeButton).toBeDisabled();
  await expect.poll(() => sampleCanvasRgbGrid(page)).toEqual(normalCanvasSamples);

  const zoomBeforeWheel = (await page.locator('#zoom-readout').innerText()).trim();
  await page.mouse.wheel(0, -500);
  await expect(page.locator('#zoom-readout')).not.toHaveText(zoomBeforeWheel);

  const panBeforeDrag = (await page.locator('#pan-readout').innerText()).trim();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(360, 330);
  await page.mouse.up();
  await expect(page.locator('#pan-readout')).not.toHaveText(panBeforeDrag);

  await expect(layerControl).toBeHidden();
  await expect(rgbGroupSelect).toBeEnabled();

  await page.locator('#close-opened-image-button').click();
  await expect(openedImages.locator('option')).toHaveCount(0, { timeout: 30000 });
  await expect(layerControl).toBeHidden();
  await expect(probeCoords).toHaveText('(x: -, y: -)');
});

async function sampleCanvasRgbGrid(page: Page): Promise<number[]> {
  return await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    const canvas = document.querySelector<HTMLCanvasElement>('#gl-canvas');
    if (!canvas) {
      return [];
    }

    if (canvas.width <= 0 || canvas.height <= 0) {
      return [];
    }

    const scratch = document.createElement('canvas');
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const context = scratch.getContext('2d');
    if (!context) {
      return [];
    }

    context.drawImage(canvas, 0, 0);

    const samples: number[] = [];
    const positions = [0.25, 0.375, 0.5, 0.625, 0.75];
    for (const yUnit of positions) {
      for (const xUnit of positions) {
        const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(canvas.width * xUnit)));
        const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(canvas.height * yUnit)));
        const pixel = context.getImageData(x, y, 1, 1).data;
        samples.push(pixel[0], pixel[1], pixel[2]);
      }
    }

    return samples;
  });
}

async function waitForCanvasSamplesToChange(
  page: Page,
  previousSamples: number[],
  message: string
): Promise<number[]> {
  let nextSamples: number[] = [];

  await expect
    .poll(
      async () => {
        nextSamples = await sampleCanvasRgbGrid(page);
        return !areSamplesEqual(nextSamples, previousSamples);
      },
      { message }
    )
    .toBe(true);

  return nextSamples;
}

function areSamplesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((value, index) => value === b[index]);
}
