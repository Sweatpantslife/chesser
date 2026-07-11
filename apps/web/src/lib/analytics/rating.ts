/**
 * Heuristic performance-rating estimate for the game report.
 *
 * This is an ESTIMATE, not Elo maths — there is no opponent pool to compute a
 * true performance rating against, so we map play quality onto the familiar
 * rating scale instead. UI copy must present it as such ("~1650, estimate").
 *
 * PURE function over per-side aggregates (see types.ts) — no store, no engine.
 */
import type { SideAccuracy } from './types';

const RATING_MIN = 400;
const RATING_MAX = 3200;
/** Below this many own moves the sample is thin; blend 50/50 toward neutral. */
const SHORT_GAME_MOVES = 12;
const NEUTRAL_RATING = 1500;

/**
 * HEURISTIC performance-rating estimate for one side of a reviewed game.
 *
 * A fixed blend of two linear skill proxies, so the result is deterministic
 * and monotonic in both inputs (lower ACPL → higher rating, higher accuracy →
 * higher rating):
 *
 *   base = 0.6·(3000 − 9·acpl) + 0.4·(45·accuracy − 1700)
 *
 * The ACPL line maps 0 cp lost per move → 3000 and ~290 cp → the floor; the
 * accuracy line maps 100% → 2800 and ~47% → the floor. Games shorter than 12
 * own moves carry little evidence, so base is damped 50/50 toward 1500.
 * Result = clamp(round(base), 400, 3200).
 *
 * `accuracy` is the side's game accuracy (0–100, accuracy.gameAccuracy),
 * `acpl` its average centipawn loss (accuracy.acpl), `moves` its move count.
 */
export function estimatePerformanceRating(input: SideAccuracy): number {
  const acplRating = 3000 - 9 * input.acpl;
  const accuracyRating = 45 * input.accuracy - 1700;
  let base = 0.6 * acplRating + 0.4 * accuracyRating;
  if (input.moves < SHORT_GAME_MOVES) base = (base + NEUTRAL_RATING) / 2;
  return Math.max(RATING_MIN, Math.min(RATING_MAX, Math.round(base)));
}
