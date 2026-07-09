import { Chess } from 'chess.js';
import type { Color, GameSummary, HistoryMove } from '../store/game';

/** The slice of game state {@link deriveGameResult} needs (store-compatible). */
export interface GameResultInput {
  gameSummary: GameSummary | null;
  gameNo: number;
  isGameOver: boolean;
  winner: Color | 'draw' | null;
  history: HistoryMove[];
}

/**
 * PGN result of the current game — '*' only when it's genuinely unfinished.
 *
 * Note: a merely *claimable* draw (threefold repetition / fifty-move rule in
 * play mode, or a repetition annotation on the analysis board) never sets
 * `isGameOver`/`winner`, so a decisive line that just passes through a
 * repeated position still exports its real result.
 */
export function deriveGameResult(s: GameResultInput): string {
  // A finished bot game's summary is authoritative (it survives switching to
  // the analysis board and covers resignations, flags and agreed draws).
  if (s.gameSummary && s.gameSummary.gameNo === s.gameNo) {
    if (s.gameSummary.outcome === 'draw') return '1/2-1/2';
    const winColor =
      s.gameSummary.outcome === 'win' ? s.gameSummary.playerColor : s.gameSummary.playerColor === 'white' ? 'black' : 'white';
    return winColor === 'white' ? '1-0' : '0-1';
  }
  // Live store outcome (play mode, or a terminal viewed position).
  if (s.isGameOver && s.winner) return s.winner === 'draw' ? '1/2-1/2' : s.winner === 'white' ? '1-0' : '0-1';
  // Otherwise inspect the end of the line being exported (the user may be
  // viewing an earlier ply of a line that ends in mate/stalemate).
  const endFen = s.history[s.history.length - 1]?.fen;
  if (endFen) {
    try {
      const c = new Chess(endFen);
      if (c.isCheckmate()) return c.turn() === 'w' ? '0-1' : '1-0';
      if (c.isStalemate() || c.isInsufficientMaterial()) return '1/2-1/2';
    } catch {
      /* fall through to unfinished */
    }
  }
  return '*';
}
