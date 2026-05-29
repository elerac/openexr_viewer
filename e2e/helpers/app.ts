import { expect, type Page } from '@playwright/test';

export async function gotoViewerApp(page: Page): Promise<void> {
  await page.goto(process.env.PLAYWRIGHT_APP_PATH ?? '/');
  await expectViewerAppReady(page);
}

export async function expectViewerAppReady(page: Page): Promise<void> {
  await expect(page.locator('#gl-canvas')).toBeVisible();
  if (await waitForE2EHook(page, 'waitForAppReady')) {
    return;
  }

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
  await waitForE2ESessionCount(page, 1);
  await waitForE2ERenderIdle(page);
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr', { timeout: 30000 });
}

export async function waitForE2ERenderIdle(page: Page): Promise<void> {
  if (await waitForE2EHook(page, 'waitForRenderIdle')) {
    return;
  }

  await page.waitForTimeout(50);
}

export async function waitForE2EFrames(page: Page, count = 2): Promise<void> {
  const usedHook = await page.evaluate(async (frameCount) => {
    const hooks = window.__openExrViewerE2E;
    if (!hooks) {
      return false;
    }

    await hooks.waitForFrames(frameCount);
    return true;
  }, count);
  if (usedHook) {
    return;
  }

  await page.waitForTimeout(50);
}

export async function waitForE2ESessionCount(page: Page, count: number): Promise<void> {
  if (await waitForE2EHook(page, 'waitForSessionCount', [count])) {
    return;
  }

  await expect(page.locator('#opened-images-select option')).toHaveCount(count, { timeout: 30000 });
}

export async function waitForE2EThumbnailIdle(page: Page): Promise<void> {
  if (await waitForE2EHook(page, 'waitForThumbnailIdle')) {
    return;
  }

  await page.waitForTimeout(50);
}

async function waitForE2EHook(
  page: Page,
  method: 'waitForAppReady' | 'waitForRenderIdle' | 'waitForSessionCount' | 'waitForThumbnailIdle',
  args: unknown[] = []
): Promise<boolean> {
  return await page.evaluate(async ({ methodName, methodArgs }) => {
    const hooks = window.__openExrViewerE2E;
    if (!hooks) {
      return false;
    }

    if (methodName === 'waitForAppReady') {
      await hooks.waitForAppReady();
    } else if (methodName === 'waitForRenderIdle') {
      await hooks.waitForRenderIdle();
    } else if (methodName === 'waitForThumbnailIdle') {
      await hooks.waitForThumbnailIdle();
    } else {
      await hooks.waitForSessionCount(Number(methodArgs[0]));
    }
    return true;
  }, { methodName: method, methodArgs: args });
}
