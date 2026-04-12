#!/usr/bin/env node

import { chromium } from '@playwright/test';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(repoRoot, 'dist');
const distIndex = resolve(distDir, 'index.html');
const thumbnailPath = resolve(distDir, 'thumbnail.jpg');
const host = '127.0.0.1';
const port = Number(process.env.THUMBNAIL_PREVIEW_PORT ?? 4174);
const appPath = normalizePath(process.env.PLAYWRIGHT_APP_PATH ?? '/openexr_viewer/');
const appUrl = `http://${host}:${port}${appPath}`;
const viewerTimeoutMs = Number(process.env.THUMBNAIL_VIEWER_TIMEOUT_MS ?? 60000);
const viewport = {
  width: Number(process.env.THUMBNAIL_WIDTH ?? 1440),
  height: Number(process.env.THUMBNAIL_HEIGHT ?? 900)
};

if (!existsSync(distIndex)) {
  throw new Error('dist/index.html was not found. Run `npm run build` before capturing the thumbnail.');
}

mkdirSync(dirname(thumbnailPath), { recursive: true });

const server = createStaticServer();

try {
  await startServer(server);
  console.log(`Capturing thumbnail from ${appUrl}`);
  await captureThumbnail();
  const { size } = statSync(thumbnailPath);
  console.log(`Saved ${thumbnailPath} (${size} bytes)`);
} finally {
  await stopServer(server);
}

async function captureThumbnail() {
  const browser = await chromium.launch({
    args: [
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader'
    ]
  });
  const pageErrors = [];

  try {
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: 1
    });

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(appUrl, {
      waitUntil: 'domcontentloaded',
      timeout: viewerTimeoutMs
    });

    await waitForViewerReady(page);

    if (pageErrors.length > 0) {
      throw new Error(`The viewer raised a page error: ${pageErrors.join('\n')}`);
    }

    await waitForNextPaint(page);

    await page.screenshot({
      path: thumbnailPath,
      type: 'jpeg',
      quality: 88,
      fullPage: false
    });
  } finally {
    await browser.close();
  }
}

async function waitForViewerReady(page) {
  const deadline = Date.now() + viewerTimeoutMs;
  let lastState = null;

  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const errorBanner = document.querySelector('#error-banner');
      const errorText =
        errorBanner && !errorBanner.classList.contains('hidden')
          ? (errorBanner.textContent ?? '').trim()
          : '';
      const loadingOverlay = document.querySelector('#loading-overlay');
      const canvas = document.querySelector('#gl-canvas');
      const options = Array.from(document.querySelectorAll('#opened-images-select option')).map((option) =>
        (option.textContent ?? '').trim()
      );

      return {
        errorText,
        loading: loadingOverlay ? !loadingOverlay.classList.contains('hidden') : true,
        canvasWidth: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
        canvasHeight: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
        options
      };
    });

    if (state.errorText) {
      throw new Error(`The viewer failed before thumbnail capture: ${state.errorText}`);
    }

    const hasDefaultImage = state.options.some((option) => option.includes('cbox_rgb.exr'));
    if (!state.loading && hasDefaultImage && state.canvasWidth > 0 && state.canvasHeight > 0) {
      return;
    }

    lastState = state;
    await waitMs(250);
  }

  throw new Error(`Timed out waiting for the default EXR to render. Last state: ${JSON.stringify(lastState)}`);
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
    return 'index.html';
  }

  if (pathname.startsWith(appPath)) {
    return pathname.slice(appPath.length);
  }

  return pathname.replace(/^\/+/, '');
}

function startServer(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function stopServer(server) {
  server.closeAllConnections?.();

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
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
    default:
      return 'application/octet-stream';
  }
}

function normalizePath(value) {
  const path = value.startsWith('/') ? value : `/${value}`;
  return path.endsWith('/') ? path : `${path}/`;
}

function waitMs(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
