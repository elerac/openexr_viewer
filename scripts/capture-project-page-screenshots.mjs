#!/usr/bin/env node

import { chromium } from '@playwright/test';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(repoRoot, 'dist');
const distIndex = resolve(distDir, 'index.html');
const distAppIndex = resolve(distDir, 'app', 'index.html');
const defaultOutputDir = resolve(repoRoot, 'public', 'project-page');
const host = '127.0.0.1';
const port = Number(process.env.PROJECT_PAGE_CAPTURE_PORT ?? 4175);
const appPath = normalizePath(process.env.PLAYWRIGHT_APP_PATH ?? '/prismifold/app/');
const siteBasePath = resolveSiteBasePath(appPath);
const appUrl = `http://${host}:${port}${appPath}`;
const siteBaseUrl = `http://${host}:${port}${siteBasePath}`;
const viewerTimeoutMs = Number(process.env.PROJECT_PAGE_CAPTURE_TIMEOUT_MS ?? 120000);
const renderSettleMs = Number(process.env.PROJECT_PAGE_CAPTURE_SETTLE_MS ?? 250);
const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(repoRoot, args.outDir ?? defaultOutputDir);
const scenes = createScenes();
const selectedScenes = filterScenes(scenes, args.only);

if (args.help) {
  printHelp();
  process.exit(0);
}
if (!existsSync(distIndex)) {
  throw new Error('dist/index.html was not found. Run `npm run build:e2e` before capturing project-page screenshots.');
}
if (!existsSync(distAppIndex)) {
  throw new Error('dist/app/index.html was not found. Run `npm run build:e2e` before capturing project-page screenshots.');
}

mkdirSync(outputDir, { recursive: true });

const server = createStaticServer();

try {
  await startServer(server);
  console.log(`Serving ${distDir} at http://${host}:${port}${siteBasePath}`);
  console.log(`Capturing ${selectedScenes.length} project-page screenshot(s) into ${outputDir}`);
  await captureScenes(selectedScenes);
} finally {
  await stopServer(server);
}

function createScenes() {
  const rgbState = {
    viewerMode: 'image',
    view: { zoom: 180, panX: 195.5, panY: 169.5 },
    lockedPixel: { ix: 195, iy: 169 }
  };
  const spoonsState = {
    viewerMode: 'image',
    visualizationMode: 'colormap',
    displaySelection: {
      kind: 'stokesScalar',
      parameter: 's2_over_s0',
      source: { kind: 'scalar', suffix: 'Y' }
    },
    colormapRange: { min: -1, max: 1 },
    colormapZeroCentered: true,
    view: { zoom: 0.378, panX: 1224, panY: 1024 }
  };
  const stokesState = {
    viewerMode: 'image',
    displaySelection: {
      kind: 'stokesAngle',
      parameter: 'aolp',
      source: { kind: 'scalar', suffix: 'Y' }
    }
  };
  const hyperspectralState = {
    viewerMode: 'image',
    lockedPixel: { ix: 2216, iy: 1189 }
  };
  const depthState = {
    viewerMode: 'depth',
    depthChannel: 'Z',
    depthFocalLengthPx: 960,
    depthPointSizePx: 2,
    view: { depthYawDeg: -5.3, depthPitchDeg: 0.65, depthZoom: 2 },
    lockedPixel: { ix: 406, iy: 300 }
  };
  const panoramaState = {
    viewerMode: 'panorama',
    view: { panoramaYawDeg: 5.37, panoramaPitchDeg: -34, panoramaHfovDeg: 180 }
  };

  return [
    {
      id: 'rgb',
      aliases: ['cbox', 'source'],
      output: 'cbox-rgb-inspection.png',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'cbox_rgb.exr',
      src: localAssetUrl('cbox_rgb.exr'),
      state: rgbState,
      initStorage: { rulers: true },
      prepare: async (page) => {
        await setPanelCollapsed(page, '#image-panel-collapse-button', true);
        await setPanelCollapsed(page, '#bottom-panel-collapse-button', true);
        await setPanelCollapsed(page, '#right-panel-collapse-button', false);
      }
    },
    {
      id: 'spoons',
      aliases: ['screenshot', 'export'],
      output: 'spoons-screenshot-export.png',
      viewport: { width: 2048, height: 1024 },
      expectedImageName: 'spoons.exr',
      src: 'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/spoons.exr',
      state: spoonsState,
      prepare: async (page) => {
        await openScreenshotSelection(page);
        await positionScreenshotRegions(page, {
          active: { x: 875, y: 205, width: 122, height: 124 },
          inactive: { x: 913, y: 525, width: 363, height: 315 },
          controls: { x: 573, y: 340 }
        });
      }
    },
    {
      id: 'stokes',
      aliases: ['polarization'],
      output: 'polanalyser-stokes-aolp-y.png',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'owl_spheres.exr',
      src: 'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/owl_spheres.exr',
      state: stokesState,
      prepare: async (page) => {
        await page.mouse.move(24, 24);
      }
    },
    {
      id: 'hyperspectral',
      aliases: ['kaist'],
      output: 'kaist-hyperspectral-inspection.png',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'scene27_reflectance.exr',
      src: 'https://huggingface.co/datasets/danaroth/kaist-hyperspectral/resolve/main/exr/scene27_reflectance.exr',
      state: hyperspectralState,
      prepare: async (page) => {
        await setCollapsibleExpanded(page, '#display-control-toggle', false);
        await expandSpectralThumbnailStack(page);
      }
    },
    {
      id: 'depth',
      aliases: ['middlebury'],
      output: 'middlebury-depth-inspection.png',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'middlebury_chess1_rgb_z.exr',
      src: localAssetUrl('middlebury_chess1_rgb_z.exr'),
      state: depthState
    },
    {
      id: 'panorama',
      aliases: ['polyhaven'],
      output: 'polyhaven-panorama-inspection.png',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'brown_photostudio_02_1k.exr',
      src: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/brown_photostudio_02_1k.exr',
      state: panoramaState
    }
  ];
}

async function captureScenes(sceneList) {
  const browser = await chromium.launch({
    args: [
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader'
    ]
  });

  try {
    for (const scene of sceneList) {
      await captureScene(browser, scene);
    }
  } finally {
    await browser.close();
  }
}

async function captureScene(browser, scene) {
  const outputPath = resolve(outputDir, scene.output);
  const pageErrors = [];
  const consoleErrors = [];
  const page = await browser.newPage({
    viewport: scene.viewport,
    deviceScaleFactor: 1
  });

  page.on('pageerror', (error) => {
    if (!error.message.includes('Viewer application has not finished initializing.')) {
      pageErrors.push(error.message);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  try {
    await page.addInitScript((storage) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      if (storage.rulers) {
        window.localStorage.setItem('prismifold:rulers-visible:v1', 'true');
      }
    }, scene.initStorage ?? {});

    const url = buildViewerUrl(scene.src, scene.state);
    console.log(`Capturing ${scene.id}: ${url}`);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: viewerTimeoutMs
    });

    await waitForAppReady(page);
    await waitForViewerReady(page, scene.expectedImageName);
    await waitForRenderIdle(page);
    if (scene.prepare) {
      await scene.prepare(page);
      await waitForRenderIdle(page);
    }
    await waitForNextPaint(page);
    await page.waitForTimeout(renderSettleMs);

    await assertNoAppErrors(page, scene.id);
    if (pageErrors.length > 0) {
      throw new Error(`Page error while capturing ${scene.id}:\n${pageErrors.join('\n')}`);
    }
    if (consoleErrors.length > 0) {
      throw new Error(`Console error while capturing ${scene.id}:\n${consoleErrors.join('\n')}`);
    }

    await page.screenshot({
      path: outputPath,
      type: 'png',
      fullPage: false
    });

    const dimensions = readPngDimensions(outputPath);
    if (dimensions.width !== scene.viewport.width || dimensions.height !== scene.viewport.height) {
      throw new Error(
        `Expected ${scene.output} to be ${scene.viewport.width}x${scene.viewport.height}, ` +
        `got ${dimensions.width}x${dimensions.height}.`
      );
    }
    const { size } = statSync(outputPath);
    console.log(`Saved ${outputPath} (${dimensions.width}x${dimensions.height}, ${size} bytes)`);
  } finally {
    await page.close();
  }
}

async function waitForAppReady(page) {
  const usedHook = await page.evaluate(async () => {
    const hooks = window.__openExrViewerE2E;
    if (!hooks) {
      return false;
    }
    await hooks.waitForAppReady();
    return true;
  });
  if (usedHook) {
    return;
  }

  const deadline = Date.now() + viewerTimeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const state = await readViewerState(page);
    if (state.errorText) {
      throw new Error(`The viewer failed before capture: ${state.errorText}`);
    }
    if (state.hasGalleryButton && state.canvasWidth > 0 && state.canvasHeight > 0) {
      return;
    }
    lastState = state;
    await waitMs(250);
  }

  throw new Error(`Timed out waiting for the app shell. Last state: ${JSON.stringify(lastState)}`);
}

async function waitForViewerReady(page, expectedImageName) {
  const deadline = Date.now() + viewerTimeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const state = await readViewerState(page);
    if (state.errorText) {
      throw new Error(`The viewer failed before capture: ${state.errorText}`);
    }
    const hasImage = state.options.some((option) => option.includes(expectedImageName));
    if (!state.loading && hasImage && state.canvasWidth > 0 && state.canvasHeight > 0) {
      return;
    }
    lastState = state;
    await waitMs(250);
  }

  throw new Error(`Timed out waiting for ${expectedImageName}. Last state: ${JSON.stringify(lastState)}`);
}

async function waitForRenderIdle(page) {
  const usedHook = await page.evaluate(async () => {
    const hooks = window.__openExrViewerE2E;
    if (!hooks) {
      return false;
    }
    await hooks.waitForRenderIdle();
    await hooks.waitForThumbnailIdle();
    await hooks.waitForFrames(2);
    return true;
  });
  if (!usedHook) {
    await waitForNextPaint(page);
  }
}

async function readViewerState(page) {
  return await page.evaluate(() => {
    const errorBanner = document.querySelector('#error-banner');
    const errorText =
      errorBanner instanceof HTMLElement && !errorBanner.classList.contains('hidden')
        ? (errorBanner.textContent ?? '').trim()
        : '';
    const galleryButton = document.querySelector('#gallery-menu-button');
    const loadingOverlay = document.querySelector('#loading-overlay');
    const canvas = document.querySelector('#gl-canvas');
    const options = Array.from(document.querySelectorAll('#opened-images-select option')).map((option) =>
      (option.textContent ?? '').trim()
    );

    return {
      errorText,
      hasGalleryButton: galleryButton instanceof HTMLButtonElement,
      loading: loadingOverlay ? !loadingOverlay.classList.contains('hidden') : true,
      canvasWidth: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
      canvasHeight: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
      options
    };
  });
}

async function assertNoAppErrors(page, sceneId) {
  const errorText = await page.evaluate(() => {
    const errorBanner = document.querySelector('#error-banner');
    return errorBanner instanceof HTMLElement && !errorBanner.classList.contains('hidden')
      ? (errorBanner.textContent ?? '').trim()
      : '';
  });
  if (errorText) {
    throw new Error(`The viewer reported an error while capturing ${sceneId}: ${errorText}`);
  }
}

async function setPanelCollapsed(page, buttonSelector, collapsed) {
  const button = page.locator(buttonSelector);
  await button.waitFor({ state: 'visible', timeout: 30000 });
  const expanded = await button.getAttribute('aria-expanded');
  const isCollapsed = expanded === 'false';
  if (isCollapsed !== collapsed) {
    await button.click();
    await waitForNextPaint(page);
  }
}

async function setCollapsibleExpanded(page, toggleSelector, expanded) {
  const toggle = page.locator(toggleSelector);
  await toggle.waitFor({ state: 'visible', timeout: 30000 });
  const isExpanded = (await toggle.getAttribute('aria-expanded')) === 'true';
  if (isExpanded !== expanded) {
    await toggle.click();
    await waitForNextPaint(page);
  }
}

async function openScreenshotSelection(page) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('#export-screenshot-button').click();
  await page.locator('#screenshot-selection-overlay').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#screenshot-selection-add-button').click();
  await page.locator('.screenshot-selection-region-box').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#screenshot-selection-box').waitFor({ state: 'visible', timeout: 30000 });
}

async function positionScreenshotRegions(page, layout) {
  await page.evaluate(({ active, inactive, controls }) => {
    const activeBox = document.querySelector('#screenshot-selection-box');
    const inactiveBox = document.querySelector('.screenshot-selection-region-box');
    const controlsElement = document.querySelector('#screenshot-selection-controls');
    const maskSvg = document.querySelector('#screenshot-selection-mask-svg');
    const maskPath = document.querySelector('#screenshot-selection-mask-path');
    if (
      !(activeBox instanceof HTMLElement) ||
      !(inactiveBox instanceof HTMLElement) ||
      !(controlsElement instanceof HTMLElement) ||
      !(maskSvg instanceof SVGSVGElement) ||
      !(maskPath instanceof SVGElement)
    ) {
      throw new Error('Screenshot selection overlay was not ready for deterministic positioning.');
    }

    setBox(activeBox, active);
    setBox(inactiveBox, inactive);
    setBox(controlsElement, {
      x: controls.x,
      y: controls.y,
      width: controlsElement.offsetWidth || 244,
      height: controlsElement.offsetHeight || 64
    });
    activeBox.querySelector('.screenshot-selection-region-badge')?.replaceChildren('1');
    inactiveBox.querySelector('.screenshot-selection-region-badge')?.replaceChildren('2');
    maskSvg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    maskPath.setAttribute('d', [
      `M0 0 H${window.innerWidth} V${window.innerHeight} H0 Z`,
      rectPath(active),
      rectPath(inactive)
    ].join(' '));

    function setBox(element, rect) {
      element.style.left = `${rect.x}px`;
      element.style.top = `${rect.y}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
    }

    function rectPath(rect) {
      return `M${rect.x} ${rect.y} H${rect.x + rect.width} V${rect.y + rect.height} H${rect.x} Z`;
    }
  }, layout);
}

async function expandSpectralThumbnailStack(page) {
  const expanded = await page.evaluate(() => {
    const toggles = Array.from(document.querySelectorAll('.channel-thumbnail-stack-toggle'));
    const toggle = toggles.find((candidate) => {
      const text = (candidate.textContent ?? '').trim();
      const stack = candidate.closest('.channel-thumbnail-stack');
      const stackText = stack?.textContent ?? '';
      return text === '31' || /Spectral/i.test(stackText);
    });
    if (!(toggle instanceof HTMLElement)) {
      return false;
    }
    if (toggle.getAttribute('aria-expanded') !== 'true') {
      toggle.click();
    }
    return true;
  });
  if (!expanded) {
    throw new Error('Could not find the hyperspectral Spectral thumbnail stack toggle.');
  }
  await waitForRenderIdle(page);
}

async function waitForNextPaint(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(resolve);
        });
      })
  );
}

function buildViewerUrl(src, state) {
  const url = new URL(appUrl);
  url.searchParams.set('src', src);
  const encodedState = encodeViewerState(state);
  if (encodedState) {
    url.searchParams.set('state', encodedState);
  }
  return url.toString();
}

function encodeViewerState(state) {
  if (!state) {
    return null;
  }
  return encodeURIComponent(JSON.stringify(state));
}

function localAssetUrl(path) {
  return new URL(path, siteBaseUrl).toString();
}

function createStaticServer() {
  return createServer((request, response) => {
    if (!request.url) {
      sendText(response, 400, 'Missing request URL');
      return;
    }

    const url = new URL(request.url, appUrl);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed');
      return;
    }

    const filePath = resolveStaticPath(url.pathname);
    if (!filePath) {
      sendText(response, 403, `Forbidden: ${url.pathname}`);
      return;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      sendText(response, 404, `Not found: ${url.pathname}`);
      return;
    }

    response.statusCode = 200;
    response.setHeader('Content-Type', contentTypeFor(filePath));

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  });
}

function resolveStaticPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const pathWithinDist = toDistRelativePath(decodedPath);
  const normalizedRelativePath = pathWithinDist === '' ? 'index.html' : pathWithinDist;
  const filePath = resolve(distDir, normalizedRelativePath);

  if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) {
    return null;
  }

  return filePath;
}

function toDistRelativePath(pathname) {
  if (pathname === appPath.slice(0, -1) || pathname === appPath) {
    return 'app/index.html';
  }

  if (pathname.startsWith(siteBasePath)) {
    return pathname.slice(siteBasePath.length);
  }

  return pathname.replace(/^\/+/, '');
}

function startServer(server) {
  return new Promise((resolveStart, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveStart();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function stopServer(server) {
  server.closeAllConnections?.();

  await new Promise((resolveStop, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolveStop();
    });
  });
}

function sendText(response, statusCode, message) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(message);
}

function contentTypeFor(filePath) {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.wasm':
      return 'application/wasm';
    case '.exr':
      return 'image/aces';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.npy':
      return 'application/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

function readPngDimensions(path) {
  const bytes = readFileSync(path);
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    throw new Error(`${path} is not a PNG file.`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    only: null,
    outDir: null
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith('--only=')) {
      parsed.only = arg.slice('--only='.length);
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      parsed.outDir = arg.slice('--out-dir='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function filterScenes(sceneList, only) {
  if (!only) {
    return sceneList;
  }
  const wanted = new Set(only.split(',').map((item) => item.trim()).filter(Boolean));
  const selected = sceneList.filter((scene) => (
    wanted.has(scene.id) || scene.aliases.some((alias) => wanted.has(alias))
  ));
  if (selected.length !== wanted.size) {
    const known = sceneList.flatMap((scene) => [scene.id, ...scene.aliases]).sort().join(', ');
    throw new Error(`Unknown --only scene in "${only}". Known scene ids/aliases: ${known}`);
  }
  return selected;
}

function printHelp() {
  console.log(`Usage: node scripts/capture-project-page-screenshots.mjs [options]

Options:
  --only=<ids>       Comma-separated scene ids or aliases.
                     Known ids: ${scenes.map((scene) => scene.id).join(', ')}
  --out-dir=<path>   Output directory. Defaults to public/project-page.
  --help             Show this help.

Examples:
  npm run capture:project-page
  npm run capture:project-page -- --only=rgb
  npm run capture:project-page -- --only=rgb,depth --out-dir=/tmp/prismifold-shots
`);
}

function normalizePath(value) {
  const path = value.startsWith('/') ? value : `/${value}`;
  return path.endsWith('/') ? path : `${path}/`;
}

function resolveSiteBasePath(normalizedAppPath) {
  const segments = normalizedAppPath.split('/').filter(Boolean);
  if (segments.at(-1) === 'app') {
    segments.pop();
  }

  return segments.length > 0 ? `/${segments.join('/')}/` : '/';
}

function waitMs(durationMs) {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, durationMs);
  });
}
