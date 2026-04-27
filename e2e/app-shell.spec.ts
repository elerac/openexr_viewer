import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { Buffer } from 'node:buffer';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';
import {
  buildPortraitRgbExr,
  buildRgbAuxExr,
  buildScalarChannelExr,
  expectedColormapLabels
} from './helpers/exr-fixtures';
import { readProbeCoords, resolveViewerPoint, setExposureValue } from './helpers/viewer';

async function expectVisibleShellGap(page: Page, upper: Locator, lower: Locator): Promise<void> {
  const [expectedGap, upperBox, lowerBox] = await Promise.all([
    page.locator('#app').evaluate((element) => {
      const style = getComputedStyle(element);
      return Number.parseFloat(style.rowGap || style.gap) || 0;
    }),
    upper.boundingBox(),
    lower.boundingBox()
  ]);

  if (!upperBox || !lowerBox) {
    throw new Error('Expected shell layout targets to be visible.');
  }

  const actualGap = lowerBox.y - (upperBox.y + upperBox.height);
  expect(Math.abs(actualGap - expectedGap)).toBeLessThanOrEqual(1);
}

async function expectMainPanelTopsAligned(viewer: Locator, imagePanel: Locator, rightStack: Locator): Promise<void> {
  const [viewerBox, imagePanelBox, rightStackBox] = await Promise.all([
    viewer.boundingBox(),
    imagePanel.boundingBox(),
    rightStack.boundingBox()
  ]);

  if (!viewerBox || !imagePanelBox || !rightStackBox) {
    throw new Error('Expected main layout panels to be visible.');
  }

  expect(Math.abs(imagePanelBox.y - viewerBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(rightStackBox.y - viewerBox.y)).toBeLessThanOrEqual(1);
}

async function readDownloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function expectPngSignature(bytes: Uint8Array): void {
  expect(Buffer.from(bytes.subarray(0, 8))).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
}

function getBoxCenter(box: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return {
    x: box.x + box.width * 0.5,
    y: box.y + box.height * 0.5
  };
}

async function readChromeVisualState(locator: Locator): Promise<{
  opacity: number;
  pointerEvents: string;
  filter: string;
  backdropFilter: string;
  overlayBackgroundColor: string;
}> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const webkitStyle = style as CSSStyleDeclaration & { webkitBackdropFilter?: string };
    const overlayStyle = getComputedStyle(element, '::after');
    return {
      opacity: Number.parseFloat(style.opacity),
      pointerEvents: style.pointerEvents,
      filter: style.filter,
      backdropFilter: style.backdropFilter || webkitStyle.webkitBackdropFilter || '',
      overlayBackgroundColor: overlayStyle.backgroundColor
    };
  });
}

async function readAutoFitButtonVisualState(page: Page): Promise<{
  backgroundColor: string;
  boxShadow: string;
  outlineStyle: string;
  outlineWidth: string;
}> {
  return page.locator('#app-auto-fit-image-button').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth
    };
  });
}

async function expectInactiveScreenshotChrome(locator: Locator): Promise<void> {
  await expect.poll(async () => (await readChromeVisualState(locator)).opacity).toBeCloseTo(1, 2);
  await expect.poll(async () => (await readChromeVisualState(locator)).pointerEvents).toBe('none');
  await expect.poll(async () => (await readChromeVisualState(locator)).filter).toBe('none');
  await expect.poll(async () => parseCssColorAlpha((await readChromeVisualState(locator)).overlayBackgroundColor))
    .toBeGreaterThan(0);
}

async function expectInactiveScreenshotResizer(locator: Locator): Promise<void> {
  await expect.poll(async () => (await readChromeVisualState(locator)).opacity).toBeCloseTo(0.46, 2);
  await expect.poll(async () => (await readChromeVisualState(locator)).pointerEvents).toBe('none');
  await expect.poll(async () => (await readChromeVisualState(locator)).filter).toBe('none');
}

async function expectActiveScreenshotTarget(locator: Locator): Promise<void> {
  await expect.poll(async () => (await readChromeVisualState(locator)).opacity).toBeCloseTo(1, 2);
  await expect.poll(async () => (await readChromeVisualState(locator)).pointerEvents).toBe('auto');
  await expect.poll(async () => (await readChromeVisualState(locator)).filter).toBe('none');
}

function parseCssColorAlpha(color: string): number {
  if (color === 'transparent') {
    return 0;
  }

  const match = color.match(/^rgba?\((.+)\)$/);
  if (!match) {
    return 0;
  }

  const alpha = match[1]?.split(',').at(3)?.trim();
  return alpha === undefined ? 1 : Number.parseFloat(alpha);
}

async function expectViewerCheckerBackground(viewer: Locator): Promise<void> {
  const background = await viewer.evaluate((element) => {
    const style = getComputedStyle(element);
    const checkerStyle = getComputedStyle(element, '::after');
    const rect = element.getBoundingClientRect();
    return {
      color: style.backgroundColor,
      image: checkerStyle.backgroundImage,
      opacity: checkerStyle.opacity,
      size: checkerStyle.backgroundSize,
      position: checkerStyle.backgroundPosition,
      offsetX: style.getPropertyValue('--viewer-checker-offset-x').trim(),
      offsetY: style.getPropertyValue('--viewer-checker-offset-y').trim(),
      rectLeft: rect.left,
      rectTop: rect.top
    };
  });

  expect(background.color).toBe('rgb(11, 15, 21)');
  expect(background.image).toContain('conic-gradient');
  expect(background.image).toContain('rgb(31, 31, 31)');
  expect(background.opacity).toBe('1');
  expect(background.size).toBe('32px 32px');
  expect(background.position).toBeTruthy();
  expect(Number.parseFloat(background.offsetX)).toBeCloseTo(-background.rectLeft, 2);
  expect(Number.parseFloat(background.offsetY)).toBeCloseTo(-background.rectTop, 2);
}

test('boots an empty app shell with menu actions gated until an image opens', async ({ page }) => {
  await gotoViewerApp(page);

  const viewer = page.locator('#viewer-container');
  const openedImages = page.locator('#opened-images-select');
  const appMenuTitle = page.locator('.app-menu-title');
  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const fileMenu = page.locator('#file-menu');
  const galleryMenuButton = page.getByRole('button', { name: 'Gallery', exact: true });
  const galleryMenu = page.locator('#gallery-menu');
  const settingsDialogButton = page.locator('#settings-dialog-button');
  const settingsDialog = page.locator('#settings-dialog');
  const galleryCboxItem = page.getByRole('menuitem', { name: 'cbox_rgb.exr', exact: true });
  const openMenuItem = page.locator('#open-file-button');
  const exportMenuItem = page.locator('#export-image-button');
  const reloadAllMenuItem = page.locator('#reload-all-opened-images-button');
  const closeAllMenuItem = page.locator('#close-all-opened-images-button');
  const autoFitButton = page.locator('#app-auto-fit-image-button');
  const themeInput = page.locator('#theme-select');
  const spectrumMotionInput = page.locator('#spectrum-lattice-motion-select');
  const budgetInput = page.locator('#display-cache-budget-input');
  const usageReadout = page.locator('#display-cache-usage');

  await expect(page.getByRole('heading', { name: 'Inspector' })).toHaveCount(0);
  await expect(appMenuTitle).toHaveText('OpenEXR Viewer');
  await expect(fileMenuButton).toBeVisible();
  await expect(fileMenu).toBeHidden();
  await expect(galleryMenuButton).toBeVisible();
  await expect(galleryMenu).toBeHidden();
  await expect(page.locator('.app-menu-nav').getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(settingsDialogButton).toBeVisible();
  await expect(settingsDialogButton).toHaveAttribute('aria-label', 'Settings');
  await expect(settingsDialogButton).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(settingsDialogButton).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsDialog).toBeHidden();
  await expect(page.locator('.image-panel-actions')).toHaveCount(0);
  await expect(page.locator('.image-panel-titlebar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Image', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'View', exact: true })).toHaveCount(0);
  await expect(page.locator('#zoom-readout')).toHaveCount(0);
  await expect(page.locator('#pan-readout')).toHaveCount(0);
  await expect(openedImages.locator('option')).toHaveCount(0);
  await expect(page.locator('#opened-files-list')).toContainText('No open files');
  await expect(page.locator('#viewer-idle-message')).toHaveCount(0);
  await expect(autoFitButton).toBeVisible();
  await expect(autoFitButton).toHaveAttribute('aria-label', 'Auto fit selected images');
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'false');
  await expectViewerCheckerBackground(viewer);

  await autoFitButton.click();
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'true');
  await autoFitButton.click();
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'false');

  await fileMenuButton.click();
  await expect(fileMenu).toBeVisible();
  await expect(openMenuItem).toBeEnabled();
  await expect(exportMenuItem).toBeDisabled();
  await expect(reloadAllMenuItem).toBeDisabled();
  await expect(closeAllMenuItem).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(fileMenu).toBeHidden();
  await expect(fileMenuButton).toHaveAttribute('aria-expanded', 'false');

  await galleryMenuButton.click();
  await expect(galleryMenu).toBeVisible();
  await expect(galleryCboxItem).toBeVisible();
  await expect(galleryCboxItem).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(galleryMenu).toBeHidden();

  await settingsDialogButton.click();
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialogButton).toHaveAttribute('aria-expanded', 'true');
  await expect(themeInput).toBeVisible();
  await expect(themeInput).toHaveValue('default');
  await expect(themeInput.locator('option')).toHaveText(['Default', 'Spectrum lattice']);
  await expect(spectrumMotionInput).toBeVisible();
  await expect(spectrumMotionInput).toHaveValue('animate');
  await expect(spectrumMotionInput.locator('option')).toHaveText(['Animate', 'Follow system']);
  await expect(budgetInput).toBeVisible();
  await expect(budgetInput).toHaveValue('256');
  await expect(budgetInput.locator('option')).toHaveText(['64', '128', '256', '512', '1024']);
  await expect(usageReadout).toContainText('/ 256 MB');
  await page.keyboard.press('Escape');
  await expect(settingsDialog).toBeHidden();
  await expect(settingsDialogButton).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsDialogButton).toBeFocused();

  await fileMenuButton.click();
  await expect(fileMenu).toBeVisible();
  await galleryMenuButton.hover();
  await expect(fileMenu).toBeHidden();
  await expect(galleryMenu).toBeVisible();
  await settingsDialogButton.hover();
  await expect(galleryMenu).toBeHidden();
  await expect(settingsDialog).toBeHidden();
});

test('distinguishes auto-fit pressed state from hover feedback', async ({ page }) => {
  await gotoViewerApp(page);

  const autoFitButton = page.locator('#app-auto-fit-image-button');

  await page.mouse.move(1, 1);
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'false');
  const initialState = await readAutoFitButtonVisualState(page);
  expect(initialState.boxShadow).toBe('none');

  await autoFitButton.click();
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'true');
  const pressedState = await readAutoFitButtonVisualState(page);
  expect(pressedState.boxShadow).not.toBe('none');
  expect(pressedState.boxShadow.match(/\binset\b/g)).toHaveLength(1);
  expect(pressedState.boxShadow).not.toContain('-2px');

  await autoFitButton.click();
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'false');
  const hoveredOffState = await readAutoFitButtonVisualState(page);
  expect(hoveredOffState.boxShadow).toBe('none');
  expect(hoveredOffState.backgroundColor).not.toBe(pressedState.backgroundColor);
});

test('keeps pointer-toggled auto-fit button unfocused while panning with wasd keys', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const autoFitButton = page.locator('#app-auto-fit-image-button');
  const viewer = page.locator('#viewer-container');
  const probeCoords = page.locator('#probe-coords');

  await autoFitButton.click();
  await expect(autoFitButton).toHaveAttribute('aria-pressed', 'true');
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

  await expect(autoFitButton).not.toBeFocused();
  const keyboardPanState = await readAutoFitButtonVisualState(page);
  expect(keyboardPanState.outlineStyle).toBe('none');
  expect(Number.parseFloat(keyboardPanState.outlineWidth)).toBe(0);
});

test('opens the gallery demo image and keeps core display controls stable', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  const layerControl = page.locator('#layer-control');
  const rgbGroupSelect = page.locator('#rgb-group-select');
  const rgbSplitToggleButton = page.locator('#rgb-split-toggle-button');
  const probeCoords = page.locator('#probe-coords');
  const probeColorValues = page.locator('#probe-color-values');
  const probeValues = page.locator('#probe-values');
  const metadataTable = page.locator('#metadata-table');
  const appMenuBar = page.locator('#app-menu-bar');
  const mainLayout = page.locator('#main-layout');
  const imagePanel = page.locator('#image-panel');
  const rightStack = page.locator('#right-stack');
  const viewer = page.locator('#viewer-container');
  const resetButton = page.locator('#reset-view-button');
  const noneButton = page.locator('#visualization-none-button');
  const colormapButton = page.locator('#colormap-toggle-button');
  const exposureControl = page.locator('#exposure-control');
  const exposureValue = page.locator('#exposure-value');
  const colormapRangeControl = page.locator('#colormap-range-control');
  const colormapSelect = page.locator('#colormap-select');
  const colormapAutoRangeButton = page.getByRole('button', { name: 'Auto Range' });
  const colormapZeroCenterButton = page.getByRole('button', { name: 'Zero Center' });
  const colormapRangeSlider = page.locator('#colormap-range-slider');
  const colormapVminInput = page.locator('#colormap-vmin-input');
  const colormapVmaxInput = page.locator('#colormap-vmax-input');
  const colormapVminSlider = page.locator('#colormap-vmin-slider');
  const colormapVmaxSlider = page.locator('#colormap-vmax-slider');
  const openedFileRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'cbox_rgb.exr' });
  const reloadOpenedFileButton = page.getByRole('button', { name: 'Reload cbox_rgb.exr', exact: true });
  const closeOpenedFileButton = page.getByRole('button', { name: 'Close cbox_rgb.exr', exact: true });
  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const fileMenu = page.locator('#file-menu');
  const openMenuItem = page.locator('#open-file-button');
  const exportMenuItem = page.locator('#export-image-button');
  const reloadAllMenuItem = page.locator('#reload-all-opened-images-button');
  const closeAllMenuItem = page.locator('#close-all-opened-images-button');

  await openGalleryCbox(page);

  await expect(openedImages.locator('option')).toHaveCount(1, { timeout: 30000 });
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(openedFileRow).toHaveCount(1);
  await expect(openedFileRow.locator('.opened-file-thumbnail')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(reloadOpenedFileButton).toBeVisible();
  await expect(closeOpenedFileButton).toBeVisible();
  await expect(openedFileRow.locator('.opened-file-label')).toHaveAttribute('title', /Path: .*cbox_rgb\.exr\nSize: .* MB/);
  await expect(layerControl).toBeHidden();
  await expect(metadataTable).toContainText('compression');
  await expect(metadataTable).toContainText('PIZ');
  await expect(metadataTable).toContainText('dataWindow');
  await expect(metadataTable).toContainText('channels');
  await expect(metadataTable).toContainText('3 (R, G, B)');

  await viewer.hover();
  await expect.poll(async () => await readProbeCoords(probeCoords)).not.toBeNull();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['R:', 'G:', 'B:']);
  await expect(probeValues).toContainText('R');
  await expect(probeValues).toContainText('G');
  await expect(probeValues).toContainText('B');

  const lockedProbePoint = await resolveViewerPoint(viewer, 0.5, 0.5);
  await page.mouse.click(lockedProbePoint.x, lockedProbePoint.y);
  await expect(page.locator('#probe-mode')).toHaveText('Locked');

  await expect(rgbGroupSelect).toBeEnabled();
  await expect(rgbSplitToggleButton).toBeVisible();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'false');
  await expect(rgbGroupSelect.locator('option:checked')).toHaveText('RGB');
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^R$/ })).toHaveCount(0);
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(rgbGroupSelect.locator('option:checked')).toHaveText('R');
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^R$/ })).toHaveCount(1);
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^G$/ })).toHaveCount(1);
  await expect(rgbGroupSelect.locator('option').filter({ hasText: /^B$/ })).toHaveCount(1);
  await rgbGroupSelect.selectOption({ label: 'R' });
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);
  await rgbSplitToggleButton.click();
  await expect(rgbSplitToggleButton).toHaveAttribute('aria-pressed', 'false');
  await expect(rgbGroupSelect.locator('option:checked')).toHaveText('RGB');

  await expect(page.locator('#display-toolbar')).toHaveCount(0);
  await expect(page.locator('#window-toolbar-menu-item')).toHaveCount(0);
  await expectVisibleShellGap(page, appMenuBar, mainLayout);
  await expectMainPanelTopsAligned(viewer, imagePanel, rightStack);

  await expect(resetButton).toBeVisible();
  await expect(noneButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'false');
  await expect(exposureControl).toBeVisible();
  await expect(colormapRangeControl).toBeHidden();
  await setExposureValue(exposureValue, '1.3');
  await expect(exposureValue).toHaveValue('1.3');
  await setExposureValue(exposureValue, '-0.7');
  await expect(exposureValue).toHaveValue('-0.7');

  await colormapButton.click();
  await expect(noneButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(exposureControl).toBeHidden();
  await expect(colormapRangeControl).toBeVisible();
  await expect(probeColorValues.locator('.probe-color-channel')).toHaveText(['Mono:']);
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'false');
  expect(expectedColormapLabels.length).toBeGreaterThanOrEqual(2);
  await expect(colormapSelect.locator('option')).toHaveText(expectedColormapLabels);
  await expect(colormapSelect).toHaveValue('0');
  await colormapSelect.selectOption({ label: expectedColormapLabels[1] });
  await expect(colormapSelect).toHaveValue('1');
  await expect(colormapRangeSlider).toBeVisible();
  await expect(colormapVminInput).toBeEnabled();
  await expect(colormapVmaxInput).toBeEnabled();
  await expect(colormapVmaxSlider).toBeEnabled();

  const autoMin = Number(await colormapVminInput.inputValue());
  const autoMax = Number(await colormapVmaxInput.inputValue());
  expect(autoMax).toBeGreaterThan(autoMin);
  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const track = document.querySelector('#colormap-range-slider');
        const slider = document.querySelector('#colormap-vmax-slider');
        if (!track || !slider) {
          return 0;
        }

        return slider.getBoundingClientRect().width - track.getBoundingClientRect().width;
      });
    })
    .toBeCloseTo(0, 1);

  const zeroCenteredAutoMax = Math.max(Math.abs(autoMin), Math.abs(autoMax));
  await colormapZeroCenterButton.click();
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapRangeSlider).toHaveClass(/zero-centered/);
  expect(Number(await colormapVminSlider.getAttribute('max'))).toBeLessThan(0);
  expect(Number(await colormapVmaxSlider.getAttribute('min'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-zeroCenteredAutoMax, 5);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(zeroCenteredAutoMax, 5);

  const manualMax = 1e-16;
  await colormapVmaxInput.fill(String(manualMax));
  await colormapVmaxInput.dispatchEvent('change');
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-manualMax, 12);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(manualMax, 12);

  await reloadOpenedFileButton.click();
  await expect(openedImages.locator('option:checked')).toContainText('cbox_rgb.exr');
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'false');
  await expect(colormapZeroCenterButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-manualMax, 12);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(manualMax, 12);

  await colormapAutoRangeButton.click();
  await expect(colormapAutoRangeButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await colormapVminInput.inputValue())).toBeCloseTo(-zeroCenteredAutoMax, 5);
  await expect.poll(async () => Number(await colormapVmaxInput.inputValue())).toBeCloseTo(zeroCenteredAutoMax, 5);

  await noneButton.click();
  await expect(noneButton).toHaveAttribute('aria-pressed', 'true');
  await expect(colormapButton).toHaveAttribute('aria-pressed', 'false');
  await expect(exposureControl).toBeVisible();
  await expect(colormapRangeControl).toBeHidden();

  await closeOpenedFileButton.click();
  await expect(openedImages.locator('option')).toHaveCount(0, { timeout: 30000 });
  await expect(layerControl).toBeHidden();
  await expect.poll(async () => await probeCoords.evaluate((element) => element.textContent ?? '')).toBe('x -   y -');
  await fileMenuButton.click();
  await expect(fileMenu).toBeVisible();
  await expect(openMenuItem).toBeEnabled();
  await expect(exportMenuItem).toBeDisabled();
  await expect(reloadAllMenuItem).toBeDisabled();
  await expect(closeAllMenuItem).toBeDisabled();
});

test('exports the active image as a png download from the file menu', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const exportMenuItem = page.locator('#export-image-button');
  const exportDialog = page.locator('#export-dialog-form');
  const exportFilenameInput = page.locator('#export-filename-input');
  const exportSubmitButton = page.locator('#export-dialog-submit-button');

  await fileMenuButton.click();
  await exportMenuItem.click();

  await expect(exportDialog).toBeVisible();
  await expect(exportFilenameInput).toHaveValue('cbox_rgb.png');

  const downloadPromise = page.waitForEvent('download');
  await exportSubmitButton.click();
  const download = await downloadPromise;

  await expect(exportDialog).toBeHidden();
  expect(download.suggestedFilename()).toBe('cbox_rgb.png');

  expectPngSignature(await readDownloadBytes(download));
});

test('temporarily renames an open file from the Open Files list', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const openedImages = page.locator('#opened-images-select');
  const openedFileRow = page.locator('#opened-files-list .opened-file-row').first();
  const openedFileLabel = openedFileRow.locator('.opened-file-label');
  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const exportMenuItem = page.locator('#export-image-button');
  const exportFilenameInput = page.locator('#export-filename-input');

  await expect(openedFileRow).toHaveCount(1);
  await expect(openedFileRow).toContainText('cbox_rgb.exr');
  await openedFileLabel.dblclick();

  const renameInput = openedFileRow.locator('.opened-file-rename-input');
  await expect(renameInput).toBeFocused();
  await renameInput.fill('Hero Plate.exr');
  await renameInput.press('Enter');

  const renamedRow = page.locator('#opened-files-list .opened-file-row').filter({ hasText: 'Hero Plate.exr' });
  await expect(renamedRow.locator('.opened-file-label')).toHaveText('Hero Plate.exr');
  await expect(openedImages.locator('option:checked')).toContainText('Hero Plate.exr');
  await expect(renamedRow.locator('.opened-file-label')).toHaveAttribute('title', /Path: .*cbox_rgb\.exr\nSize: .* MB/);

  await fileMenuButton.click();
  await exportMenuItem.click();
  await expect(exportFilenameInput).toHaveValue('Hero Plate.png');
});

test('exports an adjusted image-viewer screenshot region as a png download', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const exportScreenshotMenuItem = page.locator('#export-screenshot-button');
  const selectionOverlay = page.locator('#screenshot-selection-overlay');
  const selectionBox = page.locator('#screenshot-selection-box');
  const overlayExportButton = page.locator('#screenshot-selection-export-button');
  const exportDialog = page.locator('#export-dialog-form');
  const exportDialogBackdrop = page.locator('#export-dialog-backdrop');
  const exportFilenameInput = page.locator('#export-filename-input');
  const exportSizeField = page.locator('#export-size-field');
  const exportWidthInput = page.locator('#export-width-input');
  const exportHeightInput = page.locator('#export-height-input');
  const exportSubmitButton = page.locator('#export-dialog-submit-button');

  await fileMenuButton.click();
  await exportScreenshotMenuItem.click();

  await expect(selectionOverlay).toBeVisible();
  await expect(selectionBox).toBeVisible();

  const initialBox = await selectionBox.boundingBox();
  if (!initialBox) {
    throw new Error('Expected screenshot selection box to be visible.');
  }

  const dragSelectionWithKeys = async (
    keys: string[],
    from: { x: number; y: number },
    to: { x: number; y: number },
    button: 'left' | 'right' = 'left'
  ): Promise<void> => {
    for (const key of keys) {
      await page.keyboard.down(key);
    }
    try {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down({ button });
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up({ button });
    } finally {
      for (const key of [...keys].reverse()) {
        await page.keyboard.up(key);
      }
    }
  };

  const initialCenter = getBoxCenter(initialBox);
  await dragSelectionWithKeys(
    ['Control'],
    {
      x: initialBox.x + initialBox.width,
      y: initialBox.y + initialBox.height * 0.5
    },
    {
      x: initialBox.x + initialBox.width - 48,
      y: initialBox.y + initialBox.height * 0.5
    },
    'right'
  );

  const centerResizedBox = await selectionBox.boundingBox();
  if (!centerResizedBox) {
    throw new Error('Expected center-resized screenshot selection box to be visible.');
  }
  expect(getBoxCenter(centerResizedBox).x).toBeCloseTo(initialCenter.x, 0);
  expect(getBoxCenter(centerResizedBox).y).toBeCloseTo(initialCenter.y, 0);

  const centerResizedRatio = centerResizedBox.width / centerResizedBox.height;
  await dragSelectionWithKeys(
    ['Control', 'Shift'],
    {
      x: centerResizedBox.x + centerResizedBox.width,
      y: centerResizedBox.y + centerResizedBox.height
    },
    {
      x: centerResizedBox.x + centerResizedBox.width - 40,
      y: centerResizedBox.y + centerResizedBox.height - 20
    }
  );

  const resizedBox = await selectionBox.boundingBox();
  if (!resizedBox) {
    throw new Error('Expected resized screenshot selection box to be visible.');
  }
  expect(getBoxCenter(resizedBox).x).toBeCloseTo(initialCenter.x, 0);
  expect(getBoxCenter(resizedBox).y).toBeCloseTo(initialCenter.y, 0);
  expect(resizedBox.width / resizedBox.height).toBeCloseTo(centerResizedRatio, 1);
  expect(resizedBox.width).toBeLessThan(initialBox.width);
  expect(resizedBox.height).toBeLessThan(initialBox.height);

  await overlayExportButton.click();

  await expect(exportDialog).toBeVisible();
  await expect(exportFilenameInput).toHaveValue('cbox_rgb-screenshot.png');
  await expect(exportSizeField).toBeVisible();

  const initialWidth = Number(await exportWidthInput.inputValue());
  const initialHeight = Number(await exportHeightInput.inputValue());
  expect(initialWidth).toBeGreaterThan(0);
  expect(initialHeight).toBeGreaterThan(0);

  const [widthInputBox, dialogBox] = await Promise.all([
    exportWidthInput.boundingBox(),
    exportDialog.boundingBox()
  ]);
  if (!widthInputBox || !dialogBox) {
    throw new Error('Expected screenshot export dialog and width input to be visible.');
  }

  await page.mouse.move(
    widthInputBox.x + widthInputBox.width - 4,
    widthInputBox.y + widthInputBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(dialogBox.x - 8, widthInputBox.y + widthInputBox.height / 2, { steps: 4 });
  await page.mouse.up();

  await expect(exportDialogBackdrop).toBeVisible();
  await expect(exportDialog).toBeVisible();

  const nextWidth = Math.max(80, Math.round(initialWidth * 0.6));
  await exportWidthInput.fill(String(nextWidth));
  const nextHeight = Number(await exportHeightInput.inputValue());
  expect(nextHeight).toBeGreaterThan(0);
  expect(nextHeight).not.toBe(initialHeight);
  expect(nextHeight / nextWidth).toBeCloseTo(initialHeight / initialWidth, 1);

  const downloadPromise = page.waitForEvent('download');
  await exportSubmitButton.click();
  const download = await downloadPromise;

  await expect(exportDialog).toBeHidden();
  await expect(selectionOverlay).toBeHidden();
  expect(download.suggestedFilename()).toBe('cbox_rgb-screenshot.png');

  expectPngSignature(await readDownloadBytes(download));
});

test('marks non-viewer chrome inactive while screenshot selection is active', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const appShell = page.locator('#app');
  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const exportScreenshotMenuItem = page.locator('#export-screenshot-button');
  const appMenuBar = page.locator('#app-menu-bar');
  const rightStack = page.locator('#right-stack');
  const imagePanel = page.locator('#image-panel');
  const bottomPanel = page.locator('#bottom-panel');
  const imagePanelResizer = page.locator('#image-panel-resizer');
  const rightPanelResizer = page.locator('#right-panel-resizer');
  const bottomPanelResizer = page.locator('#bottom-panel-resizer');
  const selectionOverlay = page.locator('#screenshot-selection-overlay');
  const selectionControls = page.locator('#screenshot-selection-controls');
  const selectionCancelButton = page.locator('#screenshot-selection-cancel-button');

  await fileMenuButton.click();
  await exportScreenshotMenuItem.click();

  await expect(selectionOverlay).toBeVisible();
  await expect(appShell).toHaveClass(/is-screenshot-selecting/);

  for (const inactiveChrome of [
    appMenuBar,
    rightStack,
    imagePanel,
    bottomPanel
  ]) {
    await expectInactiveScreenshotChrome(inactiveChrome);
  }

  for (const inactiveResizer of [
    imagePanelResizer,
    rightPanelResizer,
    bottomPanelResizer
  ]) {
    await expectInactiveScreenshotResizer(inactiveResizer);
  }

  await expectActiveScreenshotTarget(selectionControls);
  await expectActiveScreenshotTarget(selectionCancelButton);

  await selectionCancelButton.click();

  await expect(selectionOverlay).toBeHidden();
  await expect(appShell).not.toHaveClass(/is-screenshot-selecting/);
  for (const restoredChrome of [
    appMenuBar,
    rightStack,
    imagePanel,
    bottomPanel,
    imagePanelResizer,
    rightPanelResizer,
    bottomPanelResizer
  ]) {
    await expectActiveScreenshotTarget(restoredChrome);
  }
});

test('preserves Spectrum lattice chrome blur while screenshot selection is active', async ({ page }) => {
  await gotoViewerApp(page);

  const settingsDialogButton = page.locator('#settings-dialog-button');
  const themeInput = page.locator('#theme-select');
  const appShell = page.locator('#app');
  const appMenuBar = page.locator('#app-menu-bar');
  const rightStack = page.locator('#right-stack');
  const imagePanel = page.locator('#image-panel');
  const bottomPanel = page.locator('#bottom-panel');
  const appScreenshotButton = page.locator('#app-screenshot-button');
  const selectionOverlay = page.locator('#screenshot-selection-overlay');

  await settingsDialogButton.click();
  await themeInput.selectOption('spectrum-lattice');
  await expect(themeInput).toHaveValue('spectrum-lattice');
  await page.keyboard.press('Escape');

  await openGalleryCbox(page);
  await appScreenshotButton.click();

  await expect(selectionOverlay).toBeVisible();
  await expect(appShell).toHaveClass(/is-screenshot-selecting/);

  for (const inactiveChrome of [
    appMenuBar,
    rightStack,
    imagePanel,
    bottomPanel
  ]) {
    await expectInactiveScreenshotChrome(inactiveChrome);
    await expect.poll(async () => (await readChromeVisualState(inactiveChrome)).backdropFilter).toContain('blur');
  }
});

test('exports a panorama-viewer screenshot region as a png download', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const viewMenuButton = page.getByRole('button', { name: 'View', exact: true });
  const panoramaMenuItem = page.locator('#panorama-viewer-menu-item');
  const exportScreenshotMenuItem = page.locator('#export-screenshot-button');
  const selectionOverlay = page.locator('#screenshot-selection-overlay');
  const overlayExportButton = page.locator('#screenshot-selection-export-button');
  const exportDialog = page.locator('#export-dialog-form');
  const exportSizeField = page.locator('#export-size-field');
  const exportSubmitButton = page.locator('#export-dialog-submit-button');

  await viewMenuButton.click();
  await panoramaMenuItem.click();
  await expect(panoramaMenuItem).toHaveAttribute('aria-checked', 'true');

  await fileMenuButton.click();
  await exportScreenshotMenuItem.click();

  await expect(selectionOverlay).toBeVisible();
  await overlayExportButton.click();

  await expect(exportDialog).toBeVisible();
  await expect(exportSizeField).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await exportSubmitButton.click();
  const download = await downloadPromise;

  await expect(exportDialog).toBeHidden();
  await expect(selectionOverlay).toBeHidden();
  expect(download.suggestedFilename()).toBe('cbox_rgb-screenshot.png');

  expectPngSignature(await readDownloadBytes(download));
});

test('cancels screenshot mode when screenshot export dialog is canceled', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const exportScreenshotMenuItem = page.locator('#export-screenshot-button');
  const selectionOverlay = page.locator('#screenshot-selection-overlay');
  const overlayExportButton = page.locator('#screenshot-selection-export-button');
  const exportDialog = page.locator('#export-dialog-form');
  const exportCancelButton = page.locator('#export-dialog-cancel-button');

  await fileMenuButton.click();
  await exportScreenshotMenuItem.click();
  await expect(selectionOverlay).toBeVisible();

  await overlayExportButton.click();
  await expect(exportDialog).toBeVisible();

  await exportCancelButton.click();
  await expect(exportDialog).toBeHidden();
  await expect(selectionOverlay).toBeHidden();
});

test('exports selected file-channel cells as one batch zip download', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  await page.setInputFiles('#file-input', {
    name: 'rgb_aux.exr',
    mimeType: 'image/exr',
    buffer: buildRgbAuxExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('rgb_aux.exr', { timeout: 30000 });

  await page.setInputFiles('#file-input', {
    name: 'scalar_z.exr',
    mimeType: 'image/exr',
    buffer: buildScalarChannelExr()
  });
  await expect(openedImages.locator('option')).toHaveCount(2, { timeout: 30000 });
  await expect(openedImages.locator('option:checked')).toContainText('scalar_z.exr');

  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const exportBatchMenuItem = page.locator('#export-image-batch-button');
  const exportBatchDialog = page.locator('#export-batch-dialog-form');
  const exportBatchSubmitButton = page.locator('#export-batch-dialog-submit-button');

  await fileMenuButton.click();
  await expect(exportBatchMenuItem).toBeEnabled();
  await exportBatchMenuItem.click();

  await expect(exportBatchDialog).toBeVisible();
  await expect(page.locator('#export-batch-archive-filename-input')).toHaveValue('openexr-export.zip');
  await expect(page.locator('.export-batch-file-toggle').filter({ hasText: 'rgb_aux.exr' })).toBeVisible();
  await page.locator('#export-batch-select-all-button').click();

  const downloadPromise = page.waitForEvent('download');
  await exportBatchSubmitButton.click();
  const download = await downloadPromise;

  await expect(exportBatchDialog).toBeHidden();
  expect(download.suggestedFilename()).toBe('openexr-export.zip');

  const zipEntries = unzipSync(await readDownloadBytes(download));
  expect(Object.keys(zipEntries).sort()).toEqual([
    'rgb_aux.RGBA.png',
    'rgb_aux.mask_A.png',
    'scalar_z.Z.png'
  ]);
  for (const entry of Object.values(zipEntries)) {
    expectPngSignature(entry);
  }
});

test('fits portrait batch export thumbnails inside their preview frames', async ({ page }) => {
  await gotoViewerApp(page);

  const openedImages = page.locator('#opened-images-select');
  await page.setInputFiles('#file-input', {
    name: 'portrait_rgb.exr',
    mimeType: 'image/exr',
    buffer: buildPortraitRgbExr()
  });
  await expect(openedImages.locator('option:checked')).toContainText('portrait_rgb.exr', { timeout: 30000 });

  const fileMenuButton = page.getByRole('button', { name: 'File', exact: true });
  const exportBatchMenuItem = page.locator('#export-image-batch-button');

  await fileMenuButton.click();
  await expect(exportBatchMenuItem).toBeEnabled();
  await exportBatchMenuItem.click();
  await expect(page.locator('#export-batch-dialog-form')).toBeVisible();

  const preview = page.locator('.export-batch-cell-preview').first();
  const image = preview.locator('.export-batch-cell-preview-image');
  await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(image).toBeVisible();

  const geometry = await preview.evaluate((previewElement) => {
    const imageElement = previewElement.querySelector<HTMLImageElement>('.export-batch-cell-preview-image');
    if (!imageElement) {
      throw new Error('Expected batch thumbnail preview image.');
    }

    const previewRect = previewElement.getBoundingClientRect();
    const imageRect = imageElement.getBoundingClientRect();
    return {
      preview: {
        left: previewRect.left,
        top: previewRect.top,
        right: previewRect.right,
        bottom: previewRect.bottom,
        width: previewRect.width,
        height: previewRect.height
      },
      image: {
        left: imageRect.left,
        top: imageRect.top,
        right: imageRect.right,
        bottom: imageRect.bottom,
        width: imageRect.width,
        height: imageRect.height
      },
      naturalWidth: imageElement.naturalWidth,
      naturalHeight: imageElement.naturalHeight
    };
  });

  expect(geometry.naturalHeight).toBeGreaterThan(geometry.naturalWidth);
  expect(geometry.image.height).toBeGreaterThan(geometry.image.width);
  expect(geometry.image.width).toBeLessThan(geometry.preview.width - 8);
  expect(geometry.image.height).toBeLessThanOrEqual(geometry.preview.height + 1);
  expect(geometry.image.left).toBeGreaterThanOrEqual(geometry.preview.left - 1);
  expect(geometry.image.top).toBeGreaterThanOrEqual(geometry.preview.top - 1);
  expect(geometry.image.right).toBeLessThanOrEqual(geometry.preview.right + 1);
  expect(geometry.image.bottom).toBeLessThanOrEqual(geometry.preview.bottom + 1);
});
