/**
 * Metrics tests — counters increment per request, gauges sample at scrape
 * time, the exposition format parses, and the optional token guard holds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { MetricsRegistry, registerMetrics } from './metrics.js';

async function metricsApp(opts: { token?: string } = {}): Promise<{ app: FastifyInstance; registry: MetricsRegistry }> {
  const app = Fastify();
  // token '' isolates tests from any ambient CHESSER_METRICS_TOKEN.
  const registry = registerMetrics(app, { token: opts.token ?? '' });
  app.get('/api/ping', async () => ({ ok: true }));
  app.get('/api/private', async (req, reply) => reply.code(401).send({ error: 'Not authenticated.' }));
  app.get('/api/import', async () => ({ ok: true }));
  await app.ready();
  return { app, registry };
}

test('http_requests_total increments by route/method/status; scrapes are not self-counted', async (t) => {
  const { app } = await metricsApp();
  t.after(() => app.close());

  await app.inject({ method: 'GET', url: '/api/ping' });
  await app.inject({ method: 'GET', url: '/api/ping' });
  await app.inject({ method: 'GET', url: '/api/private' });
  await app.inject({ method: 'GET', url: '/metrics' }); // must not count itself

  const res = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /^text\/plain/);
  const body = res.body;
  assert.ok(body.includes('# TYPE http_requests_total counter'), body);
  assert.ok(body.includes('http_requests_total{route="/api/ping",method="GET",status="200"} 2'), body);
  assert.ok(body.includes('http_requests_total{route="/api/private",method="GET",status="401"} 1'), body);
  assert.ok(!body.includes('route="/metrics"'), 'scrape endpoint excluded from its own counter');
});

test('auth_failures_total counts 401 responses', async (t) => {
  const { app } = await metricsApp();
  t.after(() => app.close());

  assert.match((await app.inject('/metrics')).body, /auth_failures_total 0/);
  await app.inject({ method: 'GET', url: '/api/private' });
  await app.inject({ method: 'GET', url: '/api/private' });
  assert.match((await app.inject('/metrics')).body, /auth_failures_total 2/);
});

test('proxy_requests_total tracks the upstream-proxy endpoints only', async (t) => {
  const { app } = await metricsApp();
  t.after(() => app.close());

  await app.inject({ method: 'GET', url: '/api/import' });
  await app.inject({ method: 'GET', url: '/api/ping' });
  const body = (await app.inject('/metrics')).body;
  assert.ok(body.includes('proxy_requests_total{route="/api/import",status="200"} 1'), body);
  assert.ok(!body.includes('proxy_requests_total{route="/api/ping"'), 'non-proxy routes not in proxy counter');
});

test('unmatched URLs collapse into one label instead of exploding cardinality', async (t) => {
  const { app } = await metricsApp();
  t.after(() => app.close());

  await app.inject({ method: 'GET', url: '/no/such/route-1' });
  await app.inject({ method: 'GET', url: '/no/such/route-2' });
  const body = (await app.inject('/metrics')).body;
  assert.ok(body.includes('http_requests_total{route="unrouted",method="GET",status="404"} 2'), body);
  assert.ok(!body.includes('route-1'), 'raw 404 URLs never become label values');
});

test('gauges are sampled at scrape time', async (t) => {
  const { app, registry } = await metricsApp();
  t.after(() => app.close());

  let connections = 0;
  registry.gauge('ws_connections_current', 'Open WebSocket connections.', () => connections);
  registry.gauge('engine_processes_current', 'Live engine processes.', () => {
    throw new Error('collector broke');
  });

  connections = 3;
  const body = (await app.inject('/metrics')).body;
  assert.ok(body.includes('# TYPE ws_connections_current gauge'), body);
  assert.ok(body.includes('ws_connections_current 3'), body);
  assert.ok(body.includes('engine_processes_current 0'), 'a throwing collector degrades to 0, not a 500');
});

test('CHESSER_METRICS_TOKEN guards the endpoint with a bearer token', async (t) => {
  const { app } = await metricsApp({ token: 'scrape-secret' });
  t.after(() => app.close());

  assert.equal((await app.inject('/metrics')).statusCode, 401);
  assert.equal(
    (await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer wrong' } })).statusCode,
    401,
  );
  const ok = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer scrape-secret' } });
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.body.includes('http_requests_total'));
});

test('label values are escaped in the exposition format', () => {
  const registry = new MetricsRegistry();
  const c = registry.counter('weird_total', 'Escaping.', ['what']);
  c.inc({ what: 'a"b\\c\nd' });
  assert.ok(registry.render().includes('weird_total{what="a\\"b\\\\c\\nd"} 1'));
});

test('duplicate or invalid metric names are rejected', () => {
  const registry = new MetricsRegistry();
  registry.counter('ok_total', 'x');
  assert.throws(() => registry.counter('ok_total', 'again'));
  assert.throws(() => registry.gauge('bad name', 'x', () => 0));
});
