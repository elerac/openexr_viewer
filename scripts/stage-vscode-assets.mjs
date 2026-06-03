import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(rootDir, 'vscode-extension', 'media', 'prismifold');
const colormapOutputDir = resolve(distDir, 'app', 'colormaps');
const colormapSourceDir = resolve(rootDir, 'public', 'colormaps');

await mkdir(distDir, { recursive: true });
await cp(colormapSourceDir, colormapOutputDir, {
  recursive: true,
  force: true
});

console.log('Staged VS Code assets: public/colormaps -> vscode-extension/media/prismifold/app/colormaps');
