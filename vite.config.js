import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// BubHub v10 — Vite dev server replaces double-click file://.
// `npm run dev` serves index.html + native ES modules from src/, net/,
// room/, plugins/ and auto-registers games/*/index.js via import.meta.glob.
// No bundler magic in the game contract: plain ESM only.
// The cloudflare() plugin wires `vite build` output to Worker Static Assets
// (wrangler.jsonc); it must stay in a `plugins` array — wrangler refuses to
// auto-configure a config without one.
export default defineConfig({
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: 'dist',
    target: 'es2020'
  },
  plugins: [cloudflare()]
});
