import { expect, test, type Page } from './helpers/test';
import { expectViewerAppReady } from './helpers/app';
import { readProbeCoords } from './helpers/viewer';

const CBOX_RGB_URL = 'cbox_rgb.exr';
const MIDDLEBURY_CHESS1_RGB_Z_URL = 'middlebury_chess1_rgb_z.exr';
const MIDDLEBURY_SCENES2021_URL = 'https://vision.middlebury.edu/stereo/data/scenes2021/';
const KAIST_DATASET_URL = 'https://vclab.kaist.ac.kr/siggraphasia2017p1/kaistdataset.html';
const POLYHAVEN_BROWN_PHOTOSTUDIO_PAGE_URL = 'https://polyhaven.com/a/brown_photostudio_02';
const SPOONS_LINEAR_STOKES_URL =
  'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/spoons.exr';
const BROWN_PHOTOSTUDIO_PANORAMA_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/brown_photostudio_02_1k.exr';
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

function decodeLaunchState(url: URL): Record<string, unknown> {
  const state = url.searchParams.get('state');
  if (!state) {
    throw new Error(`Expected launch URL state param in ${url.toString()}`);
  }

  return JSON.parse(decodeURIComponent(state)) as Record<string, unknown>;
}

async function expectGalleryCardLaunch(
  page: Page,
  title: string,
  image: { accessibleName: RegExp; src: string },
  launch: { src: string | RegExp; state?: Record<string, unknown> | null }
): Promise<void> {
  const item = page.locator('.gallery-item').filter({ hasText: title });
  await expect(item).toHaveCount(1);
  await expect(item.locator('prismifold-viewer')).toHaveCount(0);

  const screenshot = item.getByRole('img', { name: image.accessibleName });
  await expect(screenshot).toBeVisible();
  await expect(screenshot).toHaveAttribute('src', image.src);
  await expect.poll(async () => (
    await screenshot.evaluate((node) => (
      node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0 && node.naturalHeight > 0
    ))
  )).toBe(true);

  const launchLink = item.getByRole('link', { name: 'Try Web App', exact: true });
  await expect(launchLink).toBeVisible();
  await expect(launchLink).toHaveAttribute('target', '_blank');
  await expect(launchLink).toHaveAttribute('rel', 'noopener');
  const href = await launchLink.getAttribute('href');
  if (!href) {
    throw new Error(`Expected launch link href for ${title}.`);
  }

  const launchUrl = new URL(href, page.url());
  expect(launchUrl.pathname).toBe('/app/');
  const src = launchUrl.searchParams.get('src');
  if (launch.src instanceof RegExp) {
    expect(src).toMatch(launch.src);
  } else {
    expect(src).toBe(launch.src);
  }
  if (launch.state === null) {
    expect(launchUrl.searchParams.has('state')).toBe(false);
  } else if (launch.state !== undefined) {
    expect(decodeLaunchState(launchUrl)).toMatchObject(launch.state);
  }
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
  await expect(page.getByText(
    'Tools for inspecting, visualizing, exporting, and embedding channel-heavy EXR data.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inspect', level: 3 })).toBeVisible();
  await expect(page.locator('.feature-card').filter({ hasText: 'Inspect' }).locator('.feature-list li')).toHaveCount(3);
  await expect(page.getByText(
    'Open files and sample scenes; review metadata and channels.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(
    'Probe exact source values with zoom and rulers.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(
    'Inspect ROIs, valid samples, and image statistics.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visualize', level: 3 })).toBeVisible();
  await expect(page.getByText(
    'Browse RGB, alpha, AOV, spectral, polarization, and grouped channels.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Measure', level: 3 })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Export', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Embed', level: 3 })).toBeVisible();
  await expect(page.getByText('Add <prismifold-viewer> to HTML pages.', { exact: true })).toBeVisible();
  await expect(page.getByText(
    'Load the viewer with the hosted JavaScript web component.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('OpenEXR 2.x scanline', { exact: true })).toHaveCount(0);
  await expect(page.getByText('half / float / uint', { exact: true })).toHaveCount(0);
  await expect(page.getByText('WebGL2', { exact: true })).toHaveCount(0);
  await expect(page.getByText('exrs WASM', { exact: true })).toHaveCount(0);
  await expect(page.getByText('local files stay local', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Gallery', level: 2 })).toBeVisible();
  await expect(page.getByText(
    'Gallery examples highlight source-value inspection, screenshot export, visualization across RGB, depth, hyperspectral, polarization, and panorama EXR data, plus an embeddable HTML viewer demo.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(
    'Zoom into image data with pixel rulers and lock a probe to read exact source channel values directly from the OpenEXR pixels.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('Source value inspection', { exact: true })).toBeVisible();
  await expect(page.getByText('Screenshot export', { exact: true })).toBeVisible();
  await expect(page.getByText(
    'Select and crop multiple regions from the current view, keep a region active for adjustment, and export pixel exact screenshot crops without interpolation.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('Depth map view', { exact: true })).toBeVisible();
  await expect(page.locator('.gallery-item').filter({
    hasText: /Switch RGB plus Z data into a depth-map view that converts depth into a 3D\s+point cloud/
  })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Middlebury Stereo Datasets', exact: true })).toHaveAttribute(
    'href',
    MIDDLEBURY_SCENES2021_URL
  );
  await expect(page.locator('.gallery-item').filter({
    hasText: /Hyperspectral channels are automatically computed into RGB for visualization/
  })).toHaveCount(1);
  await expect(page.getByText('Hyperspectral visualization', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'KAIST Hyperspectral Image Dataset', exact: true })).toHaveAttribute(
    'href',
    KAIST_DATASET_URL
  );
  await expect(page.locator('.gallery-item').filter({ hasText: /AoLP/ })).toHaveCount(1);
  await expect(page.getByText(/angle of linear polarization/)).toHaveCount(0);
  await expect(page.getByText('Stokes vector visualization', { exact: true })).toBeVisible();
  await expect(page.locator('.gallery-item').filter({
    hasText: /Full-Stokes vector\s+images that include the circular/
  }).filter({
    hasText: 'S3'
  })).toHaveCount(1);
  await expect(page.getByText(/Navigate HDRI data in equirectangular format with panorama mode and a wide fov/)).toBeVisible();
  await expect(page.getByText('Panorama view', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Poly Haven HDRIs', exact: true })).toHaveAttribute(
    'href',
    POLYHAVEN_BROWN_PHOTOSTUDIO_PAGE_URL
  );
  await expect.poll(async () => (
    await page.locator('.gallery-source-link').evaluateAll((links) => links.every((link) => {
      const style = getComputedStyle(link);
      return Number(style.fontWeight) <= 500 && style.color === getComputedStyle(link.parentElement!).color;
    }))
  )).toBe(true);
  await expect(page.getByRole('link', { name: 'cbox_rgb.exr', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'owl_spheres.exr', exact: true })).toHaveCount(0);
  await expect(page.getByText('Middlebury chess1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('KAIST scene 27', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Brown Photostudio', { exact: true })).toHaveCount(0);
  await expect(page.getByText(MIDDLEBURY_SCENES2021_URL, { exact: true })).toHaveCount(0);
  await expect(page.getByText(KAIST_DATASET_URL, { exact: true })).toHaveCount(0);
  await expect(page.getByText(POLYHAVEN_BROWN_PHOTOSTUDIO_PAGE_URL, { exact: true })).toHaveCount(0);

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
    const galleryInner = document.querySelector('#gallery .section-inner');
    const galleryGrid = document.querySelector('.gallery-grid');
    const firstItem = document.querySelector('.gallery-item');
    const caption = firstItem?.querySelector('figcaption');
    const frame = firstItem?.querySelector('.exr-embed-frame');
    if (
      !(galleryInner instanceof HTMLElement) ||
      !(galleryGrid instanceof HTMLElement) ||
      !(firstItem instanceof HTMLElement) ||
      !(caption instanceof HTMLElement) ||
      !(frame instanceof HTMLElement)
    ) {
      return false;
    }
    const innerRect = galleryInner.getBoundingClientRect();
    const gridRect = galleryGrid.getBoundingClientRect();
    const captionRect = caption.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return (
      Math.abs(gridRect.width - innerRect.width) < 1 &&
      captionRect.right < frameRect.left &&
      Math.abs(captionRect.top - frameRect.top) < 12 &&
      frameRect.width > 760
    );
  });
  expect(desktopGalleryLayout).toBe(true);
  const embeds = page.locator('prismifold-viewer');
  await expect(embeds).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Try Web App', exact: true })).toHaveCount(6);
  await expect.poll(async () => (
    await page.locator('.gallery-item strong').evaluateAll((titles) => (
      titles.map((title) => title.textContent?.trim())
    ))
  )).toEqual([
    'Source value inspection',
    'Screenshot export',
    'Stokes vector visualization',
    'Hyperspectral visualization',
    'Depth map view',
    'Panorama view',
    'HTML embed'
  ]);

  const htmlEmbedItem = page.locator('.gallery-item').filter({ hasText: 'HTML embed' });
  await expect(htmlEmbedItem).toHaveCount(1);
  await expect(htmlEmbedItem.locator('img')).toHaveCount(0);
  await expect(htmlEmbedItem.getByText(
    'Add the hosted JavaScript file and a <prismifold-viewer> tag to publish an interactive OpenEXR viewer directly inside documentation, papers, and project pages.',
    { exact: true }
  )).toBeVisible();
  await expect(htmlEmbedItem.locator('figcaption .gallery-code-frame')).toHaveCount(1);
  await expect(htmlEmbedItem.locator('figcaption prismifold-viewer')).toHaveCount(0);
  expect(await htmlEmbedItem.evaluate((item) => {
    const caption = item.querySelector('figcaption');
    const copy = caption?.querySelector('.gallery-caption-copy');
    const code = caption?.querySelector('.gallery-code-frame');
    return Boolean(
      copy &&
      code &&
      (copy.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  })).toBe(true);
  const embedCode = htmlEmbedItem.locator('figcaption .gallery-code-frame code');
  await expect(embedCode).toContainText(
    '<script src="https://elerac.github.io/prismifold/embed/prismifold.js"></script>'
  );
  await expect(embedCode).toContainText('<prismifold-viewer');
  await expect(embedCode).toContainText('src="cbox_rgb.exr"');
  await expect(embedCode).not.toContainText('name=');
  await expect(embedCode).toContainText('height="360"');
  const liveEmbed = htmlEmbedItem.locator('.gallery-live-embed-frame prismifold-viewer');
  await expect(liveEmbed).toHaveAttribute('src', 'cbox_rgb.exr');
  await expect(liveEmbed).not.toHaveAttribute('name');
  await expect(liveEmbed).toHaveAttribute('height', '360');
  await htmlEmbedItem.scrollIntoViewIfNeeded();
  const liveEmbedFrame = htmlEmbedItem.locator('prismifold-viewer iframe');
  await expect(liveEmbedFrame).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => {
    const iframeSrc = await liveEmbedFrame.getAttribute('src');
    return iframeSrc ? new URL(iframeSrc, page.url()).searchParams.get('ui') : null;
  }).toBe('embed');
  const embedFrame = htmlEmbedItem.frameLocator('prismifold-viewer iframe');
  await expect(embedFrame.locator('.embed-shell')).toBeVisible({ timeout: 30000 });
  await expect(embedFrame.locator('.embed-source-label')).toBeHidden({ timeout: 30000 });

  await expectGalleryCardLaunch(page, 'Source value inspection', {
    accessibleName: /RGB OpenEXR image with a locked pixel probe and pixel rulers/,
    src: 'project-page/cbox-rgb-inspection.png'
  }, {
    src: new RegExp(`/${CBOX_RGB_URL}$`),
    state: {
      viewerMode: 'image',
      view: { zoom: 180, panX: 195.5, panY: 169.5 },
      lockedPixel: { ix: 195, iy: 169 }
    }
  });

  await expectGalleryCardLaunch(page, 'Screenshot export', {
    accessibleName: /two selected screenshot regions and R1 active/,
    src: 'project-page/spoons-screenshot-export.png'
  }, {
    src: SPOONS_LINEAR_STOKES_URL,
    state: null
  });

  await expectGalleryCardLaunch(page, 'Stokes vector visualization', {
    accessibleName: /Stokes vector image with computed AoLP and an automatically applied dedicated colormap/,
    src: 'project-page/polanalyser-stokes-aolp-y.png'
  }, {
    src: OWL_SPHERES_LINEAR_STOKES_URL,
    state: null
  });

  await expectGalleryCardLaunch(page, 'Hyperspectral visualization', {
    accessibleName: /hyperspectral EXR data with a locked pixel probe.*31 spectral channel thumbnails expanded/,
    src: 'project-page/kaist-hyperspectral-inspection.png'
  }, {
    src: KAIST_SCENE27_REFLECTANCE_URL,
    state: {
      viewerMode: 'image',
      lockedPixel: { ix: 2216, iy: 1189 }
    }
  });

  await expectGalleryCardLaunch(page, 'Depth map view', {
    accessibleName: /Prismifold depth map view with focal length 960/,
    src: 'project-page/middlebury-depth-inspection.png'
  }, {
    src: new RegExp(`/${MIDDLEBURY_CHESS1_RGB_Z_URL}$`),
    state: {
      viewerMode: 'depth',
      depthChannel: 'Z',
      depthFocalLengthPx: 960,
      depthPointSizePx: 2,
      view: { depthYawDeg: -5.3, depthPitchDeg: 0.65, depthZoom: 2 },
      lockedPixel: { ix: 406, iy: 300 }
    }
  });

  await expectGalleryCardLaunch(page, 'Panorama view', {
    accessibleName: /Prismifold panorama view with yaw 5\.37 pitch -34 and fov 180/,
    src: 'project-page/polyhaven-panorama-inspection.png'
  }, {
    src: BROWN_PHOTOSTUDIO_PANORAMA_URL,
    state: {
      viewerMode: 'panorama',
      view: { panoramaYawDeg: 5.37, panoramaPitchDeg: -34, panoramaHfovDeg: 180 }
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  expect(unexpectedErrors).toEqual([]);
});

test('opens the RGB gallery screenshot state in the web app', async ({ page }) => {
  const unexpectedErrors = watchUnexpectedErrors(page);
  await page.goto('/');

  const rgbAppLink = page.locator('.gallery-item').first().getByRole('link', { name: 'Try Web App', exact: true });
  const popupPromise = page.waitForEvent('popup');
  await rgbAppLink.click();
  const appPage = await popupPromise;
  const appUnexpectedErrors = watchUnexpectedErrors(appPage);

  await appPage.waitForURL(/\/app\/\?/, { waitUntil: 'domcontentloaded' });
  await expect(appPage).toHaveURL(/\/app\/\?/);
  await expectViewerAppReady(appPage);

  await expect(appPage.locator('#opened-images-select option')).toHaveCount(1, { timeout: 30000 });
  await expect(appPage.locator('#opened-images-select option:checked')).toContainText('cbox_rgb.exr', {
    timeout: 30000
  });
  await expect(appPage.locator('#loading-overlay')).toBeHidden({ timeout: 30000 });
  await expect(appPage.locator('#probe-mode')).toHaveText('Locked', { timeout: 30000 });
  await expect.poll(async () => await readProbeCoords(appPage.locator('#probe-coords'))).toEqual({
    x: 195,
    y: 169
  });
  await expect(appPage.locator('#viewer-state-zoom-input')).toHaveValue('180');
  await expect(appPage.locator('#viewer-state-pan-x-input')).toHaveValue('195.5');
  await expect(appPage.locator('#viewer-state-pan-y-input')).toHaveValue('169.5');

  expect([...unexpectedErrors, ...appUnexpectedErrors]).toEqual([]);
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
