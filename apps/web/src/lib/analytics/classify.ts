/**
 * Report-layer move classification: turn a {@link MoveRow} into the final
 * grade the new analysis report renders (glyphs live in
 * CLASSIFICATION_GLYPH, lib/analytics/types.ts).
 *
 * The existing coach grade (lib/coach.ts) is consumed as a prior: when the
 * row carries one we pass it through unchanged — coach.ts already applies the
 * book/miss/brilliant/great logic and both layers must agree. We only derive a
 * grade ourselves for rows without one (cached/imported games), using the
 * exact same thresholds, so the two paths are indistinguishable.
 *
 * The one override in both paths: a move that delivers checkmate is always
 * best-tier for the mover, never a mistake/miss — detected purely from data
 * (the SAN suffix '#', surfaced as row.isMate).
 */
import { Chess } from 'chess.js';
import { whiteWinPercent } from '../format';
import type { Classification, EvalPoint, MoveRow, Side } from './types';

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const povWin = (whiteWin: number, side: Side) => (side === 'white' ? whiteWin : 100 - whiteWin);

/** EvalPoint → White win% via the shared curve (whiteWinPercent, lib/format). */
function evalWinPercent(ev: EvalPoint | null): number {
  if (!ev) return 50;
  if (ev.mate !== undefined) return whiteWinPercent({ kind: 'mate', value: ev.mate });
  return whiteWinPercent({ kind: 'cp', value: ev.cp ?? 0 });
}

/** Net material on the board (White − Black), in pawns. */
function material(fen: string): number {
  const board = fen.split(' ')[0] ?? '';
  let v = 0;
  for (const ch of board) {
    const val = PIECE_VALUE[ch.toLowerCase()];
    if (val === undefined) continue;
    v += ch === ch.toUpperCase() ? val : -val;
  }
  return v;
}

/**
 * Material the mover is down after playing the move and taking the engine's
 * best reply on the chin (mirrors materialSwing in lib/coach.ts). Positive =
 * a sacrifice; 0 when the reply is unknown or replay fails.
 */
function sacrificedMaterial(fenBefore: string, playedUci: string, replyUci: string | null, side: Side): number {
  if (!replyUci) return 0;
  try {
    const c = new Chess(fenBefore);
    c.move({ from: playedUci.slice(0, 2), to: playedUci.slice(2, 4), promotion: playedUci.length > 4 ? playedUci[4] : undefined });
    c.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4), promotion: replyUci.length > 4 ? replyUci[4] : undefined });
    const before = material(fenBefore);
    const after = material(c.fen());
    const moverDelta = side === 'white' ? after - before : before - after;
    return -moverDelta;
  } catch {
    return 0;
  }
}

/** Derivation path for rows with no coach grade — same thresholds as lib/coach.ts. */
function deriveGrade(row: MoveRow): Classification {
  const moverWinBefore = povWin(row.winBefore, row.side);
  const moverWinAfter = povWin(row.winAfter, row.side);
  const drop = Math.max(0, moverWinBefore - moverWinAfter);
  const playedIsBest = !!row.bestMoveUci && row.uci === row.bestMoveUci;

  // — Base grade from the mover-POV win% swing (Lichess thresholds) —
  let cls: Classification;
  if (drop >= 30) cls = 'blunder';
  else if (drop >= 20) cls = 'mistake';
  else if (drop >= 10) cls = 'inaccuracy';
  else cls = playedIsBest || drop < 2 ? 'best' : 'good';

  // Theory moves that didn't lose anything are just "book".
  if (row.isBook && drop < 10) return 'book';

  // A serious error that only squandered a *winning* edge reads as a missed win.
  if ((cls === 'mistake' || cls === 'blunder') && moverWinBefore >= 75 && moverWinAfter >= 38 && moverWinAfter <= 65) {
    return 'miss';
  }

  // Upgrades for strong moves: a sound sacrifice is brilliant; the single move
  // that turns the game around or the only good option is great.
  if (cls === 'best' || cls === 'good') {
    const lost = sacrificedMaterial(row.fenBefore, row.uci, row.bestReplyUci, row.side);
    if (lost >= 2 && moverWinAfter >= 50 && moverWinBefore <= 95 && (playedIsBest || drop < 6)) {
      return 'brilliant';
    }
    const turnaround = moverWinBefore < 50 && moverWinAfter >= 52;
    const onlyMoveGap = row.secondEvalBefore ? moverWinBefore - povWin(evalWinPercent(row.secondEvalBefore), row.side) : 0;
    const onlyGood = onlyMoveGap >= 18 && moverWinAfter >= 45 && moverWinBefore <= 90;
    if ((playedIsBest || drop < 4) && (turnaround || onlyGood)) return 'great';
  }

  return cls;
}

/**
 * Final report-layer grade for a row. Precedence (first match wins):
 *  1. delivered checkmate → best-tier (an existing brilliant/great sticks,
 *     anything else becomes 'best') — never a bad grade;
 *  2. a coach grade passes through unchanged;
 *  3. otherwise derive from the row (drop thresholds, then book / miss /
 *     brilliant / great refinements).
 */
export function classifyMove(row: MoveRow): Classification {
  if (row.isMate) {
    // Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
    return row.coachGrade === 'brilliant' || row.coachGrade === 'great' ? row.coachGrade : 'best';
  }
  if (row.coachGrade) return row.coachGrade;
  return deriveGrade(row);
}

/** classifyMove over all rows, in order. */
export function classifyAll(rows: MoveRow[]): Classification[] {
  return rows.map(classifyMove);
}

const zeroCounts = (): Record<Classification, number> => ({
  brilliant: 0,
  great: 0,
  best: 0,
  good: 0,
  book: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
  miss: 0,
});

/** Per-side tally over final classifications (all keys present, zero-filled). */
export function classificationCounts(
  moves: ReadonlyArray<{ side: Side; classification: Classification }>,
): { white: Record<Classification, number>; black: Record<Classification, number> } {
  const out = { white: zeroCounts(), black: zeroCounts() };
  for (const m of moves) out[m.side][m.classification] += 1;
  return out;
}
