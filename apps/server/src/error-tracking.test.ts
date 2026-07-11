/**
 * Error-tracking tests — DSN parsing, the mini Sentry reporter (delivery,
 * no-op without a DSN, self rate cap), and the app-wide error handler (5xx
 * bodies are generic while details reach the log + reporter; 4xx keep
 * Fastify's default shape).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { buildLoggerOptions } from './logging.js';
import { parseSentryDsn, registerErrorHandling, SentryReporter, type ErrorReporter } from './error-tracking.js';

// ---------------------------------------------------------------------------
// DSN parsing
// ---------------------------------------------------------------------------

test('parseSentryDsn: standard and path-prefixed DSNs', () => {
  assert.deepEqual(parseSentryDsn('https://abc123@o4507.ingest.sentry.io/4506'), {
    publicKey: 'abc123',
    endpoint: 'https://o4507.ingest.sentry.io/api/4506/store/',
  });
  // Path prefixes (self-hosted behind a subpath) stay in front of /api/.
  assert.deepEqual(parseSentryDsn('https://key@glitchtip.example.com/prefix/7'), {
    publicKey: 'key',
    endpoint: 'https://glitchtip.example.com/prefix/api/7/store/',
  });
  assert.equal(parseSentryDsn('not a dsn'), null);
  assert.equal(parseSentryDsn('ftp://key@host/1'), null);
  assert.equal(parseSentryDsn('https://host/1'), null, 'missing public key');
  assert.equal(parseSentryDsn('https://key@host/'), null, 'missing project id');
});

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

interface Sent {
  url: string;
  auth: string;
  body: {
    level: string;
    environment: string;
    exception: { values: { type: string; value: string; stacktrace?: { frames: { filename: string }[] } }[] };
    extra?: Record<string, unknown>;
  };
}

function fetchStub(sink: Sent[], status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sink.push({
      url: String(url),
      auth: String((init?.headers as Record<string, string>)['x-sentry-auth']),
      body: JSON.parse(String(init?.body)) as Sent['body'],
    });
    return { ok: status < 400, status } as Response;
  }) as typeof fetch;
}

const silentLog = { warn: () => {}, info: () => {} };

test('reporter POSTs a Sentry store event with exception + context', async () => {
  const sent: Sent[] = [];
  const reporter = new SentryReporter('https://pk@errors.example.com/9', {
    fetchFn: fetchStub(sent),
    log: silentLog,
    environment: 'test',
  });
  assert.equal(reporter.enabled, true);

  reporter.captureException(new Error('kaboom'), { requestId: 'r-1', path: '/api/x' });
  await reporter.flush();

  assert.equal(sent.length, 1);
  const [event] = sent;
  assert.equal(event!.url, 'https://errors.example.com/api/9/store/');
  assert.ok(event!.auth.includes('sentry_key=pk'), event!.auth);
  assert.equal(event!.body.level, 'error');
  assert.equal(event!.body.environment, 'test');
  const exc = event!.body.exception.values[0]!;
  assert.equal(exc.type, 'Error');
  assert.equal(exc.value, 'kaboom');
  assert.ok((exc.stacktrace?.frames.length ?? 0) > 0, 'stack frames parsed');
  assert.deepEqual(event!.body.extra, { requestId: 'r-1', path: '/api/x' });
});

test('reporter is a silent no-op without a DSN and with an invalid DSN', async () => {
  const sent: Sent[] = [];
  const off = new SentryReporter(undefined, { fetchFn: fetchStub(sent), log: silentLog });
  assert.equal(off.enabled, false);
  off.captureException(new Error('nope'));
  await off.flush();
  assert.equal(sent.length, 0);

  const warnings: unknown[] = [];
  const bad = new SentryReporter('garbage', { fetchFn: fetchStub(sent), log: { warn: (m: unknown) => warnings.push(m), info: () => {} } });
  assert.equal(bad.enabled, false);
  bad.captureException(new Error('nope'));
  await bad.flush();
  assert.equal(sent.length, 0);
  assert.equal(warnings.length, 1, 'operator warned about the bad DSN');
});

test('reporter caps its own outbound rate (error storms are dropped, not amplified)', async () => {
  const sent: Sent[] = [];
  const reporter = new SentryReporter('https://pk@h.example/1', {
    fetchFn: fetchStub(sent),
    log: silentLog,
    maxBurst: 2,
    refillPerMinute: 0,
    now: () => 0,
  });
  for (let i = 0; i < 10; i++) reporter.captureException(new Error(`storm ${i}`));
  await reporter.flush();
  assert.equal(sent.length, 2);
});

test('reporter survives a failing transport (delivery errors only warn)', async () => {
  const reporter = new SentryReporter('https://pk@h.example/1', {
    fetchFn: (async () => {
      throw new Error('network down');
    }) as typeof fetch,
    log: silentLog,
  });
  reporter.captureException(new Error('x'));
  await reporter.flush(); // must not reject
});

// ---------------------------------------------------------------------------
// Fastify error handler
// ---------------------------------------------------------------------------

function fakeReporter() {
  const captured: { err: unknown; context?: Record<string, unknown> }[] = [];
  const reporter: ErrorReporter = {
    enabled: true,
    captureException: (err, context) => {
      captured.push({ err, context });
    },
    flush: async () => {},
  };
  return { reporter, captured };
}

async function errorApp(reporter: ErrorReporter) {
  const lines: string[] = [];
  const logger = pino(buildLoggerOptions({ pretty: false }), {
    write: (s: string) => {
      lines.push(s);
    },
  }) as unknown as FastifyBaseLogger;
  const app = Fastify({ loggerInstance: logger });
  registerErrorHandling(app, { reporter });
  app.get('/api/explode', async () => {
    throw new Error('kaboom-internal-detail at /home/user/secret-path.ts');
  });
  app.get('/api/teapot', async () => {
    const e = new Error('I refuse') as Error & { statusCode: number };
    e.statusCode = 418;
    throw e;
  });
  app.post('/api/tiny', { bodyLimit: 100 }, async () => ({ ok: true }));
  await app.ready();
  return { app, lines };
}

test('unhandled route errors: 500 with a generic body, details only in the log and reporter', async (t) => {
  const { reporter, captured } = fakeReporter();
  const { app, lines } = await errorApp(reporter);
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/explode' });
  assert.equal(res.statusCode, 500);
  const body = res.json() as { statusCode: number; error: string; message: string; requestId: string };
  assert.equal(body.statusCode, 500);
  assert.equal(body.error, 'Internal Server Error');
  assert.ok(body.requestId, 'response carries the request id for correlation');
  assert.ok(!res.body.includes('kaboom-internal-detail'), 'error message leaked to the client');
  assert.ok(!res.body.includes('secret-path'), 'paths leaked to the client');
  assert.ok(!res.body.toLowerCase().includes('at object'), 'stack leaked to the client');

  const logged = lines.join('');
  assert.ok(logged.includes('kaboom-internal-detail'), 'full error message reaches the server log');
  assert.ok(logged.includes('request failed'), 'error logged at the handler');

  assert.equal(captured.length, 1);
  assert.equal((captured[0]!.err as Error).message, 'kaboom-internal-detail at /home/user/secret-path.ts');
  assert.equal(captured[0]!.context?.path, '/api/explode');
});

test('thrown 4xx errors keep the default shape and are not reported', async (t) => {
  const { reporter, captured } = fakeReporter();
  const { app } = await errorApp(reporter);
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/teapot' });
  assert.equal(res.statusCode, 418);
  const body = res.json() as { statusCode: number; message: string };
  assert.equal(body.statusCode, 418);
  assert.equal(body.message, 'I refuse', '4xx messages stay intact for clients');
  assert.equal(captured.length, 0, '4xx must not spam the error tracker');
});

test('framework 4xx (body limit) still yields its Fastify shape through the custom handler', async (t) => {
  const { reporter, captured } = fakeReporter();
  const { app } = await errorApp(reporter);
  t.after(() => app.close());

  const res = await app.inject({ method: 'POST', url: '/api/tiny', payload: { pad: 'x'.repeat(500) } });
  assert.equal(res.statusCode, 413);
  const body = res.json() as { code: string };
  assert.equal(body.code, 'FST_ERR_CTP_BODY_TOO_LARGE');
  assert.equal(captured.length, 0);
});
