import type { ExplorerDb, ExplorerResult } from '@chesser/shared';

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

const cache = new Map<string, ExplorerResult>();

/** Request headers, including a Bearer token when CHESSER_LICHESS_TOKEN is set. */
function explorerHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'chesser-trainer' };
  const token = process.env.CHESSER_LICHESS_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function normalize(data: any): ExplorerResult {
  const moves = Array.isArray(data.moves)
    ? data.moves.map((m: any) => {
        const white = m.white ?? 0;
        const draws = m.draws ?? 0;
        const black = m.black ?? 0;
        return { uci: m.uci as string, san: m.san as string, white, draws, black, total: white + draws + black };
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
  };
}

export async function probeExplorer(fen: string, db: ExplorerDb): Promise<ExplorerResult> {
  const key = `${db}:${fen}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const base = db === 'masters' ? MASTERS : LICHESS;
  const params = new URLSearchParams({ fen, moves: '12', topGames: '0' });
  if (db === 'lichess') params.set('speeds', 'blitz,rapid,classical');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${base}?${params.toString()}`, {
      signal: controller.signal,
      headers: explorerHeaders(),
    });
    clearTimeout(timer);
    if (!res.ok) return { available: false, reason: `http-${res.status}` };
    const result = normalize(await res.json());
    cache.set(key, result);
    return result;
  } catch {
    return { available: false, reason: 'unreachable' };
  }
}
