import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FriendColor } from '@chesser/shared';
import { store } from '../accounts/store.js';
import { FriendRoomManager, RoomError, validTimeControl } from '../friends/rooms.js';
import { socialStore } from './store.js';
import { now } from './clock.js';
import {
  FRIEND_CODE_RE,
  FRIEND_LIMITS,
  addEdge,
  areFriends,
  feedEventsFor,
  friendCodeOf,
  friendCount,
  friendsOf,
  pendingBetween,
  pruneGraph,
  removeEdge,
  userIdByFriendCode,
  type FeedEvent,
} from './friends.js';

/**
 * Friends & challenges endpoints. State lives in the social store's friend
 * graph (social/store.ts); privacy + anti-abuse rules live in social/friends.ts.
 *
 * Challenge acceptance reuses the friend-link live-game machinery end to end:
 * accepting creates a room in the SAME FriendRoomManager that /ws/friend
 * serves, seats the accepter, and hands the room code to the challenger — both
 * clients then talk plain friend-game WebSocket from there.
 */

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

function bearer(req: FastifyRequest): string | null {
  const h = req.headers['authorization'];
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null;
}
function authUserId(req: FastifyRequest): string | null {
  const t = bearer(req);
  return t ? (store.sessionUserId(t) ?? null) : null;
}

/** One answer for "no such user" and "not discoverable" — no account leaks. */
const NOT_FOUND_MSG = 'No player found — check the name, or ask them for their friend code.';

export function registerFriendRoutes(app: FastifyInstance, rooms: FriendRoomManager): void {
  // --- friends: list + code -------------------------------------------------

  app.get('/api/friends', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const g = socialStore.graph();
    // pruneGraph mutates in place; an empty update persists what it changed.
    if (pruneGraph(g, now())) socialStore.updateGraph(() => {});

    // Fetching your list is the "I'm using friends" moment — mint the share
    // code lazily here so it exists exactly when its owner can see it.
    let code = g.codes[uid];
    if (!code) {
      socialStore.updateGraph((graph) => {
        code = friendCodeOf(graph, uid).code;
      });
    }

    const name = (id: string) => store.usernameById(id) ?? null;
    const friends = friendsOf(g, uid)
      .map((f) => ({ username: name(f.id), since: f.since }))
      .filter((f): f is { username: string; since: number } => f.username !== null)
      .sort((a, b) => a.username.localeCompare(b.username));
    const incoming = g.requests
      .filter((r) => r.to === uid)
      .map((r) => ({ id: r.id, username: name(r.from), at: r.at }))
      .filter((r): r is { id: string; username: string; at: number } => r.username !== null);
    const outgoing = g.requests
      .filter((r) => r.from === uid)
      .map((r) => ({ id: r.id, username: name(r.to), at: r.at }))
      .filter((r): r is { id: string; username: string; at: number } => r.username !== null);

    return { friends, incoming, outgoing, code };
  });

  // --- friends: send a request ---------------------------------------------

  app.post('/api/friends/request', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const body = (req.body ?? {}) as { username?: unknown; code?: unknown };

    // Resolve the target: by friend code (possession = consent) or by
    // username (requires the target's public-profile opt-in).
    let targetId: string | null = null;
    const g = socialStore.graph();
    if (typeof body.code === 'string') {
      const code = body.code.toUpperCase().trim();
      if (!FRIEND_CODE_RE.test(code)) return reply.code(400).send({ error: 'That friend code is not valid.' });
      targetId = userIdByFriendCode(g, code);
      if (!targetId) return reply.code(404).send({ error: 'No player found with that friend code.' });
    } else if (typeof body.username === 'string') {
      const username = body.username.trim();
      if (!USERNAME_RE.test(username)) return reply.code(400).send({ error: 'That username is not valid.' });
      const user = store.getUser(username);
      // Privacy: only players who opted into a public profile are
      // discoverable by name; everyone else gets the identical not-found.
      if (!user || !socialStore.get(user.id).prefs.profile) return reply.code(404).send({ error: NOT_FOUND_MSG });
      targetId = user.id;
    } else {
      return reply.code(400).send({ error: 'Provide a username or a friend code.' });
    }

    if (targetId === uid) return reply.code(400).send({ error: 'You cannot add yourself.' });
    if (areFriends(g, uid, targetId)) return reply.code(409).send({ error: 'You are already friends.' });
    const targetName = store.usernameById(targetId);
    if (!targetName) return reply.code(404).send({ error: NOT_FOUND_MSG });

    const nowMs = now();
    if (friendCount(g, uid) >= FRIEND_LIMITS.maxFriends) {
      return reply.code(400).send({ error: `Friends are capped at ${FRIEND_LIMITS.maxFriends}.` });
    }
    if (friendCount(g, targetId) >= FRIEND_LIMITS.maxFriends) {
      return reply.code(400).send({ error: 'That player cannot add more friends right now.' });
    }

    // Mutual interest: they already asked you — sending back accepts.
    const theirs = pendingBetween(g, targetId, uid);
    if (theirs) {
      socialStore.updateGraph((graph) => {
        graph.requests = graph.requests.filter((r) => r.id !== theirs.id);
        addEdge(graph, uid, targetId, nowMs);
      });
      return { ok: true, accepted: true, username: targetName };
    }

    if (pendingBetween(g, uid, targetId)) return reply.code(409).send({ error: 'Request already sent.' });
    const declinedAt = g.declinedAt[`${uid}:${targetId}`];
    if (declinedAt !== undefined && nowMs - declinedAt < FRIEND_LIMITS.declineCooldownMs) {
      return reply.code(429).send({ error: 'They declined recently — try again later.' });
    }
    const last = g.lastRequestAt[uid];
    if (last !== undefined && nowMs - last < FRIEND_LIMITS.requestIntervalMs) {
      return reply.code(429).send({ error: 'Too many friend requests — try again in a moment.' });
    }
    if (g.requests.filter((r) => r.from === uid).length >= FRIEND_LIMITS.maxPendingRequests) {
      return reply.code(400).send({ error: `You already have ${FRIEND_LIMITS.maxPendingRequests} pending requests.` });
    }

    socialStore.updateGraph((graph) => {
      graph.requests.push({ id: randomUUID(), from: uid, to: targetId, at: nowMs });
      graph.lastRequestAt[uid] = nowMs;
    });
    return { ok: true, accepted: false, username: targetName };
  });

  // --- friends: respond to / cancel a request -------------------------------

  app.post('/api/friends/respond', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const { id, accept } = (req.body ?? {}) as { id?: unknown; accept?: unknown };
    if (typeof id !== 'string' || typeof accept !== 'boolean') {
      return reply.code(400).send({ error: 'Provide a request id and accept: true/false.' });
    }
    const g = socialStore.graph();
    const rec = g.requests.find((r) => r.id === id && r.to === uid);
    if (!rec) return reply.code(404).send({ error: 'No such friend request.' });
    if (accept && friendCount(g, uid) >= FRIEND_LIMITS.maxFriends) {
      return reply.code(400).send({ error: `Friends are capped at ${FRIEND_LIMITS.maxFriends}.` });
    }
    const nowMs = now();
    socialStore.updateGraph((graph) => {
      graph.requests = graph.requests.filter((r) => r.id !== id);
      if (accept) addEdge(graph, rec.from, rec.to, nowMs);
      else graph.declinedAt[`${rec.from}:${rec.to}`] = nowMs;
    });
    return { ok: true, username: store.usernameById(rec.from) ?? null };
  });

  app.delete('/api/friends/request/:id', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const { id } = req.params as { id: string };
    const rec = socialStore.graph().requests.find((r) => r.id === id && r.from === uid);
    if (!rec) return reply.code(404).send({ error: 'No such friend request.' });
    socialStore.updateGraph((graph) => {
      graph.requests = graph.requests.filter((r) => r.id !== id);
    });
    return { ok: true };
  });

  // --- friends: remove -------------------------------------------------------

  app.delete('/api/friends/:username', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const { username } = req.params as { username: string };
    const user = store.getUser(username);
    if (!user || !areFriends(socialStore.graph(), uid, user.id)) {
      return reply.code(404).send({ error: 'You are not friends with that player.' });
    }
    socialStore.updateGraph((graph) => {
      removeEdge(graph, uid, user.id);
      // Unfriending voids any open challenges between the two.
      graph.challenges = graph.challenges.filter(
        (c) => !(c.status === 'pending' && ((c.from === uid && c.to === user.id) || (c.from === user.id && c.to === uid))),
      );
    });
    return { ok: true };
  });

  // --- challenges ------------------------------------------------------------

  app.post('/api/challenges', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const body = (req.body ?? {}) as { username?: unknown; timeControl?: unknown; color?: unknown };
    if (typeof body.username !== 'string' || !USERNAME_RE.test(body.username.trim())) {
      return reply.code(400).send({ error: 'That username is not valid.' });
    }
    const target = store.getUser(body.username.trim());
    const g = socialStore.graph();
    if (!target || !areFriends(g, uid, target.id)) {
      return reply.code(400).send({ error: 'You can only challenge your friends.' });
    }
    const color: FriendColor | 'random' =
      body.color === 'white' || body.color === 'black' ? body.color : 'random';
    // Same clamp the rooms apply — a challenge that a room would reject is
    // rejected up front rather than dying at accept time.
    const timeControl =
      body.timeControl === null || body.timeControl === undefined
        ? null
        : validTimeControl(body.timeControl as Parameters<typeof validTimeControl>[0]);
    if (body.timeControl && !timeControl) return reply.code(400).send({ error: 'That time control is not valid.' });

    const nowMs = now();
    if (pruneGraph(g, nowMs)) socialStore.updateGraph(() => {});
    const last = g.lastChallengeAt[uid];
    if (last !== undefined && nowMs - last < FRIEND_LIMITS.challengeIntervalMs) {
      return reply.code(429).send({ error: 'Too many challenges — try again in a moment.' });
    }
    const myPending = g.challenges.filter((c) => c.from === uid && c.status === 'pending');
    if (myPending.some((c) => c.to === target.id)) {
      return reply.code(409).send({ error: 'You already have a pending challenge to that friend.' });
    }
    if (myPending.length >= FRIEND_LIMITS.maxPendingChallenges) {
      return reply.code(400).send({ error: `You already have ${FRIEND_LIMITS.maxPendingChallenges} pending challenges.` });
    }

    const id = randomUUID();
    socialStore.updateGraph((graph) => {
      graph.challenges.push({ id, from: uid, to: target.id, timeControl, color, createdAt: nowMs, status: 'pending' });
      graph.lastChallengeAt[uid] = nowMs;
    });
    return { ok: true, id };
  });

  app.get('/api/challenges', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const g = socialStore.graph();
    // pruneGraph mutates in place; an empty update persists what it changed.
    if (pruneGraph(g, now())) socialStore.updateGraph(() => {});
    const name = (id: string) => store.usernameById(id) ?? null;
    const incoming = g.challenges
      .filter((c) => c.to === uid && c.status === 'pending')
      .map((c) => ({ id: c.id, from: name(c.from), timeControl: c.timeControl, color: c.color, createdAt: c.createdAt }))
      .filter((c) => c.from !== null);
    const outgoing = g.challenges
      .filter((c) => c.from === uid)
      .map((c) => ({
        id: c.id,
        to: name(c.to),
        timeControl: c.timeControl,
        color: c.color,
        createdAt: c.createdAt,
        status: c.status,
        ...(c.status === 'accepted' && c.roomCode ? { roomCode: c.roomCode } : {}),
      }))
      .filter((c) => c.to !== null);
    return { incoming, outgoing };
  });

  app.post('/api/challenges/:id/respond', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const { id } = req.params as { id: string };
    const { accept } = (req.body ?? {}) as { accept?: unknown };
    if (typeof accept !== 'boolean') return reply.code(400).send({ error: 'Provide accept: true/false.' });
    const g = socialStore.graph();
    // pruneGraph mutates in place; an empty update persists what it changed.
    if (pruneGraph(g, now())) socialStore.updateGraph(() => {});
    const rec = g.challenges.find((c) => c.id === id && c.to === uid);
    if (!rec || rec.status !== 'pending') return reply.code(404).send({ error: 'That challenge is gone or already answered.' });
    const nowMs = now();

    if (!accept) {
      socialStore.updateGraph(() => {
        rec.status = 'declined';
        rec.resolvedAt = nowMs;
      });
      return { ok: true, status: 'declined' };
    }

    // Accept → spin up a real friend-link room (the same manager /ws/friend
    // uses). The ACCEPTER is seated now, with the color the challenger did NOT
    // pick; the challenger learns the room code on their next poll and joins
    // as the second player — which is exactly when the game (and any clock)
    // starts, i.e. when both sides are actually present.
    const accepterColor: FriendColor | 'random' =
      rec.color === 'white' ? 'black' : rec.color === 'black' ? 'white' : 'random';
    let seat: { code: string; token: string; color: FriendColor };
    try {
      const created = rooms.create({
        name: store.usernameById(uid),
        timeControl: rec.timeControl,
        color: accepterColor,
      });
      seat = { code: created.room.code, token: created.token, color: created.color };
    } catch (e) {
      if (e instanceof RoomError) return reply.code(503).send({ error: e.message });
      throw e;
    }
    socialStore.updateGraph(() => {
      rec.status = 'accepted';
      rec.resolvedAt = nowMs;
      rec.roomCode = seat.code;
    });
    return { ok: true, status: 'accepted', roomCode: seat.code, token: seat.token, color: seat.color };
  });

  app.delete('/api/challenges/:id', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const { id } = req.params as { id: string };
    const rec = socialStore.graph().challenges.find((c) => c.id === id && c.from === uid);
    if (!rec) return reply.code(404).send({ error: 'No such challenge.' });
    // Pending → cancel (vanishes for the receiver too); resolved → dismiss.
    socialStore.updateGraph((graph) => {
      graph.challenges = graph.challenges.filter((c) => c.id !== id);
    });
    return { ok: true };
  });

  // --- activity feed ----------------------------------------------------------

  app.get('/api/friends/feed', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const g = socialStore.graph();
    const nowMs = now();
    const events: FeedEvent[] = [];
    for (const f of friendsOf(g, uid)) {
      const username = store.usernameById(f.id);
      if (!username) continue;
      const social = socialStore.get(f.id);
      const blob = store.getProgress(f.id)?.data ?? null;
      events.push(...feedEventsFor(username, social, blob, nowMs));
    }
    events.sort((a, b) => b.at - a.at);
    return { events: events.slice(0, FRIEND_LIMITS.feedMax) };
  });
}
