/**
 * Logging tests — redaction (the serialized line must never carry secrets),
 * request-id minting/threading, and the request-log serializer shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { buildLoggerOptions, genReqId, registerRequestIdHeader, REDACT_PATHS } from './logging.js';

function captureLogger() {
  const lines: string[] = [];
  const logger = pino(buildLoggerOptions({ pretty: false }), {
    write: (s: string) => {
      lines.push(s);
    },
  });
  return { logger, lines };
}

test('redaction: authorization header, password and api keys never reach the serialized line', () => {
  const { logger, lines } = captureLogger();
  logger.info(
    {
      authorization: 'Bearer top-level-bearer-9f3a',
      password: 'hunter2-plaintext',
      token: 'tok-4242',
      apiKey: 'sk-ant-fake-byok-key',
      api_key: 'sk-openai-fake-key',
      secret: 'shhh-1',
      headers: {
        authorization: 'Bearer nested-bearer-77',
        cookie: 'session=abc123',
        'x-api-key': 'header-api-key-1',
        'x-coach-key': 'byok-coach-key-1',
      },
      body: { password: 'body-password-x', token: 'body-token-y' },
      user: { creds: { password: 'two-levels-deep-pass' } },
    },
    'login attempt',
  );
  const line = lines.join('');
  const secrets = [
    'top-level-bearer-9f3a',
    'hunter2-plaintext',
    'tok-4242',
    'sk-ant-fake-byok-key',
    'sk-openai-fake-key',
    'shhh-1',
    'nested-bearer-77',
    'session=abc123',
    'header-api-key-1',
    'byok-coach-key-1',
    'body-password-x',
    'body-token-y',
    'two-levels-deep-pass',
  ];
  for (const secret of secrets) assert.ok(!line.includes(secret), `secret leaked into log line: ${secret}`);
  assert.ok(line.includes('[Redacted]'), 'censor marker present');
  assert.ok(line.includes('login attempt'), 'message survives redaction');
});

test('redaction: whole request bodies are censored (they can carry user PII)', () => {
  const { logger, lines } = captureLogger();
  logger.info({ req: { method: 'PUT', body: { favoriteFood: 'private-fact' } } }, 'x');
  assert.ok(!lines.join('').includes('private-fact'));
});

test('REDACT_PATHS covers the BYOK and auth header names', () => {
  for (const needle of ['x-coach-key', 'x-api-key', 'authorization', 'password', 'api_key']) {
    assert.ok(
      REDACT_PATHS.some((p) => p.includes(needle)),
      `no redact path mentions ${needle}`,
    );
  }
});

test('request logs: bearer token from a real request never appears; x-request-id is echoed', async (t) => {
  const { logger, lines } = captureLogger();
  const app = Fastify({ loggerInstance: logger as unknown as FastifyBaseLogger, genReqId });
  registerRequestIdHeader(app);
  app.get('/api/thing', async (req) => {
    // Worst case: a handler logs the whole request object.
    req.log.info({ req }, 'handler saw request');
    return { ok: true };
  });
  await app.ready();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/thing',
    headers: { authorization: 'Bearer super-secret-session-token', 'x-request-id': 'proxy-id-42' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-request-id'], 'proxy-id-42', 'well-formed incoming id is threaded through');
  const all = lines.join('');
  assert.ok(all.length > 0, 'request logging active');
  assert.ok(!all.includes('super-secret-session-token'), 'bearer token leaked into request logs');
});

test('request id: malformed/oversized incoming x-request-id is replaced with a UUID', async (t) => {
  const app = Fastify({ genReqId });
  registerRequestIdHeader(app);
  app.get('/x', async () => ({ ok: true }));
  await app.ready();
  t.after(() => app.close());

  const evil = 'a'.repeat(300) + '\n"injected"';
  const res = await app.inject({ method: 'GET', url: '/x', headers: { 'x-request-id': evil } });
  const echoed = String(res.headers['x-request-id']);
  assert.notEqual(echoed, evil);
  assert.match(echoed, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

  const missing = await app.inject({ method: 'GET', url: '/x' });
  assert.match(String(missing.headers['x-request-id']), /^[0-9a-f-]{36}$/, 'id minted when none supplied');
});
