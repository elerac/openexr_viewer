import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoViewerApp, waitForE2ERenderIdle } from './helpers/app';
import {
  buildLinearScalarStokesExr,
  buildRgbStokesExr,
  buildScalarStokesExr,
  expectedColormapLabels
} from './helpers/exr-fixtures';
import {
  flushAllIdleCallbacks,
  getPendingIdleCallbackCount,
  installIdleCallbackController
} from './helpers/idle-callbacks';
import {
  clickChannelStackToggle,
  expectColormapAutoRange,
  expectColormapDisplayMode,
  expectColormapZeroCentered,
  expectRgbDisplayMode,
  getChannelStackToggle,
  readImagePixel,
  selectColormapPalette,
  selectPaletteNone
} from './helpers/viewer';

function exactText(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

function channelTileByLabel(page: Page, label: string): Locator {
  return page.locator('#channel-thumbnail-strip .channel-thumbnail-tile').filter({ hasText: exactText(label) });
}

function selectedChannelTile(page: Page): Locator {
  return page.locator('#channel-thumbnail-strip .channel-thumbnail-tile[aria-selected="true"]');
}

async function selectChannelTile(page: Page, label: string): Promise<void> {
  await channelTileByLabel(page, label).click();
  await waitForE2ERenderIdle(page);
}

async function expectThumbnailImageAfterIdleFlush(page: Page, tile: Locator): Promise<void> {
  const image = tile.locator('.channel-thumbnail-image');
  await expect
    .poll(async () => {
      await flushAllIdleCallbacks(page);
      return await image.count();
    }, { timeout: 30000 })
    .toBe(1);
}

test('loads scalar Stokes channels and applies derived-channel defaults @smoke', async ({ page }) => {
  test.slow();
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  await expect(openedImages.locator('option')).toHaveCount(0);

  await page.setInputFiles('#file-input', {
    name: 'stokes_scalar.exr',
    mimeType: 'image/exr',
    buffer: buildScalarStokesExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('stokes_scalar.exr', { timeout: 30000 });

  await expect(channelTileByLabel(page, 'Stokes AoLP')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes DoLP')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes DoP')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes DoCP')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes CoP')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes ToP')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes S1/S0')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes S2/S0')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes S3/S0')).toHaveCount(1);

  const colormapRangeControl = page.locator('#colormap-range-control');
  const colormapSelect = page.locator('#colormap-select');
  const colormapVminInput = page.locator('#colormap-vmin-input');
  const colormapVmaxInput = page.locator('#colormap-vmax-input');
  const colormapZeroCenterButton = page.locator('#colormap-zero-center-button');
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

  await selectChannelTile(page, 'Stokes AoLP');
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapSelect).toHaveValue(hsvId);
  await expectColormapAutoRange(page, false);
  await expectColormapZeroCentered(page, false);
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

  await selectChannelTile(page, 'Stokes DoLP');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await selectChannelTile(page, 'Stokes AoLP');
  await expect(stokesAolpModeControl).toBeVisible();
  await expect(stokesAolpValueButton).toHaveAttribute('aria-pressed', 'false');
  await expect(stokesAolpSaturationButton).toHaveAttribute('aria-pressed', 'true');

  await selectChannelTile(page, 'Stokes DoP');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await selectColormapPalette(page, 'coolwarm');
  await expect(colormapSelect).toHaveValue(coolwarmId);
  await expectColormapZeroCentered(page, true);
  await colormapVminInput.fill('0.2');
  await colormapVminInput.dispatchEvent('change');
  await colormapVmaxInput.fill('0.8');
  await colormapVmaxInput.dispatchEvent('change');
  await colormapVmaxInput.blur();
  await expectColormapZeroCentered(page, true);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-0.8, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(0.8, 8);

  await selectChannelTile(page, 'Stokes DoCP');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(coolwarmId);
  await expectColormapZeroCentered(page, true);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-0.8, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(0.8, 8);

  await selectChannelTile(page, 'Stokes CoP');
  await expect(colormapSelect).toHaveValue(yellowBlackBlueId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoCP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expect(stokesAolpModeControl).toBeHidden();
  await expectColormapZeroCentered(page, true);
  await stokesDegreeModulationButton.click();
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await selectChannelTile(page, 'Stokes ToP');
  await expect(colormapSelect).toHaveValue(yellowCyanYellowId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expect(stokesAolpModeControl).toBeHidden();
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await selectChannelTile(page, 'Stokes S1/S0');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(rdBuId);
  await expectColormapZeroCentered(page, true);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-1, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await colormapZeroCenterButton.click();
  await expectColormapZeroCentered(page, false);
  await selectColormapPalette(page, 'coolwarm');
  await expect(colormapSelect).toHaveValue(coolwarmId);
  await expectColormapZeroCentered(page, true);
  await colormapVminInput.fill('-0.4');
  await colormapVminInput.dispatchEvent('change');
  await colormapVmaxInput.fill('0.6');
  await colormapVmaxInput.dispatchEvent('change');
  await colormapVmaxInput.blur();
  await expectColormapZeroCentered(page, true);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-0.6, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(0.6, 8);

  await selectChannelTile(page, 'Stokes S2/S0');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(coolwarmId);
  await expectColormapZeroCentered(page, true);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-0.6, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(0.6, 8);
});

test('loads linear-only scalar Stokes channels without S3-derived options', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  await page.setInputFiles('#file-input', {
    name: 'stokes_linear_scalar.exr',
    mimeType: 'image/exr',
    buffer: buildLinearScalarStokesExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('stokes_linear_scalar.exr', { timeout: 30000 });

  const stokesDegreeModulationButton = page.locator('#stokes-degree-modulation-button');
  const stokesAolpModeControl = page.locator('#stokes-aolp-modulation-mode-control');
  const colormapSelect = page.locator('#colormap-select');
  const colormapVminInput = page.locator('#colormap-vmin-input');
  const colormapVmaxInput = page.locator('#colormap-vmax-input');
  const blackRedId = String(expectedColormapLabels.indexOf('Black-Red'));

  expect(blackRedId).not.toBe('-1');
  await expect(channelTileByLabel(page, 'Stokes S1/S0')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes S2/S0')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes AoLP')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes DoP')).toHaveCount(0);
  await expect(channelTileByLabel(page, 'Stokes DoLP')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'Stokes S3/S0')).toHaveCount(0);
  await expect(channelTileByLabel(page, 'Stokes DoCP')).toHaveCount(0);
  await expect(channelTileByLabel(page, 'Stokes CoP')).toHaveCount(0);
  await expect(channelTileByLabel(page, 'Stokes ToP')).toHaveCount(0);

  await selectChannelTile(page, 'Stokes DoLP');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(stokesAolpModeControl).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);
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

  await expect(getChannelStackToggle(page, 'stokesRgb:aolp:group')).toHaveText('3');
  await expect(channelTileByLabel(page, 'AoLP.RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'DoLP.RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'DoP.RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'DoCP.RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'CoP.RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'ToP.RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'S1/S0.RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'S2/S0.RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'S3/S0.RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'AoLP.R')).toHaveCount(0);
  await expect(channelTileByLabel(page, 'S0.R')).toHaveCount(0);

  const colormapRangeControl = page.locator('#colormap-range-control');
  const colormapSelect = page.locator('#colormap-select');
  const colormapVminInput = page.locator('#colormap-vmin-input');
  const colormapVmaxInput = page.locator('#colormap-vmax-input');
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

  await selectChannelTile(page, 'AoLP.RGB');
  await expect(colormapRangeControl).toBeVisible();
  await expect(colormapSelect).toHaveValue(hsvId);
  await expectColormapAutoRange(page, false);
  await expectColormapZeroCentered(page, false);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoLP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI, 6);

  await selectPaletteNone(page);
  await expectRgbDisplayMode(page);
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['R:', 'G:', 'B:']);

  await selectColormapPalette(page, 'HSV');
  await expectColormapDisplayMode(page, 'HSV');
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);

  await selectChannelTile(page, 'S2/S0.RGB');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(previousColormapId);
  await expectColormapZeroCentered(page, true);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-1, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await selectChannelTile(page, 'AoLP.RGB');
  await expect(colormapSelect).toHaveValue(hsvId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoLP Modulation');

  await clickChannelStackToggle(page, 'stokesRgb:aolp:group');
  await expect(selectedChannelTile(page)).toHaveText('AoLP.R');
  await expect(channelTileByLabel(page, 'AoLP.RGB')).toHaveCount(0);
  await expect(channelTileByLabel(page, 'AoLP.R')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'AoLP.G')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'AoLP.B')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'S1/S0.R')).toHaveCount(0);
  await expect(channelTileByLabel(page, 'S2/S0.R')).toHaveCount(0);
  await expect(channelTileByLabel(page, 'S3/S0.R')).toHaveCount(0);
  await expect(channelTileByLabel(page, 'S0.RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'S0.R')).toHaveCount(0);
  await expect(colormapSelect).toHaveValue(hsvId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoLP Modulation');

  await clickChannelStackToggle(page, 'stokesRgb:dolp:group');
  await selectChannelTile(page, 'DoLP.G');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await clickChannelStackToggle(page, 'stokesRgb:dop:group');
  await selectChannelTile(page, 'DoP.B');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await clickChannelStackToggle(page, 'stokesRgb:docp:group');
  await selectChannelTile(page, 'DoCP.R');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(blackRedId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(0, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await clickChannelStackToggle(page, 'stokesRgb:cop:group');
  await selectChannelTile(page, 'CoP.B');
  await expect(colormapSelect).toHaveValue(yellowBlackBlueId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoCP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expectColormapZeroCentered(page, true);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await clickChannelStackToggle(page, 'stokesRgb:top:group');
  await selectChannelTile(page, 'ToP.B');
  await expect(colormapSelect).toHaveValue(yellowCyanYellowId);
  await expect(stokesDegreeModulationButton).toBeVisible();
  await expect(stokesDegreeModulationButton).toHaveText('DoP Modulation');
  await expect(stokesDegreeModulationButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await clickChannelStackToggle(page, 'stokesRgb:s3_over_s0:group');
  await selectChannelTile(page, 'S3/S0.B');
  await expect(selectedChannelTile(page)).toHaveText('S3/S0.B');
  await expect(stokesDegreeModulationButton).toBeHidden();
  await expect(colormapSelect).toHaveValue(previousColormapId);
  await expectColormapZeroCentered(page, true);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-1, 8);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(1, 8);

  await selectChannelTile(page, 'ToP.B');

  await clickChannelStackToggle(page, 'stokesRgb:top:B');
  await expect(selectedChannelTile(page)).toHaveText('ToP.RGB');
  await expect(channelTileByLabel(page, 'RGB')).toHaveCount(1);
  await expect(channelTileByLabel(page, 'ToP.B')).toHaveCount(0);
  await expect(channelTileByLabel(page, 'S0.R')).toHaveCount(0);
  await selectChannelTile(page, 'RGB');
  await expect(selectedChannelTile(page)).toHaveText('RGB');
  await selectPaletteNone(page);
  await expectRgbDisplayMode(page);
  await expect(stokesDegreeModulationButton).toBeHidden();

  await selectColormapPalette(page, 'RdBu');
  await expectColormapDisplayMode(page, 'RdBu');
  await expect(colormapSelect).toHaveValue(previousColormapId);

  await selectChannelTile(page, 'ToP.RGB');
  await expect(colormapSelect).toHaveValue(yellowCyanYellowId);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-Math.PI / 4, 6);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(Math.PI / 4, 6);

  await selectChannelTile(page, 'RGB');
  await expectColormapDisplayMode(page, 'RdBu');
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
  await expectThumbnailImageAfterIdleFlush(page, scalarAolpTile);

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
  await expectThumbnailImageAfterIdleFlush(page, groupedAolpTile);

  const groupedPixel = await readImagePixel(groupedAolpTile.locator('.channel-thumbnail-image'), 96, 96);
  expect(new Set(groupedPixel.slice(0, 3)).size).toBeGreaterThan(1);
});

test('keeps RGB Stokes stack controls coherent when opening another matching image', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const colormapRangeControl = page.locator('#colormap-range-control');

  await page.setInputFiles('#file-input', {
    name: 'stokes_rgb_first.exr',
    mimeType: 'image/exr',
    buffer: buildRgbStokesExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('stokes_rgb_first.exr', { timeout: 30000 });

  await selectChannelTile(page, 'AoLP.RGB');
  await clickChannelStackToggle(page, 'stokesRgb:aolp:group');
  await expect(selectedChannelTile(page)).toHaveText('AoLP.R');
  await selectColormapPalette(page, 'RdBu');
  await expect(colormapRangeControl).toBeVisible();
  await expect(selectedChannelTile(page)).toHaveText('AoLP.R');
  await page.waitForTimeout(120);

  await page.setInputFiles('#file-input', {
    name: 'stokes_rgb_second.exr',
    mimeType: 'image/exr',
    buffer: buildRgbStokesExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('stokes_rgb_second.exr', { timeout: 30000 });
  await expect.poll(async () => (await selectedChannelTile(page).textContent())?.trim()).toMatch(/^AoLP\.R(?:GB)?$/);
  const selectedText = (await selectedChannelTile(page).textContent())?.trim();
  if (selectedText === 'AoLP.R') {
    await expect(channelTileByLabel(page, 'AoLP.R')).toHaveCount(1);
    await expect(getChannelStackToggle(page, 'stokesRgb:aolp:R')).toHaveText('1/3');
  } else {
    await expect(channelTileByLabel(page, 'AoLP.R')).toHaveCount(0);
    await expect(getChannelStackToggle(page, 'stokesRgb:aolp:group')).toHaveText('3');
  }
  await expect(colormapRangeControl).toBeVisible();
});
