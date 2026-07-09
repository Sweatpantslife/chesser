/**
 * Cheap, engine-free tactical threat checks (pure chess.js).
 *
 * Used by the anti-blunder trainer: a player's move only "dodges the trap" if
 * the opponent no longer has an immediate refutation. Every bundled drill's
 * tempting move loses to a mate-in-one (see trainers/blunders.ts — refutations
 * are [tempting, mate]), so "does the reply mate on the spot?" is exactly the
 * check a real blunder-check would make, and it also catches *other* moves
 * that lose to the same mate (e.g. Rd1–d5 in the back-rank drill still allows
 * …Re1#).
 */
import { Chess } from 'chess.js';

/**
 * If the side to move in `fen` can deliver checkmate in one move, return that
 * move's UCI; otherwise null. Illegal/terminal FENs return null.
 */
export function mateInOneUci(fen: string): string | null {
  let g: Chess;
  try {
    g = new Chess(fen);
  } catch {
    return null;
  }
  for (const m of g.moves({ verbose: true })) {
    g.move(m);
    const mates = g.isCheckmate();
    g.undo();
    if (mates) return m.from + m.to + (m.promotion ?? '');
  }
  return null;
}
