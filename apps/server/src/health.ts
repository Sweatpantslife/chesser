/**
 * Liveness and readiness probes.
 *
 *   GET /healthz  — liveness: 200 whenever the process can answer at all.
 *   GET /readyz   — readiness: 200 only when serving traffic can actually
 *                   work — the data directory (db.json / social.json) must be
 *                   writable, and when a web dir is configured its index.html
 *                   must exist. 503 with per-check detail otherwise.
 *
 * Both are quiet (route logLevel "silent" keeps orchestrator probes out of
 * the request logs), excluded from http_requests_total (see metrics.ts), and
 * untouched by the rate limiters (the proxy/auth guards match their own
 * paths only). The pre-existing GET /api/health stays as-is — Docker's
 * HEALTHCHECK and the Playwright webServer probe still use it.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { WEB_DIR } from './config.js';
import { DATA_DIR } from './accounts/store.js';

export interface HealthOptions {
  /** Directory the JSON stores persist to; default CHESSER_DATA_DIR. */
  dataDir?: string;
  /** Built SPA dir, or null to skip the check; default WEB_DIR. */
  webDir?: string | null;
}

/** True when `dir` exists (or can be created) and a file can be written in it. */
function dataDirWritable(dir: string): boolean {
  const probe = path.join(dir, `.readyz-${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, '');
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.unlinkSync(probe);
    } catch {
      /* probe never landed */
    }
  }
}

export function registerHealth(app: FastifyInstance, opts: HealthOptions = {}): void {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const webDir = opts.webDir === undefined ? WEB_DIR : opts.webDir;

  app.get('/healthz', { logLevel: 'silent' }, async () => ({ ok: true }));

  app.get('/readyz', { logLevel: 'silent' }, async (req, reply) => {
    const checks: Record<string, 'ok' | 'fail'> = {
      dataDir: dataDirWritable(dataDir) ? 'ok' : 'fail',
    };
    if (webDir) {
      checks.web = fs.existsSync(path.join(webDir, 'index.html')) ? 'ok' : 'fail';
    }
    const ok = Object.values(checks).every((c) => c === 'ok');
    if (!ok) reply.code(503);
    return { ok, checks };
  });
}
