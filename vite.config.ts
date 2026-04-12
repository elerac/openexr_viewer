import { defineConfig } from 'vite';

const githubPagesBase = '/openexr_viewer/';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? githubPagesBase : '/'
});
