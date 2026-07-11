import type { ExplorerDb, ExplorerGame, ExplorerMove, ExplorerResult, ExplorerSpeed } from '@chesser/shared';
import { EXPLORER_RATINGS } from '@chesser/shared';

/**
 * Opening-explorer client: position-keyed LRU cache + debounced feed over the
 * server's /api/explorer proxy (which fronts the Lichess opening explorer).
 *
 * Everything network-shaped is injectable so the logic is unit-testable
 * without live calls: `fetchExplorer` takes a fetch function, and
 * `createExplorerFeed` additionally takes its debounce from the ambient
 * timers (fake-timer friendly).
 */

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Lichess-DB filters. Masters ignores them (it has no speed/rating splits). */
export interface ExplorerFilters {
  speeds: ExplorerSpeed[];
  /** Minimum rating bucket to include (0 = everyone). */
  minRating: number;
}

export const DEFAULT_FILTERS: ExplorerFilters = { speeds: ['blitz', 'rapid', 'classical'], minRating: 0 };

/** The Lichess `ratings` param lists buckets to include — everything ≥ min. */
export function ratingBucketsFrom(minRating: number): number[] {
  return EXPLORER_RATINGS.filter((r) => r >= minRating);
}

// ---------------------------------------------------------------------------
// Position-keyed cache key
// ---------------------------------------------------------------------------

/**
 * Cache key for a query. Keys on the *position* (EPD — the FEN without its
 * move counters) so transpositions and different move numbers share an entry,
 * exactly like the upstream database does.
 */
export function explorerKey(fen: string, db: ExplorerDb, filters: ExplorerFilters, games = 0): string {
  const epd = fen.trim().split(/\s+/).slice(0, 4).join(' ');
  if (db === 'masters') return `masters:${games}:${epd}`;
  const speeds = [...filters.speeds].sort().join(',');
  return `lichess:${games}:${speeds}:${filters.minRating}:${epd}`;
}

// ---------------------------------------------------------------------------
// LRU cache
// ---------------------------------------------------------------------------

/** Tiny LRU on Map insertion order: get() refreshes, set() evicts the oldest. */
export class LruCache<V> {
  private map = new Map<string, V>();

  constructor(private readonly max: number) {
    if (max < 1) throw new Error('LruCache: max must be >= 1');
  }

  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key); // re-insert to mark as most recently used
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

// ---------------------------------------------------------------------------
// Response normalization (defensive — never trust the wire)
// ---------------------------------------------------------------------------

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

function normalizeMove(m: any): ExplorerMove | null {
  if (!m || typeof m.uci !== 'string' || typeof m.san !== 'string') return null;
  const white = num(m.white);
  const draws = num(m.draws);
  const black = num(m.black);
  return {
    uci: m.uci,
    san: m.san,
    white,
    draws,
    black,
    total: white + draws + black,
    averageRating: typeof m.averageRating === 'number' ? m.averageRating : null,
  };
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

/**
 * Turn whatever came off the wire into a well-formed ExplorerResult: malformed
 * payloads become `available: false`, malformed rows are dropped, counts are
 * clamped to non-negative numbers and per-move totals recomputed, and moves
 * are ordered most-played first.
 */
export function normalizeExplorerResult(raw: unknown): ExplorerResult {
  if (!raw || typeof raw !== 'object') return { available: false, reason: 'malformed' };
  const r = raw as Record<string, unknown>;
  if (r.available !== true) {
    return { available: false, reason: typeof r.reason === 'string' ? r.reason : 'unavailable' };
  }
  const moves = (Array.isArray(r.moves) ? r.moves : [])
    .map(normalizeMove)
    .filter((m): m is ExplorerMove => m !== null)
    .sort((a, b) => b.total - a.total);
  const white = num(r.white);
  const draws = num(r.draws);
  const black = num(r.black);
  const opening =
    r.opening && typeof (r.opening as { name?: unknown }).name === 'string'
      ? {
          eco: typeof (r.opening as { eco?: unknown }).eco === 'string' ? (r.opening as { eco: string }).eco : undefined,
          name: (r.opening as { name: string }).name,
        }
      : null;
  const games = (list: unknown) =>
    (Array.isArray(list) ? list : []).map(normalizeGame).filter((g): g is ExplorerGame => g !== null);
  return {
    available: true,
    white,
    draws,
    black,
    total: white + draws + black,
    moves,
    opening,
    topGames: games(r.topGames),
    recentGames: games(r.recentGames),
  };
}

// ---------------------------------------------------------------------------
// Fetching (LRU-cached, in-flight deduped)
// ---------------------------------------------------------------------------

export interface FetchExplorerOpts {
  /** Top/recent games to request (server clamps to 0-8). */
  games?: number;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
  /** Injectable for tests; defaults to the shared module cache. */
  cache?: LruCache<ExplorerResult>;
}

const CACHE_MAX = 200;
const sharedCache = new LruCache<ExplorerResult>(CACHE_MAX);
const inFlight = new Map<string, Promise<ExplorerResult>>();

/** The cached result for a query, if any — lets callers skip the debounce. */
export function peekExplorer(fen: string, db: ExplorerDb, filters: ExplorerFilters, opts: FetchExplorerOpts = {}): ExplorerResult | undefined {
  return (opts.cache ?? sharedCache).get(explorerKey(fen, db, filters, opts.games ?? 0));
}

function explorerUrl(fen: string, db: ExplorerDb, filters: ExplorerFilters, games: number): string {
  const params = new URLSearchParams({ fen, db, games: String(games) });
  if (db === 'lichess') {
    params.set('speeds', [...filters.speeds].sort().join(','));
    if (filters.minRating > 0) params.set('ratings', ratingBucketsFrom(filters.minRating).join(','));
  }
  return `/api/explorer?${params.toString()}`;
}

/**
 * Fetch stats for a position. Successful results are LRU-cached by position;
 * failures are returned as `available: false` and never cached, so a retry
 * actually retries. Concurrent identical queries share one request.
 */
export function fetchExplorer(
  fen: string,
  db: ExplorerDb,
  filters: ExplorerFilters,
  opts: FetchExplorerOpts = {},
): Promise<ExplorerResult> {
  const games = opts.games ?? 0;
  const cache = opts.cache ?? sharedCache;
  const key = explorerKey(fen, db, filters, games);

  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const fetchFn = opts.fetchFn ?? fetch;
  const p = (async (): Promise<ExplorerResult> => {
    try {
      const res = await fetchFn(explorerUrl(fen, db, filters, games));
      if (!res.ok) return { available: false, reason: `http-${res.status}` };
      const result = normalizeExplorerResult(await res.json());
      if (result.available) cache.set(key, result);
      return result;
    } catch {
      return { available: false, reason: 'network' };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// Debounced feed
// ---------------------------------------------------------------------------

export interface ExplorerFeedUpdate {
  key: string;
  result: ExplorerResult | null;
  loading: boolean;
}

export interface ExplorerFeed {
  /** Point the feed at a position. Cached answers emit synchronously; anything else emits a loading update, then the result after the debounce. */
  set(fen: string, db: ExplorerDb, filters: ExplorerFilters): void;
  /** Cancel any pending fetch and stop emitting. */
  dispose(): void;
}

/**
 * A debounced query feed: rapid position changes (holding an arrow key,
 * clicking through a line) collapse into one request for wherever the user
 * lands, while already-cached positions render instantly. Stale responses —
 * answers for a position the feed has moved past — are dropped.
 */
export function createExplorerFeed(
  onUpdate: (u: ExplorerFeedUpdate) => void,
  opts: FetchExplorerOpts & { debounceMs?: number } = {},
): ExplorerFeed {
  const debounceMs = opts.debounceMs ?? 250;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: string | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    set(fen, db, filters) {
      const key = explorerKey(fen, db, filters, opts.games ?? 0);
      current = key;
      clear();
      const cached = peekExplorer(fen, db, filters, opts);
      if (cached) {
        onUpdate({ key, result: cached, loading: false });
        return;
      }
      onUpdate({ key, result: null, loading: true });
      timer = setTimeout(() => {
        timer = null;
        void fetchExplorer(fen, db, filters, opts).then((result) => {
          if (current === key) onUpdate({ key, result, loading: false });
        });
      }, debounceMs);
    },
    dispose() {
      clear();
      current = null;
    },
  };
}
