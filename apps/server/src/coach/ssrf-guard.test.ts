/**
 * BYOK SSRF guard tests — the address classifier, the DNS half of the guard
 * (with a stubbed resolver; no live lookups), and the route wiring: a public
 * hostname resolving to a private address must never reach fetch().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CoachWeeklyReportFacts } from '@chesser/shared';
import { BYOK_BASE_URL_HEADER, BYOK_KEY_HEADER, BYOK_PROVIDER_HEADER, registerCoachRoutes } from './routes.js';
import { byokBaseUrlDnsError, isForbiddenIpAddress, type DnsLookupFn } from './provider.js';

// ---------------------------------------------------------------------------
// isForbiddenIpAddress
// ---------------------------------------------------------------------------

test('isForbiddenIpAddress rejects every non-public range', () => {
  const forbidden = [
    '127.0.0.1', // loopback
    '127.255.255.254',
    '10.0.0.1', // private
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // link-local / cloud metadata
    '0.0.0.0',
    '100.64.0.1', // CGNAT
    '100.127.255.255',
    '192.0.0.170', // IETF special-purpose
    '198.18.0.1', // benchmarking
    '224.0.0.1', // multicast
    '255.255.255.255',
    '::1', // v6 loopback
    '::',
    'fe80::1', // v6 link-local
    'fc00::1', // v6 unique-local
    'fd12:3456:789a::1',
    '::ffff:127.0.0.1', // v4-mapped loopback
    '::ffff:10.0.0.5', // v4-mapped private
    '::ffff:169.254.169.254',
    'not-an-ip', // fail closed
    '',
  ];
  for (const ip of forbidden) {
    assert.equal(isForbiddenIpAddress(ip), true, `${JSON.stringify(ip)} must be forbidden`);
  }
});

test('isForbiddenIpAddress allows public unicast addresses', () => {
  const allowed = [
    '93.184.216.34',
    '8.8.8.8',
    '104.18.2.115',
    '100.63.255.255', // just below CGNAT
    '100.128.0.1', // just above CGNAT
    '172.15.255.255', // just below 172.16/12
    '172.32.0.1', // just above 172.16/12
    '2606:4700::1111', // v6 global unicast
    '2a00:1450:4001:829::200e',
    '::ffff:8.8.8.8', // v4-mapped public
  ];
  for (const ip of allowed) {
    assert.equal(isForbiddenIpAddress(ip), false, `${ip} must be allowed`);
  }
});

// ---------------------------------------------------------------------------
// byokBaseUrlDnsError (stubbed resolver)
// ---------------------------------------------------------------------------

const resolveTo =
  (...addresses: string[]): DnsLookupFn =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

test('a public hostname resolving to loopback/private/link-local is refused', async () => {
  const url = 'https://rebind.example.com/v1';
  for (const bad of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '169.254.169.254', '::1', 'fd00::1']) {
    assert.equal(await byokBaseUrlDnsError(url, resolveTo(bad)), 'Base URL host is not allowed.', bad);
  }
});

test('ANY private record among the answers poisons the whole set', async () => {
  const err = await byokBaseUrlDnsError('https://mixed.example.com/v1', resolveTo('93.184.216.34', '10.0.0.1'));
  assert.equal(err, 'Base URL host is not allowed.');
});

test('a hostname resolving only to public addresses passes', async () => {
  assert.equal(await byokBaseUrlDnsError('https://llm.example.com/v1', resolveTo('93.184.216.34')), null);
  assert.equal(await byokBaseUrlDnsError('https://llm6.example.com/v1', resolveTo('2606:4700::1111')), null);
});

test('unresolvable or empty DNS answers fail closed', async () => {
  const failing: DnsLookupFn = async () => {
    throw new Error('ENOTFOUND');
  };
  assert.equal(await byokBaseUrlDnsError('https://nope.example.com/v1', failing), 'Base URL host could not be resolved.');
  assert.equal(await byokBaseUrlDnsError('https://empty.example.com/v1', resolveTo()), 'Base URL host could not be resolved.');
});

test('literal addresses never hit DNS: public passes, private is stopped by the syntax check', async () => {
  let lookups = 0;
  const counting: DnsLookupFn = async () => {
    lookups += 1;
    return [{ address: '93.184.216.34', family: 4 }];
  };
  assert.equal(await byokBaseUrlDnsError('https://93.184.216.34/v1', counting), null);
  assert.equal(await byokBaseUrlDnsError('https://[2606:4700::1111]/v1', counting), null);
  assert.equal(await byokBaseUrlDnsError('https://127.0.0.1/v1', counting), 'Base URL host is not allowed.');
  assert.equal(await byokBaseUrlDnsError('https://[::1]/v1', counting), 'Base URL host is not allowed.');
  assert.equal(lookups, 0, 'no DNS lookups for literals');
});

// ---------------------------------------------------------------------------
// Route wiring — the guard runs before any upstream fetch
// ---------------------------------------------------------------------------

function weeklyFacts(): CoachWeeklyReportFacts {
  return {
    kind: 'weekly_report',
    weekLabel: 'Jul 6 – Jul 12',
    activeDays: 5,
    xpEarned: 320,
    streak: 9,
    gamesPlayed: 4,
    wins: 2,
    losses: 1,
    draws: 1,
    bestAccuracy: 91.2,
    lessonsCompleted: 2,
    lessonStars: 5,
    puzzleRatingDelta: 42,
    newRushBest: 18,
    newStormBest: null,
    trainingAttempts: 10,
    trainingSolved: 7,
    topWeakness: 'Hanging pieces',
    topWeaknessCount: 3,
    ruleBasedText: 'You trained on 5 of 7 days this week, earning 320 XP.',
  };
}

async function makeApp(dnsLookup: DnsLookupFn): Promise<FastifyInstance> {
  const app = Fastify();
  registerCoachRoutes(app, { provider: null, dnsLookup });
  await app.ready();
  return app;
}

function postByok(app: FastifyInstance, baseUrl: string) {
  return app.inject({
    method: 'POST',
    url: '/api/coach/explain',
    payload: { facts: weeklyFacts() },
    headers: {
      [BYOK_KEY_HEADER]: 'sk-test-users-own-key-000000000000',
      [BYOK_PROVIDER_HEADER]: 'openai',
      [BYOK_BASE_URL_HEADER]: baseUrl,
    },
  });
}

test('explain refuses a base URL whose hostname resolves privately — and never fetches', async (t) => {
  const app = await makeApp(resolveTo('127.0.0.1'));
  t.after(() => app.close());

  let fetched = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetched += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  const res = await postByok(app, 'https://rebind.example.com/v1');
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'Base URL host is not allowed.');
  assert.equal(fetched, 0, 'upstream fetch never happened');
});

test('explain lets a publicly-resolving base URL through to the provider', async (t) => {
  const app = await makeApp(resolveTo('93.184.216.34'));
  t.after(() => app.close());

  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'ok.' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  const res = await postByok(app, 'https://llm.example.com/v1');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().explanation, 'ok.');
});
