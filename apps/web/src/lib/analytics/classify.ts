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
 * Three overrides apply on both paths: a move that delivers checkmate is
 * always best-tier for the mover, never a mistake/miss — detected purely from
 * data (row.isMate, see buildRows) —; a move identical to the engine's own
 * first choice is floored at 'best' and can NEVER be an error, whatever the
 * coach grade or win% delta says (two independent searches produce eval noise,
 * and "there was a better move" is refuted by the app's own data — mirrors
 * lila's best-move-is-never-an-error behaviour); and a move that throws away
 * a forced mate is always at least an error (lila's MateLost judgement),
 * since the win%-drop thresholds cannot see a mate-for → still-winning swing
 * under the ±1000 eval ceiling.
 */
import { Chess } from 'chess.js';
import { cpValue, winPercent } from './accuracy';
import type { Classification, EvalPoint, MoveRow, Side } from './types';

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const povWin = (whiteWin: number, side: Side) => (side === 'white' ? whiteWin : 100 - whiteWin);

/**
 * The mover played the engine's own first choice. Matched by UCI or by SAN so
 * a missing / differently-encoded UCI (e.g. castling variants) cannot defeat
 * the best-move floor in {@link classifyMove}.
 */
export function isEngineBestMove(
  row: Pick<MoveRow, 'uci' | 'san' | 'bestMoveUci' | 'bestMoveSan'>,
): boolean {
  return (!!row.bestMoveUci && row.uci === row.bestMoveUci) || (!!row.bestMoveSan && row.san === row.bestMoveSan);
}

/** True when the eval says the MOVER has a forced mate. */
const mateFor = (ev: EvalPoint | null, side: Side): boolean =>
  ev?.mate !== undefined && ev.mate !== 0 && (side === 'white' ? ev.mate > 0 : ev.mate < 0);

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
  if (isEngineBestMove(row)) return grade;
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
  const playedIsBest = isEngineBestMove(row);

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
 * lila MateAdvice's MateLost ladder: how bad throwing away a forced mate is,
 * by the mover-POV eval the game is left at (still totally winning →
 * inaccuracy, winning → mistake, anything less → blunder). Needed because the
 * ±1000 eval ceiling makes a mate-for → still-winning-cp swing a < 2-point
 * win% drop, invisible to every drop threshold.
 */
function lostMateTier(row: MoveRow): Classification {
  const moverCpAfter = row.side === 'white' ? cpValue(row.evalAfter) : -cpValue(row.evalAfter);
  if (moverCpAfter > 999) return 'inaccuracy';
  if (moverCpAfter > 700) return 'mistake';
  return 'blunder';
}

/**
 * Final report-layer grade for a row. Precedence (first match wins):
 *  1. delivered checkmate → best-tier (an existing brilliant/great sticks,
 *     anything else becomes 'best') — never a bad grade;
 *  2. the engine's own first choice (matched by UCI or SAN) is floored at
 *     'best': brilliant/great upgrades stick and book rows keep their theory
 *     label, but the grade can NEVER be inaccuracy/mistake/blunder/miss —
 *     whatever the coach grade or the win% delta between the two independent
 *     searches claims. A "drop" on the move the engine itself wanted is eval
 *     noise, and prose like "there was a more precise move" would be refuted
 *     by the app's own data (lila: the best move is never an error);
 *  3. losing a forced mate is always at least an error (lila MateAdvice's
 *     MateLost, cp-laddered): the explanation template ("You had mate in N…")
 *     fires on exactly this condition, so the badge must agree with the
 *     prose. The house 'miss' grade survives where it applies; a DELAYED mate
 *     (still mate-for after) is not an error;
 *  4. a coach grade passes through, escalated to the lichess error tier its
 *     win% drop lands in (brilliant/great/miss are exempt; never downgraded);
 *  5. otherwise derive from the row (drop thresholds, then book / miss /
 *     brilliant / great refinements).
 */
export function classifyMove(row: MoveRow): Classification {
  if (row.isMate) {
    // row.isMate is data-derived in buildRows (SAN '#' fast path, cross-checked
    // with checkmateWinner from lib/coach).
    return row.coachGrade === 'brilliant' || row.coachGrade === 'great' ? row.coachGrade : 'best';
  }
  const base = row.coachGrade ? escalateCoachGrade(row, row.coachGrade) : deriveGrade(row);
  if (isEngineBestMove(row)) {
    // Best-move floor: keep upgrades and the theory label, erase everything else.
    return base === 'brilliant' || base === 'great' || base === 'book' ? base : 'best';
  }
  if (mateFor(row.evalBefore, row.side) && !mateFor(row.evalAfter, row.side)) {
    if (base === 'miss') return 'miss'; // "missed win" is exactly what happened
    const tier = lostMateTier(row);
    return (ERROR_RANK[base] ?? 0) >= (ERROR_RANK[tier] ?? 0) ? base : tier;
  }
  return base;
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
