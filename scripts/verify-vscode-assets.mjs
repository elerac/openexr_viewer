import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(rootDir, 'vscode-extension', 'media', 'prismifold');
const appDir = resolve(distDir, 'app');
const colormapDir = resolve(appDir, 'colormaps');
const manifestPath = resolve(colormapDir, 'manifest.json');

await assertFile(resolve(appDir, 'index.html'));

const distFiles = await listFiles(distDir);
const exrFiles = distFiles.filter((file) => extname(file).toLowerCase() === '.exr');
if (exrFiles.length > 0) {
  throw new Error(`VS Code extension media must not contain bundled EXR files: ${exrFiles.join(', ')}`);
}

const hasScript = distFiles.some((file) => extname(file) === '.js');
const hasStylesheet = distFiles.some((file) => extname(file) === '.css');
const hasWasm = distFiles.some((file) => extname(file) === '.wasm');
if (!hasScript) {
  throw new Error('VS Code extension media does not contain a JavaScript bundle.');
}
if (!hasStylesheet) {
  throw new Error('VS Code extension media does not contain a CSS bundle.');
}
if (!hasWasm) {
  throw new Error('VS Code extension media does not contain a WASM asset.');
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest || !Array.isArray(manifest.colormaps)) {
  throw new Error('VS Code colormap manifest is missing a colormaps array.');
}
for (const colormap of manifest.colormaps) {
  if (!colormap || typeof colormap.file !== 'string') {
    throw new Error('VS Code colormap manifest contains an invalid entry.');
  }
  await assertFile(resolve(colormapDir, colormap.file));
}

console.log('Verified VS Code extension media assets.');

async function assertFile(path) {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error(`Expected file is missing: ${path}`);
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}
