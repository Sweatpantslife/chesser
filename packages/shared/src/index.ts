/**
 * @chesser/shared — types shared between the web client and the engine server.
 *
 * The WebSocket protocol is a small tagged-union. Every request carries a
 * `reqId` the client generates so streaming replies (analysis updates) and
 * one-shot replies (a bot's move) can be correlated and cancelled.
 */

// ---------------------------------------------------------------------------
// Engines & availability
// ---------------------------------------------------------------------------

export type EngineKind = 'stockfish' | 'lc0';

/** What the server actually has installed (derived from engines/manifest.json). */
export interface EngineAvailability {
  stockfish: boolean;
  lc0: boolean;
  /** Maia (human-like Lc0) networks present, ascending by rating. */
  maiaNetworks: MaiaNetworkInfo[];
}

export interface MaiaNetworkInfo {
  id: string; // e.g. "maia-1500"
  rating: number; // 1100 | 1500 | 1900
}

// ---------------------------------------------------------------------------
// Bot opponents — levels & styles
// ---------------------------------------------------------------------------

export type BotStyleId =
  | 'balanced' // Stockfish, plays the objectively best move at its level
  | 'aggressive' // Stockfish biased toward attacking / sacrificial lines
  | 'defensive' // Stockfish biased toward solid, low-risk play
  | 'positional' // Stockfish biased toward quiet, improving moves
  | 'human'; // Maia — mimics how a human of a given rating actually moves

export interface BotStyle {
  id: BotStyleId;
  name: string;
  description: string;
  engine: EngineKind;
}

/** The canonical style catalogue (the server filters by what's installed). */
export const BOT_STYLES: BotStyle[] = [
  {
    id: 'human',
    name: 'Human-like (Maia)',
    description:
      'A neural net trained on millions of human games. Plays the move a real player of the chosen rating would most likely make — natural mistakes and all.',
    engine: 'lc0',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Stockfish playing the strongest move available at the chosen level.',
    engine: 'stockfish',
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: 'Prefers attacks, sacrifices and sharp tactical play among its top candidate moves.',
    engine: 'stockfish',
  },
  {
    id: 'defensive',
    name: 'Defensive',
    description: 'Prefers safe, solid, low-risk moves; avoids complications when it can.',
    engine: 'stockfish',
  },
  {
    id: 'positional',
    name: 'Positional',
    description: 'Prefers quiet, improving, space-gaining moves over forcing tactics.',
    engine: 'stockfish',
  },
];

export interface BotConfig {
  style: BotStyleId;
  /** Target strength for Stockfish styles (UCI_Elo range). Ignored for 'human'. */
  elo?: number;
  /** Maia network rating for 'human' style. */
  maiaRating?: number;
  /** Thinking-time budget per move in ms (Stockfish styles). */
  moveTimeMs?: number;
}

/** UCI_Elo bounds supported by Stockfish's strength limiter. */
export const STOCKFISH_ELO_MIN = 1320;
export const STOCKFISH_ELO_MAX = 3190;

// ---------------------------------------------------------------------------
// Evaluation scores (always normalised to White's point of view)
// ---------------------------------------------------------------------------

export type Score =
  | { kind: 'cp'; value: number } // centipawns, White POV
  | { kind: 'mate'; value: number }; // mate in N (positive = White mates)

export interface AnalysisLine {
  multipv: number;
  depth: number;
  score: Score;
  /** Principal variation in UCI (e.g. ["e2e4","e7e5"]). */
  pvUci: string[];
  /** Same PV in SAN, computed server-side for display. */
  pvSan: string[];
  nodes?: number;
  nps?: number;
  timeMs?: number;
}

// ---------------------------------------------------------------------------
// WebSocket protocol
// ---------------------------------------------------------------------------

export interface AnalyzeRequest {
  t: 'analyze';
  reqId: string;
  fen: string;
  multipv?: number; // default 1
  depth?: number; // optional cap
  movetimeMs?: number; // optional cap; if neither set, runs until stopped
}

export interface StopRequest {
  t: 'stop';
  reqId: string;
}

export interface BotMoveRequest {
  t: 'botMove';
  reqId: string;
  fen: string;
  bot: BotConfig;
}

export type ClientMessage = AnalyzeRequest | StopRequest | BotMoveRequest | { t: 'hello' };

export interface WelcomeMessage {
  t: 'welcome';
  engines: EngineAvailability;
  styles: BotStyle[];
}

export interface AnalysisMessage {
  t: 'analysis';
  reqId: string;
  fen: string;
  depth: number;
  lines: AnalysisLine[];
  /** True for the last update of a search (depth cap / movetime reached). */
  final?: boolean;
}

export interface BotMoveMeta {
  engine: EngineKind;
  style: BotStyleId;
  /** Eval after the chosen move, White POV, when the engine reports it. */
  score?: Score;
  depth?: number;
  /** For styled bots: how many candidate moves were considered. */
  candidates?: number;
}

export interface BotMoveMessage {
  t: 'botMove';
  reqId: string;
  fen: string;
  uci: string;
  san: string;
  meta: BotMoveMeta;
}

export interface ErrorMessage {
  t: 'error';
  reqId?: string;
  message: string;
}

export type ServerMessage = WelcomeMessage | AnalysisMessage | BotMoveMessage | ErrorMessage;

// ---------------------------------------------------------------------------
// Syzygy tablebase (proxied through the server; optional)
// ---------------------------------------------------------------------------

export type TablebaseCategory = 'win' | 'draw' | 'loss' | 'cursed-win' | 'blessed-loss' | 'unknown';

export interface TablebaseMove {
  uci: string;
  san?: string;
  /** Result for the side that PLAYS this move (already inverted to the mover's POV). */
  category: TablebaseCategory;
  dtz: number | null; // distance-to-zeroing
  dtm: number | null; // distance-to-mate
}

export interface TablebaseResult {
  available: boolean;
  reason?: string; // why unavailable (too-many-pieces / unreachable / ...)
  /** Result for the side to move. */
  category?: TablebaseCategory;
  dtz?: number | null;
  dtm?: number | null;
  checkmate?: boolean;
  stalemate?: boolean;
  /** Legal moves, best-first for the side to move (each category is mover-POV). */
  moves?: TablebaseMove[];
}

// ---------------------------------------------------------------------------
// Opening explorer (proxied through the server; optional)
// ---------------------------------------------------------------------------

export type ExplorerDb = 'masters' | 'lichess';

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  total: number;
}

export interface ExplorerResult {
  available: boolean;
  reason?: string;
  white?: number;
  draws?: number;
  black?: number;
  total?: number;
  moves?: ExplorerMove[];
  opening?: { eco?: string; name?: string } | null;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Format a White-POV score the way chess UIs do (+1.24, -0.30, #4, #-2). */
export function formatScore(score: Score): string {
  if (score.kind === 'mate') {
    return score.value === 0 ? '#' : `#${score.value > 0 ? '' : '-'}${Math.abs(score.value)}`;
  }
  const pawns = score.value / 100;
  const sign = pawns > 0 ? '+' : pawns < 0 ? '−' : '';
  return `${sign}${Math.abs(pawns).toFixed(2)}`;
}
