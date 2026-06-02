import { expect, test, type Locator, type Page } from './helpers/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';
import { buildLongNamedRgbExr, buildScalarChannelExr, buildSizedRgbExr, buildSpectralExr } from './helpers/exr-fixtures';
import { installIdleCallbackController } from './helpers/idle-callbacks';
import { clickChannelStackToggle, dragBy, readProbeCoords, resolveViewerPoint } from './helpers/viewer';

test('moves bottom-panel thumbnail selections with left and right arrow keys', async ({ page }) => {
  await gotoViewerApp(page);

  const bottomPanelButton = page.locator('#bottom-panel-collapse-button');
  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');

  await openGalleryCbox(page);
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'true');
  await clickChannelStackToggle(page, 'group:');
  await expect(thumbnailTiles).toHaveCount(3);
  await expect(thumbnailTiles.nth(0)).toHaveAttribute('aria-selected', 'true');

  await thumbnailTiles.nth(0).focus();
  await expect(thumbnailTiles.nth(0)).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(thumbnailTiles.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(thumbnailTiles.nth(1)).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(thumbnailTiles.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(thumbnailTiles.nth(2)).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(thumbnailTiles.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(thumbnailTiles.nth(1)).toBeFocused();
});

test('selects a large-image bottom thumbnail on the first gesture before thumbnails finish', async ({ page }) => {
  await installIdleCallbackController(page);
  await gotoViewerApp(page);

  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');

  await page.setInputFiles('#file-input', {
    name: 'large_rgb.exr',
    mimeType: 'image/exr',
    buffer: buildSizedRgbExr(512, 512)
  });
  await expect(page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'large_rgb.exr' })).toHaveCount(1, {
    timeout: 30000
  });

  await clickChannelStackToggle(page, 'group:');
  await expect(thumbnailTiles).toHaveCount(3);
  await expect(page.locator('#channel-thumbnail-strip .channel-thumbnail-placeholder')).toHaveCount(3);

  await thumbnailTiles.nth(1).click();

  await expect(thumbnailTiles.nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('selects a bottom thumbnail when dragged into the image viewer', async ({ page }) => {
  await gotoViewerApp(page);

  const viewer = page.locator('#viewer-container');
  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');

  await openGalleryCbox(page);
  await clickChannelStackToggle(page, 'group:');
  await expect(thumbnailTiles).toHaveCount(3);
  await expect(thumbnailTiles.nth(0)).toHaveAttribute('aria-selected', 'true');

  await dragLocatorToPoint(page, thumbnailTiles.nth(1), await resolveViewerPoint(viewer, 0.5, 0.5));

  await expect(thumbnailTiles.nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('selects an open file when dragged into the image viewer', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const viewer = page.locator('#viewer-container');

  await openGalleryCbox(page);
  await page.setInputFiles('#file-input', {
    name: 'scalar_z.exr',
    mimeType: 'image/exr',
    buffer: buildScalarChannelExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('scalar_z.exr', { timeout: 30000 });

  const cboxRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'cbox_rgb.exr' });
  const cboxRowBox = await cboxRow.boundingBox();
  if (!cboxRowBox) {
    throw new Error('Open file row is not visible.');
  }

  const target = await resolveViewerPoint(viewer, 0.5, 0.5);
  await page.mouse.move(cboxRowBox.x + cboxRowBox.width / 2, cboxRowBox.y + cboxRowBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });

  await expect(viewer).toHaveClass(/is-opened-file-drop-target/);

  await page.mouse.up();
  await page.waitForTimeout(100);

  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(cboxRow).toHaveAttribute('aria-selected', 'true');
  await expect(viewer).not.toHaveClass(/is-opened-file-drop-target/);
});

test('filters the visible Open Files rows by text', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const openedFilesCount = page.locator('#opened-files-count');
  const openedRows = page.locator('#opened-files-list .opened-file-row');
  const filterInput = page.locator('#opened-files-filter-input');

  await openGalleryCbox(page);
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
  await expect(openedRows).toHaveCount(3);

  await expect(filterInput).toBeEnabled();
  await filterInput.fill('scalar');

  await expect(openedRows).toHaveCount(1);
  await expect(openedRows.first()).toContainText('scalar_z.exr');
  await expect(openedImages.locator('option')).toHaveCount(3);
  await expect(openedFilesCount).toHaveText('3');

  await filterInput.fill('missing');

  await expect(openedRows).toHaveCount(0);
  await expect(page.locator('#opened-files-list')).toHaveText('No matching open files');

  await filterInput.fill('');

  await expect(openedRows).toHaveCount(3);
});

test('keeps collapsed bottom channel names visible and selectable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoViewerApp(page);

  const bottomPanel = page.locator('#bottom-panel-content');
  const bottomPanelButton = page.locator('#bottom-panel-collapse-button');
  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');
  const thumbnailPreviews = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile-preview');
  const thumbnailImages = page.locator('#channel-thumbnail-strip .channel-thumbnail-image');

  await openGalleryCbox(page);
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'true');
  await clickChannelStackToggle(page, 'group:');
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
  await expect(thumbnailTiles.nth(1)).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowRight');
  await expect(thumbnailTiles.nth(2)).toHaveAttribute('aria-selected', 'true');

  await bottomPanelButton.click();
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'true');
  await expect(thumbnailPreviews.nth(0)).toBeVisible();
});

test('shows expanded thumbnail channel names in a stable custom tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const longLabel = 'beauty_render_layer_with_a_very_long_surface_name.RGB';
  const thumbnailTile = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile').filter({
    hasText: longLabel
  });
  const thumbnailPreview = thumbnailTile.locator('.channel-thumbnail-tile-preview');
  const nameTooltip = page.locator('.channel-thumbnail-name-tooltip');

  await page.setInputFiles('#file-input', {
    name: 'long_named_rgb.exr',
    mimeType: 'image/exr',
    buffer: buildLongNamedRgbExr()
  });

  await expect(openedImages.locator('option:checked')).toContainText('long_named_rgb.exr', { timeout: 30000 });
  await expect(thumbnailTile).toHaveCount(1);
  await expect(thumbnailTile).not.toHaveAttribute('title');
  await expect(thumbnailTile).toHaveAttribute('aria-label', longLabel);
  await expect(thumbnailTile).toHaveAttribute('data-channel-label', longLabel);
  await expect(thumbnailPreview).toBeVisible();

  await page.mouse.move(8, 8);
  await thumbnailPreview.hover();
  await expect(nameTooltip).toHaveText(longLabel, { timeout: 2000 });
  await expect(nameTooltip).toHaveClass(/is-visible/);
  await expect(page.locator('.channel-thumbnail-hover-preview')).toHaveCount(0);

  const firstMetrics = await readExpandedNameTooltipMetrics(page);
  expect(firstMetrics.tooltipStyle.position).toBe('fixed');
  expect(firstMetrics.tooltipStyle.pointerEvents).toBe('none');
  expect(firstMetrics.tooltipStyle.borderTopWidth).not.toBe('0px');
  expect(firstMetrics.tooltip.bottom).toBeLessThanOrEqual(firstMetrics.preview.top);
  expect(rectsIntersect(firstMetrics.tooltip, firstMetrics.preview)).toBe(false);

  await page.mouse.move(8, 8);
  await expect(nameTooltip).toHaveCount(0);

  await thumbnailTile.locator('.channel-thumbnail-tile-label').hover();
  await expect(nameTooltip).toHaveText(longLabel, { timeout: 2000 });
  await expect(page.locator('.channel-thumbnail-hover-preview')).toHaveCount(0);
  const labelMetrics = await readExpandedNameTooltipMetrics(page);
  expect(labelMetrics.tooltip.bottom).toBeLessThanOrEqual(labelMetrics.preview.top);
  expect(rectsIntersect(labelMetrics.tooltip, labelMetrics.preview)).toBe(false);

  await page.mouse.move(8, 8);
  await expect(nameTooltip).toHaveCount(0);

  await thumbnailPreview.hover();
  await expect(nameTooltip).toHaveText(longLabel, { timeout: 2000 });
  const secondMetrics = await readExpandedNameTooltipMetrics(page);
  expect(secondMetrics.tooltip.bottom).toBeLessThanOrEqual(secondMetrics.preview.top);
  expect(rectsIntersect(secondMetrics.tooltip, secondMetrics.preview)).toBe(false);
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

  await expect.poll(async () => {
    const center = await resolveViewerPoint(viewer, 0.5, 0.5);
    await page.mouse.move(center.x, center.y);
    return await readProbeCoords(probeCoords);
  }, { timeout: 5000 }).toEqual({
    x: 128,
    y: 128
  });
});

test('moves open files and bottom channel thumbnail selections with arrow keys', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');

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
  await clickChannelStackToggle(page, 'group:');
  await expect(thumbnailTiles).toHaveCount(3);

  await thumbnailTiles.nth(0).click();
  await expect(thumbnailTiles.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(thumbnailTiles.nth(0)).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(thumbnailTiles.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(thumbnailTiles.nth(1)).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(thumbnailTiles.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(thumbnailTiles.nth(2)).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(thumbnailTiles.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(thumbnailTiles.nth(1)).toBeFocused();
});

test('auto-fits images selected from Open Files when the top-bar toggle is enabled @smoke', async ({ page }) => {
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

interface TooltipRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

async function readExpandedNameTooltipMetrics(page: Page): Promise<{
  preview: TooltipRect;
  tooltip: TooltipRect;
  tooltipStyle: {
    borderTopWidth: string;
    pointerEvents: string;
    position: string;
  };
}> {
  return await page.evaluate(() => {
    const preview = document.querySelector('#channel-thumbnail-strip .channel-thumbnail-tile-preview');
    const tooltip = document.querySelector('.channel-thumbnail-name-tooltip');
    if (!(preview instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) {
      throw new Error('Expanded channel name tooltip is not visible.');
    }

    const readRect = (element: HTMLElement): TooltipRect => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height
      };
    };
    const style = getComputedStyle(tooltip);
    return {
      preview: readRect(preview),
      tooltip: readRect(tooltip),
      tooltipStyle: {
        borderTopWidth: style.borderTopWidth,
        pointerEvents: style.pointerEvents,
        position: style.position
      }
    };
  });
}

function rectsIntersect(a: TooltipRect, b: TooltipRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

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
