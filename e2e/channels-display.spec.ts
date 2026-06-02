import { expect, test, type Locator } from './helpers/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';
import {
  buildAutoExposureRgbExr,
  buildDepthAlphaExr,
  buildDuplicateWavelengthSpectralExr,
  buildNamedRgbaExr,
  buildNamedRgbBareAlphaExr,
  buildRgbAuxExr,
  buildScalarAlphaExr,
  buildScalarChannelExr,
  buildSpectralExr,
  buildSpectralStokesExr
} from './helpers/exr-fixtures';
import {
  clickChannelStackToggle,
  dragBy,
  expectColormapDisplayMode,
  expectRgbDisplayMode,
  getChannelStackToggle,
  getChannelThumbnailTile,
  getSelectedChannelThumbnailTile,
  resolveViewerPoint,
  selectColormapPalette,
  selectPaletteNone,
  setExposureValue
} from './helpers/viewer';

async function readSpectralPlotMetrics(spectralPlot: Locator): Promise<{
  svgWidth: number;
  tickLabelHeight: number;
}> {
  return await spectralPlot.evaluate((element) => {
    const svg = element.querySelector('svg');
    const tickLabel = element.querySelector('.spectral-tick-label');
    if (!(svg instanceof SVGSVGElement) || !(tickLabel instanceof SVGTextElement)) {
      throw new Error('Spectral plot SVG tick label was not rendered.');
    }

    return {
      svgWidth: svg.getBoundingClientRect().width,
      tickLabelHeight: tickLabel.getBoundingClientRect().height
    };
  });
}

test('carries exposure when opening and switching files @smoke', async ({ page }) => {
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

test('auto exposure updates in None mode and pauses while Colormap is active', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const autoExposureButton = page.locator('#app-auto-exposure-button');
  const exposureValue = page.locator('#exposure-value');

  await page.setInputFiles('#file-input', {
    name: 'auto_exposure.exr',
    mimeType: 'image/exr',
    buffer: buildAutoExposureRgbExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('auto_exposure.exr', { timeout: 30000 });
  await expect(exposureValue).toHaveValue('0.0');

  await selectColormapPalette(page, 'Viridis');
  await expectColormapDisplayMode(page, 'Viridis');

  await autoExposureButton.click();
  await expect(autoExposureButton).toHaveAttribute('aria-pressed', 'true');
  await expect(exposureValue).toHaveValue('0.0');

  await selectPaletteNone(page);
  await expectRgbDisplayMode(page);
  await expect(exposureValue).toHaveValue('-3.0', { timeout: 30000 });
});

test('loads arbitrary scalar channels as grayscale display options', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const channelTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');
  const selectedChannelTile = getSelectedChannelThumbnailTile(page);
  const probeColorValues = page.locator('#probe-color-values');
  const spectralPanel = page.locator('#spectral-panel');
  const spectralPlot = page.locator('#spectral-plot');
  const rightPanelResizer = page.locator('#right-panel-resizer');
  const viewer = page.locator('#viewer-container');

  await expect(openedImages.locator('option')).toHaveCount(0);

  await page.setInputFiles('#file-input', {
    name: 'scalar_z.exr',
    mimeType: 'image/exr',
    buffer: buildScalarChannelExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('scalar_z.exr', { timeout: 30000 });
  await expect(channelTiles).toHaveCount(1);
  await expect(selectedChannelTile).toHaveText('Z');

  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);
  await expect(spectralPanel).toBeHidden();

  await page.setInputFiles('#file-input', {
    name: 'spectral.exr',
    mimeType: 'image/exr',
    buffer: buildSpectralExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('spectral.exr', { timeout: 30000 });
  await expect(getChannelStackToggle(page, 'spectralRgb:')).toHaveText('4');
  await expect(selectedChannelTile).toHaveText('Spectral RGB');
  await expect(channelTiles.filter({ hasText: /^Spectral RGB$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^400nm,500nm,600nm$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^400nm$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^500nm$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^600nm$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^700nm$/ })).toHaveCount(0);
  await expect(spectralPanel).toBeVisible();
  await expect(page.locator('#spectral-empty-state')).toHaveText('');
  await expect(spectralPlot).toBeVisible();
  await expect(spectralPlot.locator('.spectral-point')).toHaveCount(0);
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['R:', 'G:', 'B:']);
  await expect(spectralPlot.locator('.spectral-point')).toHaveCount(4);

  await clickChannelStackToggle(page, 'spectralRgb:');
  await expect(selectedChannelTile).toHaveText('400nm');
  await expect(channelTiles.filter({ hasText: /^Spectral RGB$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^400nm$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^500nm$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^600nm$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^700nm$/ })).toHaveCount(1);

  await getChannelThumbnailTile(page, 'channel:500nm').click();
  await expect(selectedChannelTile).toHaveText('500nm');
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);
  await expect(spectralPlot).toBeVisible();
  await expect(spectralPlot.locator('.spectral-point')).toHaveCount(4);
  await expect(spectralPlot.locator('.spectral-point').nth(0)).toHaveAttribute('data-wavelength', '400');
  await expect(spectralPlot.locator('.spectral-point').nth(1)).toHaveAttribute('data-wavelength', '500');
  await expect(spectralPlot.locator('.spectral-point').nth(2)).toHaveAttribute('data-wavelength', '600');
  await expect(spectralPlot.locator('.spectral-point').nth(3)).toHaveAttribute('data-wavelength', '700');

  const lockedSpectralPoint = await resolveViewerPoint(viewer, 0.5, 0.5);
  await page.mouse.click(lockedSpectralPoint.x, lockedSpectralPoint.y);
  await expect(page.locator('#probe-mode')).toHaveText('Locked');
  await expect(spectralPlot).toBeVisible();

  const initialSpectralPlotMetrics = await readSpectralPlotMetrics(spectralPlot);
  expect(initialSpectralPlotMetrics.tickLabelHeight).toBeGreaterThan(0);

  await dragBy(page, rightPanelResizer, -80, 0);

  await expect.poll(async () => {
    return (await readSpectralPlotMetrics(spectralPlot)).svgWidth;
  }).toBeGreaterThan(initialSpectralPlotMetrics.svgWidth + 30);
  const resizedSpectralPlotMetrics = await readSpectralPlotMetrics(spectralPlot);
  expect(resizedSpectralPlotMetrics.svgWidth).toBeGreaterThan(initialSpectralPlotMetrics.svgWidth + 30);
  expect(Math.abs(resizedSpectralPlotMetrics.tickLabelHeight - initialSpectralPlotMetrics.tickLabelHeight))
    .toBeLessThan(1);

  await clickChannelStackToggle(page, 'channel:500nm');
  await expect(selectedChannelTile).toHaveText('Spectral RGB');

  await page.setInputFiles('#file-input', {
    name: 'duplicate_wavelength_spectral.exr',
    mimeType: 'image/exr',
    buffer: buildDuplicateWavelengthSpectralExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('duplicate_wavelength_spectral.exr', {
    timeout: 30000
  });
  await expect(selectedChannelTile).toHaveText(/^(fuga|hoge) Spectral RGB$/);
  await expect(channelTiles.filter({ hasText: /^fuga Spectral RGB$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^hoge Spectral RGB$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^hoge\.414nm$/ })).toHaveCount(0);
  await expect(spectralPanel).toBeVisible();
  await viewer.hover();
  await expect(spectralPlot.locator('.spectral-point')).toHaveCount(2);
  await expect(spectralPlot.locator('.spectral-point').nth(0)).toHaveAttribute('data-channel', /^(fuga|hoge)\.414nm$/);
  await expect(spectralPlot.locator('.spectral-point').nth(0)).toHaveAttribute('data-wavelength', '414');
  await expect(spectralPlot.locator('.spectral-point').nth(1)).toHaveAttribute('data-channel', /^(fuga|hoge)\.453nm$/);
  await expect(spectralPlot.locator('.spectral-point').nth(1)).toHaveAttribute('data-wavelength', '453');

  await clickChannelStackToggle(page, 'spectralRgb:hoge');
  await expect(channelTiles.filter({ hasText: /^fuga Spectral RGB$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^hoge Spectral RGB$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^hoge\.414nm$/ })).toHaveCount(1);

  await getChannelThumbnailTile(page, 'channel:hoge.414nm').click();
  await expect(selectedChannelTile).toHaveText('hoge.414nm');
  await expect(spectralPlot.locator('.spectral-point')).toHaveCount(2);
  await expect(spectralPlot.locator('.spectral-point').nth(0)).toHaveAttribute('data-channel', 'hoge.414nm');
  await expect(spectralPlot.locator('.spectral-point').nth(0)).toHaveAttribute('data-wavelength', '414');
  await expect(spectralPlot.locator('.spectral-point').nth(1)).toHaveAttribute('data-channel', 'hoge.453nm');
  await expect(spectralPlot.locator('.spectral-point').nth(1)).toHaveAttribute('data-wavelength', '453');

  await clickChannelStackToggle(page, 'channel:hoge.414nm');

  await page.setInputFiles('#file-input', {
    name: 'spectral_stokes.exr',
    mimeType: 'image/exr',
    buffer: buildSpectralStokesExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('spectral_stokes.exr', { timeout: 30000 });
  await expect(channelTiles.filter({ hasText: /^S1\/S0 Spectral RGB$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^AoLP Spectral RGB$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^S1\/S0\.400nm$/ })).toHaveCount(0);
  await getChannelThumbnailTile(page, 'stokesSpectralRgb:s1_over_s0:group').click();
  await expect(selectedChannelTile).toHaveText('S1/S0 Spectral RGB');

  await clickChannelStackToggle(page, 'stokesSpectralRgb:s1_over_s0:group');
  await expect(channelTiles.filter({ hasText: /^S1\/S0 Spectral RGB$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^S1\/S0\.400nm$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^AoLP\.500nm$/ })).toHaveCount(0);
  await getChannelThumbnailTile(page, 'stokesScalar:s1_over_s0:400nm').click();
  await expect(selectedChannelTile).toHaveText('S1/S0.400nm');

  await page.setInputFiles('#file-input', {
    name: 'rgb_aux.exr',
    mimeType: 'image/exr',
    buffer: buildRgbAuxExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('rgb_aux.exr', { timeout: 30000 });
  await expect(spectralPanel).toBeHidden();
  await expect(selectedChannelTile).toHaveText('RGBA');
  await expect(channelTiles.filter({ hasText: /^R$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^G$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^B$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^A$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^mask,A$/ })).toHaveCount(1);

  await getChannelThumbnailTile(page, 'channel:mask').click();
  await expect(selectedChannelTile).toHaveText('mask,A');
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:', 'A:']);

  await clickChannelStackToggle(page, 'group:');
  await expect(selectedChannelTile).toHaveText('mask,A');
  await expect(channelTiles.filter({ hasText: /^RGBA$/ })).toHaveCount(0);
  await expect(channelTiles.filter({ hasText: /^R$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^G$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^B$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^A$/ })).toHaveCount(1);
  await expect(channelTiles.filter({ hasText: /^mask,A$/ })).toHaveCount(1);
  await clickChannelStackToggle(page, 'channel:R');
  await getChannelThumbnailTile(page, 'group:').click();
  await expect(selectedChannelTile).toHaveText('RGBA');

  await page.setInputFiles('#file-input', {
    name: 'named_rgba.exr',
    mimeType: 'image/exr',
    buffer: buildNamedRgbaExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('named_rgba.exr', { timeout: 30000 });
  await expect(selectedChannelTile).toHaveText('beauty.RGBA');

  await page.setInputFiles('#file-input', {
    name: 'named_rgb_bare_alpha.exr',
    mimeType: 'image/exr',
    buffer: buildNamedRgbBareAlphaExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('named_rgb_bare_alpha.exr', { timeout: 30000 });
  await expect(selectedChannelTile).toHaveText('beauty.RGB');

  await page.setInputFiles('#file-input', {
    name: 'scalar_alpha.exr',
    mimeType: 'image/exr',
    buffer: buildScalarAlphaExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('scalar_alpha.exr', { timeout: 30000 });
  await expect(selectedChannelTile).toHaveText('Z,A');
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:', 'A:']);

  await page.setInputFiles('#file-input', {
    name: 'depth_alpha.exr',
    mimeType: 'image/exr',
    buffer: buildDepthAlphaExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('depth_alpha.exr', { timeout: 30000 });
  await expect(selectedChannelTile).toHaveText('depth.Z,depth.A');
  await viewer.hover();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:', 'A:']);
});
