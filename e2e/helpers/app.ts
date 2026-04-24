import { expect, type Page } from '@playwright/test';

export async function gotoViewerApp(page: Page): Promise<void> {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await expectViewerAppReady(page);
}

export async function expectViewerAppReady(page: Page): Promise<void> {
  await expect(page.locator('#gl-canvas')).toBeVisible();

  await expect
    .poll(async () => {
      const state = await page.evaluate(() => {
        const errorBanner = document.querySelector('#error-banner');
        const errorText =
          errorBanner instanceof HTMLElement && !errorBanner.classList.contains('hidden')
            ? (errorBanner.textContent ?? '').trim()
            : '';
        const galleryButton = document.querySelector('#gallery-menu-button');
        const canvas = document.querySelector('#gl-canvas');

        return {
          errorText,
          ready:
            galleryButton instanceof HTMLButtonElement &&
            canvas instanceof HTMLCanvasElement &&
            canvas.width > 0 &&
            canvas.height > 0
        };
      });

      if (state.errorText) {
        throw new Error(`Playwright app boot failed: ${state.errorText}`);
      }

      return state.ready;
    }, { timeout: 30000 })
    .toBe(true);
}

export async function openGalleryCbox(page: Page): Promise<void> {
  const openedImages = page.locator('#opened-images-select');

  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('menuitem', { name: 'cbox_rgb.exr', exact: true }).click();
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr', { timeout: 30000 });
}
