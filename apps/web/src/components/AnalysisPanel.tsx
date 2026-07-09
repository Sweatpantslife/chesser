import type { AnalysisLine } from '@chesser/shared';
import { formatScore } from '../lib/format';
import { useGame } from '../store/game';

function scoreClass(line: AnalysisLine): string {
  const v = line.score.kind === 'cp' ? line.score.value : line.score.value > 0 ? 1 : -1;
  if (v > 30) return 'text-emerald-300';
  if (v < -30) return 'text-rose-300';
  return 'text-neutral-300';
}

export function AnalysisPanel() {
  const { analysisOn, analysisLines, analysisDepth, multipv, setMultipv, setAnalysisOn } = useGame();
  const mode = useGame((s) => s.mode);
  const isGameOver = useGame((s) => s.isGameOver);

  // Engine assistance is never available while a game is being played — the
  // store also refuses to stream (see _refreshAnalysis), this is just the UI.
  const playing = mode === 'play' && !isGameOver;
  if (playing) {
    return (
      <div className="rounded-lg bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">Engine</h3>
          <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300">off during games</span>
        </div>
        <p className="text-xs text-neutral-500">
          Engine analysis is disabled while you play — it unlocks the moment the game ends.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">Engine</h3>
          {analysisOn && (
            <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-xs text-neutral-300">
              Stockfish · depth {analysisDepth}
            </span>
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-400">
          <input type="checkbox" checked={analysisOn} onChange={(e) => setAnalysisOn(e.target.checked)} />
          analyse
        </label>
      </div>

      {analysisOn ? (
        <>
          <div className="mb-2 flex items-center gap-1 text-xs text-neutral-400">
            <span>lines</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setMultipv(n)}
                className={`h-5 w-5 rounded text-xs ${
                  multipv === n ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <ol className="space-y-1">
            {analysisLines.length === 0 && <li className="text-xs text-neutral-400">thinking…</li>}
            {analysisLines.map((line) => (
              <li key={line.multipv} className="flex items-baseline gap-2 text-sm">
                <span className={`w-12 shrink-0 font-mono font-semibold tabular-nums ${scoreClass(line)}`}>
                  {formatScore(line.score)}
                </span>
                <span className="truncate font-mono text-xs text-neutral-300" title={line.pvSan.join(' ')}>
                  {line.pvSan.join(' ')}
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="text-xs text-neutral-400">Analysis is off.</p>
      )}
    </div>
  );
}
