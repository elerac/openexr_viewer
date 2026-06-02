import { expect, test, type Page } from '@playwright/test';
import { expectViewerAppReady } from './helpers/app';

const CBOX_RGB_URL = 'cbox_rgb.exr';
const BROWN_PHOTOSTUDIO_PANORAMA_URL = 'brown_photostudio_02_4k.exr';
const OWL_SPHERES_LINEAR_STOKES_URL =
  'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/owl_spheres.exr';
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
    'Prismifold is an OpenEXR image viewer for computational imaging, rendering, and vision workflows. It unfolds polarization, spectral, panoramas, depth, AoVs and exact pixel values from images with more than color.',
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
  await expect(page.getByRole('link', { name: 'brown_photostudio_02_4k.exr', exact: true })).toHaveCount(0);

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
  await expect(embeds).toHaveCount(3);

  const cornellEmbed = embeds.first();
  await expect(cornellEmbed).toHaveAttribute('src', CBOX_RGB_URL);
  await expect(cornellEmbed).not.toHaveAttribute('name');
  await expect(cornellEmbed).toHaveAttribute('width', '100%');
  await expect(cornellEmbed).toHaveAttribute('height', '360');

  const stokesEmbed = embeds.nth(1);
  await expect(stokesEmbed).toHaveAttribute('src', OWL_SPHERES_LINEAR_STOKES_URL);
  await expect(stokesEmbed).not.toHaveAttribute('name');
  await expect(stokesEmbed).toHaveAttribute('width', '100%');
  await expect(stokesEmbed).toHaveAttribute('height', '360');
  await expect(stokesEmbed).toHaveAttribute('bottom-panel', 'channels');
  await expect(stokesEmbed).toHaveAttribute('auto-load', 'false');

  const panoramaEmbed = embeds.nth(2);
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
  expect(panoramaIframeSrc).not.toContain('src=');
  expect(panoramaIframeSrc).toContain('view=panorama');
  expect(panoramaIframeSrc).not.toContain('name=');
  expect(panoramaIframeSrc).toContain('autoLoad=false');

  const embeddedViewer = cornellEmbed.frameLocator('iframe');
  await expect(embeddedViewer.locator('#gl-canvas')).toBeVisible({
    timeout: 30000
  });
  await expect(embeddedViewer.getByRole('button', { name: 'Open full viewer', exact: true })).toBeEnabled();

  const deferredStokesViewer = stokesEmbed.frameLocator('iframe');
  await expect(deferredStokesViewer.getByRole('button', { name: 'Load image', exact: true })).toBeVisible();
  const deferredPanoramaViewer = panoramaEmbed.frameLocator('iframe');
  await expect(deferredPanoramaViewer.getByRole('button', { name: 'Load image', exact: true })).toBeVisible();
  await deferredPanoramaViewer.getByRole('button', { name: 'Load image', exact: true }).click();
  const panoramaFrame = page.frames().find((frame) => frame.url().includes('view=panorama'));
  expect(panoramaFrame).toBeTruthy();
  const panoramaViewerMode = await panoramaFrame?.evaluate(async () => {
    const hooks = window.__openExrViewerE2E;
    if (!hooks) {
      return null;
    }
    await hooks.waitForSessionCount(1);
    await hooks.waitForRenderIdle();
    return hooks.snapshot().viewerMode;
  });
  expect(panoramaViewerMode).toBe('panorama');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expect(cornellEmbed).toHaveAttribute('height', '280');
  await expect(stokesEmbed).toHaveAttribute('height', '280');
  await expect(panoramaEmbed).toHaveAttribute('height', '280');
  await expect.poll(async () => (
    await cornellEmbed.evaluate((element) => {
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
