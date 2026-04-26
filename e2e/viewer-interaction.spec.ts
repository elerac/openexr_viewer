import { expect, test } from '@playwright/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';
import { buildScalarChannelExr, buildSpectralExr } from './helpers/exr-fixtures';
import { dragViewerRoi, readProbeCoords } from './helpers/viewer';

test('pans image view with global w/a/s/d keys while keeping the probe in sync', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const viewer = page.locator('#viewer-container');
  const probeCoords = page.locator('#probe-coords');

  await viewer.hover();
  await expect.poll(async () => await readProbeCoords(probeCoords)).not.toBeNull();
  const initialCoords = await readProbeCoords(probeCoords);
  if (!initialCoords) {
    throw new Error('Expected probe coordinates after hovering the viewer.');
  }

  await page.keyboard.press('d');
  await expect.poll(async () => {
    const coords = await readProbeCoords(probeCoords);
    return coords
      ? coords.x !== initialCoords.x || coords.y !== initialCoords.y
      : false;
  }).toBe(true);

  const afterRightCoords = await readProbeCoords(probeCoords);
  if (!afterRightCoords) {
    throw new Error('Expected probe coordinates after panning right.');
  }
  expect(afterRightCoords.x).not.toBe(initialCoords.x);

  await page.keyboard.press('a');
  await expect.poll(async () => await readProbeCoords(probeCoords)).toEqual(initialCoords);
});

test('leaves editable text input alone when typing image-viewer wasd keys', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const viewer = page.locator('#viewer-container');
  const probeCoords = page.locator('#probe-coords');

  await viewer.hover();
  await expect.poll(async () => await readProbeCoords(probeCoords)).not.toBeNull();
  const initialCoords = await readProbeCoords(probeCoords);
  if (!initialCoords) {
    throw new Error('Expected probe coordinates after hovering the viewer.');
  }

  const scratchInput = page.locator('#wasd-scratch-input');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'wasd-scratch-input';
    input.type = 'text';
    document.body.append(input);
  });
  await scratchInput.focus();
  await page.keyboard.type('wasd');

  await expect(scratchInput).toHaveValue('wasd');
  await expect.poll(async () => await readProbeCoords(probeCoords)).toEqual(initialCoords);
});

test('orbits panorama view with global w/a/s/d keys while keeping the probe in sync', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const viewer = page.locator('#viewer-container');
  const probeCoords = page.locator('#probe-coords');

  await page.locator('#view-menu-button').click();
  await page.locator('#panorama-viewer-menu-item').click();

  await viewer.hover();
  await expect.poll(async () => await readProbeCoords(probeCoords)).not.toBeNull();
  const initialCoords = await readProbeCoords(probeCoords);
  if (!initialCoords) {
    throw new Error('Expected probe coordinates after hovering the viewer.');
  }

  await page.keyboard.press('d');
  await expect.poll(async () => {
    const coords = await readProbeCoords(probeCoords);
    return coords
      ? coords.x !== initialCoords.x || coords.y !== initialCoords.y
      : false;
  }).toBe(true);

  const afterRightCoords = await readProbeCoords(probeCoords);
  if (!afterRightCoords) {
    throw new Error('Expected probe coordinates after orbiting right.');
  }
  expect(afterRightCoords.x).not.toBe(initialCoords.x);

  await page.keyboard.press('a');
  await expect.poll(async () => await readProbeCoords(probeCoords)).toEqual(initialCoords);
});

test('creates ROI with shift-drag and keeps ROI editing disabled in panorama mode', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const viewer = page.locator('#viewer-container');
  const roiEmptyState = page.locator('#roi-empty-state');
  const roiDetails = page.locator('#roi-details');
  const roiBounds = page.locator('#roi-bounds');

  await expect(roiEmptyState).toBeVisible();

  await dragViewerRoi(page, viewer, { xRatio: 0.45, yRatio: 0.45 }, { xRatio: 0.68, yRatio: 0.58 });

  await expect(roiDetails).toBeVisible();
  const initialBounds = (await roiBounds.textContent())?.trim() ?? '';
  expect(initialBounds).toMatch(/^x \d+\.\.\d+ {2}y \d+\.\.\d+$/);

  await page.locator('#view-menu-button').click();
  await page.locator('#panorama-viewer-menu-item').click();

  await dragViewerRoi(page, viewer, { xRatio: 0.2, yRatio: 0.2 }, { xRatio: 0.8, yRatio: 0.8 });

  await expect(roiBounds).toHaveText(initialBounds);
});

test('carries ROI across open-file switches', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const viewer = page.locator('#viewer-container');
  const roiEmptyState = page.locator('#roi-empty-state');
  const roiDetails = page.locator('#roi-details');
  const roiBounds = page.locator('#roi-bounds');

  await page.setInputFiles('#file-input', {
    name: 'scalar_z.exr',
    mimeType: 'image/exr',
    buffer: buildScalarChannelExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('scalar_z.exr', { timeout: 30000 });
  await expect(roiEmptyState).toBeVisible();

  await dragViewerRoi(page, viewer, { xRatio: 0.25, yRatio: 0.25 }, { xRatio: 0.75, yRatio: 0.75 });

  await expect(roiDetails).toBeVisible();
  const initialBounds = (await roiBounds.textContent())?.trim() ?? '';
  expect(initialBounds).toMatch(/^x \d+\.\.\d+ {2}y \d+\.\.\d+$/);

  await page.setInputFiles('#file-input', {
    name: 'spectral.exr',
    mimeType: 'image/exr',
    buffer: buildSpectralExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('spectral.exr', { timeout: 30000 });
  await expect(roiDetails).toBeVisible();

  await dragViewerRoi(page, viewer, { xRatio: 0.25, yRatio: 0.25 }, { xRatio: 0.75, yRatio: 0.25 });

  const updatedBounds = (await roiBounds.textContent())?.trim() ?? '';
  expect(updatedBounds).toMatch(/^x \d+\.\.\d+ {2}y \d+\.\.\d+$/);
  expect(updatedBounds).not.toBe(initialBounds);

  const scalarRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'scalar_z.exr' });
  await scalarRow.locator('.opened-file-label').click();

  await expect(openedImages.locator('option:checked')).toContainText('scalar_z.exr');
  await expect(roiDetails).toBeVisible();
  await expect(roiEmptyState).toBeHidden();
  await expect(roiBounds).toHaveText(updatedBounds);
});
