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
      className="relative w-6 shrink-0 overflow-hidden rounded bg-neutral-900"
      title={score ? `Evaluation: ${label} (White's view)` : 'No evaluation'}
    >
      {/* white share of the bar */}
      <div
        className="absolute inset-x-0 bg-neutral-100 transition-[height] duration-300 ease-out"
        style={whiteAtBottom ? { bottom: 0, height: `${whitePct}%` } : { top: 0, height: `${whitePct}%` }}
      />
      <span
        className={`absolute inset-x-0 text-center text-[10px] font-semibold tabular-nums ${
          whiteIsBetter ? 'text-neutral-900' : 'text-neutral-100'
        }`}
        style={whiteIsBetter === whiteAtBottom ? { bottom: 2 } : { top: 2 }}
      >
        {label}
      </span>
    </div>
  );
}
