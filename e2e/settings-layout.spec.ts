import { expect, test, type Page } from '@playwright/test';
import { expectViewerAppReady, gotoViewerApp, openGalleryCbox } from './helpers/app';
import { dragBy } from './helpers/viewer';

async function readPanelShellVisualState(page: Page): Promise<Array<{
  id: string;
  backgroundColor: string;
  backgroundImage: string;
  backdropFilter: string;
  boxShadow: string;
}>> {
  return await page.evaluate(() => {
    return ['image-panel', 'right-stack', 'bottom-panel'].map((id) => {
      const element = document.getElementById(id);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing panel shell: ${id}`);
      }

      const style = getComputedStyle(element);
      const webkitStyle = style as CSSStyleDeclaration & { webkitBackdropFilter?: string };
      return {
        id,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        backdropFilter: style.backdropFilter || webkitStyle.webkitBackdropFilter || '',
        boxShadow: style.boxShadow
      };
    });
  });
}

async function readTopBarVisualState(page: Page): Promise<{
  backgroundColor: string;
  backgroundImage: string;
  backdropFilter: string;
  boxShadow: string;
}> {
  return await page.evaluate(() => {
    const element = document.getElementById('app-menu-bar');
    if (!(element instanceof HTMLElement)) {
      throw new Error('Missing app menu bar.');
    }

    const style = getComputedStyle(element);
    const webkitStyle = style as CSSStyleDeclaration & { webkitBackdropFilter?: string };
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backdropFilter: style.backdropFilter || webkitStyle.webkitBackdropFilter || '',
      boxShadow: style.boxShadow
    };
  });
}

async function readViewerBackgroundState(page: Page): Promise<{
  backgroundColor: string;
  backgroundImage: string;
  checkerBackgroundImage: string;
  checkerOpacity: string;
  checkerTransitionDuration: string;
  checkerTransitionProperty: string;
  spectrumGridBackgroundImage: string;
  spectrumGridOpacity: string;
  spectrumGridTransitionDuration: string;
  spectrumGridTransitionProperty: string;
}> {
  return await page.evaluate(() => {
    const element = document.getElementById('viewer-container');
    if (!(element instanceof HTMLElement)) {
      throw new Error('Missing viewer container.');
    }

    const style = getComputedStyle(element);
    const checkerStyle = getComputedStyle(element, '::after');
    const spectrumGridStyle = getComputedStyle(element, '::before');
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      checkerBackgroundImage: checkerStyle.backgroundImage,
      checkerOpacity: checkerStyle.opacity,
      checkerTransitionDuration: checkerStyle.transitionDuration,
      checkerTransitionProperty: checkerStyle.transitionProperty,
      spectrumGridBackgroundImage: spectrumGridStyle.backgroundImage,
      spectrumGridOpacity: spectrumGridStyle.opacity,
      spectrumGridTransitionDuration: spectrumGridStyle.transitionDuration,
      spectrumGridTransitionProperty: spectrumGridStyle.transitionProperty
    };
  });
}

async function expectViewerBackgroundLayerOpacity(
  page: Page,
  expected: { checker: number; spectrumGrid: number }
): Promise<void> {
  await expect.poll(async () => {
    const state = await readViewerBackgroundState(page);
    return (
      Math.abs(Number(state.checkerOpacity) - expected.checker) < 0.01 &&
      Math.abs(Number(state.spectrumGridOpacity) - expected.spectrumGrid) < 0.01
    );
  }, { timeout: 4500 }).toBe(true);
}

async function expectOverlayCanvasTransparent(page: Page): Promise<void> {
  await expect.poll(async () => await hasOverlayCanvasPixels(page), { timeout: 1000 }).toBe(false);
}

async function hasOverlayCanvasPixels(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const canvas = document.getElementById('overlay-canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) {
      return false;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to read overlay canvas.');
    }

    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
      if ((data[index] ?? 0) > 0) {
        return true;
      }
    }
    return false;
  });
}

test('persists the cache budget and keeps open-file actions limited to reload and close', async ({ page }) => {
  await gotoViewerApp(page);

  const settingsMenuButton = page.getByRole('button', { name: 'Settings', exact: true });
  const settingsMenu = page.locator('#settings-menu');
  const budgetInput = page.locator('#display-cache-budget-input');
  const usageReadout = page.locator('#display-cache-usage');

  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await expect(budgetInput).toHaveValue('256');
  await expect(usageReadout).toContainText('/ 256 MB');

  await openGalleryCbox(page);

  await expect(page.getByRole('button', { name: 'Reload cbox_rgb.exr', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close cbox_rgb.exr', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pin cache|Unpin cache/ })).toHaveCount(0);

  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await budgetInput.selectOption('128');

  await expect(budgetInput).toHaveValue('128');
  await expect(usageReadout).toContainText('/ 128 MB');
  await expect.poll(async () => {
    return await page.evaluate(() => {
      return window.localStorage.getItem('openexr-viewer:display-cache-budget-mb:v1');
    });
  }).toBe('128');

  await page.reload();
  await expectViewerAppReady(page);

  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await expect(budgetInput).toHaveValue('128');
  await expect(usageReadout).toContainText('/ 128 MB');

  await openGalleryCbox(page);
  await expect(page.getByRole('button', { name: 'Reload cbox_rgb.exr', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close cbox_rgb.exr', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pin cache|Unpin cache/ })).toHaveCount(0);
});

test('persists Spectrum lattice as animated idle and frozen active chrome', async ({ page }) => {
  await gotoViewerApp(page);

  const settingsMenuButton = page.getByRole('button', { name: 'Settings', exact: true });
  const settingsMenu = page.locator('#settings-menu');
  const themeInput = page.locator('#theme-select');
  const appShell = page.locator('#app');
  const mainLayout = page.locator('#main-layout');
  const viewer = page.locator('#viewer-container');
  const idleCanvas = page.locator('#spectrum-lattice-canvas');

  await expect(page.locator('#viewer-idle-message')).toHaveCount(0);
  await expect(page.locator('#spectrum-lattice-idle')).toHaveCount(0);
  await expect(idleCanvas).toBeHidden();
  const defaultViewerBackground = await readViewerBackgroundState(page);
  expect(defaultViewerBackground.backgroundImage).toBe('none');
  expect(defaultViewerBackground.checkerBackgroundImage).toContain('conic-gradient');
  expect(defaultViewerBackground.checkerOpacity).toBe('1');
  expect(defaultViewerBackground.spectrumGridBackgroundImage).toContain('linear-gradient');
  expect(defaultViewerBackground.spectrumGridOpacity).toBe('0');
  const defaultPanelState = await readPanelShellVisualState(page);
  expect(defaultPanelState.every((panel) => panel.backgroundColor === 'rgb(23, 29, 38)')).toBe(true);
  expect(defaultPanelState.every((panel) => panel.backgroundImage === 'none')).toBe(true);
  expect(defaultPanelState.every((panel) => panel.backdropFilter === 'none' || panel.backdropFilter === '')).toBe(true);
  const defaultTopBarState = await readTopBarVisualState(page);
  expect(defaultTopBarState.backgroundImage).toBe('none');
  expect(defaultTopBarState.backdropFilter === 'none' || defaultTopBarState.backdropFilter === '').toBe(true);
  expect(defaultTopBarState.boxShadow).toBe('none');
  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await themeInput.selectOption('spectrum-lattice');

  await expect(themeInput).toHaveValue('spectrum-lattice');
  await expect(idleCanvas).toBeVisible();
  const spectrumPanelState = await readPanelShellVisualState(page);
  expect(spectrumPanelState.every((panel) => panel.backgroundImage.includes('linear-gradient'))).toBe(true);
  expect(spectrumPanelState.every((panel) => panel.backdropFilter.includes('blur'))).toBe(true);
  expect(spectrumPanelState.every((panel) => panel.boxShadow !== 'none')).toBe(true);
  const spectrumTopBarState = await readTopBarVisualState(page);
  expect(spectrumTopBarState.backgroundImage.includes('linear-gradient')).toBe(true);
  expect(spectrumTopBarState.backdropFilter.includes('blur')).toBe(true);
  expect(spectrumTopBarState.boxShadow).not.toBe('none');
  await expectViewerBackgroundLayerOpacity(page, { checker: 0, spectrumGrid: 1 });
  const spectrumViewerBackground = await readViewerBackgroundState(page);
  expect(spectrumViewerBackground.checkerBackgroundImage).toContain('conic-gradient');
  expect(spectrumViewerBackground.spectrumGridBackgroundImage).toContain('linear-gradient');
  const spectrumLayoutState = await page.evaluate(() => {
    const appShell = document.getElementById('app');
    const mainLayout = document.getElementById('main-layout');
    const canvas = document.getElementById('spectrum-lattice-canvas');
    const viewer = document.getElementById('viewer-container');
    if (
      !(appShell instanceof HTMLElement) ||
      !(mainLayout instanceof HTMLElement) ||
      !(canvas instanceof HTMLCanvasElement) ||
      !(viewer instanceof HTMLElement)
    ) {
      throw new Error('Missing Spectrum layout elements.');
    }

    const viewerStyle = getComputedStyle(viewer);
    return {
      canvasParentId: canvas.parentElement?.id,
      appIdle: appShell.classList.contains('is-spectrum-lattice-idle'),
      mainIdle: mainLayout.classList.contains('is-spectrum-lattice-idle'),
      viewerIdle: viewer.classList.contains('is-spectrum-lattice-idle'),
      viewerBackgroundColor: viewerStyle.backgroundColor,
      viewerBackgroundImage: viewerStyle.backgroundImage
    };
  });
  expect(spectrumLayoutState.canvasParentId).toBe('app');
  expect(spectrumLayoutState.appIdle).toBe(true);
  expect(spectrumLayoutState.mainIdle).toBe(true);
  expect(spectrumLayoutState.viewerIdle).toBe(true);
  expect(spectrumLayoutState.viewerBackgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(spectrumLayoutState.viewerBackgroundImage).toBe('none');
  await expect.poll(async () => {
    return await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      storedTheme: window.localStorage.getItem('openexr-viewer:theme:v1')
    }));
  }).toEqual({
    theme: 'spectrum-lattice',
    storedTheme: 'spectrum-lattice'
  });

  await page.reload();
  await expectViewerAppReady(page);
  await expect(idleCanvas).toBeVisible();
  await expect(appShell).toHaveClass(/is-spectrum-lattice-idle/);
  await expect(mainLayout).toHaveClass(/is-spectrum-lattice-idle/);
  await expect(viewer).toHaveClass(/is-spectrum-lattice-idle/);
  const reloadedSpectrumViewerBackground = await readViewerBackgroundState(page);
  expect(reloadedSpectrumViewerBackground.checkerOpacity).toBe('0');
  expect(reloadedSpectrumViewerBackground.spectrumGridOpacity).toBe('1');
  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await expect(themeInput).toHaveValue('spectrum-lattice');
  await page.keyboard.press('Escape');

  await openGalleryCbox(page);
  await expect(idleCanvas).toBeVisible();
  await expect(appShell).not.toHaveClass(/is-spectrum-lattice-idle/);
  await expect(mainLayout).not.toHaveClass(/is-spectrum-lattice-idle/);
  await expect(viewer).not.toHaveClass(/is-spectrum-lattice-idle/);
  await expectViewerBackgroundLayerOpacity(page, { checker: 1, spectrumGrid: 0 });
  const activeViewerBackground = await readViewerBackgroundState(page);
  expect(activeViewerBackground.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(activeViewerBackground.backgroundImage).toBe('none');
  expect(activeViewerBackground.checkerBackgroundImage).toContain('conic-gradient');
  expect(activeViewerBackground.spectrumGridBackgroundImage).toContain('linear-gradient');
  const activePanelState = await readPanelShellVisualState(page);
  expect(activePanelState.every((panel) => panel.backgroundImage.includes('linear-gradient'))).toBe(true);
  expect(activePanelState.every((panel) => panel.backdropFilter.includes('blur'))).toBe(true);
  const activeTopBarState = await readTopBarVisualState(page);
  expect(activeTopBarState.backgroundImage.includes('linear-gradient')).toBe(true);
  expect(activeTopBarState.backdropFilter.includes('blur')).toBe(true);
  await expect.poll(async () => {
    return await page.evaluate(() => document.documentElement.dataset.theme);
  }).toBe('spectrum-lattice');

  await page.getByRole('button', { name: 'Close cbox_rgb.exr', exact: true }).click();
  await expectOverlayCanvasTransparent(page);
  await expect(appShell).toHaveClass(/is-spectrum-lattice-idle/);
  await expect(mainLayout).toHaveClass(/is-spectrum-lattice-idle/);
  await expect(viewer).toHaveClass(/is-spectrum-lattice-idle/);
  await expectViewerBackgroundLayerOpacity(page, { checker: 0, spectrumGrid: 1 });
});

test('resets settings back to the default budget and panel layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoViewerApp(page);

  const settingsMenuButton = page.getByRole('button', { name: 'Settings', exact: true });
  const settingsMenu = page.locator('#settings-menu');
  const themeInput = page.locator('#theme-select');
  const budgetInput = page.locator('#display-cache-budget-input');
  const usageReadout = page.locator('#display-cache-usage');
  const resetSettingsButton = page.getByRole('menuitem', { name: 'Reset Settings', exact: true });
  const imageResizer = page.locator('#image-panel-resizer');
  const rightResizer = page.locator('#right-panel-resizer');
  const bottomResizer = page.locator('#bottom-panel-resizer');
  const imageCollapseButton = page.locator('#image-panel-collapse-button');
  const rightCollapseButton = page.locator('#right-panel-collapse-button');
  const bottomCollapseButton = page.locator('#bottom-panel-collapse-button');

  const readLayout = async () => {
    return await page.evaluate(() => {
      const imagePanelContent = document.querySelector('#image-panel-content');
      const inspectorPanel = document.querySelector('#inspector-panel');
      const bottomPanelContent = document.querySelector('#bottom-panel-content');
      const imageCollapseButton = document.querySelector('#image-panel-collapse-button');
      const rightCollapseButton = document.querySelector('#right-panel-collapse-button');
      const bottomCollapseButton = document.querySelector('#bottom-panel-collapse-button');
      if (
        !(imagePanelContent instanceof HTMLElement) ||
        !(inspectorPanel instanceof HTMLElement) ||
        !(bottomPanelContent instanceof HTMLElement) ||
        !(imageCollapseButton instanceof HTMLButtonElement) ||
        !(rightCollapseButton instanceof HTMLButtonElement) ||
        !(bottomCollapseButton instanceof HTMLButtonElement)
      ) {
        throw new Error('Missing layout elements.');
      }

      return {
        imageWidth: imagePanelContent.getBoundingClientRect().width,
        rightWidth: inspectorPanel.getBoundingClientRect().width,
        bottomHeight: bottomPanelContent.getBoundingClientRect().height,
        imageExpanded: imageCollapseButton.getAttribute('aria-expanded'),
        rightExpanded: rightCollapseButton.getAttribute('aria-expanded'),
        bottomExpanded: bottomCollapseButton.getAttribute('aria-expanded'),
        storedBudget: window.localStorage.getItem('openexr-viewer:display-cache-budget-mb:v1'),
        storedTheme: window.localStorage.getItem('openexr-viewer:theme:v1'),
        storedPanel: window.localStorage.getItem('openexr-viewer:panel-splits:v1')
      };
    });
  };

  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await themeInput.selectOption('spectrum-lattice');
  await expect(themeInput).toHaveValue('spectrum-lattice');
  await budgetInput.selectOption('128');
  await expect(budgetInput).toHaveValue('128');
  await expect(usageReadout).toContainText('/ 128 MB');
  await page.keyboard.press('Escape');
  await expect(settingsMenu).toBeHidden();

  await dragBy(page, imageResizer, 48, 0);
  await dragBy(page, rightResizer, -48, 0);
  await expect(bottomCollapseButton).toHaveAttribute('aria-expanded', 'true');
  await expect(bottomResizer).toBeVisible();
  await dragBy(page, bottomResizer, 0, -48);
  await imageCollapseButton.click();
  await rightCollapseButton.click();
  await bottomCollapseButton.click();
  await page.waitForTimeout(100);

  const mutated = await readLayout();
  expect(mutated.imageWidth).toBeLessThan(2);
  expect(mutated.rightWidth).toBeLessThan(2);
  expect(mutated.bottomHeight).toBeLessThanOrEqual(2);
  expect(mutated.imageExpanded).toBe('false');
  expect(mutated.rightExpanded).toBe('false');
  expect(mutated.bottomExpanded).toBe('false');
  expect(mutated.storedBudget).toBe('128');
  expect(mutated.storedTheme).toBe('spectrum-lattice');

  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await expect(themeInput).toHaveValue('spectrum-lattice');
  await expect(budgetInput).toHaveValue('128');
  await resetSettingsButton.click();

  await expect(settingsMenu).toBeVisible();
  await expect(settingsMenuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(themeInput).toHaveValue('default');
  await expect(budgetInput).toHaveValue('256');
  await expect(usageReadout).toContainText('/ 256 MB');

  const afterReset = await readLayout();
  expect(Math.abs(afterReset.imageWidth - 220)).toBeLessThanOrEqual(2);
  expect(Math.abs(afterReset.rightWidth - 280)).toBeLessThanOrEqual(2);
  expect(Math.abs(afterReset.bottomHeight - 120)).toBeLessThanOrEqual(2);
  expect(afterReset.imageExpanded).toBe('true');
  expect(afterReset.rightExpanded).toBe('true');
  expect(afterReset.bottomExpanded).toBe('true');
  expect(afterReset.storedBudget).toBe('256');
  expect(afterReset.storedTheme).toBeNull();
  expect(JSON.parse(afterReset.storedPanel ?? '{}')).toEqual({
    imagePanelWidth: 220,
    rightPanelWidth: 280,
    bottomPanelHeight: 120,
    imagePanelCollapsed: false,
    rightPanelCollapsed: false,
    bottomPanelCollapsed: false
  });

  await page.reload();
  await expectViewerAppReady(page);

  await settingsMenuButton.click();
  await expect(settingsMenu).toBeVisible();
  await expect(themeInput).toHaveValue('default');
  await expect(budgetInput).toHaveValue('256');
  await expect(usageReadout).toContainText('/ 256 MB');

  const afterReload = await readLayout();
  expect(Math.abs(afterReload.imageWidth - 220)).toBeLessThanOrEqual(2);
  expect(Math.abs(afterReload.rightWidth - 280)).toBeLessThanOrEqual(2);
  expect(Math.abs(afterReload.bottomHeight - 120)).toBeLessThanOrEqual(2);
  expect(afterReload.imageExpanded).toBe('true');
  expect(afterReload.rightExpanded).toBe('true');
  expect(afterReload.bottomExpanded).toBe('true');
  expect(afterReload.storedBudget).toBe('256');
  expect(afterReload.storedTheme).toBeNull();
  expect(JSON.parse(afterReload.storedPanel ?? '{}')).toEqual({
    imagePanelWidth: 220,
    rightPanelWidth: 280,
    bottomPanelHeight: 120,
    imagePanelCollapsed: false,
    rightPanelCollapsed: false,
    bottomPanelCollapsed: false
  });
});

test('resizes desktop panel splits and persists them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoViewerApp(page);

  const imageResizer = page.locator('#image-panel-resizer');
  const rightResizer = page.locator('#right-panel-resizer');
  const bottomResizer = page.locator('#bottom-panel-resizer');
  const imageCollapseButton = page.locator('#image-panel-collapse-button');
  const rightCollapseButton = page.locator('#right-panel-collapse-button');
  const bottomCollapseButton = page.locator('#bottom-panel-collapse-button');
  const viewer = page.locator('#viewer-container');
  const bottomPanel = page.locator('#bottom-panel');
  const inspectorPanel = page.locator('#inspector-panel');
  const imagePanel = page.locator('#image-panel');

  await expect(imageResizer).toBeVisible();
  await expect(rightResizer).toBeVisible();
  await expect(bottomResizer).toBeVisible();
  await expect(imageCollapseButton).toBeVisible();
  await expect(rightCollapseButton).toBeVisible();
  await expect(bottomCollapseButton).toBeVisible();

  const readLayout = async () => {
    return await page.evaluate(() => {
      const mainLayout = document.querySelector('#main-layout');
      const imagePanel = document.querySelector('#image-panel');
      const imagePanelContent = document.querySelector('#image-panel-content');
      const rightStack = document.querySelector('#right-stack');
      const inspectorPanel = document.querySelector('#inspector-panel');
      const bottomPanel = document.querySelector('#bottom-panel');
      const bottomPanelContent = document.querySelector('#bottom-panel-content');
      const imageResizer = document.querySelector('#image-panel-resizer');
      const rightResizer = document.querySelector('#right-panel-resizer');
      const bottomResizer = document.querySelector('#bottom-panel-resizer');
      const imageCollapseButton = document.querySelector('#image-panel-collapse-button');
      const rightCollapseButton = document.querySelector('#right-panel-collapse-button');
      const bottomCollapseButton = document.querySelector('#bottom-panel-collapse-button');
      const viewerContainer = document.querySelector('#viewer-container');
      const canvas = document.querySelector('#gl-canvas');
      if (
        !(mainLayout instanceof HTMLElement) ||
        !(imagePanel instanceof HTMLElement) ||
        !(imagePanelContent instanceof HTMLElement) ||
        !(rightStack instanceof HTMLElement) ||
        !(inspectorPanel instanceof HTMLElement) ||
        !(bottomPanel instanceof HTMLElement) ||
        !(bottomPanelContent instanceof HTMLElement) ||
        !(imageResizer instanceof HTMLElement) ||
        !(rightResizer instanceof HTMLElement) ||
        !(bottomResizer instanceof HTMLElement) ||
        !(imageCollapseButton instanceof HTMLButtonElement) ||
        !(rightCollapseButton instanceof HTMLButtonElement) ||
        !(bottomCollapseButton instanceof HTMLButtonElement) ||
        !(viewerContainer instanceof HTMLElement) ||
        !(canvas instanceof HTMLCanvasElement)
      ) {
        throw new Error('Missing layout elements.');
      }

      const imagePanelRect = imagePanel.getBoundingClientRect();
      const imagePanelContentRect = imagePanelContent.getBoundingClientRect();
      const rightStackRect = rightStack.getBoundingClientRect();
      const inspectorPanelRect = inspectorPanel.getBoundingClientRect();
      const bottomPanelRect = bottomPanel.getBoundingClientRect();
      const bottomPanelContentRect = bottomPanelContent.getBoundingClientRect();
      const imageCollapseButtonRect = imageCollapseButton.getBoundingClientRect();
      const rightCollapseButtonRect = rightCollapseButton.getBoundingClientRect();
      const bottomCollapseButtonRect = bottomCollapseButton.getBoundingClientRect();
      const mainLayoutRect = mainLayout.getBoundingClientRect();

      return {
        mainWidth: mainLayoutRect.width,
        imageShellWidth: imagePanelRect.width,
        imageWidth: imagePanelContentRect.width,
        imageButtonHeight: imageCollapseButtonRect.height,
        imageShellHeight: imagePanelRect.height,
        imageButtonLeft: imageCollapseButtonRect.left,
        imageShellLeft: imagePanelRect.left,
        rightShellWidth: rightStackRect.width,
        rightWidth: inspectorPanelRect.width,
        rightButtonHeight: rightCollapseButtonRect.height,
        rightShellHeight: rightStackRect.height,
        rightButtonRight: rightCollapseButtonRect.right,
        rightShellRight: rightStackRect.right,
        bottomShellWidth: bottomPanelRect.width,
        bottomShellHeight: bottomPanelRect.height,
        bottomHeight: bottomPanelContentRect.height,
        bottomButtonWidth: bottomCollapseButtonRect.width,
        bottomButtonBottom: bottomCollapseButtonRect.bottom,
        bottomShellBottom: bottomPanelRect.bottom,
        imageResizerWidth: imageResizer.getBoundingClientRect().width,
        rightResizerWidth: rightResizer.getBoundingClientRect().width,
        bottomResizerHeight: bottomResizer.getBoundingClientRect().height,
        viewerWidth: viewerContainer.getBoundingClientRect().width,
        viewerHeight: viewerContainer.getBoundingClientRect().height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        stored: window.localStorage.getItem('openexr-viewer:panel-splits:v1')
      };
    });
  };

  const initial = await readLayout();
  expect(Math.abs(initial.imageButtonHeight - initial.imageShellHeight)).toBeLessThan(3);
  expect(Math.abs(initial.rightButtonHeight - initial.rightShellHeight)).toBeLessThan(3);
  expect(Math.abs(initial.imageButtonLeft - initial.imageShellLeft)).toBeLessThan(2);
  expect(Math.abs(initial.rightButtonRight - initial.rightShellRight)).toBeLessThan(2);
  expect(Math.abs(initial.bottomButtonWidth - initial.bottomShellWidth)).toBeLessThan(3);
  expect(Math.abs(initial.bottomButtonBottom - initial.bottomShellBottom)).toBeLessThan(2);
  expect(Math.abs(initial.bottomShellWidth - initial.mainWidth)).toBeLessThan(3);
  expect(initial.bottomHeight).toBeGreaterThanOrEqual(110);
  expect(initial.bottomHeight).toBeLessThanOrEqual(120);

  await dragBy(page, imageResizer, 48, 0);
  const afterImageResize = await readLayout();
  expect(afterImageResize.imageWidth).toBeGreaterThan(initial.imageWidth + 30);
  expect(afterImageResize.viewerWidth).toBeGreaterThan(360);

  await dragBy(page, rightResizer, -48, 0);
  const afterRightResize = await readLayout();
  expect(afterRightResize.rightWidth).toBeGreaterThan(afterImageResize.rightWidth + 30);
  expect(afterRightResize.canvasWidth).toBeGreaterThan(0);
  expect(afterRightResize.canvasHeight).toBeGreaterThan(0);

  await expect(bottomCollapseButton).toHaveAttribute('aria-expanded', 'true');
  await expect(bottomResizer).toBeVisible();

  await dragBy(page, bottomResizer, 0, 160);
  const afterBottomResize = await readLayout();
  expect(afterBottomResize.bottomHeight).toBeLessThan(120);
  expect(afterBottomResize.bottomHeight).toBeGreaterThanOrEqual(68);
  expect(afterBottomResize.bottomHeight).toBeLessThanOrEqual(74);
  expect(afterBottomResize.viewerHeight).toBeGreaterThan(afterRightResize.viewerHeight + 30);

  expect(afterBottomResize.stored).not.toBeNull();

  const stored = JSON.parse(afterBottomResize.stored ?? '{}') as {
    imagePanelWidth?: number;
    rightPanelWidth?: number;
    bottomPanelHeight?: number;
    imagePanelCollapsed?: boolean;
    rightPanelCollapsed?: boolean;
    bottomPanelCollapsed?: boolean;
  };
  expect(stored.imagePanelWidth).toBeCloseTo(afterBottomResize.imageWidth, 0);
  expect(stored.rightPanelWidth).toBeCloseTo(afterBottomResize.rightWidth, 0);
  expect(stored.bottomPanelHeight).toBeGreaterThanOrEqual(72);
  expect(stored.bottomPanelHeight).toBeLessThan(120);
  expect(Math.abs((stored.bottomPanelHeight ?? 0) - afterBottomResize.bottomHeight)).toBeLessThanOrEqual(2);
  expect(stored.imagePanelCollapsed).toBe(false);
  expect(stored.rightPanelCollapsed).toBe(false);
  expect(stored.bottomPanelCollapsed).toBe(false);

  await page.reload();
  await expectViewerAppReady(page);
  const afterReload = await readLayout();
  expect(afterReload.imageWidth).toBeCloseTo(afterBottomResize.imageWidth, 0);
  expect(afterReload.rightWidth).toBeCloseTo(afterBottomResize.rightWidth, 0);
  expect(afterReload.bottomHeight).toBeCloseTo(afterBottomResize.bottomHeight, 0);

  await imageCollapseButton.click();
  await page.waitForTimeout(100);
  const afterImageCollapse = await readLayout();
  expect(afterImageCollapse.imageWidth).toBeLessThan(2);
  expect(afterImageCollapse.imageShellWidth).toBeGreaterThan(10);
  expect(afterImageCollapse.imageResizerWidth).toBeLessThan(2);
  expect(afterImageCollapse.viewerWidth).toBeGreaterThan(afterReload.viewerWidth + 30);
  await expect(imageResizer).toBeHidden();
  await expect(imageCollapseButton).toHaveAttribute('aria-expanded', 'false');

  const storedAfterImageCollapse = JSON.parse(afterImageCollapse.stored ?? '{}') as {
    imagePanelWidth?: number;
    imagePanelCollapsed?: boolean;
  };
  expect(storedAfterImageCollapse.imagePanelWidth).toBeCloseTo(afterReload.imageWidth, 0);
  expect(storedAfterImageCollapse.imagePanelCollapsed).toBe(true);

  await page.reload();
  await expectViewerAppReady(page);
  const afterImageCollapseReload = await readLayout();
  expect(afterImageCollapseReload.imageWidth).toBeLessThan(2);
  await expect(imageCollapseButton).toHaveAttribute('aria-expanded', 'false');

  await imageCollapseButton.click();
  await page.waitForTimeout(100);
  const afterImageReopen = await readLayout();
  expect(afterImageReopen.imageWidth).toBeCloseTo(afterReload.imageWidth, 0);
  await expect(imageResizer).toBeVisible();
  await expect(imageCollapseButton).toHaveAttribute('aria-expanded', 'true');

  await rightCollapseButton.click();
  await page.waitForTimeout(100);
  const afterRightCollapse = await readLayout();
  expect(afterRightCollapse.rightWidth).toBeLessThan(2);
  expect(afterRightCollapse.rightShellWidth).toBeGreaterThan(10);
  expect(afterRightCollapse.rightResizerWidth).toBeLessThan(2);
  expect(afterRightCollapse.viewerWidth).toBeGreaterThan(afterImageReopen.viewerWidth + 30);
  await expect(rightResizer).toBeHidden();
  await expect(rightCollapseButton).toHaveAttribute('aria-expanded', 'false');

  const storedAfterRightCollapse = JSON.parse(afterRightCollapse.stored ?? '{}') as {
    rightPanelWidth?: number;
    rightPanelCollapsed?: boolean;
  };
  expect(storedAfterRightCollapse.rightPanelWidth).toBeCloseTo(afterImageReopen.rightWidth, 0);
  expect(storedAfterRightCollapse.rightPanelCollapsed).toBe(true);

  await page.reload();
  await expectViewerAppReady(page);
  const afterRightCollapseReload = await readLayout();
  expect(afterRightCollapseReload.rightWidth).toBeLessThan(2);
  await expect(rightCollapseButton).toHaveAttribute('aria-expanded', 'false');

  await rightCollapseButton.click();
  await page.waitForTimeout(100);
  const afterRightReopen = await readLayout();
  expect(afterRightReopen.rightWidth).toBeCloseTo(afterImageReopen.rightWidth, 0);
  await expect(rightResizer).toBeVisible();
  await expect(rightCollapseButton).toHaveAttribute('aria-expanded', 'true');

  await bottomCollapseButton.click();
  await page.waitForTimeout(100);
  const afterBottomCollapse = await readLayout();
  expect(afterBottomCollapse.bottomHeight).toBeLessThanOrEqual(2);
  expect(afterBottomCollapse.bottomShellHeight).toBeGreaterThan(10);
  expect(afterBottomCollapse.bottomResizerHeight).toBeLessThan(2);
  expect(afterBottomCollapse.viewerHeight).toBeGreaterThan(afterRightReopen.viewerHeight + 30);
  await expect(bottomResizer).toBeHidden();
  await expect(bottomCollapseButton).toHaveAttribute('aria-expanded', 'false');

  const storedAfterBottomCollapse = JSON.parse(afterBottomCollapse.stored ?? '{}') as {
    bottomPanelHeight?: number;
    bottomPanelCollapsed?: boolean;
  };
  expect(Math.abs((storedAfterBottomCollapse.bottomPanelHeight ?? 0) - afterRightReopen.bottomHeight)).toBeLessThanOrEqual(2);
  expect(storedAfterBottomCollapse.bottomPanelCollapsed).toBe(true);

  await page.reload();
  await expectViewerAppReady(page);
  const afterBottomCollapseReload = await readLayout();
  expect(afterBottomCollapseReload.bottomHeight).toBeLessThanOrEqual(2);
  await expect(bottomCollapseButton).toHaveAttribute('aria-expanded', 'false');

  await bottomCollapseButton.click();
  await page.waitForTimeout(100);
  const afterBottomReopen = await readLayout();
  expect(afterBottomReopen.bottomHeight).toBeCloseTo(afterRightReopen.bottomHeight, 0);
  await expect(bottomResizer).toBeVisible();
  await expect(bottomCollapseButton).toHaveAttribute('aria-expanded', 'true');

  await page.setViewportSize({ width: 800, height: 700 });
  await expect(imageResizer).toBeHidden();
  await expect(rightResizer).toBeHidden();
  await expect(bottomResizer).toBeHidden();
  await expect(imageCollapseButton).toBeHidden();
  await expect(rightCollapseButton).toBeHidden();
  await expect(bottomCollapseButton).toBeHidden();
  await expect(viewer).toBeVisible();
  await expect(bottomPanel).toBeVisible();
  await expect(inspectorPanel).toBeVisible();
  await expect(imagePanel).toBeVisible();

  const mobileOrder = await page.evaluate(() => {
    const viewer = document.querySelector('#viewer-container');
    const bottom = document.querySelector('#bottom-panel');
    const panel = document.querySelector('#inspector-panel');
    const image = document.querySelector('#image-panel');
    if (
      !(viewer instanceof HTMLElement) ||
      !(bottom instanceof HTMLElement) ||
      !(panel instanceof HTMLElement) ||
      !(image instanceof HTMLElement)
    ) {
      throw new Error('Missing mobile layout elements.');
    }

    return {
      viewerTop: viewer.getBoundingClientRect().top,
      bottomTop: bottom.getBoundingClientRect().top,
      panelTop: panel.getBoundingClientRect().top,
      imageTop: image.getBoundingClientRect().top
    };
  });
  expect(mobileOrder.bottomTop).toBeGreaterThan(mobileOrder.viewerTop);
  expect(mobileOrder.panelTop).toBeGreaterThan(mobileOrder.bottomTop);
  expect(mobileOrder.imageTop).toBeGreaterThan(mobileOrder.panelTop);
});

test('keeps desktop panel heights stable after opening an image', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoViewerApp(page);

  const imageCollapseButton = page.locator('#image-panel-collapse-button');
  const rightCollapseButton = page.locator('#right-panel-collapse-button');

  await expect(imageCollapseButton).toBeVisible();
  await expect(rightCollapseButton).toBeVisible();

  const readHeights = async () => {
    return await page.evaluate(() => {
      const mainLayout = document.querySelector('#main-layout');
      const imagePanel = document.querySelector('#image-panel');
      const rightStack = document.querySelector('#right-stack');
      const imageCollapseButton = document.querySelector('#image-panel-collapse-button');
      const rightCollapseButton = document.querySelector('#right-panel-collapse-button');

      if (
        !(mainLayout instanceof HTMLElement) ||
        !(imagePanel instanceof HTMLElement) ||
        !(rightStack instanceof HTMLElement) ||
        !(imageCollapseButton instanceof HTMLButtonElement) ||
        !(rightCollapseButton instanceof HTMLButtonElement)
      ) {
        throw new Error('Missing panel height elements.');
      }

      return {
        mainLayoutHeight: mainLayout.getBoundingClientRect().height,
        imageShellHeight: imagePanel.getBoundingClientRect().height,
        rightShellHeight: rightStack.getBoundingClientRect().height,
        imageButtonHeight: imageCollapseButton.getBoundingClientRect().height,
        rightButtonHeight: rightCollapseButton.getBoundingClientRect().height
      };
    });
  };

  const initial = await readHeights();
  expect(Math.abs(initial.imageButtonHeight - initial.imageShellHeight)).toBeLessThan(3);
  expect(Math.abs(initial.rightButtonHeight - initial.rightShellHeight)).toBeLessThan(3);

  await openGalleryCbox(page);
  await page.waitForTimeout(250);

  const afterOpen = await readHeights();
  expect(afterOpen.mainLayoutHeight).toBeCloseTo(initial.mainLayoutHeight, 0);
  expect(afterOpen.imageShellHeight).toBeCloseTo(initial.imageShellHeight, 0);
  expect(afterOpen.rightShellHeight).toBeCloseTo(initial.rightShellHeight, 0);
  expect(Math.abs(afterOpen.imageButtonHeight - afterOpen.imageShellHeight)).toBeLessThan(3);
  expect(Math.abs(afterOpen.rightButtonHeight - afterOpen.rightShellHeight)).toBeLessThan(3);
});
