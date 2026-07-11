import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importGames } from './import.js';

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

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

// ---------------------------------------------------------------------------
// Lichess
// ---------------------------------------------------------------------------

test('lichess: parses NDJSON, maps winners/players/AI/date/url, filters and skips junk', async () => {
  const lines = [
    JSON.stringify({
      id: 'g1',
      winner: 'white',
      createdAt: 1700000000000,
      players: { white: { user: { name: 'alice' } }, black: { user: { name: 'bob' } } },
      pgn: '[Event "x"]\n1. e4 e5 1-0',
    }),
    JSON.stringify({
      id: 'g2',
      winner: 'black',
      createdAt: 1700100000000,
      players: { white: { user: { name: 'carol' } }, black: { user: { name: 'dave' } } },
      pgn: '1. d4 d5 0-1',
    }),
    // no winner -> draw; no createdAt -> no date
    JSON.stringify({
      id: 'g3',
      players: { white: { user: { name: 'erin' } }, black: { user: { name: 'frank' } } },
      pgn: '1. c4 c5 1/2-1/2',
    }),
    // AI opponent: no user.name, falls back to "AI L<level>"
    JSON.stringify({
      id: 'g4',
      winner: 'white',
      players: { white: { aiLevel: 5 }, black: { user: { name: 'grace' } } },
      pgn: '1. e4 1-0',
    }),
    JSON.stringify({ id: 'g5', winner: 'white', players: {}, pgn: '' }), // empty pgn -> filtered out
    'this is not json', // malformed -> skipped
    '', // blank -> skipped
  ];
  const m = mockFetch(() => new Response(lines.join('\n'), { status: 200 }));
  try {
    const r = await importGames('lichess', 'alice', 5);
    assert.equal(r.available, true);
    assert.equal(r.games?.length, 4); // g5 dropped (no pgn), junk lines skipped

    assert.deepEqual(r.games?.[0], {
      pgn: '[Event "x"]\n1. e4 e5 1-0',
      white: 'alice',
      black: 'bob',
      result: '1-0',
      url: 'https://lichess.org/g1',
      date: new Date(1700000000000).toISOString().slice(0, 10),
    });
    assert.equal(r.games?.[1]!.result, '0-1');
    assert.equal(r.games?.[2]!.result, '1/2-1/2');
    assert.equal(r.games?.[2]!.date, undefined); // no createdAt
    assert.equal(r.games?.[3]!.white, 'AI L5');
    assert.equal(r.games?.[3]!.black, 'grace');

    // request shape: lichess games export, NDJSON, max passed through
    const u = new URL(m.calls[0]!.url);
    assert.equal(u.host, 'lichess.org');
    assert.equal(u.pathname, '/api/games/user/alice');
    assert.equal(u.searchParams.get('max'), '5');
    assert.equal(u.searchParams.get('pgnInJson'), 'true');
    assert.equal(headerOf(m.calls[0]!.init, 'Accept'), 'application/x-ndjson');
  } finally {
    m.restore();
  }
});

test('lichess: a non-OK response reports the HTTP status', async () => {
  const m = mockFetch(() => new Response('busy', { status: 503 }));
  try {
    const r = await importGames('lichess', 'alice');
    assert.deepEqual(r, { available: false, reason: 'http-503' });
  } finally {
    m.restore();
  }
});

test('lichess: a thrown fetch reports unreachable', async () => {
  const m = mockFetch(() => {
    throw new Error('dns');
  });
  try {
    const r = await importGames('lichess', 'alice');
    assert.deepEqual(r, { available: false, reason: 'unreachable' });
  } finally {
    m.restore();
  }
});

test('an empty username is rejected without any network request', async () => {
  let called = false;
  const m = mockFetch(() => {
    called = true;
    return new Response('', { status: 200 });
  });
  try {
    const r = await importGames('lichess', '   ');
    assert.deepEqual(r, { available: false, reason: 'no-user' });
    assert.equal(called, false);
  } finally {
    m.restore();
  }
});

// ---------------------------------------------------------------------------
// Chess.com
// ---------------------------------------------------------------------------

test('chess.com: fetches the latest monthly archive and maps results (most recent first)', async () => {
  const archives = {
    archives: [
      'https://api.chess.com/pub/player/hero/games/2026/05',
      'https://api.chess.com/pub/player/hero/games/2026/06',
    ],
  };
  const month = {
    games: [
      { url: 'u1', pgn: '1. e4 1-0', white: { username: 'Hero', result: 'win' }, black: { username: 'villain', result: 'resigned' }, end_time: 1717200000 },
      { url: 'u2', pgn: '1. d4 0-1', white: { username: 'Hero', result: 'checkmated' }, black: { username: 'rival', result: 'win' }, end_time: 1717300000 },
      { url: 'u3', pgn: '1. c4 1/2-1/2', white: { username: 'Hero', result: 'agreed' }, black: { username: 'pal', result: 'agreed' } },
      { url: 'u4', pgn: '' }, // no pgn -> filtered out
    ],
  };
  const m = mockFetch((url) => {
    if (url.endsWith('/games/archives')) return json(archives);
    if (url.endsWith('/2026/06')) return json(month);
    throw new Error(`unexpected url ${url}`);
  });
  try {
    const r = await importGames('chesscom', 'Hero', 15);
    assert.equal(r.available, true);

    // username is lowercased for the archives request
    assert.ok(m.calls[0]!.url.includes('/pub/player/hero/games/archives'));
    // the *last* archive is the latest month
    assert.ok(m.calls[1]!.url.endsWith('/2026/06'));

    // u4 dropped; the remaining three are reversed (newest first)
    assert.deepEqual(
      r.games?.map((g) => g.result),
      ['1/2-1/2', '0-1', '1-0'],
    );
    assert.equal(r.games?.[2]!.white, 'Hero');
    assert.equal(r.games?.[2]!.url, 'u1');
    assert.equal(r.games?.[2]!.date, new Date(1717200000 * 1000).toISOString().slice(0, 10));
    assert.equal(r.games?.[0]!.date, undefined); // u3 has no end_time
  } finally {
    m.restore();
  }
});

test('chess.com: a player with no archives yields an empty (but available) list', async () => {
  let calls = 0;
  const m = mockFetch(() => {
    calls++;
    return json({ archives: [] });
  });
  try {
    const r = await importGames('chesscom', 'nobody');
    assert.deepEqual(r, { available: true, games: [] });
    assert.equal(calls, 1); // never reaches the month fetch
  } finally {
    m.restore();
  }
});

test('chess.com: a non-OK archives response reports the HTTP status', async () => {
  const m = mockFetch(() => new Response('not found', { status: 404 }));
  try {
    const r = await importGames('chesscom', 'ghost');
    assert.deepEqual(r, { available: false, reason: 'http-404' });
  } finally {
    m.restore();
  }
});
