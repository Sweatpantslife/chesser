/**
 * Friends & challenges — domain rules for the async social graph.
 *
 * Follows the anti-abuse doctrine of PRs #27/#31: every input is validated and
 * bounded, every state-changing action is rate-limited per account, and the
 * only identity that ever crosses the wire is the display name (the account
 * username) — no ids, emails or tokens.
 *
 * Privacy:
 *  - Adding by USERNAME only works when the target opted into a public
 *    profile (`prefs.profile`) — users who never opted in are not discoverable,
 *    and "no such user" and "not discoverable" share one identical answer.
 *  - Adding by FRIEND CODE always works: the code exists only when its owner
 *    fetched it to share, so possession of the code IS the opt-in.
 *  - The activity feed derives events exclusively from data each friend
 *    already shares publicly (leaderboard entries, opted-in profile sections).
 *
 * Everything time-dependent reads the injectable clock (social/clock.ts).
 */

import type { FriendColor, FriendTimeControl } from '@chesser/shared';
import type { SocialPrefs } from './validation.js';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const FRIEND_LIMITS = {
  /** Max accepted friends per account. */
  maxFriends: 100,
  /** Max outstanding outgoing friend requests. */
  maxPendingRequests: 20,
  /** Min spacing between friend-request sends per account. */
  requestIntervalMs: 5_000,
  /** After a decline, the same sender→target request is blocked this long. */
  declineCooldownMs: 60 * 60 * 1000,
  /** Min spacing between challenge sends per account. */
  challengeIntervalMs: 5_000,
  /** Max outstanding outgoing challenges. */
  maxPendingChallenges: 10,
  /** A pending challenge expires after this long. */
  challengePendingTtlMs: 24 * 60 * 60 * 1000,
  /** Resolved challenges (accepted/declined/cancelled/expired) linger this long. */
  challengeResolvedTtlMs: 60 * 60 * 1000,
  /** Feed: events older than this never show. */
  feedWindowMs: 14 * 86_400_000,
  /** Feed: max events served. */
  feedMax: 50,
} as const;

// ---------------------------------------------------------------------------
// Stored shapes (persisted inside social/store.ts)
// ---------------------------------------------------------------------------

export interface FriendEdgeRec {
  /** The two user ids, sorted ascending — one record per friendship. */
  a: string;
  b: string;
  since: number;
}

export interface FriendRequestRec {
  id: string;
  from: string; // userId
  to: string; // userId
  at: number;
}

export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface ChallengeRec {
  id: string;
  from: string; // userId (challenger)
  to: string; // userId (challenged friend)
  timeControl: FriendTimeControl | null;
  /** The CHALLENGER's requested color. */
  color: FriendColor | 'random';
  createdAt: number;
  status: ChallengeStatus;
  resolvedAt?: number;
  /** Friend-room code, set when accepted. */
  roomCode?: string;
}

/** The whole friends/challenges graph as persisted. */
export interface FriendGraph {
  edges: FriendEdgeRec[];
  requests: FriendRequestRec[];
  /** userId → shareable friend code (created lazily, stable once created). */
  codes: Record<string, string>;
  /** `${from}:${to}` → decline time (re-request cooldown). */
  declinedAt: Record<string, number>;
  /** userId → last friend-request send (rate limit). */
  lastRequestAt: Record<string, number>;
  /** userId → last challenge send (rate limit). */
  lastChallengeAt: Record<string, number>;
  challenges: ChallengeRec[];
}

export function freshGraph(): FriendGraph {
  return { edges: [], requests: [], codes: {}, declinedAt: {}, lastRequestAt: {}, lastChallengeAt: {}, challenges: [] };
}

// ---------------------------------------------------------------------------
// Graph queries
// ---------------------------------------------------------------------------

const edgeKey = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

export function areFriends(g: FriendGraph, x: string, y: string): boolean {
  const [a, b] = edgeKey(x, y);
  return g.edges.some((e) => e.a === a && e.b === b);
}

export function friendsOf(g: FriendGraph, uid: string): { id: string; since: number }[] {
  const out: { id: string; since: number }[] = [];
  for (const e of g.edges) {
    if (e.a === uid) out.push({ id: e.b, since: e.since });
    else if (e.b === uid) out.push({ id: e.a, since: e.since });
  }
  return out;
}

export function friendCount(g: FriendGraph, uid: string): number {
  return friendsOf(g, uid).length;
}

export function addEdge(g: FriendGraph, x: string, y: string, at: number): void {
  if (areFriends(g, x, y)) return;
  const [a, b] = edgeKey(x, y);
  g.edges.push({ a, b, since: at });
}

export function removeEdge(g: FriendGraph, x: string, y: string): boolean {
  const [a, b] = edgeKey(x, y);
  const before = g.edges.length;
  g.edges = g.edges.filter((e) => !(e.a === a && e.b === b));
  return g.edges.length < before;
}

export function pendingBetween(g: FriendGraph, from: string, to: string): FriendRequestRec | undefined {
  return g.requests.find((r) => r.from === from && r.to === to);
}

// ---------------------------------------------------------------------------
// Friend codes
// ---------------------------------------------------------------------------

/** Same unambiguous alphabet as friend-room codes (no 0/O/1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const FRIEND_CODE_LENGTH = 8;
export const FRIEND_CODE_RE = /^[A-Z2-9]{8}$/;

export function generateFriendCode(taken: (code: string) => boolean): string {
  for (;;) {
    let out = '';
    for (let i = 0; i < FRIEND_CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!taken(out)) return out;
  }
}

/** Get-or-create `uid`'s friend code. Mutates g when creating. */
export function friendCodeOf(g: FriendGraph, uid: string): { code: string; created: boolean } {
  const existing = g.codes[uid];
  if (existing) return { code: existing, created: false };
  const taken = new Set(Object.values(g.codes));
  const code = generateFriendCode((c) => taken.has(c));
  g.codes[uid] = code;
  return { code, created: true };
}

export function userIdByFriendCode(g: FriendGraph, code: string): string | null {
  const norm = code.toUpperCase().trim();
  for (const [uid, c] of Object.entries(g.codes)) if (c === norm) return uid;
  return null;
}

// ---------------------------------------------------------------------------
// Housekeeping (expiry + stale bookkeeping)
// ---------------------------------------------------------------------------

/** Expire stale challenges and drop old resolved records + bookkeeping. */
export function pruneGraph(g: FriendGraph, nowMs: number): boolean {
  let changed = false;
  for (const c of g.challenges) {
    if (c.status === 'pending' && nowMs - c.createdAt > FRIEND_LIMITS.challengePendingTtlMs) {
      c.status = 'expired';
      c.resolvedAt = nowMs;
      changed = true;
    }
  }
  const keep = g.challenges.filter(
    (c) => c.status === 'pending' || nowMs - (c.resolvedAt ?? c.createdAt) <= FRIEND_LIMITS.challengeResolvedTtlMs,
  );
  if (keep.length !== g.challenges.length) {
    g.challenges = keep;
    changed = true;
  }
  for (const [k, at] of Object.entries(g.declinedAt)) {
    if (nowMs - at > FRIEND_LIMITS.declineCooldownMs) {
      delete g.declinedAt[k];
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export type FeedKind = 'rush' | 'rating' | 'achievement' | 'streak';

export interface FeedEvent {
  username: string;
  at: number;
  kind: FeedKind;
  /** Rating events: which board. */
  board?: 'puzzles' | 'bots';
  /** Rush score or rating value. */
  value?: number;
  /** Achievement id. */
  id?: string;
  /** Streak length in days. */
  count?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const DAY_MS = 86_400_000;
const utcDayDiff = (aMs: number, bMs: number): number => Math.floor(bMs / DAY_MS) - Math.floor(aMs / DAY_MS);

interface FeedSocial {
  prefs: SocialPrefs;
  boards: Partial<Record<'puzzles' | 'bots' | 'rush', { value: number; updatedAt: number }>>;
}

/**
 * Events one friend contributes to the feed — derived ONLY from what they
 * already share publicly:
 *  - board entries (leaderboards opt-in ⇒ the values are public on the boards),
 *  - achievements / streak (public-profile sections they flipped on).
 * A friend who shares nothing contributes nothing.
 */
export function feedEventsFor(username: string, social: FeedSocial, blob: unknown, nowMs: number): FeedEvent[] {
  const events: FeedEvent[] = [];
  const fresh = (at: number) => isNum(at) && at <= nowMs + DAY_MS && nowMs - at <= FRIEND_LIMITS.feedWindowMs;

  if (social.prefs.leaderboards) {
    const rush = social.boards.rush;
    if (rush && rush.value > 0 && fresh(rush.updatedAt)) {
      events.push({ username, at: rush.updatedAt, kind: 'rush', value: rush.value });
    }
    for (const board of ['puzzles', 'bots'] as const) {
      const entry = social.boards[board];
      if (entry && fresh(entry.updatedAt)) {
        events.push({ username, at: entry.updatedAt, kind: 'rating', board, value: entry.value });
      }
    }
  }

  if (social.prefs.profile && social.prefs.showAchievements && isObj(blob)) {
    const a = blob.achievements;
    const unlocked = isObj(a) && isObj(a.unlocked) ? a.unlocked : {};
    const recent = Object.entries(unlocked)
      .filter((e): e is [string, number] => isNum(e[1]) && fresh(e[1]))
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3);
    for (const [id, at] of recent) events.push({ username, at, kind: 'achievement', id: id.slice(0, 64) });
  }

  if (social.prefs.profile && social.prefs.showStreak && isObj(blob)) {
    const s = isObj(blob.streak) ? blob.streak : {};
    const count = isNum(s.count) ? Math.max(0, Math.floor(s.count)) : 0;
    const freezes = isNum(s.freezes) ? Math.min(Math.max(0, s.freezes), 2) : 0;
    const lastDay = typeof s.lastDay === 'string' ? Date.parse(s.lastDay) : NaN;
    const alive = Number.isFinite(lastDay) && utcDayDiff(lastDay, nowMs) <= 2 + freezes;
    if (alive && count >= 3 && fresh(lastDay)) events.push({ username, at: lastDay, kind: 'streak', count });
  }

  return events;
}
