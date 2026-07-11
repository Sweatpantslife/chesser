import type { TablebaseCategory, TablebaseResult } from '@chesser/shared';
import { syzygyInfo } from './config.js';
import { probeLocalSyzygy } from './tablebase-local.js';
import { LruCache } from './util/lru.js';

/**
 * Syzygy tablebase access. The online proxy (default: the public Lichess
 * tablebase API) is preferred because it carries DTZ/DTM; when it is unreachable
 * we fall back to local Syzygy files, if installed, so the endgame trainer keeps
 * working offline. On any failure we report `available: false` and the caller
 * falls back to the engine. Results are cached in-memory.
 *
 * Point CHESSER_TABLEBASE_URL at a self-hosted instance, and/or drop tablebase
 * files in engines/syzygy (or set CHESSER_SYZYGY_PATH) for the local fallback.
 */
const UPSTREAM = process.env.CHESSER_TABLEBASE_URL ?? 'https://tablebase.lichess.ovh/standard';
const MAX_PIECES = 7;
const TIMEOUT_MS = 4000;
// After the upstream times out, serve from local tablebases (if any) for this
// long before paying the timeout again — keeps offline play snappy.
const ONLINE_COOLDOWN_MS = 60_000;

// LRU-bounded so a long training session (or a hostile client) can't grow the
// process without limit; ~5k entries is far more than one endgame ever visits.
const CACHE_MAX = 5000;
const cache = new LruCache<string, TablebaseResult>(CACHE_MAX);
let onlineDownUntil = 0;

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
    source: 'online',
    category: (data.category ?? 'unknown') as TablebaseCategory,
    dtz: data.dtz ?? null,
    dtm: data.dtm ?? null,
    checkmate: !!data.checkmate,
    stalemate: !!data.stalemate,
    moves,
  };
}

/** Query the online proxy. `unreachable` distinguishes timeouts/network errors. */
async function probeOnline(fen: string): Promise<{ result: TablebaseResult; unreachable: boolean }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${UPSTREAM}?fen=${encodeURIComponent(fen)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'chesser-trainer' },
    });
    clearTimeout(timer);
    if (!res.ok) return { result: { available: false, reason: `http-${res.status}` }, unreachable: false };
    return { result: normalize(await res.json()), unreachable: false };
  } catch {
    return { result: { available: false, reason: 'unreachable' }, unreachable: true };
  }
}

export async function probeTablebase(fen: string): Promise<TablebaseResult> {
  if (pieceCount(fen) > MAX_PIECES) return { available: false, reason: 'too-many-pieces' };
  const cached = cache.get(fen);
  if (cached) return cached;

  const sz = syzygyInfo();
  const localOk = !!sz && pieceCount(fen) <= sz.maxPieces;

  // While the upstream is known-down, skip the timeout and serve locally.
  if (localOk && Date.now() < onlineDownUntil) {
    const local = await probeLocalSyzygy(fen);
    if (local?.available) {
      cache.set(fen, local);
      return local;
    }
  }

  const { result, unreachable } = await probeOnline(fen);
  if (result.available) {
    onlineDownUntil = 0;
    cache.set(fen, result);
    return result;
  }
  if (unreachable) onlineDownUntil = Date.now() + ONLINE_COOLDOWN_MS;

  // Online failed — fall back to local Syzygy files if we have them.
  if (localOk) {
    const local = await probeLocalSyzygy(fen);
    if (local?.available) {
      cache.set(fen, local);
      return local;
    }
  }
  return result;
}
