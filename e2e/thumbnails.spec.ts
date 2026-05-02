import { expect, test } from '@playwright/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';
import {
  flushAllIdleCallbacks,
  getPendingIdleCallbackCount,
  installIdleCallbackController
} from './helpers/idle-callbacks';
import { buildLandscapeRgbExr, buildPortraitRgbExr } from './helpers/exr-fixtures';
import { setExposureValue } from './helpers/viewer';

test('defers opened-file thumbnails until idle time after first render', async ({ page }) => {
  await installIdleCallbackController(page);
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const openedFileRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'cbox_rgb.exr' });

  await openGalleryCbox(page);
  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });
  await expect(openedFileRow).toHaveCount(1);
  await expect(openedFileRow.locator('.opened-file-thumbnail-loading')).toHaveCount(1);
  await expect(openedFileRow.locator('.opened-file-thumbnail-loading-icon')).toHaveCount(1);
  await expect(openedFileRow.locator('.file-row-icon')).toHaveCount(0);
  await expect(openedFileRow.locator('.opened-file-thumbnail')).toHaveCount(0);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).not.toBe(0);

  await flushAllIdleCallbacks(page);

  await expect(openedFileRow.locator('.opened-file-thumbnail')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(openedFileRow.locator('.opened-file-thumbnail-loading')).toHaveCount(0);
  await expect(openedFileRow.locator('.file-row-icon')).toHaveCount(0);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(0);
});

test('keeps the previous thumbnail visible until reload thumbnails are regenerated in idle time', async ({ page }) => {
  await installIdleCallbackController(page);
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const openedFileRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'cbox_rgb.exr' });
  const reloadOpenedFileButton = page.getByRole('button', { name: 'Reload cbox_rgb.exr', exact: true });
  const exposureValue = page.locator('#exposure-value');

  await openGalleryCbox(page);
  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).not.toBe(0);
  await flushAllIdleCallbacks(page);

  const thumbnail = openedFileRow.locator('.opened-file-thumbnail');
  await expect(thumbnail).toHaveAttribute('src', /^data:image\/png;base64,/);
  const initialThumbnailSrc = await thumbnail.getAttribute('src');
  expect(initialThumbnailSrc).not.toBeNull();

  await setExposureValue(exposureValue, '2.0');
  await expect(exposureValue).toHaveValue('2.0');

  await reloadOpenedFileButton.click();
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).not.toBe(0);
  await expect(thumbnail).toHaveAttribute('src', initialThumbnailSrc ?? '');
  await expect(openedFileRow.locator('.file-row-icon')).toHaveCount(0);

  await flushAllIdleCallbacks(page);

  await expect(thumbnail).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(async () => await thumbnail.getAttribute('src')).not.toBe(initialThumbnailSrc);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(0);
});

test('keeps bottom-panel channel thumbnail frames stable across image selection changes and syncs them with the channel selector', async ({ page }) => {
  await installIdleCallbackController(page);
  await gotoViewerApp(page);

  const bottomPanelButton = page.locator('#bottom-panel-collapse-button');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');
  const channelSelect = page.locator('#rgb-group-select');
  const landscapeRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'landscape_rgb.exr' });
  const portraitRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'portrait_rgb.exr' });
  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');
  const firstThumbnailPreview = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile-preview').first();
  const greenRow = page.locator('#channel-view-list .channel-view-row').filter({ hasText: /^G/ });

  await page.setInputFiles('#file-input', {
    name: 'landscape_rgb.exr',
    mimeType: 'image/exr',
    buffer: buildLandscapeRgbExr()
  });
  await expect(landscapeRow).toHaveCount(1);
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'true');
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(channelSelect.locator('option:checked')).toHaveText('R');
  await expect(thumbnailTiles).toHaveCount(3);
  await expect(page.locator('#channel-thumbnail-strip .channel-thumbnail-placeholder')).toHaveCount(3);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).not.toBe(0);

  await flushAllIdleCallbacks(page);

  const readPreviewRect = async (): Promise<{ width: number; height: number }> => (
    await firstThumbnailPreview.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height
      };
    })
  );
  const landscapePreviewRect = await readPreviewRect();

  await page.setInputFiles('#file-input', {
    name: 'portrait_rgb.exr',
    mimeType: 'image/exr',
    buffer: buildPortraitRgbExr()
  });
  await expect(portraitRow).toHaveCount(1);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).not.toBe(0);
  await flushAllIdleCallbacks(page);

  const portraitPreviewRect = await readPreviewRect();
  expect(Math.abs(portraitPreviewRect.width - landscapePreviewRect.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(portraitPreviewRect.height - landscapePreviewRect.height)).toBeLessThanOrEqual(1);

  await thumbnailTiles.nth(1).click();
  await expect(channelSelect.locator('option:checked')).toHaveText('G');
  await expect(greenRow).toHaveAttribute('aria-selected', 'true');
});
