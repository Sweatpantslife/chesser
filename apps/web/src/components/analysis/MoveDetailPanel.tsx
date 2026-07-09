/**
 * MoveDetailPanel — detail card for the currently selected reviewed move.
 * Props-only (no store imports): PlayPage wires `report.moves[viewPly - 1]`,
 * the board-arrow setter and the variation/practice callbacks in.
 *
 * While mounted it keeps the board's best-move arrow in sync with the viewed
 * move via `onShowArrow` (cleared on move change, toggle-off and unmount).
 */
import { useEffect, useState } from 'react';
import { CLASSIFICATION_META } from '../../lib/coach';
import { formatScore } from '../../lib/format';
import { CLASSIFICATION_GLYPH } from '../../lib/analytics/types';
import type { ArrowSpec, Classification, EvalPoint, MoveDetail } from '../../lib/analytics/types';

export interface MoveDetailPanelProps {
  /** report.moves[viewPly - 1] ?? null (null renders nothing). */
  move: MoveDetail | null;
  /** Best-move arrow for the board; called with null to clear. */
  onShowArrow(arrow: ArrowSpec | null): void;
  /** Play a SAN line on the analysis board, starting before ply `fromPly`. */
  onPlayVariation(sans: string[], fromPly: number): void;
  /** Play the position before `ply` out against the engine. */
  onPractice(ply: number): void;
  /** Optional prev/next-move navigation (additive to the SPEC contract). */
  onSelectPly?(ply: number): void;
  /** Total mainline plies; lets the next button disable on the last move. */
  maxPly?: number;
}

/** EvalPoint → display string: "+0.35" / "−1.20" pawns, "#N" for mate, "—" when unknown. */
export function formatEval(ev: EvalPoint | null): string {
  if (!ev) return '—';
  return formatScore(ev.mate !== undefined ? { kind: 'mate', value: ev.mate } : { kind: 'cp', value: ev.cp ?? 0 });
}

/** Best-move UCI → board arrow squares, or null when there is no usable move. */
export function bestMoveArrow(uci: string | null | undefined): ArrowSpec | null {
  if (!uci || uci.length < 4) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

/**
 * Classification the panel displays. A delivered mate (SAN ends '#') is
 * best-tier by definition — never shown as an inaccuracy/mistake/blunder/miss,
 * whatever a stale grade says.
 * Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
 */
export function displayClassification(move: MoveDetail): Classification {
  if (move.isMate && move.classification !== 'brilliant' && move.classification !== 'great') return 'best';
  return move.classification;
}

const ctrl =
  'flex h-6 w-7 items-center justify-center rounded text-xs text-neutral-300 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30 disabled:hover:bg-neutral-700';

const moveLabel = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'}`;

/** Move-number prefix for the i-th PV san (White moves + the leading Black move). */
const pvLabel = (pvPly: number, i: number): string | null =>
  pvPly % 2 === 1 ? `${Math.ceil(pvPly / 2)}.` : i === 0 ? `${Math.ceil(pvPly / 2)}…` : null;

export function MoveDetailPanel({ move, onShowArrow, onPlayVariation, onPractice, onSelectPly, maxPly }: MoveDetailPanelProps): JSX.Element | null {
  const [showBest, setShowBest] = useState(true);
  const arrow = showBest ? bestMoveArrow(move?.bestMoveUci) : null;
  const from = arrow?.from;
  const to = arrow?.to;

  // Board arrow follows the viewed move; the cleanup clears it whenever the
  // move changes, the toggle turns off, or the panel unmounts.
  useEffect(() => {
    if (from && to) {
      onShowArrow({ from, to });
      return () => onShowArrow(null);
    }
    onShowArrow(null);
    return undefined;
  }, [from, to, onShowArrow]);

  if (!move) return null;

  const cls = displayClassification(move);
  const meta = CLASSIFICATION_META[cls];
  const glyph = cls === move.classification ? move.glyph : CLASSIFICATION_GLYPH[cls];
  const evalBefore = formatEval(move.evalBefore);
  const evalAfter = move.evalText ?? (move.isMate ? '#' : formatEval(move.evalAfter));
  const playedIsBest = move.bestMoveUci !== null ? move.bestMoveUci === move.uci : move.bestMoveSan === move.san;
  // The game ended in the mover's favour — no point "correcting" a mate.
  const showBestLine = !!move.bestMoveSan && !playedIsBest && !move.isMate;
  const hasArrow = bestMoveArrow(move.bestMoveUci) !== null;

  return (
    <div className="rounded-lg bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Move detail</h3>
        {onSelectPly && (
          <div className="flex items-center gap-1">
            <button onClick={() => onSelectPly(move.ply - 1)} disabled={move.ply <= 0} title="Previous move" className={ctrl}>
              ◀
            </button>
            <button
              onClick={() => onSelectPly(move.ply + 1)}
              disabled={maxPly !== undefined && move.ply >= maxPly}
              title="Next move"
              className={ctrl}
            >
              ▶
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold ${meta.bg} ${meta.text} ring-1 ${meta.ring}`}>
            {meta.icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-sm text-neutral-300">
                {moveLabel(move.ply)} {move.san}
              </span>
              <span className={`text-sm font-semibold ${meta.text}`}>
                {meta.label}
                {glyph && <span className="ml-1">{glyph}</span>}
              </span>
            </div>
            <div className="text-xs text-neutral-500">
              eval <span className="font-mono text-neutral-300">{evalBefore}</span> →{' '}
              <span className="font-mono text-neutral-300">{evalAfter}</span>
            </div>
          </div>
        </div>

        <p className="text-sm leading-snug text-neutral-200">{move.explanation}</p>

        {showBestLine && (
          <button
            onClick={() => onPlayVariation([move.pv[0] ?? move.bestMoveSan!], move.ply)}
            title="Play the engine's move on the board"
            className="block w-full rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-left text-xs text-neutral-300 ring-1 ring-emerald-400/30 hover:bg-emerald-500/20"
          >
            Best was <span className="font-mono font-semibold text-emerald-300">{move.bestMoveSan}</span>
          </button>
        )}

        {move.pv.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Engine line</div>
            <div className="flex flex-wrap gap-x-1 gap-y-1 text-xs">
              {move.pv.map((san, i) => {
                const label = pvLabel(move.ply + i, i);
                return (
                  <button
                    key={`${i}-${san}`}
                    onClick={() => onPlayVariation(move.pv.slice(0, i + 1), move.ply)}
                    title="Play the line up to here on the board"
                    className="rounded px-1 py-0.5 font-mono text-neutral-200 hover:bg-neutral-700 hover:text-emerald-300"
                  >
                    {label && <span className="mr-0.5 text-neutral-500">{label}</span>}
                    {san}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5 pt-0.5">
          {hasArrow && (
            <button
              onClick={() => setShowBest((v) => !v)}
              className="rounded bg-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-100 hover:bg-neutral-600"
            >
              {showBest ? 'Hide best move' : 'Show best move'}
            </button>
          )}
          <button
            onClick={() => onPractice(move.ply)}
            className="rounded bg-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-100 hover:bg-neutral-600"
          >
            Practice this position
          </button>
        </div>
      </div>
    </div>
  );
}
