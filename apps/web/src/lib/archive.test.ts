import { describe, expect, it } from 'vitest';
import type { CasualGameRecord } from '../humans/casualHistory';
import type { SavedGame } from './api';
import { reportCacheKey, REVIEW_ENGINE_SETTINGS } from './analytics/report';
import {
  applyReview,
  fromCasualGame,
  fromSavedGame,
  parsePgnGame,
  perspectiveResult,
  selfNames,
  userColorOf,
  type ReviewPeek,
} from './archive';
import { toPgn } from './pgn';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const saved = (overrides: Partial<SavedGame> = {}): SavedGame => ({
  id: 'g1',
  pgn: toPgn(['e4', 'e5', 'Nf3'], { white: 'You', black: 'Stockfish Balanced (1500)', result: '1-0' }),
  white: 'You',
  black: 'Stockfish Balanced (1500)',
  result: '1-0',
  savedAt: 1_750_000_000_000,
  source: 'play',
  ...overrides,
});

const casual = (overrides: Partial<CasualGameRecord> = {}): CasualGameRecord => ({
  at: 1_750_000_000_000,
  mode: 'local',
  winner: 'white',
  reason: 'checkmate',
  moves: 24,
  white: 'Alice',
  black: 'Bob',
  ...overrides,
});

describe('parsePgnGame', () => {
  it('extracts sans, ucis and the start FEN', () => {
    const parsed = parsePgnGame(saved().pgn);
    expect(parsed).not.toBeNull();
    expect(parsed!.startFen).toBe(START);
    expect(parsed!.sans).toEqual(['e4', 'e5', 'Nf3']);
    expect(parsed!.ucis).toEqual(['e2e4', 'e7e5', 'g1f3']);
  });

  it('carries promotion suffixes in UCIs', () => {
    const pgn = '[Result "*"]\n\n1. e4 d5 2. exd5 c6 3. dxc6 Qd7 4. cxb7 Qd8 5. bxa8=Q *';
    const parsed = parsePgnGame(pgn);
    expect(parsed!.ucis[parsed!.ucis.length - 1]).toBe('b7a8q');
  });

  it('returns null for garbage and for a move-less PGN', () => {
    expect(parsePgnGame('not a pgn 1. zz9')).toBeNull();
    expect(parsePgnGame('[Event "empty"]\n\n*')).toBeNull();
  });
});

describe('selfNames / userColorOf', () => {
  it("always includes 'you' and lowercases extras", () => {
    expect(selfNames()).toEqual(['you']);
    expect(selfNames('Magnus', null, undefined, '  Yarin ')).toEqual(['you', 'magnus', 'yarin']);
  });

  it('matches names case-insensitively on either side', () => {
    const self = selfNames('magnus');
    expect(userColorOf('You', 'Bot', self)).toBe('white');
    expect(userColorOf('Bot', 'YOU', self)).toBe('black');
    expect(userColorOf('MAGNUS', 'Bot', self)).toBe('white');
  });

  it('returns null when neither or both sides match', () => {
    const self = selfNames();
    expect(userColorOf('White', 'Black', self)).toBeNull();
    expect(userColorOf('You', 'You', self)).toBeNull();
  });
});

describe('perspectiveResult', () => {
  it('maps decisive results through the user color', () => {
    expect(perspectiveResult('1-0', 'white')).toBe('win');
    expect(perspectiveResult('1-0', 'black')).toBe('loss');
    expect(perspectiveResult('0-1', 'white')).toBe('loss');
    expect(perspectiveResult('0-1', 'black')).toBe('win');
  });

  it('counts draws even without a perspective', () => {
    expect(perspectiveResult('1/2-1/2', null)).toBe('draw');
    expect(perspectiveResult('1/2-1/2', 'white')).toBe('draw');
  });

  it('is unknown for unfinished games and missing perspectives', () => {
    expect(perspectiveResult('*', 'white')).toBe('unknown');
    expect(perspectiveResult('1-0', null)).toBe('unknown');
    expect(perspectiveResult('0-1', null)).toBe('unknown');
  });
});

describe('fromSavedGame', () => {
  it('normalizes a vs-bot game the user won as White', () => {
    const game = fromSavedGame(saved(), selfNames());
    expect(game).toMatchObject({
      id: 'saved:g1',
      kind: 'bot',
      playedAt: 1_750_000_000_000,
      userColor: 'white',
      result: 'win',
      opponent: 'Stockfish Balanced (1500)',
      moves: 2, // 3 plies → 2 full moves
      accuracy: null,
      opening: null,
    });
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('derives the report-cache key from the parsed game content', () => {
    const game = fromSavedGame(saved(), selfNames());
    expect(game.gameKey).toBe(reportCacheKey(START, ['e2e4', 'e7e5', 'g1f3'], REVIEW_ENGINE_SETTINGS));
  });

  it('maps analysis-board saves without a perspective', () => {
    const g = saved({
      source: 'analysis',
      white: 'White',
      black: 'Black',
      pgn: toPgn(['d4'], { white: 'White', black: 'Black', result: '0-1' }),
      result: '0-1',
    });
    const game = fromSavedGame(g, selfNames());
    expect(game.kind).toBe('analysis');
    expect(game.userColor).toBeNull();
    expect(game.result).toBe('unknown');
    expect(game.opponent).toBeNull();
  });

  it('spots the user as Black', () => {
    const g = saved({ white: 'Maia 1500', black: 'You', result: '0-1' });
    const game = fromSavedGame(g, selfNames());
    expect(game.userColor).toBe('black');
    expect(game.result).toBe('win');
    expect(game.opponent).toBe('Maia 1500');
  });

  it('survives an unparseable PGN (no key, no moves, result still read)', () => {
    const game = fromSavedGame(saved({ pgn: 'corrupted!!' }), selfNames());
    expect(game.gameKey).toBeNull();
    expect(game.pgn).toBe('corrupted!!');
    expect(game.sans).toEqual([]);
    expect(game.moves).toBe(0);
    expect(game.result).toBe('win');
  });
});

describe('fromCasualGame', () => {
  it('normalizes a pass-and-play game (no perspective, no PGN)', () => {
    const game = fromCasualGame(casual(), 0, selfNames());
    expect(game).toMatchObject({
      kind: 'local',
      resultRaw: '1-0',
      userColor: null,
      result: 'unknown',
      opponent: null,
      moves: 24,
      pgn: null,
      gameKey: null,
    });
  });

  it('uses the friend name to find the user in online games', () => {
    const game = fromCasualGame(casual({ mode: 'online', winner: 'black', white: 'Yarin', black: 'Dana' }), 0, selfNames('dana'));
    expect(game.kind).toBe('online');
    expect(game.userColor).toBe('black');
    expect(game.result).toBe('win');
    expect(game.opponent).toBe('Yarin');
  });

  it('maps draws and builds a stable id from the room key or timestamp', () => {
    const drawn = fromCasualGame(casual({ winner: 'draw', key: 'ROOM42' }), 3, selfNames());
    expect(drawn.result).toBe('draw');
    expect(drawn.id).toBe('casual:ROOM42');
    expect(fromCasualGame(casual(), 3, selfNames()).id).toBe('casual:1750000000000:3');
  });
});

describe('applyReview', () => {
  const peek: ReviewPeek = {
    whiteAccuracy: 91.4,
    blackAccuracy: 78.2,
    playerColor: 'black',
    eco: 'C50',
    name: 'Italian Game',
  };

  it('is a no-op without a peek', () => {
    const game = fromSavedGame(saved(), selfNames());
    expect(applyReview(game, null)).toEqual(game);
  });

  it("picks the user's side accuracy and the review's opening", () => {
    const game = applyReview(fromSavedGame(saved(), selfNames()), peek);
    expect(game.accuracy).toBe(91.4); // names said white; the peek's playerColor never overrides
    expect(game.opening).toEqual({ eco: 'C50', name: 'Italian Game' });
  });

  it('recovers the perspective from the report when names are anonymous', () => {
    const g = saved({ white: 'White', black: 'Black', result: '0-1', source: 'analysis' });
    const game = applyReview(fromSavedGame(g, selfNames()), peek);
    expect(game.userColor).toBe('black');
    expect(game.result).toBe('win');
    expect(game.opponent).toBe('White');
    expect(game.accuracy).toBe(78.2);
  });

  it('leaves accuracy null when no side can be attributed', () => {
    const g = saved({ white: 'White', black: 'Black', source: 'analysis' });
    const game = applyReview(fromSavedGame(g, selfNames()), { ...peek, playerColor: null, name: null, eco: null });
    expect(game.userColor).toBeNull();
    expect(game.accuracy).toBeNull();
    expect(game.opening).toBeNull();
  });
});
