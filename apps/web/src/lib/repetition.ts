import { Chess } from 'chess.js';

/**
 * FIDE-correct position repetition (article 9.2). Two positions are "the same"
 * when the piece placement, side to move, castling rights AND en-passant
 * *rights* all match. An en-passant square only grants a right when a capture
 * is actually legal — a double pawn push nobody can capture does not make the
 * position different from the same placement without the push.
 *
 * The half-move / full-move counters never distinguish positions.
 */

// Keys are deterministic for a given (immutable) FEN string, and computing one
// can require a chess.js instantiation (validating en-passant rights). Every
// _sync re-keys the whole played line, so cache FEN → key. The bound is
// defensive only — no game or analysis session approaches it — and clearing
// simply lets the cache refill.
const keyCache = new Map<string, string>();
const KEY_CACHE_MAX = 20_000;

/**
 * The repetition identity of a position: `board turn castling ep`, with the
 * en-passant field kept only when an en-passant capture is genuinely legal.
 */
export function repetitionKey(fen: string): string {
  const cached = keyCache.get(fen);
  if (cached !== undefined) return cached;
  const parts = fen.split(' ');
  let key: string | null = null;
  if (parts[3] && parts[3] !== '-') {
    // Re-derive the FEN through chess.js, which drops the ep square unless a
    // legal en-passant capture exists (matching FIDE's "rights" semantics).
    try {
      key = new Chess(fen).fen().split(' ').slice(0, 4).join(' ');
    } catch {
      // Unparseable FEN — fall back to the raw fields below.
    }
  }
  key ??= parts.slice(0, 4).join(' ');
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear();
  keyCache.set(fen, key);
  return key;
}

/** How many of `positionFens` are the same position (per FIDE) as `targetFen`. */
export function countRepetitions(positionFens: readonly string[], targetFen: string): number {
  const target = repetitionKey(targetFen);
  let n = 0;
  for (const fen of positionFens) if (repetitionKey(fen) === target) n++;
  return n;
}

/**
 * Whether the *last* position of the game has now occurred at least three
 * times. `positionFens` must list every position of the game so far, starting
 * position included, in any order.
 */
export function isThreefoldRepetition(positionFens: readonly string[]): boolean {
  if (positionFens.length === 0) return false;
  return countRepetitions(positionFens, positionFens[positionFens.length - 1]!) >= 3;
}
