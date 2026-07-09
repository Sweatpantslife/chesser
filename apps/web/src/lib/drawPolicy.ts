/**
 * When a bot agrees to a draw offer, and when an agreed draw counts for
 * rating. Kept pure so the policy is unit-testable.
 *
 * Both guards exist to close the same exploit: offering a draw on move 2 to a
 * 2800-rated bot used to be a free rating gain, repeatable forever. Now the
 * bot never agrees before {@link MIN_DRAW_ACCEPT_PLIES}, and even if an agreed
 * draw somehow ends earlier than that, it is recorded as unrated.
 */

/** Plies (half-moves) before which the bot flatly declines any draw offer. */
export const MIN_DRAW_ACCEPT_PLIES = 40; // move 20

/** Agreed draws shorter than this many plies are recorded as unrated. */
export const RATED_AGREED_DRAW_MIN_PLIES = MIN_DRAW_ACCEPT_PLIES;

/** Piece values (pawns) used for the "bare endgame" material check. */
const PIECE_VALUES: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 };

/** Total non-pawn, non-king material (in pawns) left on the board, both sides. */
export function nonPawnMaterial(fen: string): number {
  const board = fen.split(' ')[0] ?? '';
  let total = 0;
  for (const ch of board) total += PIECE_VALUES[ch.toLowerCase()] ?? 0;
  return total;
}

export interface DrawOfferContext {
  /** Half-moves played in the game so far. */
  plies: number;
  /** Engine evaluation from the bot's point of view (centipawns), if known. */
  botCp: number | null;
  /** Current position, for the material check. */
  fen?: string;
}

/**
 * Whether the bot agrees to a draw offer. It only ever agrees in genuinely
 * drawish situations: never in the opening, never when it stands clearly
 * better, and never when it cannot judge the position at all.
 */
export function botAcceptsDraw({ plies, botCp, fen }: DrawOfferContext): boolean {
  if (plies < MIN_DRAW_ACCEPT_PLIES) return false; // far too early to agree
  if (botCp === null) return false; // no evaluation — keep playing
  if (botCp > 60) return false; // the bot is clearly better — play on
  if (botCp <= 25) return true; // equal (or the bot is worse) — a fair draw
  // Slightly better (25–60cp): only concede in long games or bare endgames
  // where the residual edge is unlikely to convert.
  if (plies >= 80) return true;
  return fen !== undefined && nonPawnMaterial(fen) <= 6;
}

/** Whether a finished agreed draw counts for rating (early ones do not). */
export function agreedDrawIsRated(plies: number): boolean {
  return plies >= RATED_AGREED_DRAW_MIN_PLIES;
}
