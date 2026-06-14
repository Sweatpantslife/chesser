import { useMemo } from 'react';
import { useGame } from '../store/game';
import { EvalGraph } from './EvalGraph';

export function ReviewPanel() {
  const mode = useGame((s) => s.mode);
  const history = useGame((s) => s.history);
  const reviewing = useGame((s) => s.reviewing);
  const progress = useGame((s) => s.reviewProgress);
  const annotations = useGame((s) => s.annotations);
  const stats = useGame((s) => s.reviewStats);
  const reviewGame = useGame((s) => s.reviewGame);

  const counts = useMemo(() => {
    const c = { white: { blunder: 0, mistake: 0, inaccuracy: 0 }, black: { blunder: 0, mistake: 0, inaccuracy: 0 } };
    for (const [plyStr, ann] of Object.entries(annotations)) {
      const side = Number(plyStr) % 2 === 1 ? 'white' : 'black';
      c[side][ann] += 1;
    }
    return c;
  }, [annotations]);

  const hasResults = Object.keys(annotations).length > 0;
  const disabled = mode !== 'analysis' || history.length === 0 || reviewing;

  return (
    <div className="rounded-lg bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Game review</h3>
        <button
          onClick={() => reviewGame()}
          disabled={disabled}
          className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {reviewing ? `${progress}%` : hasResults ? 'Re-review' : 'Review game'}
        </button>
      </div>

      {reviewing ? (
        <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-800">
          <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      ) : hasResults ? (
        <div className="space-y-2">
          <EvalGraph />
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-500">
                <th className="text-left font-normal" />
                <th className="font-normal text-neutral-400">acc.</th>
                <th className="font-normal text-neutral-400">acpl</th>
                <th className="font-normal text-rose-400">??</th>
                <th className="font-normal text-orange-400">?</th>
                <th className="font-normal text-amber-300">?!</th>
              </tr>
            </thead>
            <tbody className="text-neutral-300">
              {(['white', 'black'] as const).map((side) => (
                <tr key={side}>
                  <td className="capitalize text-neutral-400">{side}</td>
                  <td className="text-center font-semibold text-emerald-300">{stats ? `${stats[side].accuracy}%` : '—'}</td>
                  <td className="text-center">{stats ? stats[side].acpl : '—'}</td>
                  <td className="text-center">{counts[side].blunder}</td>
                  <td className="text-center">{counts[side].mistake}</td>
                  <td className="text-center">{counts[side].inaccuracy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-neutral-500">
          {mode === 'analysis' ? 'Analyse a game, then review it for blunders and inaccuracies.' : 'Switch to the analysis board to review a game.'}
        </p>
      )}
    </div>
  );
}
