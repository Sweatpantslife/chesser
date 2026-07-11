/**
 * HTTP hardening tests — security headers, CORS allowlist, and the per-IP
 * budgets on the unauthenticated upstream-proxy endpoints. Each test builds a
 * small Fastify app wired exactly the way index.ts wires the real one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  buildCsp,
  DEFAULT_CONNECT_ORIGINS,
  inlineScriptHashes,
  parseAllowedOrigins,
  parseConnectOrigins,
  registerSecurityHeaders,
} from './security-headers.js';
import { registerProxyGuards, type ProxyGuardOptions } from './proxy-guard.js';

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

async function apiApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerSecurityHeaders(app);
  app.get('/api/ping', async () => ({ ok: true }));
  await app.ready();
  return app;
}

test('security headers are present on API responses', async (t) => {
  const app = await apiApp();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/ping' });
  assert.equal(res.statusCode, 200);
  const csp = String(res.headers['content-security-policy']);
  assert.ok(csp.includes("default-src 'self'"), 'CSP default-src');
  assert.ok(csp.includes("frame-ancestors 'none'"), 'CSP frame-ancestors');
  assert.ok(csp.includes("object-src 'none'"), 'CSP object-src');
  assert.ok(csp.includes('https://api.anthropic.com'), 'BYOK direct path allowed in connect-src');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
  assert.ok(res.headers['permissions-policy'], 'permissions-policy set');
});

test('headers also land on 404s (the not-found path serves the SPA in prod)', async (t) => {
  const app = await apiApp();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['content-security-policy']);
});

test('served SPA gets CSP whose script-src hashes the inline scripts of the real index.html', async (t) => {
  const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chesser-web-'));
  const inline = "document.documentElement.dataset.theme = 'dark';";
  fs.writeFileSync(
    path.join(webDir, 'index.html'),
    `<!doctype html><html><head><script>${inline}</script><script src="/app.js"></script></head><body></body></html>`,
  );
  t.after(() => fs.rmSync(webDir, { recursive: true, force: true }));

  const app = Fastify();
  registerSecurityHeaders(app, { webDir });
  await app.register(fastifyStatic, { root: webDir, wildcard: false });
  await app.ready();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes(inline), 'index.html actually served');

  const expected = `'sha256-${crypto.createHash('sha256').update(inline).digest('base64')}'`;
  const csp = String(res.headers['content-security-policy']);
  assert.ok(csp.includes(`script-src 'self' ${expected}`), `CSP carries the inline-script hash: ${csp}`);
  assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"), 'no unsafe-inline for scripts');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('inlineScriptHashes: hashes inline bodies only, skips src= and empty scripts', () => {
  const html = `
    <script>alert(1)</script>
    <script type="module" src="/a.js"></script>
    <script>   </script>
    <script data-x="1">alert(2)</script>`;
  const hashes = inlineScriptHashes(html);
  assert.equal(hashes.length, 2);
  assert.equal(hashes[0], `'sha256-${crypto.createHash('sha256').update('alert(1)').digest('base64')}'`);
});

test('connect-src includes ws/wss for the request host, and skips a malformed Host', async (t) => {
  const app = await apiApp();
  t.after(() => app.close());

  const good = await app.inject({ method: 'GET', url: '/api/ping', headers: { host: 'Chess.example.com:8787' } });
  const csp = String(good.headers['content-security-policy']);
  assert.ok(csp.includes('ws://chess.example.com:8787'), 'ws origin allowed');
  assert.ok(csp.includes('wss://chess.example.com:8787'), 'wss origin allowed');

  const bad = await app.inject({ method: 'GET', url: '/api/ping', headers: { host: 'evil.com; script-src *' } });
  const badCsp = String(bad.headers['content-security-policy']);
  assert.ok(!badCsp.includes('evil.com'), 'unsafe host never interpolated into CSP');
});

test('HSTS is sent only when the request arrived over TLS (via trusted proxy)', async (t) => {
  const app = Fastify({ trustProxy: 1 });
  registerSecurityHeaders(app);
  app.get('/api/ping', async () => ({ ok: true }));
  await app.ready();
  t.after(() => app.close());

  const plain = await app.inject({ method: 'GET', url: '/api/ping' });
  assert.equal(plain.headers['strict-transport-security'], undefined, 'no HSTS over plain http');

  const tls = await app.inject({ method: 'GET', url: '/api/ping', headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(tls.headers['strict-transport-security'], 'max-age=31536000');
});

test('parseConnectOrigins: unset → []; http(s) origins normalized; non-http dropped', () => {
  assert.deepEqual(parseConnectOrigins(undefined), []);
  assert.deepEqual(parseConnectOrigins(''), []);
  assert.deepEqual(parseConnectOrigins('ftp://nope.example, not a url'), []);
  assert.deepEqual(parseConnectOrigins('http://192.168.1.50:11434/v1, https://llm.example.com'), [
    'http://192.168.1.50:11434',
    'https://llm.example.com',
  ]);
});

test('operator-whitelisted connect-src origins reach the CSP (LAN/self-hosted LLM escape hatch)', async (t) => {
  const app = Fastify();
  registerSecurityHeaders(app, {
    connectOrigins: [...DEFAULT_CONNECT_ORIGINS, ...parseConnectOrigins('http://192.168.1.50:11434')],
  });
  app.get('/api/ping', async () => ({ ok: true }));
  await app.ready();
  t.after(() => app.close());

  const csp = String((await app.inject({ method: 'GET', url: '/api/ping' })).headers['content-security-policy']);
  assert.ok(csp.includes('http://192.168.1.50:11434'), 'custom LAN endpoint allowed in connect-src');
  assert.ok(csp.includes('https://api.anthropic.com'), 'defaults still present');
});

test('buildCsp shape stays parseable', () => {
  const csp = buildCsp(["'sha256-abc'"], ['https://api.anthropic.com'], 'h.example');
  for (const directive of csp.split('; ')) {
    assert.match(directive, /^[a-z-]+ /, `directive has a name: ${directive}`);
  }
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

test('parseAllowedOrigins: unset/empty/garbage → false; valid list normalized to origins', () => {
  assert.equal(parseAllowedOrigins(undefined), false);
  assert.equal(parseAllowedOrigins(''), false);
  assert.equal(parseAllowedOrigins('not a url, ftp://nope.example'), false);
  assert.deepEqual(parseAllowedOrigins('https://a.example.com/ignored-path, http://b.example.com:8080'), [
    'https://a.example.com',
    'http://b.example.com:8080',
  ]);
});

async function corsApp(allowed: false | string[]): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cors, { origin: allowed });
  app.get('/api/ping', async () => ({ ok: true }));
  await app.ready();
  return app;
}

test('default CORS (no env) never reflects a foreign origin', async (t) => {
  const app = await corsApp(parseAllowedOrigins(undefined));
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/ping', headers: { origin: 'https://evil.example.com' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], undefined, 'no ACAO for a foreign origin');

  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/api/ping',
    headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'GET' },
  });
  assert.equal(preflight.headers['access-control-allow-origin'], undefined, 'preflight fails closed too');
});

test('CHESSER_ALLOWED_ORIGINS grants exactly the listed origins', async (t) => {
  const app = await corsApp(parseAllowedOrigins('https://friend.example.com'));
  t.after(() => app.close());

  const ok = await app.inject({ method: 'GET', url: '/api/ping', headers: { origin: 'https://friend.example.com' } });
  assert.equal(ok.headers['access-control-allow-origin'], 'https://friend.example.com');

  const nope = await app.inject({ method: 'GET', url: '/api/ping', headers: { origin: 'https://evil.example.com' } });
  assert.equal(nope.headers['access-control-allow-origin'], undefined);
});

// ---------------------------------------------------------------------------
// Proxy endpoint budgets
// ---------------------------------------------------------------------------

async function proxyApp(opts: ProxyGuardOptions): Promise<FastifyInstance> {
  const app = Fastify();
  registerProxyGuards(app, opts);
  app.get('/api/import', async () => ({ ok: true }));
  app.get('/api/explorer', async () => ({ ok: true }));
  app.get('/api/tablebase', async () => ({ ok: true }));
  app.get('/api/health', async () => ({ ok: true }));
  await app.ready();
  return app;
}

test('proxy endpoints rate-limit per IP with independent budgets; other routes are untouched', async (t) => {
  let clock = 0;
  const app = await proxyApp({
    importCapacity: 2,
    importRefillPerMinute: 60,
    explorerCapacity: 3,
    explorerRefillPerMinute: 60,
    tablebaseCapacity: 3,
    tablebaseRefillPerMinute: 60,
    now: () => clock,
  });
  t.after(() => app.close());

  const hit = (url: string, ip = '203.0.113.5') => app.inject({ method: 'GET', url, remoteAddress: ip });

  // Import: 2 pass, third is refused with retry-after.
  assert.equal((await hit('/api/import?user=x')).statusCode, 200);
  assert.equal((await hit('/api/import?user=x')).statusCode, 200);
  const blocked = await hit('/api/import?user=x');
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers['retry-after'], '60');
  assert.ok(blocked.json().error);

  // A different client IP has its own bucket.
  assert.equal((await hit('/api/import?user=x', '203.0.113.6')).statusCode, 200);

  // Explorer/tablebase budgets are separate from import's exhausted one.
  assert.equal((await hit('/api/explorer?fen=x')).statusCode, 200);
  assert.equal((await hit('/api/tablebase?fen=x')).statusCode, 200);

  // Unproxied routes never consult the limiter.
  for (let i = 0; i < 10; i++) assert.equal((await hit('/api/health')).statusCode, 200);

  // Refill: a minute later the import bucket admits again.
  clock += 60_000;
  assert.equal((await hit('/api/import?user=x')).statusCode, 200);
});

test('explorer exhausts to 429 and the query string does not bypass matching', async (t) => {
  const app = await proxyApp({ explorerCapacity: 1, explorerRefillPerMinute: 1, now: () => 0 });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/api/explorer?fen=a&db=lichess' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/explorer?fen=b' })).statusCode, 429);
});

test('a percent-encoded path cannot bypass the limiter (matches the routed path, not raw url)', async (t) => {
  // Fastify decodes %69 → 'i', so /api/%69mport routes to /api/import. The guard
  // must consume budget for it exactly like the plain path, or one encoded byte
  // grants unlimited proxied requests. Capacity 2, no refill.
  const app = await proxyApp({ importCapacity: 2, importRefillPerMinute: 0, now: () => 0 });
  t.after(() => app.close());

  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await app.inject({ method: 'GET', url: '/api/%69mport?user=x' })).statusCode);
  }
  assert.deepEqual(statuses, [200, 200, 429, 429, 429], 'encoded path is rate-limited like the plain one');
});
