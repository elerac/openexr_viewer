import { expect, test } from '@playwright/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';
import { buildScalarChannelExr, buildSpectralExr } from './helpers/exr-fixtures';

test('moves bottom-panel thumbnail selections with left and right arrow keys', async ({ page }) => {
  await gotoViewerApp(page);

  const bottomPanelButton = page.locator('#bottom-panel-collapse-button');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');
  const channelSelect = page.locator('#rgb-group-select');
  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');

  await openGalleryCbox(page);
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'true');
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(channelSelect.locator('option:checked')).toHaveText('R');
  await expect(thumbnailTiles).toHaveCount(3);

  await thumbnailTiles.nth(0).focus();
  await expect(thumbnailTiles.nth(0)).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(channelSelect.locator('option:checked')).toHaveText('G');
  await expect(thumbnailTiles.nth(1)).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(channelSelect.locator('option:checked')).toHaveText('B');
  await expect(thumbnailTiles.nth(2)).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(channelSelect.locator('option:checked')).toHaveText('G');
  await expect(thumbnailTiles.nth(1)).toBeFocused();
});

test('keeps collapsed bottom channel names visible and selectable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoViewerApp(page);

  const bottomPanel = page.locator('#bottom-panel-content');
  const bottomPanelButton = page.locator('#bottom-panel-collapse-button');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');
  const channelSelect = page.locator('#rgb-group-select');
  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');
  const thumbnailPreviews = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile-preview');

  await openGalleryCbox(page);
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'true');
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(thumbnailTiles).toHaveCount(3);
  await expect(thumbnailTiles.nth(0)).toContainText('R');
  await expect(thumbnailTiles.nth(1)).toContainText('G');
  await expect(thumbnailTiles.nth(2)).toContainText('B');
  await expect(thumbnailPreviews.nth(0)).toBeVisible();

  await bottomPanelButton.click();
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'false');
  await expect(thumbnailTiles.nth(0)).toContainText('R');
  await expect(thumbnailTiles.nth(1)).toContainText('G');
  await expect(thumbnailTiles.nth(2)).toContainText('B');
  await expect(thumbnailPreviews.nth(0)).toBeHidden();
  const collapsedHeight = await bottomPanel.evaluate((element) => Math.round(element.getBoundingClientRect().height));
  expect(collapsedHeight).toBeGreaterThanOrEqual(32);
  expect(collapsedHeight).toBeLessThanOrEqual(36);

  await thumbnailTiles.nth(1).click();
  await expect(channelSelect.locator('option:checked')).toHaveText('G');
  await expect(thumbnailTiles.nth(1)).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowRight');
  await expect(channelSelect.locator('option:checked')).toHaveText('B');
  await expect(thumbnailTiles.nth(2)).toHaveAttribute('aria-selected', 'true');

  await bottomPanelButton.click();
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'true');
  await expect(thumbnailPreviews.nth(0)).toBeVisible();
});

test('moves open files and channel view selections with arrow keys', async ({ page }) => {
  await gotoViewerApp(page);

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
