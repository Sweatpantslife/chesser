import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The account store persists to CHESSER_DATA_DIR at module load, so point it
// at a throwaway directory BEFORE importing the routes (which import it).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chesser-routes-test-'));
process.env.CHESSER_DATA_DIR = dataDir;

const { registerAccountRoutes } = await import('./routes.js');
const Fastify = (await import('fastify')).default;

const app = Fastify();
registerAccountRoutes(app);
await app.ready();

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function register(username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'hunter22' } });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { token: string }).token;
}

function putProgress(token: string, data: unknown) {
  return app.inject({ method: 'PUT', url: '/api/progress', headers: { authorization: `Bearer ${token}` }, payload: { data } });
}

async function getProgress(token: string): Promise<unknown> {
  const res = await app.inject({ method: 'GET', url: '/api/progress', headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 200);
  return (res.json() as { data: unknown }).data;
}

const today = new Date().toISOString().slice(0, 10);

function honestPayload() {
  return {
    ratings: {
      legacyMigrated: true,
      categories: {
        bots: {
          elo: 1480,
          eloPeak: 1520,
          glicko: { rating: 1490, rd: 180, vol: 0.06 },
          glickoPeak: 1500,
          played: 8,
          won: 5,
          lost: 3,
          drawn: 0,
          winStreak: 2,
          bestWinStreak: 3,
          history: { [today]: { elo: 1480, glicko: 1490 } },
        },
        blitz: {
          elo: 1500,
          eloPeak: 1500,
          glicko: { rating: 1500, rd: 350, vol: 0.06 },
          glickoPeak: 1500,
          played: 0,
          won: 0,
          lost: 0,
          drawn: 0,
          winStreak: 0,
          bestWinStreak: 0,
          history: {},
        },
        puzzles: {
          elo: 1300,
          eloPeak: 1300,
          glicko: { rating: 1320, rd: 200, vol: 0.06 },
          glickoPeak: 1300,
          played: 10,
          won: 6,
          lost: 4,
          drawn: 0,
          winStreak: 2,
          bestWinStreak: 3,
          history: { [today]: { elo: 1300, glicko: 1320 } },
        },
      },
    },
    gamify: { xp: 100, days: { [today]: { xp: 100, activities: 10 } }, goalXp: 40, streak: 1, bestStreak: 1, lastGoalDay: today, goalsMet: 1 },
    streak: { count: 1, best: 1, lastDay: today, freezes: 1, milestonesAwarded: [] },
  };
}

describe('PUT /api/progress anti-cheat', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/progress', payload: { data: {} } });
    assert.equal(res.statusCode, 401);
  });

  it('accepts an honest sync and serves it back', async () => {
    const token = await register('honest-user');
    const res = await putProgress(token, honestPayload());
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((res.json() as { ok: boolean }).ok, true);
    const stored = (await getProgress(token)) as { ratings: { categories: { puzzles: { elo: number } } } };
    assert.equal(stored.ratings.categories.puzzles.elo, 1300);
  });

  it('rejects an impossible rating jump and keeps the stored copy intact', async () => {
    const token = await register('rating-cheat');
    assert.equal((await putProgress(token, honestPayload())).statusCode, 200);

    const cheat = honestPayload();
    cheat.ratings.categories.puzzles.played = 11; // one new game...
    cheat.ratings.categories.puzzles.won = 7;
    cheat.ratings.categories.puzzles.elo = 2210; // ...+910 Elo
    cheat.ratings.categories.puzzles.eloPeak = 2210;
    const res = await putProgress(token, cheat);
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /rating jump/i);

    const stored = (await getProgress(token)) as { ratings: { categories: { puzzles: { elo: number } } } };
    assert.equal(stored.ratings.categories.puzzles.elo, 1300);
  });

  it('rejects absurd XP claims', async () => {
    const token = await register('xp-cheat');
    const cheat = honestPayload();
    cheat.gamify.xp = 999_999_999;
    const res = await putProgress(token, cheat);
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /implausibly large/i);
  });

  it('clamps normalizable values and reports the adjustments', async () => {
    const token = await register('freeze-hoarder');
    const payload = honestPayload();
    payload.streak.freezes = 50;
    const res = await putProgress(token, payload);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { adjusted?: string[] };
    assert.ok(body.adjusted?.some((a) => a.includes('freezes')));
    const stored = (await getProgress(token)) as { streak: { freezes: number } };
    assert.equal(stored.streak.freezes, 2);
  });

  it('drops fabricated achievements but accepts the rest of the sync', async () => {
    const token = await register('badge-forger');
    const payload = honestPayload() as ReturnType<typeof honestPayload> & { achievements: { unlocked: Record<string, number> } };
    payload.achievements = { unlocked: { 'tactics-solve-1000': Date.now(), 'play-winstreak-3': Date.now() } };
    const res = await putProgress(token, payload);
    assert.equal(res.statusCode, 200, res.body);
    const stored = (await getProgress(token)) as { achievements: { unlocked: Record<string, number> } };
    assert.ok(!('tactics-solve-1000' in stored.achievements.unlocked)); // 6 solved < 1000
    assert.ok('play-winstreak-3' in stored.achievements.unlocked); // bestWinStreak 3 backs it
  });
});
