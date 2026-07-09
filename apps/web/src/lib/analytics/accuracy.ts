/**
 * Accuracy maths for the game report: Lichess win% curve, per-move accuracy,
 * whole-game accuracy (volatility-weighted mean blended with a harmonic mean,
 * mirroring lila's AccuracyPercent) and ACPL.
 *
 * Every function is PURE over {@link MoveRow}s / {@link EvalPoint}s — see
 * types.ts for the sign conventions (evals and win% are White POV; mover POV
 * is derived per side).
 */
import { whiteWinPercent } from '../format';
import type { EvalPoint, MoveRow, Side } from './types';

const povWin = (whiteWin: number, side: Side) => (side === 'white' ? whiteWin : 100 - whiteWin);
const povCp = (whiteCp: number, side: Side) => (side === 'white' ? whiteCp : -whiteCp);

/** EvalPoint → White win% (0–100). Delegates to whiteWinPercent (lib/format). */
export function winPercent(ev: EvalPoint | null): number {
  if (!ev) return whiteWinPercent(null);
  if (ev.mate !== undefined) return whiteWinPercent({ kind: 'mate', value: ev.mate });
  return whiteWinPercent({ kind: 'cp', value: ev.cp ?? 0 });
}

/** EvalPoint → White-POV centipawns, mate clamped to ±1500 (mirrors cpOf in lib/coach). */
export function cpValue(ev: EvalPoint | null): number {
  if (!ev) return 0;
  if (ev.mate !== undefined) return ev.mate > 0 ? 1500 : ev.mate < 0 ? -1500 : 0;
  return Math.max(-1500, Math.min(1500, ev.cp ?? 0));
}

/**
 * Per-move accuracy on the Lichess pointwise curve (identical constants to the
 * store's review loop): 103.1668·e^(−0.04354·winDrop) − 3.1669, clamped to
 * [0, 100]. winDrop is the win% the MOVER lost across the move; winBefore /
 * winAfter are White-POV percentages.
 */
export function moveAccuracy(winBefore: number, winAfter: number, side: Side): number {
  const winDrop = Math.max(0, povWin(winBefore, side) - povWin(winAfter, side));
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * winDrop) - 3.1669));
}

/** Population standard deviation; 0 for fewer than two samples. */
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/**
 * Whole-game accuracy for one side, Lichess methodology (the report's
 * canonical number; the store's simple mean in reviewStats may differ):
 * mean of window-volatility-weighted move accuracies blended 50/50 with their
 * harmonic mean. Volatile stretches of the game weigh more, and the harmonic
 * mean makes single large blunders costly. One decimal; empty input → 100.
 */
export function gameAccuracy(rows: MoveRow[], side: Side): number {
  const own = rows.filter((r) => r.side === side);
  const n = own.length;
  if (n === 0) return 100;
  // Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
  const accs = own.map((r) => (r.isMate ? 100 : r.moveAccuracy));
  const wins = own.map((r) => r.winBefore);

  const window = Math.max(2, Math.min(8, Math.round(n / 10)));
  let weightedSum = 0;
  let weightTotal = 0;
  let invSum = 0;
  for (let i = 0; i < n; i++) {
    // Window centred on i, clamped to the series bounds.
    const start = Math.min(Math.max(0, i - Math.floor(window / 2)), Math.max(0, n - window));
    const weight = Math.max(0.5, Math.min(12, stdev(wins.slice(start, start + window))));
    weightedSum += weight * accs[i]!;
    weightTotal += weight;
    invSum += 1 / Math.max(accs[i]!, 1);
  }
  const weightedMean = weightedSum / weightTotal;
  const harmonicMean = n / invSum;
  return Math.round(((weightedMean + harmonicMean) / 2) * 10) / 10;
}

/**
 * Average centipawn loss for one side: mean over own rows of the mover-POV cp
 * lost per move (cpValue clamps mate to ±1500). Delivered-mate rows contribute
 * 0 loss. Rounded to an integer; empty input → 0.
 */
export function acpl(rows: MoveRow[], side: Side): number {
  const own = rows.filter((r) => r.side === side);
  if (own.length === 0) return 0;
  let total = 0;
  for (const r of own) {
    // Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
    if (r.isMate) continue;
    const moverBefore = povCp(cpValue(r.evalBefore), r.side);
    const moverAfter = povCp(cpValue(r.evalAfter), r.side);
    total += Math.max(0, moverBefore - moverAfter);
  }
  return Math.round(total / own.length);
}
