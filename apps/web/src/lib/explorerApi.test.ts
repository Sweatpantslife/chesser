import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerResult } from '@chesser/shared';
import {
  DEFAULT_FILTERS,
  LruCache,
  createExplorerFeed,
  explorerKey,
  fetchExplorer,
  normalizeExplorerResult,
  peekExplorer,
  ratingBucketsFrom,
  type ExplorerFilters,
} from './explorerApi';

// Every test uses a unique FEN so the module-level shared cache and in-flight
// map never bleed state across cases (mirrors the server test suite).
let fenSeed = 0;
const uniqueFen = () => `${fenSeed++}k3/8/8/8/8/8/8/4K3 w - - 0 1`;

const okBody = (over: Partial<ExplorerResult> = {}): ExplorerResult => ({
  available: true,
  white: 10,
  draws: 5,
  black: 5,
  total: 20,
  moves: [{ uci: 'e2e4', san: 'e4', white: 10, draws: 5, black: 5, total: 20 }],
  opening: { eco: 'B00', name: "King's Pawn Game" },
  topGames: [],
  recentGames: [],
  ...over,
});

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { fn, calls };
}

// ---------------------------------------------------------------------------
// LruCache
// ---------------------------------------------------------------------------

describe('LruCache', () => {
  it('evicts the least recently used entry at capacity', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3); // evicts a
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });

  it('get() refreshes recency so hot entries survive', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // a is now most recent
    c.set('c', 3); // evicts b, not a
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBeUndefined();
  });

  it('overwriting a key updates the value without growing', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('a', 9);
    expect(c.get('a')).toBe(9);
    expect(c.size).toBe(1);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new LruCache(0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------------

describe('explorerKey', () => {
  const f: ExplorerFilters = { speeds: ['rapid', 'blitz'], minRating: 1800 };

  it('is position-keyed: FENs differing only in move counters share a key', () => {
    const a = explorerKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'masters', f);
    const b = explorerKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 3 42', 'masters', f);
    expect(a).toBe(b);
  });

  it('masters ignores filters; lichess keys on canonicalized filters', () => {
    const fen = uniqueFen();
    expect(explorerKey(fen, 'masters', f)).toBe(explorerKey(fen, 'masters', DEFAULT_FILTERS));
    expect(explorerKey(fen, 'lichess', f)).not.toBe(explorerKey(fen, 'lichess', DEFAULT_FILTERS));
    // Speed order does not matter.
    expect(explorerKey(fen, 'lichess', { speeds: ['blitz', 'rapid'], minRating: 1800 })).toBe(
      explorerKey(fen, 'lichess', { speeds: ['rapid', 'blitz'], minRating: 1800 }),
    );
  });

  it('distinguishes databases and games counts', () => {
    const fen = uniqueFen();
    expect(explorerKey(fen, 'masters', f)).not.toBe(explorerKey(fen, 'lichess', f));
    expect(explorerKey(fen, 'masters', f, 0)).not.toBe(explorerKey(fen, 'masters', f, 5));
  });
});

describe('ratingBucketsFrom', () => {
  it('includes every bucket at or above the minimum', () => {
    expect(ratingBucketsFrom(2000)).toEqual([2000, 2200, 2500]);
    expect(ratingBucketsFrom(0)).toContain(0);
    expect(ratingBucketsFrom(9000)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeExplorerResult
// ---------------------------------------------------------------------------

describe('normalizeExplorerResult', () => {
  it('rejects non-object payloads as unavailable', () => {
    expect(normalizeExplorerResult(null)).toEqual({ available: false, reason: 'malformed' });
    expect(normalizeExplorerResult('nope')).toEqual({ available: false, reason: 'malformed' });
  });

  it('passes through unavailable results with their reason', () => {
    expect(normalizeExplorerResult({ available: false, reason: 'http-401' })).toEqual({
      available: false,
      reason: 'http-401',
    });
    expect(normalizeExplorerResult({})).toEqual({ available: false, reason: 'unavailable' });
  });

  it('drops malformed moves, clamps counts and recomputes totals', () => {
    const r = normalizeExplorerResult({
      available: true,
      white: -3, // clamped
      draws: 2,
      black: 'x', // clamped
      moves: [
        { uci: 'e2e4', san: 'e4', white: 1, draws: 1, black: 1, total: 999 }, // total recomputed
        { san: 'd4' }, // no uci — dropped
        null,
      ],
    });
    expect(r.available).toBe(true);
    expect(r.white).toBe(0);
    expect(r.draws).toBe(2);
    expect(r.black).toBe(0);
    expect(r.total).toBe(2);
    expect(r.moves).toHaveLength(1);
    expect(r.moves![0]!.total).toBe(3);
  });

  it('orders moves most-played first', () => {
    const r = normalizeExplorerResult({
      available: true,
      moves: [
        { uci: 'd2d4', san: 'd4', white: 1, draws: 0, black: 0 },
        { uci: 'e2e4', san: 'e4', white: 5, draws: 0, black: 0 },
      ],
    });
    expect(r.moves!.map((m) => m.san)).toEqual(['e4', 'd4']);
  });

  it('keeps the opening only when it has a name, and filters games without ids', () => {
    const r = normalizeExplorerResult({
      available: true,
      opening: { eco: 'C50' }, // no name → dropped
      topGames: [{ id: 'g1', winner: 'draw' }, { winner: 'white' }],
    });
    expect(r.opening).toBeNull();
    expect(r.topGames).toHaveLength(1);
    expect(r.topGames![0]!.winner).toBeNull(); // 'draw' is not a side
  });
});

// ---------------------------------------------------------------------------
// fetchExplorer
// ---------------------------------------------------------------------------

describe('fetchExplorer', () => {
  it('caches successful results per position', async () => {
    const fen = uniqueFen();
    const { fn, calls } = mockFetch(() => jsonRes(okBody()));
    const a = await fetchExplorer(fen, 'masters', DEFAULT_FILTERS, { fetchFn: fn });
    const b = await fetchExplorer(fen, 'masters', DEFAULT_FILTERS, { fetchFn: fn });
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
    expect(peekExplorer(fen, 'masters', DEFAULT_FILTERS)).toBeDefined();
  });

  it('does not cache failures, so a retry re-fetches', async () => {
    const fen = uniqueFen();
    let status = 500;
    const { fn, calls } = mockFetch(() => jsonRes({ boom: true }, status));
    const a = await fetchExplorer(fen, 'masters', DEFAULT_FILTERS, { fetchFn: fn });
    expect(a).toEqual({ available: false, reason: 'http-500' });
    status = 200;
    const b = await fetchExplorer(fen, 'masters', DEFAULT_FILTERS, { fetchFn: fn });
    expect(b).toEqual({ available: false, reason: 'unavailable' }); // 200 but not a valid payload
    expect(calls).toHaveLength(2);
  });

  it('reports a thrown fetch as an unavailable network result', async () => {
    const fen = uniqueFen();
    const fn = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const r = await fetchExplorer(fen, 'masters', DEFAULT_FILTERS, { fetchFn: fn });
    expect(r).toEqual({ available: false, reason: 'network' });
  });

  it('dedupes concurrent identical queries into one request', async () => {
    const fen = uniqueFen();
    const { fn, calls } = mockFetch(() => jsonRes(okBody()));
    const [a, b] = await Promise.all([
      fetchExplorer(fen, 'lichess', DEFAULT_FILTERS, { fetchFn: fn }),
      fetchExplorer(fen, 'lichess', DEFAULT_FILTERS, { fetchFn: fn }),
    ]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it('builds the query: lichess sends speeds/ratings, masters sends neither', async () => {
    const fenA = uniqueFen();
    const fenB = uniqueFen();
    const fenC = uniqueFen();
    const { fn, calls } = mockFetch(() => jsonRes(okBody()));
    const filters: ExplorerFilters = { speeds: ['rapid', 'blitz'], minRating: 2000 };

    await fetchExplorer(fenA, 'lichess', filters, { fetchFn: fn, games: 5 });
    let u = new URL(calls[0]!, 'http://x');
    expect(u.pathname).toBe('/api/explorer');
    expect(u.searchParams.get('db')).toBe('lichess');
    expect(u.searchParams.get('speeds')).toBe('blitz,rapid');
    expect(u.searchParams.get('ratings')).toBe('2000,2200,2500');
    expect(u.searchParams.get('games')).toBe('5');

    await fetchExplorer(fenB, 'lichess', { speeds: ['blitz'], minRating: 0 }, { fetchFn: fn });
    u = new URL(calls[1]!, 'http://x');
    expect(u.searchParams.get('ratings')).toBeNull(); // minRating 0 → no filter

    await fetchExplorer(fenC, 'masters', filters, { fetchFn: fn });
    u = new URL(calls[2]!, 'http://x');
    expect(u.searchParams.get('speeds')).toBeNull();
    expect(u.searchParams.get('ratings')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createExplorerFeed (debounce)
// ---------------------------------------------------------------------------

describe('createExplorerFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses rapid position changes into a single fetch for the last one', async () => {
    const fens = [uniqueFen(), uniqueFen(), uniqueFen()];
    const { fn, calls } = mockFetch(() => jsonRes(okBody()));
    const updates: { loading: boolean; hasResult: boolean }[] = [];
    const feed = createExplorerFeed((u) => updates.push({ loading: u.loading, hasResult: u.result !== null }), {
      fetchFn: fn,
      debounceMs: 250,
    });

    // Simulate holding the forward arrow: three positions inside the window.
    feed.set(fens[0]!, 'masters', DEFAULT_FILTERS);
    await vi.advanceTimersByTimeAsync(100);
    feed.set(fens[1]!, 'masters', DEFAULT_FILTERS);
    await vi.advanceTimersByTimeAsync(100);
    feed.set(fens[2]!, 'masters', DEFAULT_FILTERS);
    await vi.advanceTimersByTimeAsync(400);

    expect(calls).toHaveLength(1);
    // Match on the board field: URLSearchParams encodes spaces as '+', so the
    // full-FEN encodeURIComponent form would never appear in the URL.
    expect(calls[0]).toContain(encodeURIComponent(fens[2]!.split(' ')[0]!));
    // Three loading updates, then exactly one result.
    expect(updates.filter((u) => !u.loading && u.hasResult)).toHaveLength(1);
    feed.dispose();
  });

  it('emits cached positions synchronously without fetching again', async () => {
    const fen = uniqueFen();
    const { fn, calls } = mockFetch(() => jsonRes(okBody()));
    const updates: { loading: boolean }[] = [];
    const feed = createExplorerFeed((u) => updates.push({ loading: u.loading }), { fetchFn: fn, debounceMs: 250 });

    feed.set(fen, 'masters', DEFAULT_FILTERS);
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toHaveLength(1);

    feed.set(fen, 'masters', DEFAULT_FILTERS); // back to a seen position
    expect(updates[updates.length - 1]).toEqual({ loading: false }); // no loading flash
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toHaveLength(1); // still one request
    feed.dispose();
  });

  it('drops responses that arrive after the feed moved to another position', async () => {
    const slowFen = uniqueFen();
    const fastFen = uniqueFen();
    let release!: (r: Response) => void;
    const gate = new Promise<Response>((resolve) => (release = resolve));
    const { fn } = mockFetch((url) =>
      url.includes(encodeURIComponent(slowFen.split(' ')[0]!)) ? gate : jsonRes(okBody()),
    );

    const results: string[] = [];
    const feed = createExplorerFeed((u) => {
      if (!u.loading && u.result) results.push(u.key);
    }, { fetchFn: fn, debounceMs: 10 });

    feed.set(slowFen, 'masters', DEFAULT_FILTERS);
    await vi.advanceTimersByTimeAsync(20); // slow fetch is now in flight
    feed.set(fastFen, 'masters', DEFAULT_FILTERS);
    await vi.advanceTimersByTimeAsync(20); // fast fetch resolves
    release(jsonRes(okBody())); // slow response lands late
    await vi.advanceTimersByTimeAsync(1);

    expect(results).toHaveLength(1);
    expect(results[0]).toContain(fastFen.split(' ')[0]!);
    feed.dispose();
  });

  it('dispose cancels a pending fetch', async () => {
    const fen = uniqueFen();
    const { fn, calls } = mockFetch(() => jsonRes(okBody()));
    const feed = createExplorerFeed(() => {}, { fetchFn: fn, debounceMs: 250 });
    feed.set(fen, 'masters', DEFAULT_FILTERS);
    feed.dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(0);
  });
});
