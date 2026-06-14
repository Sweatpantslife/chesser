import type { TablebaseCategory, TablebaseResult } from '@chesser/shared';

/**
 * Syzygy tablebase access, proxied to a configurable upstream (default: the
 * public Lichess tablebase API). Positions with ≤7 pieces are looked up; on any
 * failure (host blocked, timeout, too many pieces) we report `available: false`
 * and the caller falls back to the engine. Results are cached in-memory.
 *
 * Point CHESSER_TABLEBASE_URL at a self-hosted instance if you run one.
 */
const UPSTREAM = process.env.CHESSER_TABLEBASE_URL ?? 'https://tablebase.lichess.ovh/standard';
const MAX_PIECES = 7;
const TIMEOUT_MS = 4000;

const cache = new Map<string, TablebaseResult>();

function pieceCount(fen: string): number {
  return (fen.split(' ')[0] ?? '').replace(/[^a-zA-Z]/g, '').length;
}

/** Invert a category to the opposite side's point of view. */
function invert(cat: TablebaseCategory): TablebaseCategory {
  switch (cat) {
    case 'win':
      return 'loss';
    case 'loss':
      return 'win';
    case 'cursed-win':
      return 'blessed-loss';
    case 'blessed-loss':
      return 'cursed-win';
    default:
      return cat;
  }
}

function normalize(data: any): TablebaseResult {
  const moves = Array.isArray(data.moves)
    ? data.moves.map((m: any) => ({
        uci: m.uci as string,
        san: m.san as string | undefined,
        // Upstream move category is the position AFTER the move (opponent POV);
        // invert so it reads as the result for the side that plays it.
        category: invert((m.category ?? 'unknown') as TablebaseCategory),
        dtz: m.dtz ?? null,
        dtm: m.dtm ?? null,
      }))
    : [];
  return {
    available: true,
    category: (data.category ?? 'unknown') as TablebaseCategory,
    dtz: data.dtz ?? null,
    dtm: data.dtm ?? null,
    checkmate: !!data.checkmate,
    stalemate: !!data.stalemate,
    moves,
  };
}

export async function probeTablebase(fen: string): Promise<TablebaseResult> {
  if (pieceCount(fen) > MAX_PIECES) return { available: false, reason: 'too-many-pieces' };
  const cached = cache.get(fen);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${UPSTREAM}?fen=${encodeURIComponent(fen)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'chesser-trainer' },
    });
    clearTimeout(timer);
    if (!res.ok) return { available: false, reason: `http-${res.status}` };
    const result = normalize(await res.json());
    cache.set(fen, result);
    return result;
  } catch {
    return { available: false, reason: 'unreachable' };
  }
}
