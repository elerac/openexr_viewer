import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './helpers/test';
import { expectViewerAppReady } from './helpers/app';

const CBOX_RGB_URL = 'cbox_rgb.exr';
const MIDDLEBURY_CHESS1_RGB_Z_URL = 'middlebury_chess1_rgb_z.exr';
const MIDDLEBURY_SCENES2021_URL = 'https://vision.middlebury.edu/stereo/data/scenes2021/';
const BROWN_PHOTOSTUDIO_PANORAMA_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/brown_photostudio_02_1k.exr';
const BROWN_PHOTOSTUDIO_PANORAMA_FILENAME = 'brown_photostudio_02_1k.exr';
const OWL_SPHERES_LINEAR_STOKES_URL =
  'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/owl_spheres.exr';
const KAIST_SCENE27_REFLECTANCE_URL =
  'https://huggingface.co/datasets/danaroth/kaist-hyperspectral/resolve/main/exr/scene27_reflectance.exr';
const RELEASES_URL = 'https://github.com/elerac/prismifold/releases/latest';
const WINDOWS_DESKTOP_URL =
  'https://github.com/elerac/prismifold/releases/latest/download/Prismifold-windows-x64-setup.exe';
const MACOS_DESKTOP_URL =
  'https://github.com/elerac/prismifold/releases/latest/download/Prismifold-macos-arm64.dmg';
const EXPECTED_BOOTSTRAP_ABORT = 'Viewer application has not finished initializing.';

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

test('serves the project page with app and desktop download calls to action @smoke', async ({ page }) => {
  const unexpectedErrors = watchUnexpectedErrors(page);
  await page.goto('/');

  const brandIcon = page.locator('.brand-mark');
  await expect(brandIcon).toHaveAttribute('src', 'project-page/app-icon.png');
  await expect.poll(async () => (
    await brandIcon.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
  )).toBe(true);

  await expect(page.getByRole('heading', { name: 'Prismifold', level: 1 })).toBeVisible();
  await expect(page.getByText('A reader for folded light.', { exact: true })).toHaveCount(0);
  await expect(page.getByText(
    'Prismifold is an OpenEXR image viewer for computational imaging, rendering, and vision workflows. It reveals the rich structure of images that contain more than color, including polarization, spectral, panoramas, depth, and AOVs.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(
    'The name evokes a prism not merely as a symbol of color, but as a way of unfolding the manifold structure hidden inside high-dimensional image data.',
    { exact: true }
  )).toBeVisible();

  const heroAppLink = page.getByRole('link', { name: 'Open Web App', exact: true }).first();
  await expect(heroAppLink).toBeVisible();
  await expect(heroAppLink).toHaveAttribute('href', 'app/');
  await expect(heroAppLink).toHaveAttribute('target', '_blank');
  await expect(heroAppLink).toHaveAttribute('rel', 'noopener');
  const heroDownloadLink = page.getByRole('link', { name: 'Download Desktop', exact: true }).first();
  await expect(heroDownloadLink).toBeVisible();
  await expect(heroDownloadLink).toHaveAttribute('href', '#downloads');
  await expect(page.getByRole('link', { name: 'Downloads', exact: true }).first()).toHaveAttribute(
    'href',
    '#downloads'
  );
  await expect(page.getByRole('link', { name: 'Gallery', exact: true })).toHaveAttribute('href', '#gallery');

  const preview = page.getByRole('img', { name: /Prismifold interface/ });
  await expect(preview).toBeVisible();
  await expect.poll(async () => (
    await preview.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
  )).toBe(true);
  await expectNoHorizontalOverflow(page);

  await expect(page.getByRole('heading', { name: 'Downloads', level: 2 })).toBeVisible();
  await expect(page.getByText(
    'Desktop installers are published from the latest GitHub Release. These unsigned builds may show Windows or macOS security prompts.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download Prismifold for Windows x64', exact: true })).toHaveAttribute(
    'href',
    WINDOWS_DESKTOP_URL
  );
  await expect(page.getByRole('link', { name: 'Download Prismifold for macOS ARM64', exact: true })).toHaveAttribute(
    'href',
    MACOS_DESKTOP_URL
  );
  await expect(page.getByRole('link', { name: 'Release notes and checksums', exact: true })).toHaveAttribute(
    'href',
    RELEASES_URL
  );
  await expect(page.getByRole('heading', { name: 'Features', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inspect', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visualize', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Measure', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Export', level: 3 })).toBeVisible();
  await expect(page.getByText('OpenEXR 2.x scanline', { exact: true })).toHaveCount(0);
  await expect(page.getByText('half / float / uint', { exact: true })).toHaveCount(0);
  await expect(page.getByText('WebGL2', { exact: true })).toHaveCount(0);
  await expect(page.getByText('exrs WASM', { exact: true })).toHaveCount(0);
  await expect(page.getByText('local files stay local', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Gallery', level: 2 })).toBeVisible();
  await expect(page.getByText(
    'Inspect a simple RGB OpenEXR image with pixel probes for exact source values.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('RGB image inspection', { exact: true })).toBeVisible();
  await expect(page.getByText('Depth map inspection', { exact: true })).toBeVisible();
  await expect(page.getByText(/Inspect RGB plus metric Z depth from the Middlebury 2021 mobile stereo/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Middlebury Stereo Datasets', exact: true })).toHaveAttribute(
    'href',
    MIDDLEBURY_SCENES2021_URL
  );
  await expect(page.getByText(
    'Inspect KAIST scene27 reflectance data across wavelength channels with spectral probes and derived display views.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('Hyperspectral reflectance inspection', { exact: true })).toBeVisible();
  await expect(page.getByText(
    'Visualize linear polarization data by deriving AoLP and DoLP views from S0, S1, and S2 Stokes channels.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('Stokes vector visualization', { exact: true })).toBeVisible();
  await expect(page.getByText(
    'Explore equirectangular HDRI data in panorama mode, orbiting the view while probes map screen rays back to source pixels.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('Panorama environment viewing', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'cbox_rgb.exr', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'owl_spheres.exr', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: BROWN_PHOTOSTUDIO_PANORAMA_FILENAME, exact: true })).toHaveCount(0);

  const sectionOrder = await page.evaluate(() => {
    const downloads = document.querySelector('#downloads');
    const features = document.querySelector('#features');
    const gallery = document.querySelector('#gallery');
    if (!downloads || !features || !gallery) {
      return false;
    }
    return (
      Boolean(downloads.compareDocumentPosition(features) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      Boolean(features.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  });
  expect(sectionOrder).toBe(true);

  await page.locator('#gallery').scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  const desktopGalleryLayout = await page.evaluate(() => {
    const firstItem = document.querySelector('.gallery-item');
    const caption = firstItem?.querySelector('figcaption');
    const frame = firstItem?.querySelector('.exr-embed-frame');
    if (!(firstItem instanceof HTMLElement) || !(caption instanceof HTMLElement) || !(frame instanceof HTMLElement)) {
      return false;
    }
    const captionRect = caption.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return captionRect.right < frameRect.left && Math.abs(captionRect.top - frameRect.top) < 12;
  });
  expect(desktopGalleryLayout).toBe(true);
  const embeds = page.locator('prismifold-viewer');
  await expect(embeds).toHaveCount(5);

  const cornellEmbed = embeds.first();
  await expect(cornellEmbed).toHaveAttribute('src', CBOX_RGB_URL);
  await expect(cornellEmbed).not.toHaveAttribute('name');
  await expect(cornellEmbed).toHaveAttribute('width', '100%');
  await expect(cornellEmbed).toHaveAttribute('height', '360');

  const middleburyDepthEmbed = embeds.nth(1);
  await expect(middleburyDepthEmbed).toHaveAttribute('src', MIDDLEBURY_CHESS1_RGB_Z_URL);
  await expect(middleburyDepthEmbed).not.toHaveAttribute('name');
  await expect(middleburyDepthEmbed).toHaveAttribute('view', 'depth');
  await expect(middleburyDepthEmbed).toHaveAttribute('width', '100%');
  await expect(middleburyDepthEmbed).toHaveAttribute('height', '360');
  await expect(middleburyDepthEmbed).toHaveAttribute('bottom-panel', 'channels');
  await expect(middleburyDepthEmbed).toHaveAttribute('auto-load', 'false');

  const kaistEmbed = embeds.nth(2);
  await expect(kaistEmbed).toHaveAttribute('src', KAIST_SCENE27_REFLECTANCE_URL);
  await expect(kaistEmbed).not.toHaveAttribute('name');
  await expect(kaistEmbed).toHaveAttribute('width', '100%');
  await expect(kaistEmbed).toHaveAttribute('height', '360');
  await expect(kaistEmbed).toHaveAttribute('auto-load', 'false');

  const stokesEmbed = embeds.nth(3);
  await expect(stokesEmbed).toHaveAttribute('src', OWL_SPHERES_LINEAR_STOKES_URL);
  await expect(stokesEmbed).not.toHaveAttribute('name');
  await expect(stokesEmbed).toHaveAttribute('width', '100%');
  await expect(stokesEmbed).toHaveAttribute('height', '360');
  await expect(stokesEmbed).toHaveAttribute('bottom-panel', 'channels');
  await expect(stokesEmbed).toHaveAttribute('auto-load', 'false');

  const panoramaEmbed = embeds.nth(4);
  await expect(panoramaEmbed).toHaveAttribute('src', BROWN_PHOTOSTUDIO_PANORAMA_URL);
  await expect(panoramaEmbed).not.toHaveAttribute('name');
  await expect(panoramaEmbed).toHaveAttribute('view', 'panorama');
  await expect(panoramaEmbed).toHaveAttribute('width', '100%');
  await expect(panoramaEmbed).toHaveAttribute('height', '360');
  await expect(panoramaEmbed).toHaveAttribute('auto-load', 'false');

  const iframeSrc = await cornellEmbed.evaluate((element) => {
    const iframe = element.shadowRoot?.querySelector('iframe');
    return iframe instanceof HTMLIFrameElement ? iframe.src : '';
  });
  expect(iframeSrc).toContain('/app/?ui=embed');
  expect(iframeSrc).not.toContain('src=');
  expect(iframeSrc).not.toContain('name=');

  const middleburyDepthIframeSrc = await middleburyDepthEmbed.evaluate((element) => {
    const iframe = element.shadowRoot?.querySelector('iframe');
    return iframe instanceof HTMLIFrameElement ? iframe.src : '';
  });
  expect(middleburyDepthIframeSrc).toContain('/app/?ui=embed');
  expect(middleburyDepthIframeSrc).toContain('view=depth');
  expect(middleburyDepthIframeSrc).toContain('bottomPanel=channels');
  expect(middleburyDepthIframeSrc).toContain('autoLoad=false');
  expect(middleburyDepthIframeSrc).not.toContain('src=');
  expect(middleburyDepthIframeSrc).not.toContain('name=');

  const kaistIframeSrc = await kaistEmbed.evaluate((element) => {
    const iframe = element.shadowRoot?.querySelector('iframe');
    return iframe instanceof HTMLIFrameElement ? iframe.src : '';
  });
  expect(kaistIframeSrc).toContain('/app/?ui=embed');
  expect(kaistIframeSrc).toContain(`src=${encodeURIComponent(KAIST_SCENE27_REFLECTANCE_URL)}`);
  expect(kaistIframeSrc).not.toContain('name=');
  expect(kaistIframeSrc).toContain('autoLoad=false');

  const stokesIframeSrc = await stokesEmbed.evaluate((element) => {
    const iframe = element.shadowRoot?.querySelector('iframe');
    return iframe instanceof HTMLIFrameElement ? iframe.src : '';
  });
  expect(stokesIframeSrc).toContain('/app/?ui=embed');
  expect(stokesIframeSrc).toContain(`src=${encodeURIComponent(OWL_SPHERES_LINEAR_STOKES_URL)}`);
  expect(stokesIframeSrc).not.toContain('name=');
  expect(stokesIframeSrc).toContain('bottomPanel=channels');
  expect(stokesIframeSrc).toContain('autoLoad=false');

  const panoramaIframeSrc = await panoramaEmbed.evaluate((element) => {
    const iframe = element.shadowRoot?.querySelector('iframe');
    return iframe instanceof HTMLIFrameElement ? iframe.src : '';
  });
  expect(panoramaIframeSrc).toContain('/app/?ui=embed');
  expect(panoramaIframeSrc).toContain(`src=${encodeURIComponent(BROWN_PHOTOSTUDIO_PANORAMA_URL)}`);
  expect(panoramaIframeSrc).toContain('view=panorama');
  expect(panoramaIframeSrc).not.toContain('name=');
  expect(panoramaIframeSrc).toContain('autoLoad=false');

  const embeddedViewer = cornellEmbed.frameLocator('iframe');
  await expect(embeddedViewer.locator('#gl-canvas')).toBeVisible({
    timeout: 30000
  });
  await expect(embeddedViewer.getByRole('button', { name: 'Open full viewer', exact: true })).toBeEnabled();

  const deferredStokesViewer = stokesEmbed.frameLocator('iframe');
  const deferredMiddleburyDepthViewer = middleburyDepthEmbed.frameLocator('iframe');
  const deferredKaistViewer = kaistEmbed.frameLocator('iframe');
  await expect(deferredMiddleburyDepthViewer.getByRole('button', { name: 'Click to load image', exact: true })).toBeVisible();
  await expect(deferredKaistViewer.getByRole('button', { name: 'Click to load image', exact: true })).toBeVisible();
  await expect(deferredStokesViewer.getByRole('button', { name: 'Click to load image', exact: true })).toBeVisible();
  const deferredPanoramaViewer = panoramaEmbed.frameLocator('iframe');
  await expect(deferredPanoramaViewer.getByRole('button', { name: 'Click to load image', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expect(cornellEmbed).toHaveAttribute('height', '280');
  await expect(middleburyDepthEmbed).toHaveAttribute('height', '280');
  await expect(kaistEmbed).toHaveAttribute('height', '280');
  await expect(stokesEmbed).toHaveAttribute('height', '280');
  await expect(panoramaEmbed).toHaveAttribute('height', '280');
  await expect.poll(async () => (
    await cornellEmbed.evaluate((element) => {
      const iframe = element.shadowRoot?.querySelector('iframe');
      return iframe instanceof HTMLIFrameElement ? iframe.style.height : '';
    })
  )).toBe('280px');
  await expect.poll(async () => (
    await middleburyDepthEmbed.evaluate((element) => {
      const iframe = element.shadowRoot?.querySelector('iframe');
      return iframe instanceof HTMLIFrameElement ? iframe.style.height : '';
    })
  )).toBe('280px');
  await expect.poll(async () => (
    await kaistEmbed.evaluate((element) => {
      const iframe = element.shadowRoot?.querySelector('iframe');
      return iframe instanceof HTMLIFrameElement ? iframe.style.height : '';
    })
  )).toBe('280px');
  await expect.poll(async () => (
    await stokesEmbed.evaluate((element) => {
      const iframe = element.shadowRoot?.querySelector('iframe');
      return iframe instanceof HTMLIFrameElement ? iframe.style.height : '';
    })
  )).toBe('280px');
  await expect.poll(async () => (
    await panoramaEmbed.evaluate((element) => {
      const iframe = element.shadowRoot?.querySelector('iframe');
      return iframe instanceof HTMLIFrameElement ? iframe.style.height : '';
    })
  )).toBe('280px');
  expect(unexpectedErrors).toEqual([]);
});

test('loads the deferred depth embed from its local source when clicked', async ({ page }) => {
  const unexpectedErrors = watchUnexpectedErrors(page);

  await page.goto('/');
  const depthEmbed = page.locator('prismifold-viewer').nth(1);
  await depthEmbed.scrollIntoViewIfNeeded();

  const embeddedViewer = depthEmbed.frameLocator('iframe');
  const loadButton = embeddedViewer.getByRole('button', { name: 'Click to load image', exact: true });
  const openFullButton = embeddedViewer.getByRole('button', { name: 'Open full viewer', exact: true });

  await expect(loadButton).toBeVisible();
  await expect(openFullButton).toBeDisabled();
  await loadButton.click();

  await expect(loadButton).toBeHidden({ timeout: 30000 });
  await expect(openFullButton).toBeEnabled({ timeout: 30000 });
  await expect(embeddedViewer.locator('.embed-status')).toBeHidden();
  expect(unexpectedErrors).toEqual([]);
});

test('loads the deferred panorama embed from its remote source when clicked', async ({ page }) => {
  const unexpectedErrors = watchUnexpectedErrors(page);
  const fixtureBytes = readFileSync(new URL('../public/cbox_rgb.exr', import.meta.url));
  await page.route(BROWN_PHOTOSTUDIO_PANORAMA_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/aces',
      body: fixtureBytes
    });
  });

  await page.goto('/');
  const panoramaEmbed = page.locator('prismifold-viewer').nth(4);
  await panoramaEmbed.scrollIntoViewIfNeeded();

  const embeddedViewer = panoramaEmbed.frameLocator('iframe');
  const loadButton = embeddedViewer.getByRole('button', { name: 'Click to load image', exact: true });
  const openFullButton = embeddedViewer.getByRole('button', { name: 'Open full viewer', exact: true });

  await expect(loadButton).toBeVisible();
  await expect(openFullButton).toBeDisabled();
  await loadButton.click();

  await expect(loadButton).toBeHidden();
  await expect(openFullButton).toBeEnabled({ timeout: 30000 });
  await expect(embeddedViewer.locator('.embed-status')).toBeHidden();
  expect(unexpectedErrors).toEqual([]);
});

test('opens the viewer app from the project page hero @smoke', async ({ page }) => {
  const unexpectedErrors = watchUnexpectedErrors(page);
  await page.goto('/');

  const heroAppLink = page.getByRole('link', { name: 'Open Web App', exact: true }).first();
  const popupPromise = page.waitForEvent('popup');
  await heroAppLink.click();
  const appPage = await popupPromise;
  const appUnexpectedErrors = watchUnexpectedErrors(appPage);

  await expect(page).toHaveURL(/\/$/);
  await expect(appPage).toHaveURL(/\/app\/$/);
  await expectViewerAppReady(appPage);
  expect([...unexpectedErrors, ...appUnexpectedErrors]).toEqual([]);
});
