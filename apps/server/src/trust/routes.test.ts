import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Stores persist to CHESSER_DATA_DIR at module load, so point them at a
// throwaway directory BEFORE importing the routes (which import them).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chesser-trust-test-'));
process.env.CHESSER_DATA_DIR = dataDir;

const { registerAccountRoutes } = await import('../accounts/routes.js');
const { registerSocialRoutes } = await import('../social/routes.js');
const { registerTrustRoutes } = await import('./routes.js');
const { trustStore } = await import('./store.js');
const { socialStore } = await import('../social/store.js');
const { store } = await import('../accounts/store.js');
const { setClock } = await import('../social/clock.js');
const Fastify = (await import('fastify')).default;

const app = Fastify();
registerAccountRoutes(app);
registerSocialRoutes(app);
registerTrustRoutes(app);
await app.ready();

// Injectable clock (social/clock.ts) — lets the report rate-limit tests jump
// time instead of sleeping.
let nowMs = Date.now();
setClock(() => nowMs);

after(async () => {
  await app.close();
  await socialStore.flush().catch(() => {});
  await trustStore.flush().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function register(username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'hunter22' } });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { token: string }).token;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function enablePublicProfile(token: string): Promise<void> {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/social/prefs',
    headers: auth(token),
    payload: { prefs: { profile: true } },
  });
  assert.equal(res.statusCode, 200, res.body);
}

describe('display-name moderation at registration', () => {
  it('accepts ordinary names', async () => {
    for (const name of ['magnus-fan', 'Elo_Hero99', 'modern-times']) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: name, password: 'hunter22' } });
      assert.equal(res.statusCode, 200, `expected "${name}" to register: ${res.body}`);
    }
  });

  it('rejects impersonation and profanity with the moderation reason', async () => {
    for (const [name, re] of [
      ['admin', /reserved/i],
      ['chesser-staff', /reserved/i],
      ['m0derator', /reserved/i],
      ['sh1thead', /not allowed/i],
    ] as const) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: name, password: 'hunter22' } });
      assert.equal(res.statusCode, 400, `expected "${name}" to be rejected`);
      assert.match((res.json() as { error: string }).error, re);
    }
  });
});

describe('GET /api/account/export', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/account/export' });
    assert.equal(res.statusCode, 401);
  });

  it('returns everything stored for the account', async () => {
    const token = await register('export-emma');
    // Store some progress + a saved game so the export has real content.
    const put = await app.inject({
      method: 'PUT',
      url: '/api/progress',
      headers: auth(token),
      payload: { data: { lessons: { done: ['basics-1'] } } },
    });
    assert.equal(put.statusCode, 200, put.body);
    const game = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(token),
      payload: { pgn: '1. e4 e5 *', white: 'export-emma', black: 'bot', result: '*' },
    });
    assert.equal(game.statusCode, 200, game.body);
    await enablePublicProfile(token);

    const res = await app.inject({ method: 'GET', url: '/api/account/export', headers: auth(token) });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as {
      account: { username: string; createdAt: string };
      progress: { data: { lessons: { done: string[] } } };
      savedGames: { pgn: string }[];
      social: { sharePrefs: { profile: boolean } };
      friends: { friends: unknown[] };
      reportsFiled: unknown[];
    };
    assert.equal(body.account.username, 'export-emma');
    assert.ok(Date.parse(body.account.createdAt) > 0);
    // The export serves the server's stored copy byte-for-byte — i.e. the
    // progress blob AS VALIDATED/normalized by PUT /api/progress.
    const stored = await app.inject({ method: 'GET', url: '/api/progress', headers: auth(token) });
    assert.deepEqual(body.progress.data, (stored.json() as { data: unknown }).data);
    assert.ok(body.progress.data && typeof body.progress.data === 'object' && 'lessons' in (body.progress.data as object));
    assert.equal(body.savedGames.length, 1);
    assert.equal(body.savedGames[0]!.pgn, '1. e4 e5 *');
    assert.equal(body.social.sharePrefs.profile, true);
    assert.deepEqual(body.friends.friends, []);
    assert.deepEqual(body.reportsFiled, []);
  });

  it('survives a legacy friendship edge with a missing date (since: null)', async () => {
    const token = await register('export-legacy');
    await register('export-legacy-pal');
    const uid = store.getUser('export-legacy')!.id;
    const pal = store.getUser('export-legacy-pal')!.id;
    // An edge as an old social.json (predating `since`) could hold it — the
    // export must not crash on it, and must not invent a date.
    socialStore.updateGraph((g) => g.edges.push({ a: uid, b: pal, since: undefined as unknown as number }));

    const res = await app.inject({ method: 'GET', url: '/api/account/export', headers: auth(token) });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { friends: { friends: { username: string; since: string | null }[] } };
    assert.deepEqual(body.friends.friends, [{ username: 'export-legacy-pal', since: null }]);
  });
});

describe('DELETE /api/account', () => {
  it('requires authentication and the exact confirmation string', async () => {
    const anon = await app.inject({ method: 'DELETE', url: '/api/account', payload: { confirm: 'DELETE' } });
    assert.equal(anon.statusCode, 401);

    const token = await register('delete-hesitant');
    const wrong = await app.inject({ method: 'DELETE', url: '/api/account', headers: auth(token), payload: { confirm: 'delete' } });
    assert.equal(wrong.statusCode, 400);
    // Account still works.
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    assert.equal(me.statusCode, 200);
  });

  it('erases the account and every trace of its data', async () => {
    const token = await register('delete-diana');
    await app.inject({
      method: 'PUT',
      url: '/api/progress',
      headers: auth(token),
      payload: { data: { lessons: { done: ['basics-1'] } } },
    });
    await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(token),
      payload: { pgn: '1. d4 d5 *', white: 'delete-diana', black: 'bot', result: '*' },
    });
    await enablePublicProfile(token);
    // Public profile is live before deletion.
    const before = await app.inject({ method: 'GET', url: '/api/social/profile/delete-diana' });
    assert.equal(before.statusCode, 200);

    const res = await app.inject({ method: 'DELETE', url: '/api/account', headers: auth(token), payload: { confirm: 'DELETE' } });
    assert.equal(res.statusCode, 200, res.body);

    // The session is dead...
    assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/progress', headers: auth(token) })).statusCode, 401);
    // ...the credentials no longer exist...
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'delete-diana', password: 'hunter22' },
    });
    assert.equal(login.statusCode, 401);
    // ...the public profile is gone...
    assert.equal((await app.inject({ method: 'GET', url: '/api/social/profile/delete-diana' })).statusCode, 404);
    // ...and re-registering the name yields a FRESH account with no old data.
    const token2 = await register('delete-diana');
    const prog = await app.inject({ method: 'GET', url: '/api/progress', headers: auth(token2) });
    assert.equal((prog.json() as { data: unknown }).data, null);
    const games = await app.inject({ method: 'GET', url: '/api/games', headers: auth(token2) });
    assert.deepEqual((games.json() as { games: unknown[] }).games, []);
  });
});

describe('POST /api/report', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/report', payload: { username: 'whoever', reason: 'other' } });
    assert.equal(res.statusCode, 401);
  });

  it('records a report with reporter, target, reason and timestamp', async () => {
    const targetToken = await register('report-target');
    await enablePublicProfile(targetToken);
    const reporter = await register('report-filer');

    nowMs += 60_000;
    const res = await app.inject({
      method: 'POST',
      url: '/api/report',
      headers: auth(reporter),
      payload: { username: 'report-target', reason: 'inappropriate-name', details: 'Name is offensive in my language.' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((res.json() as { ok: boolean }).ok, true);

    const recs = trustStore.allReports().filter((r) => r.targetUsername === 'report-target');
    assert.equal(recs.length, 1);
    const rec = recs[0]!;
    assert.equal(rec.reason, 'inappropriate-name');
    assert.equal(rec.details, 'Name is offensive in my language.');
    assert.equal(rec.at, nowMs);
    assert.ok(rec.reporterId);
    assert.ok(rec.targetId);
    assert.notEqual(rec.reporterId, rec.targetId);
  });

  it('dedupes repeat reports and rate-limits distinct ones', async () => {
    const reporter = await register('report-eager');
    const t1 = await register('report-victim-1');
    await enablePublicProfile(t1);
    const t2 = await register('report-victim-2');
    await enablePublicProfile(t2);

    nowMs += 60_000;
    const first = await app.inject({
      method: 'POST',
      url: '/api/report',
      headers: auth(reporter),
      payload: { username: 'report-victim-1', reason: 'harassment' },
    });
    assert.equal(first.statusCode, 200, first.body);

    // Same target again inside the dedupe window → idempotent no-op.
    const dupe = await app.inject({
      method: 'POST',
      url: '/api/report',
      headers: auth(reporter),
      payload: { username: 'report-victim-1', reason: 'harassment' },
    });
    assert.equal(dupe.statusCode, 200);
    assert.equal((dupe.json() as { duplicate?: boolean }).duplicate, true);
    assert.equal(trustStore.allReports().filter((r) => r.targetUsername === 'report-victim-1').length, 1);

    // A different target too soon → rate limited; fine after the interval.
    const rushed = await app.inject({
      method: 'POST',
      url: '/api/report',
      headers: auth(reporter),
      payload: { username: 'report-victim-2', reason: 'cheating' },
    });
    assert.equal(rushed.statusCode, 429);
    nowMs += 31_000;
    const later = await app.inject({
      method: 'POST',
      url: '/api/report',
      headers: auth(reporter),
      payload: { username: 'report-victim-2', reason: 'cheating' },
    });
    assert.equal(later.statusCode, 200, later.body);
  });

  it('rejects bad reasons, self-reports, and non-public targets alike', async () => {
    const reporter = await register('report-rules');
    await enablePublicProfile(reporter);
    const hidden = await register('report-hidden');
    void hidden; // registered but never opted into a public profile

    nowMs += 60_000;
    const badReason = await app.inject({
      method: 'POST',
      url: '/api/report',
      headers: auth(reporter),
      payload: { username: 'report-rules', reason: 'because' },
    });
    assert.equal(badReason.statusCode, 400);

    const self = await app.inject({
      method: 'POST',
      url: '/api/report',
      headers: auth(reporter),
      payload: { username: 'report-rules', reason: 'other' },
    });
    assert.equal(self.statusCode, 400);

    // Private account and nonexistent account: the same 404, no probing.
    const priv = await app.inject({
      method: 'POST',
      url: '/api/report',
      headers: auth(reporter),
      payload: { username: 'report-hidden', reason: 'other' },
    });
    const ghost = await app.inject({
      method: 'POST',
      url: '/api/report',
      headers: auth(reporter),
      payload: { username: 'report-no-such', reason: 'other' },
    });
    assert.equal(priv.statusCode, 404);
    assert.equal(ghost.statusCode, 404);
    assert.deepEqual(priv.json(), ghost.json());
  });
});
