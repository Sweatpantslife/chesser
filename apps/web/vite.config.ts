import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ENGINE_TARGET = process.env.CHESSER_SERVER ?? 'http://localhost:8787';

// During dev the web app talks to the engine server through Vite's proxy, so the
// client can always use same-origin /api and /ws URLs.
export default defineConfig({
  plugins: [react()],
  // The bundled ECO opening database is a large, intentionally lazy-loaded
  // chunk (only fetched when opening-name lookup is used).
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: ENGINE_TARGET, changeOrigin: true },
      '/ws': { target: ENGINE_TARGET.replace(/^http/, 'ws'), ws: true },
    },
  },
});
