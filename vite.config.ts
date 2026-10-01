import { defineConfig } from 'vite';

// GitHub Pages serves the site under /<repo>/, so production builds (and vite preview)
// prefix every asset URL with it; the dev server stays at /.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/ProceduralBuilding_v2/' : '/',
  server: { port: 5176, open: true },
}));
