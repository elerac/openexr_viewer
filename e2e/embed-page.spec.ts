import { expect, test, type Page } from './helpers/test';

const EMBED_GUIDE_TITLE = 'Prismifold Embed Guide | OpenEXR Image Viewer';
const EMBED_GUIDE_DESCRIPTION =
  'Embed Prismifold OpenEXR viewers in HTML pages with the prismifold-viewer web component, declarative attributes, deferred loading, channel panels, and the JavaScript API.';
const EMBED_GUIDE_URL = 'https://elerac.github.io/prismifold/embed/';
const POLYHAVEN_BROWN_PHOTOSTUDIO_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/brown_photostudio_02_1k.exr';
const POLYHAVEN_BROWN_PHOTOSTUDIO_NAME = 'Poly Haven Brown Photostudio 02';
const EMPTY_EMBED_SCRIPT_ROUTE = '**/prismifold.js';

const EXAMPLE_TITLE_IDS = {
  basic: 'basic-embed-title',
  channels: 'channels-embed-title',
  panorama: 'panorama-embed-title',
  threeD: 'three-d-embed-title',
  deferred: 'deferred-embed-title',
  javascriptApi: 'javascript-api-title'
} as const;

const EXPECTED_NAV_LINKS = [
  { text: 'Project', href: '../' },
  { text: 'Examples', href: '#examples' },
  { text: 'Attributes', href: '#attributes' },
  { text: 'API', href: '#javascript-api' },
  { text: 'GitHub', href: 'https://github.com/elerac/prismifold' }
] as const;

const ATTRIBUTE_LABELS = [
  'src',
  'name',
  'width',
  'height',
  'view',
  'bottom-panel',
  'panorama-auto-rotate',
  'panorama-rotation-speed',
  'three-d-auto-orbit',
  'three-d-orbit-speed',
  'three-d-orbit-yaw',
  'three-d-orbit-pitch',
  'auto-load',
  'viewer-url',
  'source-origin'
] as const;

const METHOD_LABELS = [
  'loadUrl(src, options)',
  'loadFile(file, options)',
  'setView(view)',
  'setPanoramaAutoRotate(enabled)',
  'setPanoramaRotationSpeed(speed)',
  'setThreeDAutoOrbit(enabled)',
  'setThreeDOrbitSpeed(speed)',
  'setThreeDOrbitYaw(yaw)',
  'setThreeDOrbitPitch(pitch)',
  'destroy()'
] as const;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(async () => (
    await page.evaluate(() => {
      const width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      return width <= document.documentElement.clientWidth + 1;
    })
  )).toBe(true);
}

function embedExample(page: Page, titleId: string) {
  return page.locator(`section[aria-labelledby="${titleId}"]`);
}

function embedExampleCode(page: Page, titleId: string) {
  return embedExample(page, titleId).locator('.gallery-code-frame code');
}

async function expectSiteNavLinks(page: Page): Promise<void> {
  const navLinks = page.locator('.site-nav a');
  await expect(navLinks).toHaveCount(EXPECTED_NAV_LINKS.length);
  const actualLinks = await navLinks.evaluateAll((links) => links.map((link) => ({
    text: link.textContent?.trim() ?? '',
    href: link.getAttribute('href') ?? ''
  })));
  expect(actualLinks).toEqual(EXPECTED_NAV_LINKS);
}

async function expectReferenceLabels(page: Page, tableSelector: string, expectedLabels: readonly string[]): Promise<void> {
  const table = page.locator(tableSelector);
  await expect(table).toBeVisible();
  const cellTexts = await table.locator('[role="cell"]').evaluateAll((cells) => (
    cells.map((cell) => cell.textContent?.trim() ?? '')
  ));
  for (const label of expectedLabels) {
    expect(cellTexts).toContain(label);
  }
}

async function expectExampleViewerAttributes(
  page: Page,
  titleId: string,
  expectedAttributes: Record<string, string>
): Promise<void> {
  const viewer = embedExample(page, titleId).locator('prismifold-viewer');
  await expect(viewer).toHaveCount(1);
  const actualAttributes = await viewer.evaluate((element) => (
    Array.from(element.attributes).reduce<Record<string, string>>((attributes, attribute) => {
      attributes[attribute.name] = attribute.value;
      return attributes;
    }, {})
  ));
  expect(actualAttributes).toMatchObject(expectedAttributes);
}

test('serves the embed guide static content and reference docs @smoke', async ({ page }) => {
  await page.route(EMPTY_EMBED_SCRIPT_ROUTE, async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: ''
    });
  });
  await page.goto('/embed/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(EMBED_GUIDE_TITLE);
  await expect(page.locator('head meta[name="description"]')).toHaveAttribute('content', EMBED_GUIDE_DESCRIPTION);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', EMBED_GUIDE_URL);
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute('href', '../project-page/app-icon.png');
  await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute('content', EMBED_GUIDE_URL);

  await expect(page.locator('#embed-hero-title')).toHaveText('Embed Prismifold');
  await expectSiteNavLinks(page);
  await expect(page.locator('.hero-lede')).toContainText(
    'Publish interactive OpenEXR inspection directly inside documentation, papers, datasets, and project pages.',
  );
  await expectNoHorizontalOverflow(page);

  await expect(page.locator('#examples-title')).toHaveText('Embed examples');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.basic}`)).toHaveText('Basic custom element');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.channels}`)).toHaveText('Named source with channel panel');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.panorama}`)).toHaveText('Panorama view');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.threeD}`)).toHaveText('3D view');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.deferred}`)).toHaveText('Deferred loading');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.javascriptApi}`)).toHaveText('JavaScript API and local files');

  const basicCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.basic);
  await expect(basicCode).toContainText(
    '<script src="https://elerac.github.io/prismifold/embed/prismifold.js"></script>'
  );
  await expect(basicCode).toContainText('<prismifold-viewer');
  await expect(basicCode).toContainText('src="../cbox_rgb.exr"');
  await expect(basicCode).toContainText('height="340"');

  const channelsCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.channels);
  await expect(channelsCode).toContainText('name="Cornell Box RGB"');
  await expect(channelsCode).toContainText('bottom-panel="channels"');

  const panoramaCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.panorama);
  await expect(panoramaCode).toContainText(`src="${POLYHAVEN_BROWN_PHOTOSTUDIO_URL}"`);
  await expect(panoramaCode).toContainText(`name="${POLYHAVEN_BROWN_PHOTOSTUDIO_NAME}"`);
  await expect(panoramaCode).toContainText('view="panorama"');
  await expect(panoramaCode).toContainText('panorama-auto-rotate="true"');
  await expect(panoramaCode).toContainText('bottom-panel="none"');
  await expect(panoramaCode).not.toContainText('panorama-rotation-speed');
  await expect(panoramaCode).not.toContainText('source-origin');

  const threeDCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.threeD);
  await expect(threeDCode).toContainText('src="../middlebury_chess1_rgb_p.exr"');
  await expect(threeDCode).toContainText('name="Middlebury RGB + Position"');
  await expect(threeDCode).toContainText('view="3d"');
  await expect(threeDCode).toContainText('three-d-auto-orbit="true"');
  await expect(threeDCode).toContainText('bottom-panel="none"');
  await expect(threeDCode).not.toContainText('source-origin');

  const deferredCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.deferred);
  await expect(deferredCode).toContainText('auto-load="false"');
  await expect(deferredCode).toContainText('name="Deferred Cornell Box"');

  const apiCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.javascriptApi);
  await expect(apiCode).toContainText('window.Prismifold.create("#prismifold-js-example"');
  await expect(apiCode).toContainText('controller.loadUrl("../cbox_rgb.exr"');
  await expect(apiCode).toContainText('controller.loadFile(file');

  await expect(page.locator('prismifold-viewer.embed-page-live')).toHaveCount(5);
  await expectExampleViewerAttributes(page, EXAMPLE_TITLE_IDS.basic, {
    src: '../cbox_rgb.exr',
    height: '340'
  });
  await expectExampleViewerAttributes(page, EXAMPLE_TITLE_IDS.channels, {
    src: '../cbox_rgb.exr',
    name: 'Cornell Box RGB',
    'bottom-panel': 'channels',
    height: '360'
  });
  await expectExampleViewerAttributes(page, EXAMPLE_TITLE_IDS.panorama, {
    src: POLYHAVEN_BROWN_PHOTOSTUDIO_URL,
    name: POLYHAVEN_BROWN_PHOTOSTUDIO_NAME,
    view: 'panorama',
    'panorama-auto-rotate': 'true',
    'bottom-panel': 'none',
    height: '360'
  });
  await expectExampleViewerAttributes(page, EXAMPLE_TITLE_IDS.threeD, {
    src: '../middlebury_chess1_rgb_p.exr',
    name: 'Middlebury RGB + Position',
    view: '3d',
    'three-d-auto-orbit': 'true',
    'bottom-panel': 'none',
    height: '360'
  });
  await expectExampleViewerAttributes(page, EXAMPLE_TITLE_IDS.deferred, {
    src: '../cbox_rgb.exr',
    name: 'Deferred Cornell Box',
    'auto-load': 'false',
    height: '340'
  });
  await expect(page.locator('#embed-js-viewer')).toBeAttached();
  await expect(page.locator('#embed-js-load-sample-button')).toBeVisible();
  await expect(page.locator('#embed-js-file-input')).toBeAttached();
  await expect(page.locator('#embed-js-status')).toBeAttached();

  await expect(page.locator('#attributes-title')).toHaveText('Element attributes');
  await expectReferenceLabels(page, '[role="table"][aria-label="prismifold-viewer attributes"]', ATTRIBUTE_LABELS);
  await expect(page.locator('#methods-title')).toHaveText('JavaScript methods');
  const methodsTableSelector = '[role="table"][aria-label="Prismifold JavaScript methods"]';
  await expectReferenceLabels(page, methodsTableSelector, METHOD_LABELS);
  await expect(page.locator(methodsTableSelector).locator('.feature-card')).toHaveCount(0);
  await expect(page.locator('prismifold-viewer iframe')).toHaveCount(0);

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
});
