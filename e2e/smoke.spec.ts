import { expect, test } from '@playwright/test';

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

  const zoomBeforeWheel = (await page.locator('#zoom-readout').innerText()).trim();
  await page.mouse.wheel(0, -500);
  await expect(page.locator('#zoom-readout')).not.toHaveText(zoomBeforeWheel);

  const panBeforeDrag = (await page.locator('#pan-readout').innerText()).trim();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(360, 330);
  await page.mouse.up();
  await expect(page.locator('#pan-readout')).not.toHaveText(panBeforeDrag);

  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(layerControl).toBeHidden();
  await expect(rgbGroupSelect).toBeEnabled();

  await page.locator('#close-opened-image-button').click();
  await expect(openedImages.locator('option')).toHaveCount(0, { timeout: 30000 });
  await expect(layerControl).toBeHidden();
  await expect(probeCoords).toHaveText('(x: -, y: -)');
});
