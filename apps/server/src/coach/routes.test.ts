import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CoachMoveFacts, CoachWeaknessFacts } from '@chesser/shared';
import { registerCoachRoutes, validateExplainBody, LruCache, stableStringify, type CoachRouteOptions } from './routes.js';
import type { CoachCompletionInput, CoachProvider } from './provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A provider stub that records calls and returns canned prose. */
function fakeProvider(reply = 'Nice try — Nf3 was the move.'): CoachProvider & { calls: CoachCompletionInput[] } {
  const calls: CoachCompletionInput[] = [];
  return {
    id: 'anthropic',
    model: 'fake-model-1',
    calls,
    async complete(input) {
      calls.push(input);
      return reply;
    },
  };
}

async function makeApp(opts: CoachRouteOptions): Promise<FastifyInstance> {
  const app = Fastify();
  registerCoachRoutes(app, opts);
  await app.ready();
  return app;
}

function moveFacts(overrides: Partial<CoachMoveFacts> = {}): CoachMoveFacts {
  return {
    kind: 'move',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    side: 'white',
    moveLabel: '14.',
    san: 'Qxb7',
    classification: 'blunder',
    evalBefore: '+1.20',
    evalAfter: '-2.35',
    winBefore: 62.1,
    winAfter: 21.4,
    bestMoveSan: 'Nf3',
    pv: ['Nf3', 'Nc6', 'd4'],
    bestReplySan: 'Rb8',
    phase: 'middlegame',
    isCheck: false,
    isMate: false,
    ruleBasedText: 'Blunder — it swings the game to losing. Nf3 was needed.',
    weaknessThemes: ['Hanging pieces'],
    ...overrides,
  };
}

function post(app: FastifyInstance, payload: unknown, ip = '10.0.0.1') {
  return app.inject({
    method: 'POST',
    url: '/api/coach/explain',
    payload: payload as Record<string, unknown>,
    remoteAddress: ip,
  });
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('happy path: returns the provider explanation and grounds the prompt in the facts', async (t) => {
  const provider = fakeProvider();
  const app = await makeApp({ provider });
  t.after(() => app.close());

  const res = await post(app, { facts: moveFacts(), level: 'beginner' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(body, {
    configured: true,
    explanation: 'Nice try — Nf3 was the move.',
    model: 'fake-model-1',
    cached: false,
  });

  assert.equal(provider.calls.length, 1);
  const call = provider.calls[0]!;
  // The facts payload travels as JSON in the user message …
  assert.ok(call.user.includes('"Qxb7"'), 'user prompt carries the played move');
  assert.ok(call.user.includes('"blunder"'), 'user prompt carries the classification');
  // … the system prompt pins the model to facts-only + the level voice …
  assert.ok(/only the provided facts/i.test(call.system));
  assert.ok(/beginner/i.test(call.system));
  // … and output is capped.
  assert.ok(call.maxTokens <= 300);
});

test('game_summary and weakness kinds validate and reach the provider', async (t) => {
  const provider = fakeProvider('Well played overall.');
  const app = await makeApp({ provider });
  t.after(() => app.close());

  const summary = {
    kind: 'game_summary',
    playerColor: 'white',
    result: 'win',
    accuracy: 91.2,
    acpl: 18,
    moves: 34,
    counts: { blunder: 0, mistake: 1, best: 20 },
    opening: { eco: 'B20', name: 'Sicilian Defense' },
    phases: [{ phase: 'opening', accuracy: 95.1 }],
    keyMoments: ['14. Qxb7?? threw away a winning position'],
    estimatedRating: 1620,
  };
  const res1 = await post(app, { facts: summary });
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.json().configured, true);

  const weakness: CoachWeaknessFacts = {
    kind: 'weakness',
    label: 'Hanging pieces',
    summary: 'Moves that left a piece where it could simply be captured.',
    advice: 'Before you commit to a move, scan what your opponent can take.',
    count: 5,
    games: 3,
    totalGames: 12,
    trend: 'improving',
    examples: ['14. Qxb7 in your Sicilian Defense game gave away 40% of your winning chances.'],
    accuracy: 84.2,
    worstPhase: 'middlegame',
  };
  const res2 = await post(app, { facts: weakness });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.json().configured, true);
  assert.equal(provider.calls.length, 2);
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

test('cache: identical facts+level hit the cache and skip the provider', async (t) => {
  const provider = fakeProvider();
  const app = await makeApp({ provider });
  t.after(() => app.close());

  const first = await post(app, { facts: moveFacts(), level: 'intermediate' });
  assert.equal(first.json().cached, false);
  const second = await post(app, { facts: moveFacts(), level: 'intermediate' });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().cached, true);
  assert.equal(second.json().explanation, first.json().explanation);
  assert.equal(provider.calls.length, 1, 'provider called once for two identical requests');

  // A different level is a different cache entry.
  await post(app, { facts: moveFacts(), level: 'advanced' });
  assert.equal(provider.calls.length, 2);
});

test('cache: entries expire after the TTL', async (t) => {
  let clock = 1_000_000;
  const provider = fakeProvider();
  const app = await makeApp({ provider, cacheTtlMs: 60_000, now: () => clock });
  t.after(() => app.close());

  await post(app, { facts: moveFacts() });
  clock += 61_000;
  const res = await post(app, { facts: moveFacts() });
  assert.equal(res.json().cached, false);
  assert.equal(provider.calls.length, 2);
});

test('LruCache evicts least-recently-used beyond max and stableStringify ignores key order', () => {
  const cache = new LruCache(2, 60_000, () => 0);
  cache.set('a', '1');
  cache.set('b', '2');
  assert.equal(cache.get('a'), '1'); // refresh 'a'
  cache.set('c', '3'); // evicts 'b'
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), '1');
  assert.equal(cache.get('c'), '3');

  assert.equal(stableStringify({ x: 1, y: [{ b: 2, a: 3 }] }), stableStringify({ y: [{ a: 3, b: 2 }], x: 1 }));
});

// ---------------------------------------------------------------------------
// Not configured (no key)
// ---------------------------------------------------------------------------

test('no key configured: 200 with { configured: false, reason: "no-key" }', async (t) => {
  const app = await makeApp({ provider: null });
  t.after(() => app.close());

  const res = await post(app, { facts: moveFacts() });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { configured: false, reason: 'no-key' });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('invalid bodies are rejected with 400 and never reach the provider', async (t) => {
  const provider = fakeProvider();
  const app = await makeApp({ provider });
  t.after(() => app.close());

  const bad: unknown[] = [
    {},
    { facts: null },
    { facts: { kind: 'nonsense' } },
    { facts: { ...moveFacts(), san: '' } },
    { facts: { ...moveFacts(), winBefore: 'high' } },
    { facts: moveFacts(), level: 'grandmaster' },
    { facts: { kind: 'weakness', label: 'x' } }, // missing required weakness fields
    { facts: { ...moveFacts(), ruleBasedText: 'x'.repeat(10_000) } }, // oversized payload
  ];
  for (const payload of bad) {
    const res = await post(app, payload);
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(payload).slice(0, 80)}`);
    assert.ok(res.json().error, 'error message present');
  }
  assert.equal(provider.calls.length, 0);

  // validateExplainBody is also usable directly.
  assert.equal(validateExplainBody({ facts: moveFacts() }), null);
  assert.ok(validateExplainBody('nope'));
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

test('rate limit: per-IP token bucket returns 429 once the bucket is empty, refills over time', async (t) => {
  let clock = 5_000_000;
  const provider = fakeProvider();
  const app = await makeApp({ provider, rateCapacity: 2, rateRefillPerMinute: 2, now: () => clock });
  t.after(() => app.close());

  // Distinct facts each time so the cache doesn't absorb the calls.
  assert.equal((await post(app, { facts: moveFacts({ san: 'a3' }) })).statusCode, 200);
  assert.equal((await post(app, { facts: moveFacts({ san: 'a4' }) })).statusCode, 200);
  const limited = await post(app, { facts: moveFacts({ san: 'b3' }) });
  assert.equal(limited.statusCode, 429);
  assert.ok(limited.json().error);

  // A different IP has its own bucket.
  assert.equal((await post(app, { facts: moveFacts({ san: 'b4' }) }, '10.0.0.2')).statusCode, 200);

  // Half a minute refills one token (2/min).
  clock += 30_000;
  assert.equal((await post(app, { facts: moveFacts({ san: 'c3' }) })).statusCode, 200);
  assert.equal((await post(app, { facts: moveFacts({ san: 'c4' }) })).statusCode, 429);
});

// ---------------------------------------------------------------------------
// Provider failure
// ---------------------------------------------------------------------------

test('provider failure maps to 502 and is not cached', async (t) => {
  let fail = true;
  const provider: CoachProvider = {
    id: 'openai',
    model: 'fake',
    async complete() {
      if (fail) throw new Error('boom');
      return 'Recovered.';
    },
  };
  const app = await makeApp({ provider });
  t.after(() => app.close());

  const res = await post(app, { facts: moveFacts() });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, 'provider-failed');

  fail = false;
  const retry = await post(app, { facts: moveFacts() });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().explanation, 'Recovered.');
  assert.equal(retry.json().cached, false, 'the failure was not cached');
});
