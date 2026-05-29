import { expect, test } from '@playwright/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';
import {
  flushAllIdleCallbacks,
  getPendingIdleCallbackCount,
  installIdleCallbackController
} from './helpers/idle-callbacks';
import { buildLandscapeRgbExr, buildPortraitRgbExr } from './helpers/exr-fixtures';
import { clickChannelStackToggle, setExposureValue } from './helpers/viewer';

test('defers opened-file thumbnails until idle time after first render @smoke', async ({ page }) => {
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
  await flushAllIdleCallbacks(page);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(0);

  await reloadOpenedFileButton.click();
  await expect(openedFileRow).toHaveAttribute('aria-busy', 'true');
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).not.toBe(0);
  await expect(thumbnail).toHaveAttribute('src', initialThumbnailSrc ?? '');
  await expect(openedFileRow.locator('.file-row-icon')).toHaveCount(0);

  await flushAllIdleCallbacks(page);

  await expect(thumbnail).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(async () => await thumbnail.getAttribute('src')).not.toBe(initialThumbnailSrc);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(0);
});

test('keeps bottom-panel channel thumbnail frames stable across image selection changes and syncs selection', async ({ page }) => {
  await installIdleCallbackController(page);
  await gotoViewerApp(page);

  const bottomPanelButton = page.locator('#bottom-panel-collapse-button');
  const landscapeRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'landscape_rgb.exr' });
  const portraitRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'portrait_rgb.exr' });
  const thumbnailTiles = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile');
  const firstThumbnailPreview = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile-preview').first();

  await page.setInputFiles('#file-input', {
    name: 'landscape_rgb.exr',
    mimeType: 'image/exr',
    buffer: buildLandscapeRgbExr()
  });
  await expect(landscapeRow).toHaveCount(1);
  await expect(bottomPanelButton).toHaveAttribute('aria-expanded', 'true');
  await clickChannelStackToggle(page, 'group:');
  await expect(thumbnailTiles).toHaveCount(3);
  await expect(thumbnailTiles.nth(0)).toHaveAttribute('aria-selected', 'true');
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
  const readPreviewRects = async (): Promise<Array<{ width: number; height: number }>> => (
    await page.locator('#channel-thumbnail-strip .channel-thumbnail-tile-preview').evaluateAll((elements) => (
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height
        };
      })
    ))
  );
  const expectPreviewRectsStable = (
    actual: Array<{ width: number; height: number }>,
    expected: Array<{ width: number; height: number }>
  ): void => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((rect, index) => {
      const expectedRect = expected[index]!;
      expect(Math.abs(rect.width - expectedRect.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(rect.height - expectedRect.height)).toBeLessThanOrEqual(1);
    });
  };
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

  await expect(thumbnailTiles).toHaveCount(3);
  const expandedPreviewRects = await readPreviewRects();

  await thumbnailTiles.nth(1).click();
  await expect(thumbnailTiles.nth(1)).toHaveAttribute('aria-selected', 'true');
  expectPreviewRectsStable(await readPreviewRects(), expandedPreviewRects);

  await thumbnailTiles.nth(2).click();
  await expect(thumbnailTiles.nth(2)).toHaveAttribute('aria-selected', 'true');
  expectPreviewRectsStable(await readPreviewRects(), expandedPreviewRects);
});

test('defers channel thumbnail exposure refresh until slider changes are committed', async ({ page }) => {
  await installIdleCallbackController(page);
  await gotoViewerApp(page);

  const exposureSlider = page.locator('#exposure-slider');
  const thumbnailImages = page.locator('#channel-thumbnail-strip .channel-thumbnail-image');

  await openGalleryCbox(page);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).not.toBe(0);
  await flushAllIdleCallbacks(page);
  await expect(thumbnailImages.first()).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 10000 });
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(0);

  await exposureSlider.evaluate((element) => {
    const input = element as HTMLInputElement;
    for (const value of ['1.0', '1.5', '2.0']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await expect(exposureSlider).toHaveValue('2');
  await page.waitForTimeout(100);
  expect(await getPendingIdleCallbackCount(page)).toBe(0);

  await exposureSlider.evaluate((element) => {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect.poll(async () => await getPendingIdleCallbackCount(page)).not.toBe(0);
  await flushAllIdleCallbacks(page);
  await expect.poll(async () => await getPendingIdleCallbackCount(page)).toBe(0);
});
