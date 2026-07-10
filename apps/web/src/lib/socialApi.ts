/**
 * Client for the social endpoints (apps/server/src/social/routes.ts):
 * leaderboards, share prefs and public profiles. Kept separate from lib/api.ts
 * so the social layer stays self-contained.
 */

async function jsonOrThrow(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

// --- leaderboards -----------------------------------------------------------

export type BoardId = 'puzzles' | 'bots' | 'rush';
export type BoardScope = 'global' | 'weekly';

export interface BoardRow {
  rank: number;
  username: string;
  value: number;
  played?: number;
}

export interface BoardResponse {
  board: BoardId;
  scope: BoardScope;
  weekKey: string;
  total: number;
  entries: BoardRow[];
  me: { optedIn: boolean; rank: number | null; value: number | null } | null;
}

export function apiFetchBoard(board: BoardId, scope: BoardScope, token: string | null, limit = 25): Promise<BoardResponse> {
  return fetch(`/api/leaderboard/${board}?scope=${scope}&limit=${limit}`, {
    headers: token ? authHeaders(token) : {},
  }).then(jsonOrThrow);
}

export interface SubmitResponse {
  ok: boolean;
  changed: boolean;
  value: number;
  note?: string;
}

export function apiSubmitScore(token: string, board: BoardId, value: number): Promise<SubmitResponse> {
  return fetch('/api/leaderboard/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ board, value }),
  }).then(jsonOrThrow);
}

// --- share prefs ------------------------------------------------------------

export interface SocialPrefs {
  leaderboards: boolean;
  profile: boolean;
  showRatings: boolean;
  showRush: boolean;
  showStreak: boolean;
  showAchievements: boolean;
  showOpenings: boolean;
  showRecord: boolean;
}

export const DEFAULT_SOCIAL_PREFS: SocialPrefs = {
  leaderboards: false,
  profile: false,
  showRatings: false,
  showRush: false,
  showStreak: false,
  showAchievements: false,
  showOpenings: false,
  showRecord: false,
};

export interface FavoriteOpening {
  name: string;
  eco: string | null;
  games: number;
  wins: number;
}

export function apiGetSocialPrefs(token: string): Promise<{ prefs: SocialPrefs; favoriteOpenings: FavoriteOpening[] }> {
  return fetch('/api/social/prefs', { headers: authHeaders(token) }).then(jsonOrThrow);
}

export function apiPutSocialPrefs(
  token: string,
  prefs: Partial<SocialPrefs>,
  favoriteOpenings?: FavoriteOpening[],
): Promise<{ ok: boolean; prefs: SocialPrefs }> {
  return fetch('/api/social/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(favoriteOpenings !== undefined ? { prefs, favoriteOpenings } : { prefs }),
  }).then(jsonOrThrow);
}

// --- public profile ---------------------------------------------------------

export interface PublicProfile {
  username: string;
  memberSince: string; // YYYY-MM
  ratings?: Partial<Record<'puzzles' | 'bots' | 'blitz', { elo: number; peak: number; played: number; won: number; drawn: number; lost: number }>>;
  record?: { wins: number; draws: number; losses: number };
  rushBest?: number;
  streak?: { current: number; best: number };
  achievements?: { id: string; unlockedAt: number }[];
  favoriteOpenings?: FavoriteOpening[];
}

export function apiGetPublicProfile(username: string): Promise<PublicProfile> {
  return fetch(`/api/social/profile/${encodeURIComponent(username)}`).then(jsonOrThrow);
}

/** The shareable URL for a profile (hash-routed, same-origin). */
export function profileUrl(username: string): string {
  return `${window.location.origin}${window.location.pathname}#/profile/${encodeURIComponent(username)}`;
}
