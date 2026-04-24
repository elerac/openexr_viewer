import { expect, test } from '@playwright/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';
import {
  buildDepthAlphaExr,
  buildNamedRgbaExr,
  buildNamedRgbBareAlphaExr,
  buildRgbAuxExr,
  buildScalarAlphaExr,
  buildScalarChannelExr,
  buildSpectralExr
} from './helpers/exr-fixtures';
import { setExposureValue } from './helpers/viewer';

test('carries exposure when opening and switching files', async ({ page }) => {
  await gotoViewerApp(page);

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

test('loads arbitrary scalar channels as grayscale display options', async ({ page }) => {
  await gotoViewerApp(page);

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
  await expect(channelSelect.locator('option:checked')).toHaveText('RGBA');
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
  await expect(channelSelect.locator('option').filter({ hasText: /^RGBA$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^R$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^G$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^B$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^A$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^mask$/ })).toHaveCount(1);
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'false');
  await channelSelect.selectOption({ label: 'RGBA' });
  await expect(channelSelect.locator('option:checked')).toHaveText('RGBA');

  await page.setInputFiles('#file-input', {
    name: 'named_rgba.exr',
    mimeType: 'image/exr',
    buffer: buildNamedRgbaExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('named_rgba.exr', { timeout: 30000 });
  await expect(channelSelect.locator('option:checked')).toHaveText('beauty.RGBA');

  await page.setInputFiles('#file-input', {
    name: 'named_rgb_bare_alpha.exr',
    mimeType: 'image/exr',
    buffer: buildNamedRgbBareAlphaExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('named_rgb_bare_alpha.exr', { timeout: 30000 });
  await expect(channelSelect.locator('option:checked')).toHaveText('beauty.RGB');

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
