/**
 * Personal game archive — normalization layer.
 *
 * Turns the two places played games already live in (the account's SavedGame
 * list from the server, and the local casual pass-and-play / friend-game log)
 * into one `ArchiveGame` shape the Archive view and the archiveStats
 * aggregations consume. Everything here is PURE except `peekCachedReview` /
 * `storedFriendName`, which read localStorage (guarded, error-swallowing) and
 * never write — the archive must not shuffle the report cache's LRU order.
 */
import { Chess } from 'chess.js';
import type { SavedGame } from './api';
import type { CasualGameRecord } from '../humans/casualHistory';
import { deserializeReport, REPORT_ENTRY_PREFIX, reportCacheKey, REVIEW_ENGINE_SETTINGS } from './analytics/report';
import type { Side } from './analytics/types';

export type ArchiveResult = 'win' | 'loss' | 'draw' | 'unknown';
export type ArchiveKind = 'bot' | 'analysis' | 'local' | 'online';

export const KIND_LABELS: Record<ArchiveKind, string> = {
  bot: 'vs bot',
  analysis: 'analysis board',
  local: 'pass & play',
  online: 'friend game',
};

/** One played game, whatever store it came from, ready for listing/stats. */
export interface ArchiveGame {
  id: string;
  kind: ArchiveKind;
  /** Epoch ms (savedAt for library games, finish time for casual ones). */
  playedAt: number;
  white: string;
  black: string;
  /** PGN result tag: '1-0' | '0-1' | '1/2-1/2' | '*'. */
  resultRaw: string;
  /** Which side the user played, when it can be told. */
  userColor: Side | null;
  /** Result from the user's perspective (draws count without a perspective). */
  result: ArchiveResult;
  /** The other player's name, when the user's side is known. */
  opponent: string | null;
  /** Full moves. */
  moves: number;
  /** Full PGN when the moves were stored (casual games only log results). */
  pgn: string | null;
  sans: string[];
  /** lib/analytics report-cache key, when the game content parsed. */
  gameKey: string | null;
  /** The user's accuracy from a cached review, when one exists. */
  accuracy: number | null;
  opening: { eco: string | null; name: string } | null;
}

export interface ParsedPgn {
  startFen: string;
  sans: string[];
  ucis: string[];
}

/** Replay a PGN into its move lists. Null when it doesn't parse or is empty. */
export function parsePgnGame(pgn: string): ParsedPgn | null {
  const probe = new Chess();
  try {
    probe.loadPgn(pgn);
  } catch {
    return null;
  }
  const verbose = probe.history({ verbose: true });
  if (verbose.length === 0) return null;
  return {
    startFen: verbose[0]!.before,
    sans: verbose.map((m) => m.san),
    ucis: verbose.map((m) => m.from + m.to + (m.promotion ?? '')),
  };
}

/**
 * The lowercase name list that identifies "the user" in player-name fields:
 * the literal 'You' the save flow writes, plus the account username and the
 * friend-game display name when known.
 */
export function selfNames(...names: (string | null | undefined)[]): string[] {
  const out = new Set<string>(['you']);
  for (const n of names) {
    const t = n?.trim().toLowerCase();
    if (t) out.add(t);
  }
  return [...out];
}

/** Which side the user played, judged by the stored player names. */
export function userColorOf(white: string, black: string, self: string[]): Side | null {
  const w = self.includes(white.trim().toLowerCase());
  const b = self.includes(black.trim().toLowerCase());
  if (w === b) return null; // neither, or both (self-play) — no perspective
  return w ? 'white' : 'black';
}

/** PGN result → user-perspective result. Draws count even without a side. */
export function perspectiveResult(resultRaw: string, userColor: Side | null): ArchiveResult {
  if (resultRaw === '1/2-1/2') return 'draw';
  if (!userColor) return 'unknown';
  if (resultRaw === '1-0') return userColor === 'white' ? 'win' : 'loss';
  if (resultRaw === '0-1') return userColor === 'black' ? 'win' : 'loss';
  return 'unknown';
}

/** Normalize a library SavedGame (server, synced) into an ArchiveGame. */
export function fromSavedGame(g: SavedGame, self: string[]): ArchiveGame {
  const parsed = parsePgnGame(g.pgn);
  const userColor = userColorOf(g.white, g.black, self);
  return {
    id: `saved:${g.id}`,
    kind: g.source === 'play' ? 'bot' : 'analysis',
    playedAt: g.savedAt,
    white: g.white,
    black: g.black,
    resultRaw: g.result,
    userColor,
    result: perspectiveResult(g.result, userColor),
    opponent: userColor ? (userColor === 'white' ? g.black : g.white) : null,
    moves: parsed ? Math.ceil(parsed.sans.length / 2) : 0,
    pgn: g.pgn,
    sans: parsed?.sans ?? [],
    gameKey: parsed ? reportCacheKey(parsed.startFen, parsed.ucis, REVIEW_ENGINE_SETTINGS) : null,
    accuracy: null,
    opening: null,
  };
}

/** Normalize a casual (pass-and-play / online friend) record. No PGN stored. */
export function fromCasualGame(rec: CasualGameRecord, index: number, self: string[]): ArchiveGame {
  const resultRaw = rec.winner === 'draw' ? '1/2-1/2' : rec.winner === 'white' ? '1-0' : '0-1';
  const userColor = userColorOf(rec.white, rec.black, self);
  return {
    id: `casual:${rec.key ?? `${rec.at}:${index}`}`,
    kind: rec.mode,
    playedAt: rec.at,
    white: rec.white,
    black: rec.black,
    resultRaw,
    userColor,
    result: perspectiveResult(resultRaw, userColor),
    opponent: userColor ? (userColor === 'white' ? rec.black : rec.white) : null,
    moves: rec.moves,
    pgn: null,
    sans: [],
    gameKey: null,
    accuracy: null,
    opening: null,
  };
}

/** The slice of a cached AnalysisReport the archive cares about. */
export interface ReviewPeek {
  whiteAccuracy: number;
  blackAccuracy: number;
  /** The human's side in a vs-bot review, when the report recorded one. */
  playerColor: Side | null;
  eco: string | null;
  name: string | null;
}

/**
 * Read a cached review WITHOUT touching the report cache's LRU index
 * (loadCachedReport would promote every listed game and evict real
 * recently-used entries). Returns null on any miss/parse/storage error.
 */
export function peekCachedReview(gameKey: string): ReviewPeek | null {
  try {
    const store = globalThis.localStorage ?? null;
    const raw = store?.getItem(REPORT_ENTRY_PREFIX + gameKey);
    if (!raw) return null;
    const report = deserializeReport(raw);
    if (!report) return null;
    return {
      whiteAccuracy: report.white.accuracy,
      blackAccuracy: report.black.accuracy,
      playerColor: report.meta.playerColor,
      eco: report.opening.eco,
      name: report.opening.name,
    };
  } catch {
    return null;
  }
}

/**
 * Merge a cached review into a normalized game (pure): fills the user's
 * accuracy, the opening the review already detected, and — when the names
 * were anonymous ("White"/"Black") but the report knows the human's side —
 * the user colour, perspective result and opponent.
 */
export function applyReview(game: ArchiveGame, peek: ReviewPeek | null): ArchiveGame {
  if (!peek) return game;
  const userColor = game.userColor ?? peek.playerColor;
  const accuracy = userColor ? (userColor === 'white' ? peek.whiteAccuracy : peek.blackAccuracy) : null;
  return {
    ...game,
    userColor,
    result: perspectiveResult(game.resultRaw, userColor),
    opponent: game.opponent ?? (userColor ? (userColor === 'white' ? game.black : game.white) : null),
    accuracy,
    opening: peek.name ? { eco: peek.eco, name: peek.name } : game.opening,
  };
}

/** The Friends page's stored display name (used to spot the user in casual games). */
export function storedFriendName(): string | null {
  try {
    return globalThis.localStorage?.getItem('chesser.friendName') ?? null;
  } catch {
    return null;
  }
}
