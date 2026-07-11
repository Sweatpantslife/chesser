/**
 * Liveness/readiness probe tests.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// health.ts imports the account store (for the default data dir), which
// persists to CHESSER_DATA_DIR at module load — point it at a throwaway
// directory BEFORE importing.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chesser-health-test-'));
process.env.CHESSER_DATA_DIR = dataDir;

const { registerHealth } = await import('./health.js');
const Fastify = (await import('fastify')).default;

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('/healthz is 200 whenever the process is up', async (t) => {
  const app = Fastify();
  registerHealth(app, { dataDir, webDir: null });
  await app.ready();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test('/readyz is 200 with a writable data dir (creating it if missing)', async (t) => {
  const fresh = path.join(dataDir, 'not-created-yet');
  const app = Fastify();
  registerHealth(app, { dataDir: fresh, webDir: null });
  await app.ready();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; checks: Record<string, string> };
  assert.equal(body.ok, true);
  assert.equal(body.checks.dataDir, 'ok');
  assert.ok(fs.existsSync(fresh), 'readiness probe created the data dir');
  assert.equal(fs.readdirSync(fresh).length, 0, 'probe file cleaned up');
});

test('/readyz is 503 when the data dir cannot be written', async (t) => {
  // A regular FILE where the directory should be: mkdir/writes must fail.
  const blocker = path.join(dataDir, 'blocker');
  fs.writeFileSync(blocker, 'i am a file');
  const app = Fastify();
  registerHealth(app, { dataDir: blocker, webDir: null });
  await app.ready();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(res.statusCode, 503);
  const body = res.json() as { ok: boolean; checks: Record<string, string> };
  assert.equal(body.ok, false);
  assert.equal(body.checks.dataDir, 'fail');
});

test('/readyz checks the configured web dir for index.html', async (t) => {
  const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chesser-health-web-'));
  t.after(() => fs.rmSync(webDir, { recursive: true, force: true }));

  const app = Fastify();
  registerHealth(app, { dataDir, webDir });
  await app.ready();
  t.after(() => app.close());

  const missing = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(missing.statusCode, 503);
  assert.equal((missing.json() as { checks: Record<string, string> }).checks.web, 'fail');

  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html>');
  const present = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(present.statusCode, 200);
  assert.equal((present.json() as { checks: Record<string, string> }).checks.web, 'ok');
});
