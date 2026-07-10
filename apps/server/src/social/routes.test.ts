import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Both stores persist to CHESSER_DATA_DIR at module load, so point them at a
// throwaway directory BEFORE importing the routes (which import them).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chesser-social-test-'));
process.env.CHESSER_DATA_DIR = dataDir;

const { registerAccountRoutes } = await import('../accounts/routes.js');
const { registerSocialRoutes } = await import('./routes.js');
const { socialStore } = await import('./store.js');
const { setClock } = await import('./clock.js');
const { isoWeekKey } = await import('./week.js');
const Fastify = (await import('fastify')).default;

const app = Fastify();
registerAccountRoutes(app);
registerSocialRoutes(app);
await app.ready();

// Injected clock: anchored to the real now (so account/progress validation —
// which uses the real clock — agrees on "today"), advanced manually by tests.
let t = Date.now();
setClock(() => t);

after(async () => {
  setClock(null);
  await app.close();
  // Let the store's queued async writes land BEFORE deleting the data dir —
  // a straggler would otherwise re-create it via mkdir and leak tmp dirs.
  await socialStore.flush();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
afterEach(() => {
  t = Date.now();
});

// --- helpers ----------------------------------------------------------------

async function register(username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'hunter22' } });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { token: string }).token;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const today = new Date().toISOString().slice(0, 10);
const dayKey = (offsetDays: number, from = Date.now()) => new Date(from - offsetDays * 86_400_000).toISOString().slice(0, 10);

/** Nine consecutive active day logs ending on `lastMs`'s UTC day. */
function activeDays(lastMs = Date.now()): Record<string, { xp: number; activities: number }> {
  const days: Record<string, { xp: number; activities: number }> = {};
  for (let i = 8; i >= 0; i--) days[dayKey(i, lastMs)] = { xp: 100, activities: 10 };
  return days;
}

/** A blob the PR #27 progress validator accepts (mirrors accounts/routes.test.ts). */
function progressBlob(over: { puzzlesElo?: number; puzzlesPlayed?: number } = {}) {
  const elo = over.puzzlesElo ?? 1300;
  const played = over.puzzlesPlayed ?? 15;
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
          elo,
          eloPeak: Math.max(elo, 1300),
          glicko: { rating: elo, rd: 200, vol: 0.06 },
          glickoPeak: 1300,
          played,
          won: Math.min(10 + Math.max(0, played - 15), played),
          lost: Math.max(0, played - (10 + Math.max(0, played - 15))),
          drawn: 0,
          winStreak: 2,
          bestWinStreak: 3,
          history: { [today]: { elo, glicko: elo } },
        },
      },
    },
    gamify: { xp: 900, days: activeDays(), goalXp: 40, streak: 1, bestStreak: 1, lastGoalDay: today, goalsMet: 9 },
    streak: { count: 5, best: 9, lastDay: today, freezes: 1, milestonesAwarded: [3] },
    achievements: { unlocked: { 'play-winstreak-3': Date.now() - 5_000, 'tactics-solve-10': Date.now() - 1_000 } },
  };
}

async function putProgress(token: string, data: unknown = progressBlob()) {
  const res = await app.inject({ method: 'PUT', url: '/api/progress', headers: auth(token), payload: { data } });
  assert.equal(res.statusCode, 200, res.body);
}

async function optIn(token: string, prefs: Record<string, boolean> = { leaderboards: true }) {
  const res = await app.inject({ method: 'PUT', url: '/api/social/prefs', headers: auth(token), payload: { prefs } });
  assert.equal(res.statusCode, 200, res.body);
}

function submit(token: string, board: string, value: number) {
  return app.inject({ method: 'POST', url: '/api/leaderboard/submit', headers: auth(token), payload: { board, value } });
}

async function board(boardId: string, q = '', token?: string) {
  const res = await app.inject({ method: 'GET', url: `/api/leaderboard/${boardId}${q}`, headers: token ? auth(token) : {} });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as {
    board: string;
    scope: string;
    weekKey: string;
    total: number;
    entries: { rank: number; username: string; value: number; played?: number }[];
    me: { optedIn: boolean; rank: number | null; value: number | null } | null;
  };
}

// --- tests --------------------------------------------------------------------

describe('leaderboard submit', () => {
  it('requires auth and a known board', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/leaderboard/submit', payload: { board: 'puzzles', value: 1300 } });
    assert.equal(anon.statusCode, 401);
    const token = await register('lb-badboard');
    const bad = await submit(token, 'blunders', 12);
    assert.equal(bad.statusCode, 400);
  });

  it('is opt-in: submissions are refused until leaderboards are enabled', async () => {
    const token = await register('lb-optout');
    await putProgress(token);
    const res = await submit(token, 'puzzles', 1300);
    assert.equal(res.statusCode, 403);
    assert.match((res.json() as { error: string }).error, /opt-in/i);
  });

  it('accepts an honest rating and ranks it (server value, not the claim)', async () => {
    const token = await register('lb-honest');
    await putProgress(token);
    await optIn(token);
    const res = await submit(token, 'puzzles', 1300);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((res.json() as { changed: boolean }).changed, true);

    const b = await board('puzzles', '', token);
    const mine = b.entries.find((e) => e.username === 'lb-honest');
    assert.ok(mine, 'ranked entry exists');
    assert.equal(mine.value, 1300);
    assert.equal(mine.played, 15);
    assert.equal(b.me?.rank, mine.rank);
  });

  it('rejects an inflated rating claim that does not match the synced blob', async () => {
    const token = await register('lb-inflated');
    await putProgress(token);
    await optIn(token);
    const res = await submit(token, 'puzzles', 1600);
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /doesn't match your synced rating/i);
    const b = await board('puzzles');
    assert.ok(!b.entries.some((e) => e.username === 'lb-inflated'));
  });

  it('rejects out-of-bounds scores', async () => {
    const token = await register('lb-bounds');
    await putProgress(token);
    await optIn(token);
    assert.equal((await submit(token, 'puzzles', 9000)).statusCode, 400);
    assert.equal((await submit(token, 'rush', 500)).statusCode, 400);
    assert.equal((await submit(token, 'rush', -3)).statusCode, 400);
  });

  it('rejects rating submissions with no synced progress behind them', async () => {
    const token = await register('lb-nosync');
    await optIn(token);
    const res = await submit(token, 'puzzles', 1300);
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /synced rating/i);
  });

  it('treats duplicate submissions as no-ops (one entry, unchanged)', async () => {
    const token = await register('lb-dupe');
    await putProgress(token);
    await optIn(token);
    assert.equal((await submit(token, 'puzzles', 1300)).statusCode, 200);
    const again = await submit(token, 'puzzles', 1300);
    assert.equal(again.statusCode, 200);
    assert.equal((again.json() as { changed: boolean }).changed, false);
    const b = await board('puzzles');
    assert.equal(b.entries.filter((e) => e.username === 'lb-dupe').length, 1);
  });

  it('rate-limits real changes, then accepts them once the window passes', async () => {
    const token = await register('lb-rate');
    await putProgress(token);
    await optIn(token);
    assert.equal((await submit(token, 'puzzles', 1300)).statusCode, 200);

    // One new game moved the rating by +20 — legit, but too soon after the last change.
    await putProgress(token, progressBlob({ puzzlesElo: 1320, puzzlesPlayed: 16 }));
    t += 1_000;
    assert.equal((await submit(token, 'puzzles', 1320)).statusCode, 429);

    t += 30_000;
    const ok = await submit(token, 'puzzles', 1320);
    assert.equal(ok.statusCode, 200, ok.body);
    const b = await board('puzzles', '', token);
    assert.equal(b.me?.value, 1320);
  });

  it('puzzle rush: keeps the best score, monotonic, and bounded', async () => {
    const token = await register('lb-rush');
    await putProgress(token);
    await optIn(token);
    assert.equal((await submit(token, 'rush', 18)).statusCode, 200);
    // Improvements can't arrive faster than a run could be played.
    t += 1_000;
    assert.equal((await submit(token, 'rush', 19)).statusCode, 429);
    t += 30_000;
    assert.equal((await submit(token, 'rush', 19)).statusCode, 200);
    // A worse run later — the board must keep the best (a no-op, never rated-limited).
    t += 1_000;
    const worse = await submit(token, 'rush', 9);
    assert.equal(worse.statusCode, 200);
    assert.equal((worse.json() as { changed: boolean; value: number }).value, 19);
    const b = await board('rush', '', token);
    assert.equal(b.me?.value, 19);
  });
});

describe('leaderboard fetch', () => {
  it('ranks globally, serves top-N plus the requester’s own rank', async () => {
    // Three players, distinct bots ratings (synced via the validated blob).
    const players: [string, number][] = [
      ['rank-a', 1480],
      ['rank-b', 1480],
      ['rank-c', 1480],
    ];
    const tokens: string[] = [];
    for (const [name] of players) {
      const token = await register(name);
      await putProgress(token); // bots elo 1480 for everyone — ties
      await optIn(token);
      assert.equal((await submit(token, 'bots', 1480)).statusCode, 200, name);
      tokens.push(token);
      t += 25_000; // distinct updatedAt → deterministic tie-break (first wins)
    }
    const b = await board('bots', '?limit=2', tokens[2]);
    assert.equal(b.entries.length, 2);
    assert.deepEqual(
      b.entries.map((e) => e.username),
      ['rank-a', 'rank-b'],
    );
    // rank-c is outside the top-2 but still learns its own placement.
    assert.equal(b.me?.rank, 3);
    assert.equal(b.me?.value, 1480);
    assert.ok(b.total >= 3);
  });

  it('hides players who opt back out', async () => {
    const token = await register('lb-leaver');
    await putProgress(token);
    await optIn(token);
    assert.equal((await submit(token, 'puzzles', 1300)).statusCode, 200);
    await optIn(token, { leaderboards: false });
    const b = await board('puzzles', '', token);
    assert.ok(!b.entries.some((e) => e.username === 'lb-leaver'));
    assert.equal(b.me?.optedIn, false);
    assert.equal(b.me?.rank, null);
  });

  it('standings cache: repeated reads are consistent and every write invalidates', async () => {
    const token = await register('lb-cache');
    await putProgress(token);
    await optIn(token);
    assert.equal((await submit(token, 'rush', 11)).statusCode, 200);

    // Two consecutive reads (second one served from the memoized standings)
    // must agree exactly.
    const first = await board('rush', '', token);
    const second = await board('rush', '', token);
    assert.deepEqual(second.entries, first.entries);
    assert.equal(second.total, first.total);

    // A new accepted submission bumps the store version → fresh standings.
    t += 30_000;
    assert.equal((await submit(token, 'rush', 16)).statusCode, 200);
    const afterSubmit = await board('rush', '', token);
    assert.equal(afterSubmit.entries.find((e) => e.username === 'lb-cache')?.value, 16);

    // A prefs write invalidates too (covered above via opt-out; assert the
    // opt-back-in path as well — the cached "hidden" view must not stick).
    await optIn(token, { leaderboards: false });
    assert.ok(!(await board('rush', '', token)).entries.some((e) => e.username === 'lb-cache'));
    await optIn(token, { leaderboards: true });
    assert.equal((await board('rush', '', token)).entries.find((e) => e.username === 'lb-cache')?.value, 16);
  });

  it('weekly boards use the deterministic week key and roll over', async () => {
    const token = await register('lb-weekly');
    await putProgress(token);
    await optIn(token);
    assert.equal((await submit(token, 'rush', 21)).statusCode, 200);

    const thisWeek = await board('rush', '?scope=weekly', token);
    assert.equal(thisWeek.weekKey, isoWeekKey(t));
    assert.equal(thisWeek.me?.value, 21);

    // A week later the weekly board is empty for them; the global board persists.
    t += 8 * 86_400_000;
    const nextWeek = await board('rush', '?scope=weekly', token);
    assert.notEqual(nextWeek.weekKey, thisWeek.weekKey);
    assert.equal(nextWeek.me?.rank, null);
    const global = await board('rush', '', token);
    assert.equal(global.me?.value, 21);
  });
});

describe('share prefs + public profile', () => {
  it('prefs default to fully private and PUT patches booleans strictly', async () => {
    const token = await register('prefs-default');
    const res = await app.inject({ method: 'GET', url: '/api/social/prefs', headers: auth(token) });
    assert.equal(res.statusCode, 200);
    const { prefs } = res.json() as { prefs: Record<string, boolean> };
    assert.ok(Object.values(prefs).every((v) => v === false));

    await optIn(token, { profile: true, showRatings: true });
    const after = (await app.inject({ method: 'GET', url: '/api/social/prefs', headers: auth(token) })).json() as {
      prefs: Record<string, boolean>;
    };
    assert.equal(after.prefs.profile, true);
    assert.equal(after.prefs.showRatings, true);
    assert.equal(after.prefs.leaderboards, false);
  });

  it('serves 404 for unknown users and for users who did not opt in', async () => {
    const unknown = await app.inject({ method: 'GET', url: '/api/social/profile/nobody-here' });
    assert.equal(unknown.statusCode, 404);
    const token = await register('profile-private');
    await putProgress(token);
    const closed = await app.inject({ method: 'GET', url: '/api/social/profile/profile-private' });
    assert.equal(closed.statusCode, 404);
    // Same body for both — account existence is not leaked.
    assert.equal(unknown.body, closed.body);
  });

  it('exposes exactly the opted-in sections, nothing else', async () => {
    const token = await register('profile-partial');
    await putProgress(token);
    await optIn(token, { profile: true, showRatings: true, showStreak: true });
    const res = await app.inject({ method: 'GET', url: '/api/social/profile/profile-partial' });
    assert.equal(res.statusCode, 200);
    const p = res.json() as Record<string, unknown>;
    assert.equal(p.username, 'profile-partial');
    assert.match(p.memberSince as string, /^\d{4}-\d{2}$/);
    assert.ok(p.ratings, 'ratings shared');
    assert.equal((p.ratings as Record<string, { elo: number }>).puzzles!.elo, 1300);
    assert.deepEqual(p.streak, { current: 5, best: 9 });
    assert.equal(p.record, undefined);
    assert.equal(p.rushBest, undefined);
    assert.equal(p.achievements, undefined);
    assert.equal(p.favoriteOpenings, undefined);
  });

  it('shares record, achievements, rush best and sanitized openings when opted in', async () => {
    const token = await register('profile-full');
    await putProgress(token);
    await optIn(token, {
      leaderboards: true,
      profile: true,
      showRecord: true,
      showAchievements: true,
      showRush: true,
      showOpenings: true,
    });
    assert.equal((await submit(token, 'rush', 14)).statusCode, 200);
    await app.inject({
      method: 'PUT',
      url: '/api/social/prefs',
      headers: auth(token),
      payload: { favoriteOpenings: [{ name: 'Italian Game', eco: 'C50', games: 9, wins: 6 }] },
    });

    const p = (await app.inject({ method: 'GET', url: '/api/social/profile/profile-full' })).json() as Record<string, any>;
    assert.deepEqual(p.record, { wins: 5, draws: 0, losses: 3 }); // bots + blitz only
    assert.equal(p.rushBest, 14);
    assert.equal(p.achievements.length, 2);
    assert.equal(p.achievements[0].id, 'tactics-solve-10'); // most recent first
    assert.deepEqual(p.favoriteOpenings, [{ name: 'Italian Game', eco: 'C50', games: 9, wins: 6 }]);
    assert.equal(p.ratings, undefined); // not opted in
    // The profile stays display-name-only: no ids, emails or tokens.
    assert.equal(p.id, undefined);
    assert.equal(p.token, undefined);
  });

  it('reports a broken streak as 0 while keeping the best', async () => {
    const token = await register('profile-stale-streak');
    const blob = progressBlob();
    const twoWeeksAgoMs = Date.now() - 14 * 86_400_000;
    const twoWeeksAgo = new Date(twoWeeksAgoMs).toISOString().slice(0, 10);
    blob.streak = { count: 5, best: 9, lastDay: twoWeeksAgo, freezes: 1, milestonesAwarded: [3] };
    blob.gamify.days = activeDays(twoWeeksAgoMs);
    blob.gamify.lastGoalDay = twoWeeksAgo;
    blob.ratings.categories.puzzles.history = { [twoWeeksAgo]: { elo: 1300, glicko: 1300 } };
    blob.ratings.categories.bots.history = { [twoWeeksAgo]: { elo: 1480, glicko: 1490 } };
    await putProgress(token, blob);
    await optIn(token, { profile: true, showStreak: true });
    const p = (await app.inject({ method: 'GET', url: '/api/social/profile/profile-stale-streak' })).json() as {
      streak: { current: number; best: number };
    };
    assert.deepEqual(p.streak, { current: 0, best: 9 });
  });
});
