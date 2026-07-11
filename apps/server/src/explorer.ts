import type { ExplorerDb, ExplorerGame, ExplorerResult } from '@chesser/shared';
import { EXPLORER_RATINGS, EXPLORER_SPEEDS } from '@chesser/shared';

/**
 * Opening explorer, proxied to a configurable upstream (default: the Lichess
 * opening-explorer API). Like the tablebase proxy, any failure reports
 * `available: false` so the client degrades gracefully. Results are cached.
 *
 * Override hosts with CHESSER_EXPLORER_MASTERS_URL / CHESSER_EXPLORER_LICHESS_URL.
 *
 * Auth: Lichess started requiring a logged-in account on explorer.lichess.ovh
 * (after abuse/DDoS), so unauthenticated requests now get `401`. Set
 * CHESSER_LICHESS_TOKEN to a Lichess API token and it is sent as a Bearer
 * header. Without a token the explorer simply reports itself unavailable, and
 * the rest of the app is unaffected.
 */
const MASTERS = process.env.CHESSER_EXPLORER_MASTERS_URL ?? 'https://explorer.lichess.ovh/masters';
const LICHESS = process.env.CHESSER_EXPLORER_LICHESS_URL ?? 'https://explorer.lichess.ovh/lichess';
const TIMEOUT_MS = 5000;

/** Fetch options accepted from the client (sanitized before hitting upstream). */
export interface ExplorerOpts {
  /** Lichess-DB time controls (comma-joined upstream). Ignored for masters. */
  speeds?: string;
  /** Lichess-DB rating buckets (comma-joined upstream). Ignored for masters. */
  ratings?: string;
  /** How many top/recent games to include (0-8, default 0 to match the old behavior). */
  games?: number;
}

// Successful probes are cached per (db, fen, filters). Bounded so a crawler
// walking many positions can't grow the process without limit; Map iteration
// order is insertion order, so evicting the first key drops the oldest entry.
const MAX_CACHE = 1000;
const cache = new Map<string, ExplorerResult>();

/** Request headers, including a Bearer token when CHESSER_LICHESS_TOKEN is set. */
function explorerHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'chesser-trainer' };
  const token = process.env.CHESSER_LICHESS_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Keep only recognized speeds, in canonical order; empty → undefined (upstream default). */
export function sanitizeSpeeds(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const asked = new Set(raw.split(',').map((s) => s.trim()));
  const valid = EXPLORER_SPEEDS.filter((s) => asked.has(s));
  return valid.length > 0 ? valid.join(',') : undefined;
}

/** Keep only recognized rating buckets, in canonical order; empty → undefined. */
export function sanitizeRatings(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const asked = new Set(raw.split(',').map((s) => Number(s.trim())));
  const valid = EXPLORER_RATINGS.filter((r) => asked.has(r));
  return valid.length > 0 ? valid.join(',') : undefined;
}

function normalizeGame(g: any): ExplorerGame | null {
  if (!g || typeof g.id !== 'string') return null;
  return {
    id: g.id,
    winner: g.winner === 'white' || g.winner === 'black' ? g.winner : null,
    white: { name: String(g.white?.name ?? '?'), rating: typeof g.white?.rating === 'number' ? g.white.rating : null },
    black: { name: String(g.black?.name ?? '?'), rating: typeof g.black?.rating === 'number' ? g.black.rating : null },
    year: typeof g.year === 'number' ? g.year : null,
    month: typeof g.month === 'string' ? g.month : null,
    speed: typeof g.speed === 'string' ? g.speed : null,
    uci: typeof g.uci === 'string' ? g.uci : null,
    san: typeof g.san === 'string' ? g.san : null,
  };
}

function normalizeGames(list: unknown): ExplorerGame[] {
  return Array.isArray(list) ? (list.map(normalizeGame).filter(Boolean) as ExplorerGame[]) : [];
}

function normalize(data: any): ExplorerResult {
  const moves = Array.isArray(data.moves)
    ? data.moves.map((m: any) => {
        const white = m.white ?? 0;
        const draws = m.draws ?? 0;
        const black = m.black ?? 0;
        return {
          uci: m.uci as string,
          san: m.san as string,
          white,
          draws,
          black,
          total: white + draws + black,
          // Only include the key when the upstream reports it, so results for
          // upstreams without ratings stay byte-identical to the old shape.
          ...(typeof m.averageRating === 'number' ? { averageRating: m.averageRating } : {}),
        };
      })
    : [];
  const white = data.white ?? 0;
  const draws = data.draws ?? 0;
  const black = data.black ?? 0;
  return {
    available: true,
    white,
    draws,
    black,
    total: white + draws + black,
    moves,
    opening: data.opening ?? null,
    topGames: normalizeGames(data.topGames),
    recentGames: normalizeGames(data.recentGames),
  };
}

export async function probeExplorer(fen: string, db: ExplorerDb, opts: ExplorerOpts = {}): Promise<ExplorerResult> {
  const speeds = db === 'lichess' ? (sanitizeSpeeds(opts.speeds) ?? 'blitz,rapid,classical') : undefined;
  const ratings = db === 'lichess' ? sanitizeRatings(opts.ratings) : undefined;
  const games = Math.min(Math.max(Math.trunc(opts.games ?? 0), 0), 8);

  const key = `${db}:${fen}:${speeds ?? ''}:${ratings ?? ''}:${games}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const base = db === 'masters' ? MASTERS : LICHESS;
  const params = new URLSearchParams({ fen, moves: '12', topGames: String(games) });
  if (db === 'lichess') {
    params.set('speeds', speeds!);
    if (ratings) params.set('ratings', ratings);
    params.set('recentGames', String(games));
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${base}?${params.toString()}`, {
      signal: controller.signal,
      headers: explorerHeaders(),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { available: false, reason: `http-${res.status}` };
    const result = normalize(await res.json());
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
    cache.set(key, result);
    return result;
  } catch {
    return { available: false, reason: 'unreachable' };
  }
}
