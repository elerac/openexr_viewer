import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const githubPagesBase = '/prismifold/';
const rootDir = fileURLToPath(new URL('.', import.meta.url));
const appHtml = resolve(rootDir, 'app/index.html');
const projectHtml = resolve(rootDir, 'index.html');

export default defineConfig(({ mode }) => {
  const desktopBuild = mode === 'desktop';
  const vscodeBuild = mode === 'vscode';
  const appOnlyBuild = desktopBuild || vscodeBuild;
  const tauriDevHost = process.env.TAURI_DEV_HOST;
  const tauriPlatform = process.env.TAURI_ENV_PLATFORM;
  const buildInput = appOnlyBuild
    ? {
        app: appHtml
      }
    : {
        main: projectHtml,
        app: appHtml
      };

  return {
    base: appOnlyBuild
      ? './'
      : process.env.GITHUB_PAGES === 'true' ? githubPagesBase : '/',
    publicDir: appOnlyBuild ? false : 'public',
    clearScreen: !tauriPlatform,
    server: {
      port: 5173,
      strictPort: Boolean(tauriPlatform || tauriDevHost),
      host: tauriDevHost || '127.0.0.1',
      hmr: tauriDevHost
        ? {
            protocol: 'ws',
            host: tauriDevHost,
            port: 5173
          }
        : undefined,
      watch: {
        ignored: ['**/src-tauri/**']
      }
    },
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    build: {
      ...(desktopBuild
        ? {
            outDir: 'dist-desktop',
            target: tauriPlatform === 'windows' ? 'chrome105' : 'safari13',
            minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
            sourcemap: Boolean(process.env.TAURI_ENV_DEBUG)
          }
        : vscodeBuild
          ? {
              outDir: 'vscode-extension/media/prismifold',
              target: 'chrome120',
              minify: 'esbuild',
              sourcemap: false
            }
        : {}),
      rollupOptions: {
        input: buildInput
      }
    }
  };
});
