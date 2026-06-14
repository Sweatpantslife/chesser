import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeExplorer } from './explorer.js';

// ---------------------------------------------------------------------------
// fetch stub — swap out the global fetch, capture calls, restore afterwards.
// ---------------------------------------------------------------------------
interface Call {
  url: string;
  init: RequestInit;
}
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = orig) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// The explorer keeps a module-level cache keyed by `${db}:${fen}`, so every
// test uses a fresh FEN to avoid bleeding results across cases.
let fenSeed = 0;
const uniqueFen = () => `test${fenSeed++}/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`;

test('masters: normalizes root counts and per-move totals', async () => {
  const fen = uniqueFen();
  const m = mockFetch(() =>
    json({
      white: 100,
      draws: 50,
      black: 30,
      moves: [
        { uci: 'e2e4', san: 'e4', white: 60, draws: 25, black: 15 },
        { uci: 'd2d4', san: 'd4', white: 40, draws: 25, black: 15 },
      ],
      opening: { eco: 'B00', name: "King's Pawn" },
    }),
  );
  try {
    const r = await probeExplorer(fen, 'masters');
    assert.equal(r.available, true);
    assert.equal(r.white, 100);
    assert.equal(r.draws, 50);
    assert.equal(r.black, 30);
    assert.equal(r.total, 180);
    assert.equal(r.moves?.length, 2);
    assert.deepEqual(r.moves?.[0], { uci: 'e2e4', san: 'e4', white: 60, draws: 25, black: 15, total: 100 });
    assert.deepEqual(r.opening, { eco: 'B00', name: "King's Pawn" });

    const u = new URL(m.calls[0]!.url);
    assert.ok(u.href.startsWith('https://explorer.lichess.ovh/masters'));
    assert.equal(u.searchParams.get('fen'), fen);
    assert.equal(u.searchParams.get('moves'), '12');
    assert.equal(u.searchParams.get('topGames'), '0');
    assert.equal(u.searchParams.get('speeds'), null); // masters DB sends no speeds
  } finally {
    m.restore();
  }
});

test('missing fields default to zero and opening defaults to null', async () => {
  const fen = uniqueFen();
  const m = mockFetch(() => json({ moves: [{ uci: 'e2e4', san: 'e4' }] }));
  try {
    const r = await probeExplorer(fen, 'masters');
    assert.equal(r.total, 0);
    assert.deepEqual(r.moves?.[0], { uci: 'e2e4', san: 'e4', white: 0, draws: 0, black: 0, total: 0 });
    assert.equal(r.opening, null);
  } finally {
    m.restore();
  }
});

test('lichess DB uses the lichess endpoint and adds speeds', async () => {
  const fen = uniqueFen();
  const m = mockFetch(() => json({ white: 1, draws: 0, black: 0, moves: [] }));
  try {
    const r = await probeExplorer(fen, 'lichess');
    assert.equal(r.available, true);
    const u = new URL(m.calls[0]!.url);
    assert.ok(u.href.startsWith('https://explorer.lichess.ovh/lichess'));
    assert.equal(u.searchParams.get('speeds'), 'blitz,rapid,classical');
  } finally {
    m.restore();
  }
});

test('caches successful results: a repeated query does not re-fetch', async () => {
  const fen = uniqueFen();
  let hits = 0;
  const m = mockFetch(() => {
    hits++;
    return json({ white: 2, draws: 1, black: 1, moves: [] });
  });
  try {
    const a = await probeExplorer(fen, 'masters');
    const b = await probeExplorer(fen, 'masters');
    assert.equal(hits, 1);
    assert.deepEqual(a, b);
  } finally {
    m.restore();
  }
});

test('reports unavailable on 401 (Lichess now requires login) and does not cache the failure', async () => {
  const fen = uniqueFen();
  let hits = 0;
  const m = mockFetch(() => {
    hits++;
    return new Response('<html>401 Authorization Required</html>', { status: 401 });
  });
  try {
    const a = await probeExplorer(fen, 'masters');
    assert.deepEqual(a, { available: false, reason: 'http-401' });
    // A failed probe must not be cached, so a retry actually hits the network again.
    await probeExplorer(fen, 'masters');
    assert.equal(hits, 2);
  } finally {
    m.restore();
  }
});

test('reports unreachable when fetch throws', async () => {
  const fen = uniqueFen();
  const m = mockFetch(() => {
    throw new Error('network down');
  });
  try {
    const r = await probeExplorer(fen, 'masters');
    assert.deepEqual(r, { available: false, reason: 'unreachable' });
  } finally {
    m.restore();
  }
});

test('sends a Bearer token when CHESSER_LICHESS_TOKEN is set', async () => {
  const fen = uniqueFen();
  const prev = process.env.CHESSER_LICHESS_TOKEN;
  process.env.CHESSER_LICHESS_TOKEN = 'lip_testtoken';
  const m = mockFetch(() => json({ white: 0, draws: 0, black: 0, moves: [] }));
  try {
    await probeExplorer(fen, 'masters');
    const headers = m.calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer lip_testtoken');
  } finally {
    m.restore();
    if (prev === undefined) delete process.env.CHESSER_LICHESS_TOKEN;
    else process.env.CHESSER_LICHESS_TOKEN = prev;
  }
});

test('omits Authorization when no token is configured', async () => {
  const fen = uniqueFen();
  const prev = process.env.CHESSER_LICHESS_TOKEN;
  delete process.env.CHESSER_LICHESS_TOKEN;
  const m = mockFetch(() => json({ white: 0, draws: 0, black: 0, moves: [] }));
  try {
    await probeExplorer(fen, 'masters');
    const headers = m.calls[0]!.init.headers as Record<string, string>;
    assert.equal('Authorization' in headers, false);
  } finally {
    m.restore();
    if (prev !== undefined) process.env.CHESSER_LICHESS_TOKEN = prev;
  }
});
