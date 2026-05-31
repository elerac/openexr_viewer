import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(rootDir, 'dist');
const colormapSourceDir = resolve(rootDir, 'public', 'colormaps');
const colormapOutputDir = resolve(distDir, 'colormaps');

await mkdir(distDir, { recursive: true });
await rm(colormapOutputDir, { recursive: true, force: true });
await cp(colormapSourceDir, colormapOutputDir, {
  recursive: true,
  filter: (source) => !source.endsWith('.DS_Store')
});

console.log('Staged desktop assets: public/colormaps -> dist/colormaps');
