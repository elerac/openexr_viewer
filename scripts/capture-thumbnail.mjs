#!/usr/bin/env node

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(repoRoot, 'dist');
const distIndex = resolve(distDir, 'index.html');
const thumbnailPath = resolve(distDir, 'thumbnail.jpg');
const host = '127.0.0.1';
const port = Number(process.env.THUMBNAIL_PREVIEW_PORT ?? 4174);
const appPath = normalizePath(process.env.PLAYWRIGHT_APP_PATH ?? '/openexr_viewer/');
const appUrl = `http://${host}:${port}${appPath}`;
const previewTimeoutMs = Number(process.env.THUMBNAIL_PREVIEW_TIMEOUT_MS ?? 30000);
const viewerTimeoutMs = Number(process.env.THUMBNAIL_VIEWER_TIMEOUT_MS ?? 60000);
const viewport = {
  width: Number(process.env.THUMBNAIL_WIDTH ?? 1440),
  height: Number(process.env.THUMBNAIL_HEIGHT ?? 900)
};

if (!existsSync(distIndex)) {
  throw new Error('dist/index.html was not found. Run `npm run build` before capturing the thumbnail.');
}

const builtHtml = readFileSync(distIndex, 'utf8');
const previewEnv = { ...process.env };
if (builtHtml.includes('/openexr_viewer/assets/')) {
  previewEnv.GITHUB_PAGES = 'true';
}

mkdirSync(dirname(thumbnailPath), { recursive: true });

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const preview = spawn(
  npmCommand,
  ['run', 'preview', '--', '--host', host, '--port', String(port), '--strictPort'],
  {
    cwd: repoRoot,
    env: previewEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  }
);

let previewLog = '';
let previewExit = null;

preview.stdout.on('data', collectPreviewLog);
preview.stderr.on('data', collectPreviewLog);
preview.on('exit', (code, signal) => {
  previewExit = { code, signal };
});

try {
  console.log(`Capturing thumbnail from ${appUrl}`);
  await waitForPreview(appUrl);
  await captureThumbnail();
  const { size } = statSync(thumbnailPath);
  console.log(`Saved ${thumbnailPath} (${size} bytes)`);
} finally {
  await stopPreview();
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

async function waitForPreview(url) {
  const deadline = Date.now() + previewTimeoutMs;
  let lastError = 'preview server has not responded yet';

  while (Date.now() < deadline) {
    if (previewExit) {
      throw new Error(`vite preview exited early (${formatPreviewExit()}).\n${previewLog}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await waitMs(250);
  }

  throw new Error(`Timed out waiting for vite preview at ${url}: ${lastError}\n${previewLog}`);
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

async function stopPreview() {
  if (previewExit || preview.killed) {
    return;
  }

  await new Promise((resolve) => {
    const forceKill = setTimeout(() => {
      preview.kill('SIGKILL');
      resolve();
    }, 5000);

    preview.once('exit', () => {
      clearTimeout(forceKill);
      resolve();
    });

    preview.kill('SIGTERM');
  });
}

function collectPreviewLog(chunk) {
  previewLog += chunk.toString();
  if (previewLog.length > 8000) {
    previewLog = previewLog.slice(-8000);
  }
}

function formatPreviewExit() {
  if (!previewExit) {
    return 'still running';
  }
  return previewExit.signal ? `signal ${previewExit.signal}` : `code ${previewExit.code}`;
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
