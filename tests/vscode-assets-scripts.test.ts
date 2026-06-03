import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('VS Code extension asset scripts', () => {
  it('targets the extension media directory for Vite and staged assets', async () => {
    const [packageJson, viteConfig, stageScript, verifyScript] = await Promise.all([
      readFile(resolve(rootDir, 'package.json'), 'utf8'),
      readFile(resolve(rootDir, 'vite.config.ts'), 'utf8'),
      readFile(resolve(rootDir, 'scripts/stage-vscode-assets.mjs'), 'utf8'),
      readFile(resolve(rootDir, 'scripts/verify-vscode-assets.mjs'), 'utf8')
    ]);

    expect(packageJson).toContain('"build:vscode-web"');
    expect(viteConfig).toContain("outDir: 'vscode-extension/media/prismifold'");
    expect(stageScript).toContain("'vscode-extension', 'media', 'prismifold'");
    expect(stageScript).toContain("'app', 'colormaps'");
    expect(verifyScript).toContain("'vscode-extension', 'media', 'prismifold'");
    expect(verifyScript).toContain('must not contain bundled EXR files');
  });
});
