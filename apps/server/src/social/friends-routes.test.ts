import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Both stores persist to CHESSER_DATA_DIR at module load, so point them at a
// throwaway directory BEFORE importing the routes (which import them).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chesser-friends-test-'));
process.env.CHESSER_DATA_DIR = dataDir;

const { registerAccountRoutes } = await import('../accounts/routes.js');
const { registerSocialRoutes } = await import('./routes.js');
const { registerFriendRoutes } = await import('./friends-routes.js');
const { socialStore } = await import('./store.js');
const { setClock } = await import('./clock.js');
const { FRIEND_LIMITS } = await import('./friends.js');
const { FriendRoomManager } = await import('../friends/rooms.js');
const Fastify = (await import('fastify')).default;

// Injected clock: anchored to the real now (account/progress validation uses
// the real clock and must agree on "today"), advanced manually by tests.
let t = Date.now();
setClock(() => t);

const rooms = new FriendRoomManager({ now: () => t, schedule: () => () => {} });

const app = Fastify();
// Generous auth-guard limits: these suites register/login many accounts from one
// inject IP; brute-force protection has its own suite (accounts/auth-hardening).
registerAccountRoutes(app, { guard: { registerIpCapacity: 10_000, loginIpCapacity: 10_000 } });
registerSocialRoutes(app);
registerFriendRoutes(app, rooms);
await app.ready();

after(async () => {
  setClock(null);
  await app.close();
  await socialStore.flush();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// --- helpers ----------------------------------------------------------------

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'hunter22' } });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { token: string }).token;
}

async function optIn(token: string, prefs: Record<string, boolean>) {
  const res = await app.inject({ method: 'PUT', url: '/api/social/prefs', headers: auth(token), payload: { prefs } });
  assert.equal(res.statusCode, 200, res.body);
}

function sendRequest(token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/friends/request', headers: auth(token), payload });
}

interface FriendsList {
  friends: { username: string; since: number }[];
  incoming: { id: string; username: string; at: number }[];
  outgoing: { id: string; username: string; at: number }[];
  code: string;
}

async function friendsOf(token: string): Promise<FriendsList> {
  const res = await app.inject({ method: 'GET', url: '/api/friends', headers: auth(token) });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as FriendsList;
}

async function respond(token: string, id: string, accept: boolean) {
  return app.inject({ method: 'POST', url: '/api/friends/respond', headers: auth(token), payload: { id, accept } });
}

/** Register two users and make them friends (via friend code). */
async function makeFriends(nameA: string, nameB: string): Promise<[string, string]> {
  const a = await register(nameA);
  const b = await register(nameB);
  const { code } = await friendsOf(nameA === nameB ? a : a); // a's code
  t += 10_000;
  assert.equal((await sendRequest(b, { code })).statusCode, 200);
  const list = await friendsOf(a);
  const req = list.incoming.find((r) => r.username === nameB);
  assert.ok(req, 'incoming request visible');
  assert.equal((await respond(a, req.id, true)).statusCode, 200);
  return [a, b];
}

function challenge(token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/challenges', headers: auth(token), payload });
}

interface ChallengeList {
  incoming: { id: string; from: string; timeControl: unknown; color: string; createdAt: number }[];
  outgoing: { id: string; to: string; color: string; status: string; roomCode?: string }[];
}

async function challengesOf(token: string): Promise<ChallengeList> {
  const res = await app.inject({ method: 'GET', url: '/api/challenges', headers: auth(token) });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as ChallengeList;
}

function respondChallenge(token: string, id: string, accept: boolean) {
  return app.inject({ method: 'POST', url: `/api/challenges/${id}/respond`, headers: auth(token), payload: { accept } });
}

// --- friends ------------------------------------------------------------------

describe('friend requests', () => {
  it('requires auth everywhere', async () => {
    for (const [method, url] of [
      ['GET', '/api/friends'],
      ['POST', '/api/friends/request'],
      ['POST', '/api/friends/respond'],
      ['DELETE', '/api/friends/somebody'],
      ['GET', '/api/friends/feed'],
      ['GET', '/api/challenges'],
      ['POST', '/api/challenges'],
    ] as const) {
      const res = await app.inject({ method, url });
      assert.equal(res.statusCode, 401, `${method} ${url}`);
    }
  });

  it('username adds need the target’s public-profile opt-in; the refusal never leaks account existence', async () => {
    const asker = await register('fr-asker');
    await register('fr-hidden'); // exists, but never opted in
    t += 10_000;
    const hidden = await sendRequest(asker, { username: 'fr-hidden' });
    assert.equal(hidden.statusCode, 404);
    const ghost = await sendRequest(asker, { username: 'fr-no-such' });
    assert.equal(ghost.statusCode, 404);
    // Identical bodies: "private" and "nonexistent" are indistinguishable.
    assert.equal(hidden.body, ghost.body);
  });

  it('add by username → accept → both are friends; remove works from either side', async () => {
    const ann = await register('fr-ann');
    const ben = await register('fr-ben');
    await optIn(ben, { profile: true });
    t += 10_000;
    const sent = await sendRequest(ann, { username: 'fr-ben' });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal((sent.json() as { accepted: boolean }).accepted, false);

    // Visible as outgoing for ann, incoming for ben.
    assert.equal((await friendsOf(ann)).outgoing[0]!.username, 'fr-ben');
    const req = (await friendsOf(ben)).incoming[0]!;
    assert.equal(req.username, 'fr-ann');

    assert.equal((await respond(ben, req.id, true)).statusCode, 200);
    assert.deepEqual((await friendsOf(ann)).friends.map((f) => f.username), ['fr-ben']);
    assert.deepEqual((await friendsOf(ben)).friends.map((f) => f.username), ['fr-ann']);

    // Duplicate add once friends → 409.
    t += 10_000;
    assert.equal((await sendRequest(ann, { username: 'fr-ben' })).statusCode, 409);

    // Remove: gone for both.
    const del = await app.inject({ method: 'DELETE', url: '/api/friends/fr-ann', headers: auth(ben) });
    assert.equal(del.statusCode, 200);
    assert.equal((await friendsOf(ann)).friends.length, 0);
    assert.equal((await friendsOf(ben)).friends.length, 0);
  });

  it('friend codes work without any opt-in, and reject junk', async () => {
    const cara = await register('fr-cara');
    const dave = await register('fr-dave'); // fully private
    const { code } = await friendsOf(dave);
    assert.match(code, /^[A-Z2-9]{8}$/);
    // The code is stable across reads.
    assert.equal((await friendsOf(dave)).code, code);

    t += 10_000;
    assert.equal((await sendRequest(cara, { code: 'nope' })).statusCode, 400);
    assert.equal((await sendRequest(cara, { code: 'AAAA2222' })).statusCode, 404); // valid shape, unknown
    assert.equal((await sendRequest(cara, {})).statusCode, 400);
    const ok = await sendRequest(cara, { code: code.toLowerCase() }); // case-insensitive
    assert.equal(ok.statusCode, 200, ok.body);

    const req = (await friendsOf(dave)).incoming.find((r) => r.username === 'fr-cara')!;
    assert.equal((await respond(dave, req.id, true)).statusCode, 200);
    assert.equal((await friendsOf(cara)).friends[0]!.username, 'fr-dave');
  });

  it('decline removes the request and blocks an immediate re-request (cooldown)', async () => {
    const emma = await register('fr-emma');
    const finn = await register('fr-finn');
    const { code } = await friendsOf(finn);
    t += 10_000;
    assert.equal((await sendRequest(emma, { code })).statusCode, 200);
    const req = (await friendsOf(finn)).incoming.find((r) => r.username === 'fr-emma')!;
    assert.equal((await respond(finn, req.id, false)).statusCode, 200);
    assert.equal((await friendsOf(emma)).outgoing.length, 0);
    assert.equal((await friendsOf(emma)).friends.length, 0);

    // Cooldown: same target refused, another target still fine.
    t += 10_000;
    const again = await sendRequest(emma, { code });
    assert.equal(again.statusCode, 429);
    assert.match((again.json() as { error: string }).error, /declined recently/i);
    t += FRIEND_LIMITS.declineCooldownMs + 1_000;
    assert.equal((await sendRequest(emma, { code })).statusCode, 200);
  });

  it('mutual requests auto-accept (sending back = accepting)', async () => {
    const gus = await register('fr-gus');
    const hana = await register('fr-hana');
    const gusCode = (await friendsOf(gus)).code;
    const hanaCode = (await friendsOf(hana)).code;
    t += 10_000;
    assert.equal((await sendRequest(gus, { code: hanaCode })).statusCode, 200);
    t += 10_000;
    const back = await sendRequest(hana, { code: gusCode });
    assert.equal(back.statusCode, 200);
    assert.equal((back.json() as { accepted: boolean }).accepted, true);
    assert.equal((await friendsOf(gus)).friends[0]!.username, 'fr-hana');
    assert.equal((await friendsOf(gus)).incoming.length + (await friendsOf(gus)).outgoing.length, 0);
  });

  it('self-add, duplicate pending, and cancel are handled', async () => {
    const iva = await register('fr-iva');
    const jon = await register('fr-jon');
    const ivaCode = (await friendsOf(iva)).code;
    const jonCode = (await friendsOf(jon)).code;
    t += 10_000;
    assert.equal((await sendRequest(iva, { code: ivaCode })).statusCode, 400); // self
    assert.equal((await sendRequest(iva, { code: jonCode })).statusCode, 200);
    t += 10_000;
    assert.equal((await sendRequest(iva, { code: jonCode })).statusCode, 409); // duplicate

    const out = (await friendsOf(iva)).outgoing[0]!;
    const cancel = await app.inject({ method: 'DELETE', url: `/api/friends/request/${out.id}`, headers: auth(iva) });
    assert.equal(cancel.statusCode, 200);
    assert.equal((await friendsOf(jon)).incoming.length, 0);
  });

  it('rate-limits request sends per account', async () => {
    const kat = await register('fr-kat');
    const leo = await register('fr-leo');
    const mia = await register('fr-mia');
    const leoCode = (await friendsOf(leo)).code;
    const miaCode = (await friendsOf(mia)).code;
    t += 10_000;
    assert.equal((await sendRequest(kat, { code: leoCode })).statusCode, 200);
    // Immediately asking someone ELSE is still a send — spaced per account.
    const tooFast = await sendRequest(kat, { code: miaCode });
    assert.equal(tooFast.statusCode, 429);
    t += FRIEND_LIMITS.requestIntervalMs + 500;
    assert.equal((await sendRequest(kat, { code: miaCode })).statusCode, 200);
  });
});

// --- challenges -----------------------------------------------------------------

describe('challenges', () => {
  it('can only challenge friends', async () => {
    const noah = await register('ch-noah');
    await register('ch-omar');
    const res = await challenge(noah, { username: 'ch-omar', timeControl: null, color: 'white' });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /only challenge your friends/i);
  });

  it('pending → decline: the challenger sees the declined status', async () => {
    const [pia, quinn] = await makeFriends('ch-pia', 'ch-quinn');
    t += 10_000;
    const sent = await challenge(quinn, { username: 'ch-pia', timeControl: null, color: 'random' });
    assert.equal(sent.statusCode, 200, sent.body);

    const inc = (await challengesOf(pia)).incoming;
    assert.equal(inc.length, 1);
    assert.equal(inc[0]!.from, 'ch-quinn');

    assert.equal((await respondChallenge(pia, inc[0]!.id, false)).statusCode, 200);
    assert.equal((await challengesOf(pia)).incoming.length, 0);
    const out = (await challengesOf(quinn)).outgoing[0]!;
    assert.equal(out.status, 'declined');
    assert.equal(out.roomCode, undefined);

    // The challenger dismisses the record.
    const dismiss = await app.inject({ method: 'DELETE', url: `/api/challenges/${out.id}`, headers: auth(quinn) });
    assert.equal(dismiss.statusCode, 200);
    assert.equal((await challengesOf(quinn)).outgoing.length, 0);
  });

  it('accept creates a real friend room: accepter gets a seat, challenger gets the code and their color', async () => {
    const [rob, sam] = await makeFriends('ch-rob', 'ch-sam');
    t += 10_000;
    const tc = { initialMs: 300_000, incrementMs: 0, label: '5+0' };
    // rob challenges as WHITE.
    assert.equal((await challenge(rob, { username: 'ch-sam', timeControl: tc, color: 'white' })).statusCode, 200);

    const inc = (await challengesOf(sam)).incoming[0]!;
    assert.equal(inc.color, 'white'); // the CHALLENGER's color
    const acc = await respondChallenge(sam, inc.id, true);
    assert.equal(acc.statusCode, 200, acc.body);
    const seat = acc.json() as { status: string; roomCode: string; token: string; color: string };
    assert.equal(seat.status, 'accepted');
    assert.equal(seat.color, 'black'); // accepter takes the other color
    assert.ok(seat.token);

    // The room really exists in the shared manager, carrying the time control…
    const room = rooms.get(seat.roomCode);
    assert.ok(room, 'room created');
    assert.equal(room.state().timeControl?.label, '5+0');
    assert.equal(room.state().players.black?.name, 'ch-sam');
    // …and the challenger sees the code on their next poll.
    const out = (await challengesOf(rob)).outgoing[0]!;
    assert.equal(out.status, 'accepted');
    assert.equal(out.roomCode, seat.roomCode);
    // The open seat is the challenger's requested color.
    const joined = room.join(undefined, 'ch-rob');
    assert.equal(joined.color, 'white');
    // A room join is answered only once — the record can't be re-accepted.
    assert.equal((await respondChallenge(sam, inc.id, true)).statusCode, 404);
  });

  it('validates color and time control up front', async () => {
    const [tia] = await makeFriends('ch-tia', 'ch-uma');
    t += 10_000;
    const bad = await challenge(tia, { username: 'ch-uma', timeControl: { initialMs: 1, incrementMs: 0, label: 'x' }, color: 'white' });
    assert.equal(bad.statusCode, 400);
    assert.match((bad.json() as { error: string }).error, /time control/i);
  });

  it('rate-limits challenge sends and forbids duplicate pending challenges to one friend', async () => {
    const [vic, wes] = await makeFriends('ch-vic', 'ch-wes');
    await makeFriends('ch-vic2', 'ch-wes2'); // unrelated noise
    t += 10_000;
    assert.equal((await challenge(vic, { username: 'ch-wes', color: 'random' })).statusCode, 200);
    // Duplicate to the same friend → 409 (even after the rate window).
    t += FRIEND_LIMITS.challengeIntervalMs + 500;
    assert.equal((await challenge(vic, { username: 'ch-wes', color: 'random' })).statusCode, 409);
    // Spacing: a rapid second send to anyone is 429.
    const wesOut = (await challengesOf(vic)).outgoing[0]!;
    await app.inject({ method: 'DELETE', url: `/api/challenges/${wesOut.id}`, headers: auth(vic) });
    assert.equal((await challenge(vic, { username: 'ch-wes', color: 'random' })).statusCode, 200);
    const rapid = await challenge(vic, { username: 'ch-wes', color: 'random' });
    assert.equal(rapid.statusCode, 429);
    void wes;
  });

  it('pending challenges expire; expired ones cannot be accepted', async () => {
    const [xena, yuri] = await makeFriends('ch-xena', 'ch-yuri');
    t += 10_000;
    assert.equal((await challenge(xena, { username: 'ch-yuri', color: 'white' })).statusCode, 200);
    const inc = (await challengesOf(yuri)).incoming[0]!;

    t += FRIEND_LIMITS.challengePendingTtlMs + 60_000;
    // Gone from the receiver's pending list…
    assert.equal((await challengesOf(yuri)).incoming.length, 0);
    // …the challenger sees it as expired…
    assert.equal((await challengesOf(xena)).outgoing[0]!.status, 'expired');
    // …and a late accept is refused.
    assert.equal((await respondChallenge(yuri, inc.id, true)).statusCode, 404);

    // Resolved records get swept after their linger window.
    t += FRIEND_LIMITS.challengeResolvedTtlMs + 60_000;
    assert.equal((await challengesOf(xena)).outgoing.length, 0);
  });

  it('unfriending voids pending challenges between the pair', async () => {
    const [zed, abby] = await makeFriends('ch-zed', 'ch-abby');
    t += 10_000;
    assert.equal((await challenge(zed, { username: 'ch-abby', color: 'random' })).statusCode, 200);
    const del = await app.inject({ method: 'DELETE', url: '/api/friends/ch-zed', headers: auth(abby) });
    assert.equal(del.statusCode, 200);
    assert.equal((await challengesOf(abby)).incoming.length, 0);
    assert.equal((await challengesOf(zed)).outgoing.length, 0);
    // And with the friendship gone, a new challenge is refused.
    t += 10_000;
    assert.equal((await challenge(zed, { username: 'ch-abby', color: 'random' })).statusCode, 400);
  });
});

// --- activity feed ----------------------------------------------------------------

describe('activity feed', () => {
  const today = new Date().toISOString().slice(0, 10);
  const dayKey = (offsetDays: number, from = Date.now()) => new Date(from - offsetDays * 86_400_000).toISOString().slice(0, 10);

  /** A blob the PR #27 progress validator accepts (subset of routes.test.ts's). */
  function progressBlob() {
    const days: Record<string, { xp: number; activities: number }> = {};
    for (let i = 8; i >= 0; i--) days[dayKey(i)] = { xp: 100, activities: 10 };
    return {
      ratings: {
        legacyMigrated: true,
        categories: {
          puzzles: {
            elo: 1300,
            eloPeak: 1300,
            glicko: { rating: 1300, rd: 200, vol: 0.06 },
            glickoPeak: 1300,
            played: 15,
            won: 10,
            lost: 5,
            drawn: 0,
            winStreak: 2,
            bestWinStreak: 3,
            history: { [today]: { elo: 1300, glicko: 1300 } },
          },
        },
      },
      gamify: { xp: 900, days, goalXp: 40, streak: 1, bestStreak: 1, lastGoalDay: today, goalsMet: 9 },
      streak: { count: 5, best: 9, lastDay: today, freezes: 1, milestonesAwarded: [3] },
      achievements: { unlocked: { 'tactics-solve-10': Date.now() - 5_000 } },
    };
  }

  it('serves only friends’ opted-in activity — private friends contribute nothing', async () => {
    const [beth, carl] = await makeFriends('feed-beth', 'feed-carl');

    // carl syncs progress and shares: leaderboards (rush + rating) and
    // profile achievements + streak.
    const put = await app.inject({ method: 'PUT', url: '/api/progress', headers: auth(carl), payload: { data: progressBlob() } });
    assert.equal(put.statusCode, 200, put.body);
    await optIn(carl, { leaderboards: true, profile: true, showAchievements: true, showStreak: true });
    t += 30_000;
    const rush = await app.inject({ method: 'POST', url: '/api/leaderboard/submit', headers: auth(carl), payload: { board: 'rush', value: 21 } });
    assert.equal(rush.statusCode, 200, rush.body);
    t += 30_000;
    const rating = await app.inject({ method: 'POST', url: '/api/leaderboard/submit', headers: auth(carl), payload: { board: 'puzzles', value: 1300 } });
    assert.equal(rating.statusCode, 200, rating.body);

    const res = await app.inject({ method: 'GET', url: '/api/friends/feed', headers: auth(beth) });
    assert.equal(res.statusCode, 200);
    const { events } = res.json() as { events: { username: string; kind: string; value?: number; id?: string; count?: number }[] };
    assert.ok(events.length >= 4, JSON.stringify(events));
    assert.ok(events.every((e) => e.username === 'feed-carl'));
    assert.equal(events.find((e) => e.kind === 'rush')?.value, 21);
    assert.equal(events.find((e) => e.kind === 'rating')?.value, 1300);
    assert.equal(events.find((e) => e.kind === 'achievement')?.id, 'tactics-solve-10');
    assert.equal(events.find((e) => e.kind === 'streak')?.count, 5);

    // beth shares nothing → carl's feed of her is empty.
    const carlFeed = await app.inject({ method: 'GET', url: '/api/friends/feed', headers: auth(carl) });
    assert.deepEqual((carlFeed.json() as { events: unknown[] }).events, []);
  });

  it('withdrawing an opt-in removes the events immediately', async () => {
    const [dana, eryn] = await makeFriends('feed-dana', 'feed-eryn');
    await optIn(eryn, { leaderboards: true });
    t += 30_000;
    const sub = await app.inject({ method: 'POST', url: '/api/leaderboard/submit', headers: auth(eryn), payload: { board: 'rush', value: 9 } });
    assert.equal(sub.statusCode, 200, sub.body);
    let feed = (await app.inject({ method: 'GET', url: '/api/friends/feed', headers: auth(dana) })).json() as { events: unknown[] };
    assert.equal(feed.events.length, 1);

    await optIn(eryn, { leaderboards: false });
    feed = (await app.inject({ method: 'GET', url: '/api/friends/feed', headers: auth(dana) })).json() as { events: unknown[] };
    assert.deepEqual(feed.events, []);
  });

  it('non-friends never appear, and old events age out of the window', async () => {
    const [fred] = await makeFriends('feed-fred', 'feed-gale');
    // A stranger with maximal sharing…
    const hope = await register('feed-hope');
    await optIn(hope, { leaderboards: true });
    t += 30_000;
    await app.inject({ method: 'POST', url: '/api/leaderboard/submit', headers: auth(hope), payload: { board: 'rush', value: 30 } });
    // …never shows in fred's feed.
    const feed = (await app.inject({ method: 'GET', url: '/api/friends/feed', headers: auth(fred) })).json() as {
      events: { username: string }[];
    };
    assert.ok(feed.events.every((e) => e.username !== 'feed-hope'));

    // gale posts a rush score, then two weeks pass — the event ages out.
    const galeToken = await (async () => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'feed-gale', password: 'hunter22' } });
      return (res.json() as { token: string }).token;
    })();
    await optIn(galeToken, { leaderboards: true });
    t += 30_000;
    const sub = await app.inject({ method: 'POST', url: '/api/leaderboard/submit', headers: auth(galeToken), payload: { board: 'rush', value: 12 } });
    assert.equal(sub.statusCode, 200, sub.body);
    let events = ((await app.inject({ method: 'GET', url: '/api/friends/feed', headers: auth(fred) })).json() as {
      events: { username: string }[];
    }).events;
    assert.ok(events.some((e) => e.username === 'feed-gale'));
    t += FRIEND_LIMITS.feedWindowMs + 86_400_000;
    events = ((await app.inject({ method: 'GET', url: '/api/friends/feed', headers: auth(fred) })).json() as {
      events: { username: string }[];
    }).events;
    assert.ok(events.every((e) => e.username !== 'feed-gale'));
  });
});
