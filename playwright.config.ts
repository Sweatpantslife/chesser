import { defineConfig } from '@playwright/test';

/**
 * E2E tests for the built app: the Fastify server serves apps/web/dist and the
 * WebSocket endpoints, so `pnpm build` must run before `pnpm test:e2e`.
 *
 * Browsers are NOT downloaded (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD); the suite
 * uses the preinstalled Chromium via an explicit executablePath, so it works
 * regardless of the Playwright package's pinned browser revision.
 */
const PORT = Number(process.env.E2E_PORT ?? 8917);
const CHROMIUM = process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath: CHROMIUM },
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: `http://localhost:${PORT}/api/health`,
    env: { PORT: String(PORT), HOST: '127.0.0.1', CHESSER_LOG: '0' },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
