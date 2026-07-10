import type { FastifyInstance, FastifyRequest } from 'fastify';
import { store } from '../accounts/store.js';
import { socialStore } from './store.js';
import { now } from './clock.js';
import { isoWeekKey } from './week.js';
import {
  extractCategory,
  extractRushBest,
  isBoardId,
  sanitizeOpenings,
  sanitizePrefs,
  validateSubmission,
  LB_LIMITS,
  type BoardEntry,
  type BoardId,
} from './validation.js';

/**
 * Async social endpoints: leaderboards + shareable public profiles.
 *
 * Reads the accounts store strictly read-only (sessions for auth, usernames
 * for display, the validated progress blob for score cross-checks) and keeps
 * all of its own state in social/store.ts. Score submissions go through
 * social/validation.ts — the server never trusts a client-claimed score
 * (see that module's header for the full rule set).
 *
 * Privacy: everything here is opt-in. Users appear on boards only after
 * enabling `leaderboards` in their share prefs, and profiles serve only the
 * sections the owner flipped on. The only identity exposed is the display
 * name (account username) — no PII.
 */

function bearer(req: FastifyRequest): string | null {
  const h = req.headers['authorization'];
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null;
}
function authUserId(req: FastifyRequest): string | null {
  const t = bearer(req);
  return t ? (store.sessionUserId(t) ?? null) : null;
}

type Scope = 'global' | 'weekly';

interface RankedRow {
  userId: string;
  username: string;
  value: number;
  played?: number;
  updatedAt: number;
}

/** All opted-in rows for a board+scope, ranked (best first, deterministic). */
function rankedRows(board: BoardId, scope: Scope, weekKey: string): RankedRow[] {
  const rows: RankedRow[] = [];
  for (const [userId, social] of socialStore.all()) {
    if (!social.prefs.leaderboards) continue;
    const entry = social.boards[board];
    if (!entry) continue;
    const value = scope === 'weekly' ? entry.weekly[weekKey] : entry.value;
    if (typeof value !== 'number') continue;
    const username = store.usernameById(userId);
    if (!username) continue;
    rows.push({ userId, username, value, played: entry.played, updatedAt: entry.updatedAt });
  }
  // Best value first; ties go to whoever got there first, then by name so the
  // order is total and stable across requests.
  rows.sort((a, b) => b.value - a.value || a.updatedAt - b.updatedAt || a.username.localeCompare(b.username));
  return rows;
}

const DAY_MS = 86_400_000;
const utcDayDiff = (aMs: number, bMs: number): number => Math.floor(bMs / DAY_MS) - Math.floor(aMs / DAY_MS);

export function registerSocialRoutes(app: FastifyInstance): void {
  // --- leaderboards --------------------------------------------------------

  app.post('/api/leaderboard/submit', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const { board, value } = (req.body ?? {}) as { board?: unknown; value?: unknown };
    if (!isBoardId(board)) return reply.code(400).send({ error: 'Unknown leaderboard.' });

    const social = socialStore.get(uid);
    if (!social.prefs.leaderboards) {
      return reply.code(403).send({ error: 'Leaderboards are opt-in — enable them in your share settings first.' });
    }

    const blob = store.getProgress(uid)?.data ?? null;
    const outcome = validateSubmission(board, value, social.boards[board] ?? null, blob, now());
    if (!outcome.ok) return reply.code(outcome.status).send({ error: outcome.error });
    if (outcome.changed) socialStore.setBoardEntry(uid, board, outcome.entry);
    return { ok: true, changed: outcome.changed, value: outcome.entry.value, ...(outcome.changed ? {} : { note: outcome.note }) };
  });

  app.get('/api/leaderboard/:board', async (req, reply) => {
    const { board } = req.params as { board: string };
    if (!isBoardId(board)) return reply.code(404).send({ error: 'Unknown leaderboard.' });
    const q = req.query as { scope?: string; limit?: string };
    const scope: Scope = q.scope === 'weekly' ? 'weekly' : 'global';
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
    const weekKey = isoWeekKey(now());

    const rows = rankedRows(board, scope, weekKey);
    const top = rows.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      username: r.username,
      value: r.value,
      ...(r.played !== undefined ? { played: r.played } : {}),
    }));

    // The requesting user's own placement — served even when they're far
    // outside the top-N (or absent, so the client can show a join CTA).
    const uid = authUserId(req);
    let me: { optedIn: boolean; rank: number | null; value: number | null } | null = null;
    if (uid) {
      const optedIn = socialStore.get(uid).prefs.leaderboards;
      const idx = rows.findIndex((r) => r.userId === uid);
      me = { optedIn, rank: idx >= 0 ? idx + 1 : null, value: idx >= 0 ? rows[idx]!.value : null };
    }

    return { board, scope, weekKey, total: rows.length, entries: top, me };
  });

  // --- share prefs ---------------------------------------------------------

  app.get('/api/social/prefs', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const social = socialStore.get(uid);
    return { prefs: social.prefs, favoriteOpenings: social.favoriteOpenings };
  });

  app.put('/api/social/prefs', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const body = (req.body ?? {}) as { prefs?: unknown; favoriteOpenings?: unknown };
    const social = socialStore.get(uid);
    const prefs = sanitizePrefs(social.prefs, body.prefs);
    socialStore.setPrefs(uid, prefs);
    if (body.favoriteOpenings !== undefined) {
      socialStore.setFavoriteOpenings(uid, sanitizeOpenings(body.favoriteOpenings));
    }
    return { ok: true, prefs };
  });

  // --- public profile ------------------------------------------------------

  app.get('/api/social/profile/:username', async (req, reply) => {
    const { username } = req.params as { username: string };
    const user = store.getUser(username);
    // One 404 for "no such user" and "not shared" — don't leak account existence.
    const notFound = () => reply.code(404).send({ error: 'This profile is private or does not exist.' });
    if (!user) return notFound();
    const social = socialStore.get(user.id);
    if (!social.prefs.profile) return notFound();

    const blob = store.getProgress(user.id)?.data ?? null;
    const nowMs = now();
    const profile: Record<string, unknown> = {
      username: user.username,
      memberSince: new Date(user.createdAt).toISOString().slice(0, 7), // YYYY-MM, no finer
    };

    if (social.prefs.showRatings) {
      const ratings: Record<string, unknown> = {};
      for (const cat of ['puzzles', 'bots', 'blitz'] as const) {
        const c = extractCategory(blob, cat);
        if (c) {
          ratings[cat] = {
            elo: Math.round(c.elo),
            peak: Math.round(c.eloPeak),
            played: c.played,
            won: c.won,
            drawn: c.drawn,
            lost: c.lost,
          };
        }
      }
      profile.ratings = ratings;
    }

    if (social.prefs.showRecord) {
      // W/D/L across game boards (bots + blitz) — puzzles aren't games.
      let wins = 0,
        draws = 0,
        losses = 0;
      for (const cat of ['bots', 'blitz'] as const) {
        const c = extractCategory(blob, cat);
        if (c) {
          wins += c.won;
          draws += c.drawn;
          losses += c.lost;
        }
      }
      profile.record = { wins, draws, losses };
    }

    if (social.prefs.showRush) {
      // Prefer the leaderboard entry (bounded + rate-limited by validation.ts);
      // fall back to a synced blob value, clamped to the same plausibility cap.
      const entry = social.boards.rush;
      const synced = extractRushBest(blob);
      const best = Math.max(entry?.value ?? 0, Math.min(synced ?? 0, LB_LIMITS.rushCap));
      profile.rushBest = best;
    }

    if (social.prefs.showStreak) {
      const s =
        blob && typeof blob === 'object' && !Array.isArray(blob)
          ? ((blob as Record<string, unknown>).streak as Record<string, unknown> | undefined)
          : undefined;
      const count = typeof s?.count === 'number' && Number.isFinite(s.count) ? Math.max(0, Math.floor(s.count)) : 0;
      const best = typeof s?.best === 'number' && Number.isFinite(s.best) ? Math.max(count, Math.floor(s.best)) : count;
      const freezes = typeof s?.freezes === 'number' && Number.isFinite(s.freezes) ? Math.min(Math.max(0, s.freezes), 2) : 0;
      const lastDay = typeof s?.lastDay === 'string' ? Date.parse(s.lastDay) : NaN;
      // "Current" only while the run is still alive: last active within one
      // day (+ banked freezes, + one day of local-vs-UTC slack).
      const alive = Number.isFinite(lastDay) && utcDayDiff(lastDay, nowMs) <= 2 + freezes;
      profile.streak = { current: alive ? count : 0, best };
    }

    if (social.prefs.showAchievements) {
      const a =
        blob && typeof blob === 'object' && !Array.isArray(blob)
          ? ((blob as Record<string, unknown>).achievements as Record<string, unknown> | undefined)
          : undefined;
      const unlocked = a && typeof a.unlocked === 'object' && a.unlocked !== null ? (a.unlocked as Record<string, unknown>) : {};
      const items = Object.entries(unlocked)
        .filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]))
        .sort((x, y) => y[1] - x[1])
        .slice(0, 8)
        .map(([id, unlockedAt]) => ({ id: id.slice(0, 64), unlockedAt }));
      profile.achievements = items;
    }

    if (social.prefs.showOpenings) {
      profile.favoriteOpenings = social.favoriteOpenings;
    }

    return profile;
  });
}
