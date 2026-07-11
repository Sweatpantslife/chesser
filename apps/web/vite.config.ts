import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const ENGINE_TARGET = process.env.CHESSER_SERVER ?? 'http://localhost:8787';

// During dev the web app talks to the engine server through Vite's proxy, so the
// client can always use same-origin /api and /ws URLs.
export default defineConfig({
  plugins: [
    react(),
    // Installable PWA with an offline app shell. Workbox (generateSW) precaches
    // the built assets with content hashes, so every deploy cache-busts itself.
    VitePWA({
      // autoUpdate: a new deploy's service worker activates immediately
      // (skipWaiting + clientsClaim) and the page reloads onto the new version.
      // All user state lives in localStorage/the sync API, so a reload is safe,
      // and it avoids shipping "refresh to update" UI.
      registerType: 'autoUpdate',
      // Don't force manifest icons into the precache (they'd bypass the
      // globIgnores below) — the OS fetches them at install time only.
      includeManifestIcons: false,
      manifest: {
        name: 'Chesser',
        short_name: 'Chesser',
        description:
          'Play vs bots and train openings, tactics and endgames with Stockfish and Maia.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        // Matches the app's default background (index.html theme-color).
        background_color: '#141126',
        theme_color: '#141126',
        categories: ['games', 'education'],
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell AND every lazy route/data chunk (bundled
        // puzzle core, lessons, the lazy ECO openings chunk, piece-set CSS,
        // fonts, icons/avatars) — ~2.4 MB total. The initial page load only
        // pulls the small entry chunk; the service worker tops up the rest in
        // the background so every tab still works offline. Deliberately NOT
        // precached: the full puzzle dataset (public/puzzles/*.json, 6.6 MB) —
        // it is runtime-cached below instead, so only the rating bands a user
        // actually plays are stored offline.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        // The big install-time icons (manifest 512s, apple-touch) are only
        // fetched by the OS when adding to the home screen — precaching them
        // would cost every client ~240 kB of offline storage for nothing.
        globIgnores: ['sw-legacy-cleanup.js', 'pwa-512x512.png', 'pwa-maskable-512x512.png', 'apple-touch-icon.png'],
        // The largest chunk (lazy ECO openings) is ~0.6 MB; leave headroom but
        // keep a ceiling so a future multi-MB asset can't silently bloat every
        // install.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // SPA navigation fallback — but never for API/websocket routes: an
        // offline /api request must fail, not be answered with the app shell.
        navigateFallback: '/index.html',
        // (`/api` without a slash included: the server answers it with a JSON
        // 404, so the SW must not answer it with the app shell.)
        navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/ws(\/|$)/],
        runtimeCaching: [
          {
            // Lazily fetched puzzle rating bands (~700 kB each). Serve from
            // cache instantly, refresh in the background; bands never fetched
            // just fall back to the embedded core (see lib/puzzleService.ts).
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/puzzles/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'chesser-puzzles-v1',
              expiration: { maxEntries: 16, purgeOnQuotaError: true },
            },
          },
          // No rule for /api: Workbox never caches unmatched requests, so
          // auth/sync/friend-games stay strictly online-only.
        ],
        // Drop the cache left behind by the previous hand-rolled sw.js.
        importScripts: ['sw-legacy-cleanup.js'],
        cleanupOutdatedCaches: true,
      },
      // Keep the SW out of dev — it would fight Vite's HMR.
      devOptions: { enabled: false },
    }),
  ],
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
