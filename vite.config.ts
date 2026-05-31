import { defineConfig } from 'vite';

const githubPagesBase = '/openexr_viewer/';

export default defineConfig(({ mode }) => {
  const desktopBuild = mode === 'desktop';
  const tauriDevHost = process.env.TAURI_DEV_HOST;
  const tauriPlatform = process.env.TAURI_ENV_PLATFORM;

  return {
    base: desktopBuild
      ? './'
      : process.env.GITHUB_PAGES === 'true' ? githubPagesBase : '/',
    publicDir: desktopBuild ? false : 'public',
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
    build: desktopBuild
      ? {
          target: tauriPlatform === 'windows' ? 'chrome105' : 'safari13',
          minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
          sourcemap: Boolean(process.env.TAURI_ENV_DEBUG)
        }
      : undefined
  };
});
