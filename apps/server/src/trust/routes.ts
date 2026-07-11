import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { store } from '../accounts/store.js';
import { socialStore } from '../social/store.js';
import { friendsOf, purgeUser } from '../social/friends.js';
import { now } from '../social/clock.js';
import { trustStore, isReportReason, REPORT_LIMITS, REPORT_REASONS } from './store.js';

/**
 * Trust & privacy endpoints: data export, account deletion (right to
 * erasure) and abuse reports on public profiles.
 *
 * Follows the PR #27/#31 doctrine — every endpoint is authenticated, every
 * input validated and bounded, state-changing actions rate-limited, and
 * "no such user" is indistinguishable from "not shared" so nothing here can
 * be used to probe which accounts exist.
 */

function bearer(req: FastifyRequest): string | null {
  const h = req.headers['authorization'];
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null;
}
function authUserId(req: FastifyRequest): string | null {
  const t = bearer(req);
  return t ? (store.sessionUserId(t) ?? null) : null;
}

/** Same one-404 as the public-profile route — don't leak account existence. */
const PROFILE_NOT_FOUND = 'This profile is private or does not exist.';

export function registerTrustRoutes(app: FastifyInstance): void {
  // --- data export ----------------------------------------------------------
  // Everything Chesser stores server-side about the signed-in account, as one
  // JSON document. Mirrors the stores exactly; nothing is synthesized.

  app.get('/api/account/export', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const user = store.userById(uid);
    if (!user) return reply.code(401).send({ error: 'Not authenticated.' });

    const progress = store.getProgress(uid);
    const social = socialStore.get(uid);
    const g = socialStore.graph();
    const friends = friendsOf(g, uid)
      .map((f) => ({ username: store.usernameById(f.id) ?? null, since: new Date(f.since).toISOString() }))
      .filter((f): f is { username: string; since: string } => f.username !== null);

    return {
      exportedAt: new Date(now()).toISOString(),
      app: 'chesser',
      account: {
        username: user.username,
        createdAt: new Date(user.createdAt).toISOString(),
      },
      progress: progress ? { data: progress.data, updatedAt: new Date(progress.updatedAt).toISOString() } : null,
      savedGames: store.getGames(uid),
      social: {
        sharePrefs: social.prefs,
        leaderboardEntries: social.boards,
        favoriteOpenings: social.favoriteOpenings,
      },
      friends: {
        friends,
        friendCode: g.codes[uid] ?? null,
      },
      reportsFiled: trustStore.reportsBy(uid).map((r) => ({
        targetUsername: r.targetUsername,
        reason: r.reason,
        ...(r.details ? { details: r.details } : {}),
        at: new Date(r.at).toISOString(),
      })),
    };
  });

  // --- account deletion (right to erasure) -----------------------------------
  // Requires the literal confirmation string so a stray client call can never
  // wipe an account. Removes: credentials, all sessions, the synced progress
  // blob, saved games, share prefs + leaderboard entries, the whole friend
  // presence (edges/requests/challenges/code), and abuse reports either filed
  // by or targeting the account.

  app.delete('/api/account', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const { confirm } = (req.body ?? {}) as { confirm?: unknown };
    if (confirm !== 'DELETE') {
      return reply.code(400).send({ error: 'Confirm deletion by sending { "confirm": "DELETE" }.' });
    }

    trustStore.deleteUser(uid);
    socialStore.deleteUser(uid);
    socialStore.updateGraph((g) => purgeUser(g, uid));
    store.deleteUser(uid); // last: this invalidates the session in use
    return { ok: true };
  });

  // --- abuse reports ----------------------------------------------------------
  // Reporting requires an account (spam control + a reviewable reporter), and
  // only profiles that are actually public can be reported — a private target
  // gets the same 404 as a nonexistent one.

  app.post('/api/report', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Sign in to report a profile.' });
    const body = (req.body ?? {}) as { username?: unknown; reason?: unknown; details?: unknown };

    if (typeof body.username !== 'string') return reply.code(400).send({ error: 'Provide the profile name to report.' });
    if (!isReportReason(body.reason)) {
      return reply.code(400).send({ error: `Reason must be one of: ${REPORT_REASONS.join(', ')}.` });
    }
    let details: string | undefined;
    if (body.details !== undefined && body.details !== '') {
      if (typeof body.details !== 'string') return reply.code(400).send({ error: 'Details must be text.' });
      details = body.details.trim().slice(0, REPORT_LIMITS.detailsMax);
      if (!details) details = undefined;
    }

    const target = store.getUser(body.username.trim());
    if (!target || !socialStore.get(target.id).prefs.profile) {
      return reply.code(404).send({ error: PROFILE_NOT_FOUND });
    }
    if (target.id === uid) return reply.code(400).send({ error: 'You cannot report yourself.' });

    const nowMs = now();
    if (trustStore.hasRecentReport(uid, target.id, nowMs)) {
      // Idempotent: the report is already on file — nothing new recorded.
      return { ok: true, duplicate: true };
    }
    const last = trustStore.lastReportAt(uid);
    if (last !== 0 && nowMs - last < REPORT_LIMITS.intervalMs) {
      return reply.code(429).send({ error: 'Too many reports — try again in a moment.' });
    }

    trustStore.addReport({
      id: randomUUID(),
      reporterId: uid,
      targetId: target.id,
      targetUsername: target.username,
      reason: body.reason,
      ...(details ? { details } : {}),
      at: nowMs,
    });
    return { ok: true };
  });
}
