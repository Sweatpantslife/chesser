import { Chess } from 'chess.js';

/**
 * Position-keyed "book" over a set of repertoire lines, used by the opening
 * drill to validate trainee moves.
 *
 * Keying by position (not by move sequence) means:
 * - multiple valid continuations "just work": where two lines of the same
 *   side share a prefix and diverge, both moves are accepted at the fork;
 * - transpositions between lines are recognised: if two lines reach the same
 *   position through different move orders, a move from either is accepted
 *   and the drill can follow the matched line from there.
 *
 * Everything here is pure and side-effect free (no clocks, no stores).
 */

export interface BookLineInput {
  id: string;
  side: 'white' | 'black';
  /** SAN moves from the initial position. */
  moves: string[];
}

export interface BookEntry {
  lineId: string;
  /** Ply index (0-based) of this trainee move within its line. */
  ply: number;
  /** Canonical SAN (as produced by chess.js) of the trainee move. */
  san: string;
}

/** posKey -> trainee moves known from this position (across all lines). */
export type LineBook = Map<string, BookEntry[]>;

/** Position identity: piece placement, side to move, castling, en passant. */
export const posKey = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');

/**
 * Build the book for one side from a set of lines. Lines whose side differs
 * or whose moves are not all legal are skipped (defensive: user-authored
 * lines come from free-form input on the Play board).
 */
export function buildBook(lines: BookLineInput[], side: 'white' | 'black'): LineBook {
  const book: LineBook = new Map();
  const traineeTurn = side === 'white' ? 'w' : 'b';
  for (const line of lines) {
    if (line.side !== side) continue;
    const c = new Chess();
    try {
      for (const [ply, san] of line.moves.entries()) {
        const key = posKey(c.fen());
        const mv = c.move(san); // throws on illegal SAN
        if (mv.color === traineeTurn) {
          const arr = book.get(key) ?? [];
          arr.push({ lineId: line.id, ply, san: mv.san });
          book.set(key, arr);
        }
      }
    } catch {
      // skip malformed user lines
    }
  }
  return book;
}

export type MoveVerdict =
  | { kind: 'expected'; san: string }
  /** Correct, but continues a different line of the repertoire (fork or transposition). */
  | { kind: 'alternate'; san: string; lineId: string; ply: number }
  | { kind: 'wrong'; san: string | null };

/**
 * Classify a trainee move played from `fen` while drilling `line` at `ply`.
 *
 * - `expected`: matches the drilled line's move at this ply.
 * - `alternate`: legal and matches another repertoire line that passes
 *   through this position — the drill may continue along that line.
 * - `wrong`: legal-but-off-book, or not a legal move at all (san: null).
 */
export function classifyMove(
  book: LineBook,
  line: BookLineInput,
  ply: number,
  fen: string,
  from: string,
  to: string,
  promotion = 'q',
): MoveVerdict {
  const c = new Chess(fen);
  let san: string;
  try {
    san = c.move({ from, to, promotion }).san;
  } catch {
    return { kind: 'wrong', san: null };
  }

  // Canonicalize the drilled line's expected SAN through chess.js so authored
  // variants ("Bxc3+" vs "Bxc3") never cause a false mismatch.
  const expectedRaw = line.moves[ply];
  if (expectedRaw != null) {
    try {
      const e = new Chess(fen);
      if (e.move(expectedRaw).san === san) return { kind: 'expected', san };
    } catch {
      // fall through to book lookup
    }
  }

  const entries = book.get(posKey(fen)) ?? [];
  const alt = entries.find((x) => x.san === san && !(x.lineId === line.id && x.ply === ply));
  if (alt) return { kind: 'alternate', san, lineId: alt.lineId, ply: alt.ply };
  return { kind: 'wrong', san };
}
