import { expect, test, type Page } from '@playwright/test';

const EMBED_RIGHT_INSET_PX = 8;

test('keeps the embed open-full button right-aligned without a custom name', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await gotoEmbed(page, '/?ui=embed&gallery=cbox-rgb');

  const sourceLabel = page.locator('.embed-source-label');
  const openFullButton = page.getByRole('button', { name: 'Open full viewer', exact: true });

  await expect(sourceLabel).toBeHidden();
  await expect(sourceLabel).toHaveText('');
  await expect(openFullButton).toBeEnabled();
  await expectButtonRightAligned(page);
});

test('keeps the embed open-full button right-aligned with a custom name @smoke', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await gotoEmbed(page, '/?ui=embed&gallery=cbox-rgb&name=Beauty%20pass');

  const sourceLabel = page.locator('.embed-source-label');
  const openFullButton = page.getByRole('button', { name: 'Open full viewer', exact: true });

  await expect(sourceLabel).toBeVisible();
  await expect(sourceLabel).toHaveText('Beauty pass');
  await expect(openFullButton).toBeEnabled();
  await expectButtonRightAligned(page);
  await expectNoToolbarOverlap(page);
});

async function gotoEmbed(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('#gl-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open full viewer', exact: true })).toBeEnabled({
    timeout: 30000
  });
}

async function expectButtonRightAligned(page: Page): Promise<void> {
  const alignment = await page.evaluate(() => {
    const button = document.querySelector('.embed-open-full-button');
    if (!(button instanceof HTMLElement)) {
      throw new Error('Embed open-full button was not found.');
    }

    const buttonRect = button.getBoundingClientRect();
    return {
      buttonRight: buttonRect.right,
      viewportRight: window.innerWidth
    };
  });

  expect(Math.abs(alignment.viewportRight - EMBED_RIGHT_INSET_PX - alignment.buttonRight)).toBeLessThanOrEqual(1);
}

async function expectNoToolbarOverlap(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const sourceLabel = document.querySelector('.embed-source-label');
    const button = document.querySelector('.embed-open-full-button');
    if (!(sourceLabel instanceof HTMLElement) || !(button instanceof HTMLElement)) {
      throw new Error('Embed toolbar elements were not found.');
    }

    const sourceRect = sourceLabel.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      sourceLeft: sourceRect.left,
      sourceRight: sourceRect.right,
      buttonLeft: buttonRect.left,
      buttonRight: buttonRect.right,
      viewportRight: window.innerWidth
    };
  });

  expect(layout.sourceLeft).toBeGreaterThanOrEqual(EMBED_RIGHT_INSET_PX - 1);
  expect(layout.sourceRight).toBeLessThanOrEqual(layout.buttonLeft - EMBED_RIGHT_INSET_PX + 1);
  expect(layout.buttonRight).toBeLessThanOrEqual(layout.viewportRight - EMBED_RIGHT_INSET_PX + 1);
}
