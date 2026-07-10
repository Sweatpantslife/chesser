/**
 * thinkTime — simulated human thinking time for bot moves.
 *
 * Replaces the old fixed 300ms delay with a model that varies by rating (lower
 * rated ⇒ a bit slower and more erratic), game phase (quick "book" moves early,
 * longer in the middlegame, brisker technique in the endgame) and move
 * obviousness (only-moves and recaptures come near-instantly; rich positions
 * occasionally earn a genuine long think). Pure and RNG-injectable so the
 * distribution is unit-testable; capped so a game never feels stalled.
 */

export interface ThinkTimeContext {
  /** Opponent's displayed rating. */
  rating: number;
  /** Plies played so far (0 = initial position). */
  ply: number;
  /** Legal moves available to the bot in the current position. */
  legalMoves?: number;
  /** The last move captured something the bot can immediately take back. */
  recaptureAvailable?: boolean;
  /** The bot is in check (replies are constrained ⇒ faster). */
  inCheck?: boolean;
  /** Bot's remaining clock in ms, when playing timed — caps simulated thought. */
  clockMs?: number;
  /** Uniform [0,1) source. Injectable so tests are deterministic. */
  rng?: () => number;
}

export const THINK_MIN_MS = 300;
export const THINK_MAX_MS = 6000;
/** Plies considered "book": moves come quickly, speeding variety along. */
export const BOOK_PLIES = 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Standard normal via Box-Muller (consumes two rng() draws). */
function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Never let simulated thought burn a meaningful slice of a real clock. */
function budget(ms: number, clockMs: number | undefined): number {
  const cap = clockMs != null ? Math.max(250, Math.min(THINK_MAX_MS, clockMs / 12)) : THINK_MAX_MS;
  return Math.round(clamp(ms, Math.min(THINK_MIN_MS, cap), cap));
}

/** Plies played so far, derived from a FEN's turn + fullmove counter. */
export function plyOfFen(fen: string): number {
  const parts = fen.split(' ');
  const fullmove = Number(parts[5] ?? '1');
  const black = parts[1] === 'b';
  return Math.max(0, (Number.isFinite(fullmove) ? fullmove - 1 : 0) * 2 + (black ? 1 : 0));
}

/** How long the bot should appear to think before its move lands, in ms. */
export function botThinkTimeMs(ctx: ThinkTimeContext): number {
  const rng = ctx.rng ?? Math.random;
  const rating = clamp(ctx.rating, 400, 3200);
  const slow = Math.max(0, (1800 - rating) / 1800); // 0 (strong) … ~0.78 (weak)
  const moves = ctx.legalMoves ?? 30;

  // Obvious moves come fast, whatever the phase or rating.
  if (moves <= 1) return budget(THINK_MIN_MS + 200 * rng(), ctx.clockMs);
  if (ctx.recaptureAvailable) return budget((350 + 350 * rng()) * (1 + slow * 0.4), ctx.clockMs);

  let base: number;
  if (ctx.ply < BOOK_PLIES) base = 350 + 55 * ctx.ply; // early "book" moves are quick
  else if (ctx.ply < 60) base = 1300; // middlegame is where the thinking happens
  else base = 950; // endgame technique: brisker
  if (moves <= 5) base *= 0.5; // cramped / forced positions need less thought
  else if (ctx.inCheck) base *= 0.65;

  // Weaker players are slower on average and far more erratic move to move.
  const erratic = 0.35 + slow * 0.3;
  let ms = base * (1 + slow * 0.5) * Math.exp(erratic * gauss(rng));
  // The occasional genuine long think on a rich position.
  if (moves > 5 && ctx.ply >= BOOK_PLIES && rng() < 0.07) ms *= 2.6;
  return budget(ms, ctx.clockMs);
}
