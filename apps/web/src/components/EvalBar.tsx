import type { Score } from '@chesser/shared';
import type { Color } from '../store/game';
import { formatScore, whiteWinPercent } from '../lib/format';

export function EvalBar({ score, orientation }: { score: Score | null; orientation: Color }) {
  const whitePct = whiteWinPercent(score);
  const whiteAtBottom = orientation === 'white';
  const label = score ? formatScore(score) : '·';
  const whiteIsBetter = !score || (score.kind === 'cp' ? score.value >= 0 : score.value > 0);

  return (
    <div
      className="relative w-6 shrink-0 rounded bg-neutral-900"
      role="img"
      aria-label={score ? `Evaluation: ${label} (White's view)` : 'No evaluation'}
      title={score ? `Evaluation: ${label} (White's view)` : 'No evaluation'}
    >
      {/* clip only the fill — the numeric label ("+0.42") is wider than the
          24px bar and must overflow visibly instead of being cut off */}
      <div className="absolute inset-0 overflow-hidden rounded">
        {/* white share of the bar */}
        <div
          className="absolute inset-x-0 bg-neutral-100 transition-[height] duration-300 ease-out"
          style={whiteAtBottom ? { bottom: 0, height: `${whitePct}%` } : { top: 0, height: `${whitePct}%` }}
        />
      </div>
      <span
        className={`absolute inset-x-0 whitespace-nowrap text-center text-[10px] font-semibold tabular-nums ${
          whiteIsBetter ? 'text-neutral-900' : 'text-neutral-100'
        }`}
        style={whiteIsBetter === whiteAtBottom ? { bottom: 2 } : { top: 2 }}
      >
        {label}
      </span>
    </div>
  );
}
