import { Chess } from 'chess.js';

/** Convert a UCI principal variation to SAN, stopping at the first illegal move. */
export function uciLineToSan(fen: string, uciMoves: string[], max = 12): string[] {
  const game = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciMoves.slice(0, max)) {
    const mv = tryMove(game, uci);
    if (!mv) break;
    out.push(mv);
  }
  return out;
}

/** SAN for a single UCI move from a position, or null if illegal. */
export function uciToSan(fen: string, uci: string): string | null {
  const game = new Chess(fen);
  return tryMove(game, uci);
}

function tryMove(game: Chess, uci: string): string | null {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  try {
    const mv = game.move({ from, to, promotion });
    return mv ? mv.san : null;
  } catch {
    return null;
  }
}
