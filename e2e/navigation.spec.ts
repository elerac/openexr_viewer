import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';
import { buildScalarChannelExr, buildSizedRgbExr, buildSpectralExr } from './helpers/exr-fixtures';
import { dragBy, readProbeCoords, resolveViewerPoint } from './helpers/viewer';

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

test('selects a bottom thumbnail when dragged into the image viewer', async ({ page }) => {
  await gotoViewerApp(page);

  const viewer = page.locator('#viewer-container');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');
  const channelSelect = page.locator('#rgb-group-select');
  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');

  await openGalleryCbox(page);
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(channelSelect.locator('option:checked')).toHaveText('R');
  await expect(thumbnailTiles).toHaveCount(3);

  await dragLocatorToPoint(page, thumbnailTiles.nth(1), await resolveViewerPoint(viewer, 0.5, 0.5));

  await expect(channelSelect.locator('option:checked')).toHaveText('G');
  await expect(thumbnailTiles.nth(1)).toHaveAttribute('aria-selected', 'true');
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
  const thumbnailImages = page.locator('#channel-thumbnail-strip .channel-thumbnail-image');

  await openGalleryCbox(page);
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'true');
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(thumbnailTiles).toHaveCount(3);
  await expect(thumbnailTiles.nth(0)).toContainText('R');
  await expect(thumbnailTiles.nth(1)).toContainText('G');
  await expect(thumbnailTiles.nth(2)).toContainText('B');
  await expect(thumbnailPreviews.nth(0)).toBeVisible();
  await expect(thumbnailImages.first()).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 10000 });

  await bottomPanelButton.click();
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'false');
  await expect(thumbnailTiles.nth(0)).toContainText('R');
  await expect(thumbnailTiles.nth(1)).toContainText('G');
  await expect(thumbnailTiles.nth(2)).toContainText('B');
  await expect(thumbnailPreviews.nth(0)).toBeHidden();
  const collapsedHeight = await bottomPanel.evaluate((element) => Math.round(element.getBoundingClientRect().height));
  expect(collapsedHeight).toBeGreaterThanOrEqual(32);
  expect(collapsedHeight).toBeLessThanOrEqual(36);

  await thumbnailTiles.nth(0).hover();
  const hoverPreview = page.locator('.channel-thumbnail-hover-preview');
  await expect(hoverPreview).toHaveCount(1, { timeout: 2000 });
  await expect(hoverPreview.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await page.mouse.move(8, 8);
  await expect(hoverPreview).toHaveCount(0);

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

test('keeps a newly opened image centered after collapsed bottom channel labels appear', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoViewerApp(page);

  const viewer = page.locator('#viewer-container');
  const probeCoords = page.locator('#probe-coords');
  const bottomPanel = page.locator('#bottom-panel-content');
  const bottomPanelButton = page.locator('#bottom-panel-collapse-button');
  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');

  await bottomPanelButton.click();
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'false');
  const emptyCollapsedHeight = await bottomPanel.evaluate((element) => Math.round(element.getBoundingClientRect().height));
  expect(emptyCollapsedHeight).toBeLessThanOrEqual(2);

  await openGalleryCbox(page);
  await expect(thumbnailTiles).toHaveCount(1);
  await expect(thumbnailTiles.first()).toContainText('RGB');
  await expect.poll(async () => {
    const height = await bottomPanel.evaluate((element) => Math.round(element.getBoundingClientRect().height));
    return height >= 32 && height <= 36;
  }).toBe(true);

  const center = await resolveViewerPoint(viewer, 0.5, 0.5);
  await page.mouse.move(center.x, center.y);

  await expect.poll(async () => await readProbeCoords(probeCoords), { timeout: 5000 }).toEqual({
    x: 128,
    y: 128
  });
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

test('auto-fits images selected from Open Files when the top-bar toggle is enabled', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await gotoViewerApp(page);

  const autoFitButton = page.locator('#app-auto-fit-image-button');
  const openedImages = page.locator('#opened-images-select');
  const viewer = page.locator('#viewer-container');
  const probeCoords = page.locator('#probe-coords');

  await expect(autoFitButton).toBeVisible();
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'false');
  await autoFitButton.click();
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'true');

  await page.setInputFiles('#file-input', {
    name: 'landscape.exr',
    mimeType: 'image/exr',
    buffer: buildSizedRgbExr(100, 50)
  });
  await expect(openedImages.locator('option:checked')).toContainText('landscape.exr', { timeout: 30000 });

  await page.setInputFiles('#file-input', {
    name: 'portrait.exr',
    mimeType: 'image/exr',
    buffer: buildSizedRgbExr(50, 100)
  });
  await expect(openedImages.locator('option:checked')).toContainText('portrait.exr', { timeout: 30000 });

  const center = await resolveViewerPoint(viewer, 0.5, 0.5);
  await page.mouse.move(center.x, center.y);
  await expect.poll(async () => await readProbeCoords(probeCoords), { timeout: 5000 }).toEqual({
    x: 25,
    y: 50
  });

  await dragBy(page, viewer, 180, 120);
  await page.mouse.move(center.x, center.y);
  await expect.poll(async () => {
    const coords = await readProbeCoords(probeCoords);
    return coords === null || coords.x !== 25 || coords.y !== 50;
  }).toBe(true);

  await autoFitButton.click();
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(center.x, center.y);
  await expect.poll(async () => {
    const coords = await readProbeCoords(probeCoords);
    return coords === null || coords.x !== 25 || coords.y !== 50;
  }).toBe(true);

  await autoFitButton.click();
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(center.x, center.y);
  await expect.poll(async () => await readProbeCoords(probeCoords), { timeout: 5000 }).toEqual({
    x: 25,
    y: 50
  });

  const landscapeRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'landscape.exr' });
  await landscapeRow.locator('.opened-file-label').click();
  await expect(openedImages.locator('option:checked')).toContainText('landscape.exr');
  await page.mouse.move(center.x, center.y);
  await expect.poll(async () => await readProbeCoords(probeCoords), { timeout: 5000 }).toEqual({
    x: 50,
    y: 25
  });
});

async function dragLocatorToPoint(
  page: Page,
  locator: Locator,
  point: { x: number; y: number }
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Drag source is not visible.');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}
