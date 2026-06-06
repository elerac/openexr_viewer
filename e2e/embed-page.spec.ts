import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './helpers/test';

const EXPECTED_BOOTSTRAP_ABORT = 'Viewer application has not finished initializing.';
const EMBED_GUIDE_TITLE = 'Prismifold Embed Guide | OpenEXR Image Viewer';
const EMBED_GUIDE_DESCRIPTION =
  'Embed Prismifold OpenEXR viewers in HTML pages with the prismifold-viewer web component, declarative attributes, deferred loading, channel panels, and the JavaScript API.';
const EMBED_GUIDE_URL = 'https://elerac.github.io/prismifold/embed/';
const POLYHAVEN_BROWN_PHOTOSTUDIO_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/brown_photostudio_02_1k.exr';
const POLYHAVEN_BROWN_PHOTOSTUDIO_NAME = 'Poly Haven Brown Photostudio 02';
const CBOX_RGB_EXR_FIXTURE = readFileSync(new URL('../public/cbox_rgb.exr', import.meta.url));

function watchUnexpectedErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    if (!error.message.includes(EXPECTED_BOOTSTRAP_ABORT)) {
      errors.push(`pageerror: ${error.message}`);
    }
  });
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(async () => (
    await page.evaluate(() => {
      const width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      return width <= document.documentElement.clientWidth + 1;
    })
  )).toBe(true);
}

async function expectEmbedIframeUiMode(page: Page, locatorText: string): Promise<URL> {
  const example = page.locator('.embed-example').filter({ hasText: locatorText });
  await expect(example).toHaveCount(1);
  const iframe = example.locator('prismifold-viewer iframe');
  await expect(iframe).toBeVisible({ timeout: 30000 });
  const src = await iframe.getAttribute('src');
  if (!src) {
    throw new Error(`Expected iframe src for ${locatorText}.`);
  }
  const url = new URL(src, page.url());
  expect(url.searchParams.get('ui')).toBe('embed');
  return url;
}

test('serves the embed guide with live examples and reference content @smoke', async ({ page }) => {
  test.setTimeout(120000);
  const unexpectedErrors = watchUnexpectedErrors(page);
  await page.route(POLYHAVEN_BROWN_PHOTOSTUDIO_URL, async (route) => {
    await route.fulfill({
      contentType: 'application/octet-stream',
      body: CBOX_RGB_EXR_FIXTURE
    });
  });
  await page.goto('/embed/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(EMBED_GUIDE_TITLE);
  await expect(page.locator('head meta[name="description"]')).toHaveAttribute('content', EMBED_GUIDE_DESCRIPTION);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', EMBED_GUIDE_URL);
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute('href', '../project-page/app-icon.png');
  await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute('content', EMBED_GUIDE_URL);

  await expect(page.getByRole('heading', { name: 'Embed Prismifold', level: 1 })).toBeVisible();
  await expect(page.locator('.site-nav a')).toHaveText(['Project', 'Examples', 'Attributes', 'API', 'GitHub']);
  await expect(page.getByRole('link', { name: 'Project', exact: true })).toHaveAttribute('href', '../');
  await expect(page.getByRole('link', { name: 'Examples', exact: true })).toHaveAttribute('href', '#examples');
  await expect(page.getByRole('link', { name: 'Attributes', exact: true })).toHaveAttribute('href', '#attributes');
  await expect(page.getByRole('link', { name: 'API', exact: true })).toHaveAttribute('href', '#javascript-api');
  await expect(page.getByText(
    'Publish interactive OpenEXR inspection directly inside documentation, papers, datasets, and project pages.',
    { exact: false }
  )).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await expect(page.getByRole('heading', { name: 'Embed examples', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Basic custom element', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Named source with channel panel', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Panorama view', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '3D view', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deferred loading', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'JavaScript API and local files', level: 3 })).toBeVisible();

  const basicCode = page
    .locator('.embed-example')
    .filter({ hasText: 'Basic custom element' })
    .locator('.gallery-code-frame code');
  await expect(basicCode).toContainText(
    '<script src="https://elerac.github.io/prismifold/embed/prismifold.js"></script>'
  );
  await expect(basicCode).toContainText('<prismifold-viewer');
  await expect(basicCode).toContainText('src="../cbox_rgb.exr"');
  await expect(basicCode).toContainText('height="340"');

  const channelsCode = page
    .locator('.embed-example')
    .filter({ hasText: 'Named source with channel panel' })
    .locator('.gallery-code-frame code');
  await expect(channelsCode).toContainText('name="Cornell Box RGB"');
  await expect(channelsCode).toContainText('bottom-panel="channels"');

  const panoramaCode = page
    .locator('.embed-example')
    .filter({ hasText: 'Panorama view' })
    .locator('.gallery-code-frame code');
  await expect(panoramaCode).toContainText(`src="${POLYHAVEN_BROWN_PHOTOSTUDIO_URL}"`);
  await expect(panoramaCode).toContainText(`name="${POLYHAVEN_BROWN_PHOTOSTUDIO_NAME}"`);
  await expect(panoramaCode).toContainText('view="panorama"');
  await expect(panoramaCode).toContainText('panorama-auto-rotate="true"');
  await expect(panoramaCode).toContainText('panorama-rotation-speed="6"');
  await expect(panoramaCode).toContainText('bottom-panel="none"');
  await expect(panoramaCode).toContainText('source-origin="viewer"');

  const threeDCode = page
    .locator('.embed-example')
    .filter({ hasText: '3D view' })
    .locator('.gallery-code-frame code');
  await expect(threeDCode).toContainText('src="../middlebury_chess1_rgb_z.exr"');
  await expect(threeDCode).toContainText('name="Middlebury RGB + Z"');
  await expect(threeDCode).toContainText('view="3d"');
  await expect(threeDCode).toContainText('three-d-auto-orbit="true"');
  await expect(threeDCode).toContainText('bottom-panel="none"');
  await expect(threeDCode).toContainText('source-origin="viewer"');

  const deferredCode = page
    .locator('.embed-example')
    .filter({ hasText: 'Deferred loading' })
    .locator('.gallery-code-frame code');
  await expect(deferredCode).toContainText('auto-load="false"');
  await expect(deferredCode).toContainText('name="Deferred Cornell Box"');

  const apiCode = page
    .locator('.embed-example')
    .filter({ hasText: 'JavaScript API and local files' })
    .locator('.gallery-code-frame code');
  await expect(apiCode).toContainText('window.Prismifold.create("#prismifold-js-example"');
  await expect(apiCode).toContainText('controller.loadUrl("../cbox_rgb.exr"');
  await expect(apiCode).toContainText('controller.loadFile(file');

  await expect(page.locator('prismifold-viewer')).toHaveCount(6, { timeout: 30000 });
  await expect(page.locator('prismifold-viewer iframe')).toHaveCount(6, { timeout: 30000 });
  await expectEmbedIframeUiMode(page, 'Basic custom element');
  const channelsUrl = await expectEmbedIframeUiMode(page, 'Named source with channel panel');
  expect(channelsUrl.searchParams.get('bottomPanel')).toBe('channels');
  expect(channelsUrl.searchParams.get('name')).toBe('Cornell Box RGB');
  const panoramaUrl = await expectEmbedIframeUiMode(page, 'Panorama view');
  expect(panoramaUrl.searchParams.get('src')).toBe(POLYHAVEN_BROWN_PHOTOSTUDIO_URL);
  expect(panoramaUrl.searchParams.get('view')).toBe('panorama');
  expect(panoramaUrl.searchParams.get('panoramaAutoRotate')).toBe('true');
  expect(panoramaUrl.searchParams.get('panoramaRotationSpeed')).toBe('6');
  expect(panoramaUrl.searchParams.get('bottomPanel')).toBe('none');
  expect(panoramaUrl.searchParams.get('name')).toBe(POLYHAVEN_BROWN_PHOTOSTUDIO_NAME);
  const threeDUrl = await expectEmbedIframeUiMode(page, '3D view');
  expect(threeDUrl.searchParams.get('src')).toBe('../middlebury_chess1_rgb_z.exr');
  expect(threeDUrl.searchParams.get('view')).toBe('3d');
  expect(threeDUrl.searchParams.get('threeDAutoOrbit')).toBe('true');
  expect(threeDUrl.searchParams.get('threeDOrbitSpeed')).toBe('6');
  expect(threeDUrl.searchParams.get('threeDOrbitYaw')).toBe('12');
  expect(threeDUrl.searchParams.get('threeDOrbitPitch')).toBe('2');
  expect(threeDUrl.searchParams.get('bottomPanel')).toBe('none');
  expect(threeDUrl.searchParams.get('name')).toBe('Middlebury RGB + Z');
  const deferredUrl = await expectEmbedIframeUiMode(page, 'Deferred loading');
  expect(deferredUrl.searchParams.get('autoLoad')).toBe('false');
  expect(deferredUrl.searchParams.get('name')).toBe('Deferred Cornell Box');

  await expect(page
    .locator('.embed-example')
    .filter({ hasText: 'Panorama view' })
    .frameLocator('prismifold-viewer iframe')
    .locator('.embed-shell')).toBeVisible({ timeout: 30000 });
  await expect(page
    .locator('.embed-example')
    .filter({ hasText: '3D view' })
    .frameLocator('prismifold-viewer iframe')
    .locator('.embed-shell')).toBeVisible({ timeout: 30000 });

  const channelsFrame = page
    .locator('.embed-example')
    .filter({ hasText: 'Named source with channel panel' })
    .frameLocator('prismifold-viewer iframe');
  await expect(channelsFrame.locator('.embed-channel-panel [role="option"]').first()).toBeVisible({
    timeout: 30000
  });

  const deferredFrame = page
    .locator('.embed-example')
    .filter({ hasText: 'Deferred loading' })
    .frameLocator('prismifold-viewer iframe');
  await expect(deferredFrame.getByRole('button', { name: 'Click to load image', exact: true })).toBeVisible({
    timeout: 30000
  });
  await deferredFrame.getByRole('button', { name: 'Click to load image', exact: true }).click();
  await expect(deferredFrame.locator('.embed-source-label')).toContainText('Deferred Cornell Box', {
    timeout: 30000
  });

  await expect(page.getByRole('button', { name: 'Load Sample', exact: true })).toBeVisible();
  await expect(page.locator('#embed-js-file-input')).toBeAttached();
  await expect(page.locator('#embed-js-status')).toContainText('Loaded Cornell Box RGB.', {
    timeout: 30000
  });
  const jsApiFrame = page
    .locator('.embed-example')
    .filter({ hasText: 'JavaScript API and local files' })
    .frameLocator('prismifold-viewer iframe');
  await expect(jsApiFrame.locator('.embed-channel-panel [role="option"]').first()).toBeVisible({
    timeout: 30000
  });
  await page.getByRole('button', { name: 'Load Sample', exact: true }).click();
  await expect(page.locator('#embed-js-status')).toContainText('Loaded Cornell Box RGB.', {
    timeout: 30000
  });

  await expect(page.getByRole('heading', { name: 'Element attributes', level: 2 })).toBeVisible();
  const attributesTable = page.getByRole('table', { name: 'prismifold-viewer attributes', exact: true });
  await expect(attributesTable).toBeVisible();
  for (const label of [
    'src',
    'name',
    'width',
    'height',
    'view',
    'bottom-panel',
    'three-d-auto-orbit',
    'three-d-orbit-speed',
    'three-d-orbit-yaw',
    'three-d-orbit-pitch',
    'auto-load',
    'viewer-url',
    'source-origin'
  ]) {
    await expect(attributesTable.getByRole('cell', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'JavaScript methods', level: 2 })).toBeVisible();
  const methodsTable = page.getByRole('table', { name: 'Prismifold JavaScript methods', exact: true });
  await expect(methodsTable).toBeVisible();
  await expect(methodsTable.locator('.feature-card')).toHaveCount(0);
  await expect(page.getByText('loadUrl(src, options)', { exact: true })).toBeVisible();
  await expect(page.getByText('loadFile(file, options)', { exact: true })).toBeVisible();
  await expect(page.getByText('setView(view)', { exact: true })).toBeVisible();
  await expect(page.getByText('setThreeDAutoOrbit(enabled)', { exact: true })).toBeVisible();
  await expect(page.getByText('setThreeDOrbitSpeed(speed)', { exact: true })).toBeVisible();
  await expect(page.getByText('setThreeDOrbitYaw(yaw)', { exact: true })).toBeVisible();
  await expect(page.getByText('setThreeDOrbitPitch(pitch)', { exact: true })).toBeVisible();
  await expect(page.getByText('destroy()', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#examples').scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  const mobileExampleLayout = await page.evaluate(() => {
    const firstExample = document.querySelector('.embed-example');
    const copy = firstExample?.querySelector('.embed-example-copy');
    const view = firstExample?.querySelector('.embed-example-view');
    if (
      !(firstExample instanceof HTMLElement) ||
      !(copy instanceof HTMLElement) ||
      !(view instanceof HTMLElement)
    ) {
      return false;
    }
    const itemRect = firstExample.getBoundingClientRect();
    const copyRect = copy.getBoundingClientRect();
    const viewRect = view.getBoundingClientRect();
    return (
      Math.abs(copyRect.left - itemRect.left) < 1 &&
      Math.abs(viewRect.left - itemRect.left) < 1 &&
      copyRect.bottom <= viewRect.top
    );
  });
  expect(mobileExampleLayout).toBe(true);
  await expectNoHorizontalOverflow(page);
  expect(unexpectedErrors).toEqual([]);
});
