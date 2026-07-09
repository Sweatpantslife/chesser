/**
 * Report-layer move classification: turn a {@link MoveRow} into the final
 * grade the new analysis report renders (glyphs live in
 * CLASSIFICATION_GLYPH, lib/analytics/types.ts).
 *
 * The existing coach grade (lib/coach.ts) is consumed as a prior: special
 * grades (brilliant/great/miss) pass through untouched, but the normal tiers
 * are re-checked against lichess's stricter error thresholds and escalated
 * when the win% drop warrants it — the coach's HOUSE thresholds (30/20/10)
 * are 2× more lenient than lila's 15/10/5 and under-grade canonical blunders.
 * The report layer is the single visible source of grades (the store's legacy
 * fields are hydrated from it on both paths), so escalating here cannot
 * disagree with anything on screen. Rows without a coach grade
 * (cached/imported games) are derived from scratch at the same thresholds.
 *
 * The one override in both paths: a move that delivers checkmate is always
 * best-tier for the mover, never a mistake/miss — detected purely from data
 * (the SAN suffix '#', surfaced as row.isMate).
 */
import { Chess } from 'chess.js';
import { winPercent } from './accuracy';
import type { Classification, MoveRow, Side } from './types';

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const povWin = (whiteWin: number, side: Side) => (side === 'white' ? whiteWin : 100 - whiteWin);

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

// — Error thresholds in mover-POV win% points, matching lichess's shipped
// judgements (lila Advice.scala / scalachess winningChances deltas of
// 0.3/0.2/0.1 on the ±1 scale = 15/10/5 points). lib/coach.ts still grades at
// the 2× looser HOUSE scale (30/20/10) — hands-off until fix/coach-trainers
// lands; the report layer's grades win everywhere visible via hydration. —
const DROP_BLUNDER = 15;
const DROP_MISTAKE = 10;
const DROP_INACCURACY = 5;

/** Error rank for escalation; non-error grades rank 0. */
const ERROR_RANK: Partial<Record<Classification, number>> = { inaccuracy: 1, mistake: 2, blunder: 3 };

/** The error tier a mover-POV win% drop lands in, or null below inaccuracy. */
function dropTier(drop: number): Classification | null {
  if (drop >= DROP_BLUNDER) return 'blunder';
  if (drop >= DROP_MISTAKE) return 'mistake';
  if (drop >= DROP_INACCURACY) return 'inaccuracy';
  return null;
}

/** A serious error that only squandered a *winning* edge reads as a missed win. */
const isMissedWin = (moverWinBefore: number, moverWinAfter: number) =>
  moverWinBefore >= 75 && moverWinAfter >= 38 && moverWinAfter <= 65;

/**
 * Re-check a coach normal-tier grade against the stricter thresholds and
 * escalate when the drop warrants it (never downgrade — coach errors imply a
 * bigger drop than ours). The engine's own first choice is exempt: a win%
 * drop on the move the engine itself wanted is eval noise, not an error.
 */
function escalateCoachGrade(row: MoveRow, grade: Classification): Classification {
  if (grade === 'brilliant' || grade === 'great' || grade === 'miss') return grade;
  const playedIsBest = !!row.bestMoveUci && row.uci === row.bestMoveUci;
  if (playedIsBest) return grade;
  const moverWinBefore = povWin(row.winBefore, row.side);
  const moverWinAfter = povWin(row.winAfter, row.side);
  const tier = dropTier(Math.max(0, moverWinBefore - moverWinAfter));
  if (!tier || (ERROR_RANK[tier] ?? 0) <= (ERROR_RANK[grade] ?? 0)) return grade;
  // The coach's own miss check only fires at its looser scale — re-apply it
  // for grades that became errors here.
  if ((tier === 'mistake' || tier === 'blunder') && isMissedWin(moverWinBefore, moverWinAfter)) return 'miss';
  return tier;
}

/** Derivation path for rows with no coach grade. */
function deriveGrade(row: MoveRow): Classification {
  const moverWinBefore = povWin(row.winBefore, row.side);
  const moverWinAfter = povWin(row.winAfter, row.side);
  const drop = Math.max(0, moverWinBefore - moverWinAfter);
  const playedIsBest = !!row.bestMoveUci && row.uci === row.bestMoveUci;

  // Base grade from the mover-POV win% swing; the engine's own first choice
  // is never an error (see escalateCoachGrade).
  const tier = playedIsBest ? null : dropTier(drop);
  const cls: Classification = tier ?? (playedIsBest || drop < 2 ? 'best' : 'good');

  // Theory moves that didn't lose anything are just "book".
  if (row.isBook && drop < DROP_INACCURACY) return 'book';

  if ((cls === 'mistake' || cls === 'blunder') && isMissedWin(moverWinBefore, moverWinAfter)) {
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
    const onlyMoveGap = row.secondEvalBefore ? moverWinBefore - povWin(winPercent(row.secondEvalBefore), row.side) : 0;
    const onlyGood = onlyMoveGap >= 18 && moverWinAfter >= 45 && moverWinBefore <= 90;
    if ((playedIsBest || drop < 4) && (turnaround || onlyGood)) return 'great';
  }

  return cls;
}

/**
 * Final report-layer grade for a row. Precedence (first match wins):
 *  1. delivered checkmate → best-tier (an existing brilliant/great sticks,
 *     anything else becomes 'best') — never a bad grade;
 *  2. a coach grade passes through, escalated to the lichess error tier its
 *     win% drop lands in (brilliant/great/miss and the engine's own first
 *     choice are exempt; never downgraded);
 *  3. otherwise derive from the row (drop thresholds, then book / miss /
 *     brilliant / great refinements).
 */
export function classifyMove(row: MoveRow): Classification {
  if (row.isMate) {
    // Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
    return row.coachGrade === 'brilliant' || row.coachGrade === 'great' ? row.coachGrade : 'best';
  }
  if (row.coachGrade) return escalateCoachGrade(row, row.coachGrade);
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
