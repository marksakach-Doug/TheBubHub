import { defineConfig } from 'vite';

// BubHub v10 — Vite dev server replaces double-click file://.
// `npm run dev` serves index.html + native ES modules from src/, net/,
// room/, plugins/ and auto-registers games/*/index.js via import.meta.glob.
// No bundler magic in the game contract: plain ESM only.
export default defineConfig({
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: 'dist',
    target: 'es2020'
  }
});
