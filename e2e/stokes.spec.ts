import { expect, test } from '@playwright/test';
import { gotoViewerApp } from './helpers/app';
import { buildRgbStokesExr, buildScalarStokesExr, expectedColormapLabels } from './helpers/exr-fixtures';
import {
  flushAllIdleCallbacks,
  getPendingIdleCallbackCount,
  installIdleCallbackController
} from './helpers/idle-callbacks';
import { readImagePixel } from './helpers/viewer';

test('loads scalar Stokes channels and applies derived-channel defaults', async ({ page }) => {
  await gotoViewerApp(page);

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
  const stokesAolpModeControl = page.locator('#stokes-aolp-modulation-mode-control');
  const stokesAolpValueButton = page.locator('#stokes-aolp-modulation-value-button');
  const stokesAolpSaturationButton = page.locator('#stokes-aolp-modulation-saturation-button');
  const hsvId = String(expectedColormapLabels.indexOf('HSV'));
  const rdBuId = String(expectedColormapLabels.indexOf('RdBu'));
  const blackRedId = String(expectedColormapLabels.indexOf('Black-Red'));
  const yellowBlackBlueId = String(expectedColormapLabels.indexOf('Yellow-Black-Blue'));
  const yellowCyanYellowId = String(expectedColormapLabels.indexOf('Yellow-Cyan-Yellow'));
  const coolwarmId = String(expectedColormapLabels.indexOf('coolwarm'));

  expect(hsvId).not.toBe('-1');
  expect(rdBuId).not.toBe('-1');
  expect(blackRedId).not.toBe('-1');
  expect(yellowBlackBlueId).not.toBe('-1');
  expect(yellowCyanYellowId).not.toBe('-1');
  expect(coolwarmId).not.toBe('-1');

  await channelSelect.selectOption({ label: 'Stokes AoLP' });
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapSelect).toHaveValue(hsvId);
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'false');
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoLP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'false');
  await expect(stokesAolpModeControl).toBeVisible();
  await expect(stokesAolpValueButton).toHaveAttribute('aria-pressed', 'true');
  await expect(stokesAolpSaturationButton).toHaveAttribute('aria-pressed', 'false');
  await stokesDegreeModulationButton.click();
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await stokesAolpSaturationButton.click();
  await expect(stokesAolpValueButton).toHaveAttribute('aria-pressed', 'false');
  await expect(stokesAolpSaturationButton).toHaveAttribute('aria-pressed', 'true');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI, 6);

  await channelSelect.selectOption({ label: 'Stokes DoLP' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await channelSelect.selectOption({ label: 'Stokes AoLP' });
  await expect(stokesAolpModeControl).toBeVisible();
  await expect(stokesAolpValueButton).toHaveAttribute('aria-pressed', 'false');
  await expect(stokesAolpSaturationButton).toHaveAttribute('aria-pressed', 'true');

  await channelSelect.selectOption({ label: 'Stokes DoP' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await colormapSelect.selectOption({ label: 'coolwarm' });
  await expect(colormapSelect).toHaveValue(coolwarmId);
  await colormapVminInput.fill('0.2');
  await colormapVminInput.dispatchEvent('change');
  await colormapVmaxInput.fill('0.8');
  await colormapVmaxInput.dispatchEvent('change');
  await colormapVmaxInput.blur();
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0.2, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(0.8, 8);

  await channelSelect.selectOption({ label: 'Stokes DoCP' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(coolwarmId);
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0.2, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(0.8, 8);

  await channelSelect.selectOption({ label: 'Stokes CoP' });
  await expect(colormapSelect).toHaveValue(yellowBlackBlueId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoCP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expect(stokesAolpModeControl).toBeHidden();
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
  await expect(stokesAolpModeControl).toBeHidden();
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await channelSelect.selectOption({ label: 'Stokes S1/S0' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(rdBuId);
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-1, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await colormapZeroCenterButton.click();
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'false');
  await colormapSelect.selectOption({ label: 'coolwarm' });
  await expect(colormapSelect).toHaveValue(coolwarmId);
  await colormapVminInput.fill('-0.4');
  await colormapVminInput.dispatchEvent('change');
  await colormapVmaxInput.fill('0.6');
  await colormapVmaxInput.dispatchEvent('change');
  await colormapVmaxInput.blur();
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-0.4, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(0.6, 8);

  await channelSelect.selectOption({ label: 'Stokes S2/S0' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(coolwarmId);
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-0.4, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(0.6, 8);
});

test('loads RGB Stokes channels and applies grouped and split derived defaults', async ({ page }) => {
  await gotoViewerApp(page);

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
  await expect(channelSelect.locator('option', { hasText: 'AoLP.RGB' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'DoLP.RGB' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'DoP.RGB' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'DoCP.RGB' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'CoP.RGB' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'ToP.RGB' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'S1/S0.RGB' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'S2/S0.RGB' })).toHaveCount(1);
  await expect(channelSelect.locator('option', { hasText: 'S3/S0.RGB' })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^AoLP\.R$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^S0\.R$/ })).toHaveCount(0);

  const colormapRangeControl = page.locator('#colormap-range-control');
  const colormapSelect = page.locator('#colormap-select');
  const colormapVminInput = page.locator('#colormap-vmin-input');
  const colormapVmaxInput = page.locator('#colormap-vmax-input');
  const noneButton = page.locator('#visualization-none-button');
  const colormapButton = page.locator('#colormap-toggle-button');
  const exposureControl = page.locator('#exposure-control');
  const colormapAutoRangeButton = page.getByRole('button', { name: 'Auto Range' });
  const colormapZeroCenterButton = page.getByRole('button', { name: 'Zero Center' });
  const stokesDegreeModulationButton = page.locator('#stokes-degree-modulation-button');
  const probeColorValues = page.locator('#probe-color-values');
  const viewer = page.locator('#viewer-container');
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

  await channelSelect.selectOption({ label: 'AoLP.RGB' });
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapSelect).toHaveValue(hsvId);
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'false');
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoLP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI, 6);

  await noneButton.click();
  await expect(noneButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'false');
  await expect(exposureControl).toBeVisible();
  await expect(colormapRangeControl).toBeHidden();
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['R:', 'G:', 'B:']);

  await colormapButton.click();
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapRangeControl).toBeVisible();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);

  await channelSelect.selectOption({ label: 'S2/S0.RGB' });
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(previousColormapId);
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-1, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await channelSelect.selectOption({ label: 'AoLP.RGB' });
  await expect(colormapSelect).toHaveValue(hsvId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoLP Modulation');

  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(channelSelect.locator('option:checked')).toHaveText('AoLP.R');
  await expect(channelSelect.locator('option').filter({ hasText: /^AoLP\.RGB$/ })).toHaveCount(0);
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
  await expect(channelSelect.locator('option').filter({ hasText: /^S0\.RGB$/ })).toHaveCount(0);
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
  await expect(channelSelect.locator('option:checked')).toHaveText('ToP.RGB');
  await expect(channelSelect.locator('option').filter({ hasText: /^RGB$/ })).toHaveCount(1);
  await expect(channelSelect.locator('option').filter({ hasText: /^ToP\.B$/ })).toHaveCount(0);
  await expect(channelSelect.locator('option').filter({ hasText: /^S0\.R$/ })).toHaveCount(0);
  await channelSelect.selectOption({ label: 'RGB' });
  await expect(channelSelect.locator('option:checked')).toHaveText('RGB');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(noneButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'false');
  await expect(exposureControl).toBeVisible();
  await expect(colormapRangeControl).toBeHidden();

  await colormapButton.click();
  await colormapSelect.selectOption({ label: 'RdBu' });
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapSelect).toHaveValue(previousColormapId);

  await channelSelect.selectOption({ label: 'ToP.RGB' });
  await expect(colormapSelect).toHaveValue(yellowCyanYellowId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await channelSelect.selectOption({ label: 'RGB' });
  await expect(noneButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(exposureControl).toBeHidden();
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapSelect).toHaveValue(previousColormapId);
});

test('renders default-colormapped Stokes thumbnails in the bottom panel', async ({ page }) => {
  await installIdleCallbackController(page);
  await gotoViewerApp(page);

  const bottomPanelButton = page.locator('#bottom-panel-collapse-button');
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'true');

  await page.setInputFiles('#file-input', {
    name: 'stokes_scalar.exr',
    mimeType: 'image/exr',
    buffer: buildScalarStokesExr()
  });

  const scalarAolpTile = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile').filter({
    hasText: /^Stokes AoLP$/
  });
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).not.toBe(0);
  await flushAllIdleCallbacks(page);
  await expect(scalarAolpTile.locator('.channel-thumbnail-image')).toHaveCount(1);

  const scalarPixel = await readImagePixel(scalarAolpTile.locator('.channel-thumbnail-image'), 96, 96);
  expect(new Set(scalarPixel.slice(0, 3)).size).toBeGreaterThan(1);

  await page.setInputFiles('#file-input', {
    name: 'stokes_rgb.exr',
    mimeType: 'image/exr',
    buffer: buildRgbStokesExr()
  });

  const groupedAolpTile = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile').filter({
    hasText: /^AoLP\.RGB$/
  });
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).not.toBe(0);
  await flushAllIdleCallbacks(page);
  await expect(groupedAolpTile.locator('.channel-thumbnail-image')).toHaveCount(1);

  const groupedPixel = await readImagePixel(groupedAolpTile.locator('.channel-thumbnail-image'), 96, 96);
  expect(new Set(groupedPixel.slice(0, 3)).size).toBeGreaterThan(1);
});

test('keeps the selected split RGB Stokes channel when opening another matching image', async ({ page }) => {
  await gotoViewerApp(page);

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

  await channelSelect.selectOption({ label: 'AoLP.RGB' });
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
