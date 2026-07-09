import { useMemo, useRef, useState } from 'react';
import { mainlineOf, useGame } from '../store/game';
import { useAnalysisReport } from '../store/analysisReport';
import { useMistakes, type NewMistake } from '../store/mistakes';
import { useCustomPuzzles } from '../store/customPuzzles';
import { generatePuzzles } from '../lib/puzzleGen';
import { EvalGraph } from './EvalGraph';
import { EvalGraphPro } from './analysis/EvalGraphPro';

export function ReviewPanel() {
  const mode = useGame((s) => s.mode);
  const tree = useGame((s) => s.tree);
  const rootId = useGame((s) => s.rootId);
  const startFen = useGame((s) => s.startFen);
  const evalGraph = useGame((s) => s.evalGraph);
  const reviewing = useGame((s) => s.reviewing);
  const progress = useGame((s) => s.reviewProgress);
  const annotations = useGame((s) => s.annotations);
  const stats = useGame((s) => s.reviewStats);
  const moveReviews = useGame((s) => s.moveReviews);
  const reviewGame = useGame((s) => s.reviewGame);
  const startCoach = useGame((s) => s.startCoach);
  const gameNo = useGame((s) => s.gameNo);
  const viewPly = useGame((s) => s.viewPly);
  const report = useAnalysisReport((s) => s.report);
  const reportGameNo = useAnalysisReport((s) => s.gameNo);
  const addMistakes = useMistakes((s) => s.addMany);
  const addPuzzles = useCustomPuzzles((s) => s.addMany);
  const [saved, setSaved] = useState<number | null>(null);
  const [gen, setGen] = useState<{ done: number; total: number; found: number } | null>(null);
  const [genResult, setGenResult] = useState<number | null>(null);
  const stopGen = useRef(false);

  const mainline = useMemo(() => mainlineOf(tree, rootId), [tree, rootId]);

  const makePuzzles = async () => {
    if (gen) {
      stopGen.current = true; // a second click cancels
      return;
    }
    // Bail out cleanly if the user loads a different game while we're mining.
    const startRoot = useGame.getState().rootId;
    const sameGame = () => useGame.getState().rootId === startRoot;
    stopGen.current = false;
    setGenResult(null);
    setGen({ done: 0, total: mainline.length + 1, found: 0 });
    // Free the engine: pause live analysis while we scan the game.
    const wasOn = useGame.getState().analysisOn;
    useGame.getState().setAnalysisOn(false);
    try {
      const fens = [startFen, ...mainline.map((n) => n.fen)];
      const found = await generatePuzzles({
        fens,
        source: 'your game',
        movetimeMs: 600,
        maxFound: 12,
        onProgress: (done, total, foundN) => {
          if (sameGame()) setGen({ done, total, found: foundN });
        },
        shouldStop: () => stopGen.current || !sameGame(),
      });
      const added = addPuzzles(found); // mined from a real game — keep them either way
      if (sameGame()) setGenResult(added);
    } finally {
      setGen(null);
      if (wasOn) useGame.getState().setAnalysisOn(true); // a global toggle — always restore
    }
  };

  const saveMistakes = () => {
    const cards: NewMistake[] = [];
    for (let i = 0; i < mainline.length; i++) {
      const ann = annotations[mainline[i]!.id];
      if (!ann || ann === 'inaccuracy') continue; // drill the serious ones
      const w = evalGraph[i];
      if (w === undefined) continue;
      const side = i % 2 === 0 ? 'white' : 'black';
      cards.push({
        fen: i === 0 ? startFen : mainline[i - 1]!.fen,
        side,
        playedSan: mainline[i]!.san,
        expected: side === 'white' ? w : 100 - w,
        severity: ann,
      });
    }
    setSaved(addMistakes(cards));
    setTimeout(() => setSaved(null), 2500);
  };

  const counts = useMemo(() => {
    const c = { white: { blunder: 0, mistake: 0, inaccuracy: 0 }, black: { blunder: 0, mistake: 0, inaccuracy: 0 } };
    for (let i = 0; i < mainline.length; i++) {
      const ann = annotations[mainline[i]!.id];
      if (!ann) continue;
      c[i % 2 === 0 ? 'white' : 'black'][ann] += 1;
    }
    return c;
  }, [annotations, mainline]);

  const seriousCount = counts.white.blunder + counts.white.mistake + counts.black.blunder + counts.black.mistake;
  const hasResults = Object.keys(annotations).length > 0;
  const disabled = mode !== 'analysis' || mainline.length === 0 || reviewing;
  const activeReport = report && reportGameNo === gameNo ? report : null;

  // First review of a reopened game: a cache hit loads the stored report and
  // skips the engine entirely. An explicit "Re-review" always re-analyses.
  const onReview = () => {
    if (hasResults || !useAnalysisReport.getState().tryHydrateFromCache()) void reviewGame();
  };

  return (
    <div className="rounded-lg bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Game review</h3>
        <button
          onClick={onReview}
          disabled={disabled}
          className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
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
          {Object.keys(moveReviews).length > 0 && (
            <button
              onClick={startCoach}
              className="w-full rounded bg-indigo-600 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              ▶ Guided walkthrough
            </button>
          )}
          {activeReport ? (
            <EvalGraphPro
              moves={activeReport.moves}
              phases={activeReport.phases}
              criticalMoments={activeReport.criticalMoments}
              viewPly={viewPly}
              onSelectPly={(ply) => useGame.getState().goToPly(ply)}
            />
          ) : (
            <EvalGraph />
          )}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-400">
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
          {seriousCount > 0 && (
            <button
              onClick={saveMistakes}
              className="w-full rounded bg-neutral-700 py-1.5 text-xs font-semibold text-neutral-100 hover:bg-neutral-600"
            >
              {saved !== null ? `✓ Added ${saved} to drill` : `Save ${seriousCount} mistakes to drill →`}
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-neutral-400">
          {mode === 'analysis' ? 'Analyse a game, then review it for blunders and inaccuracies.' : 'Switch to the analysis board to review a game.'}
        </p>
      )}

      {mode === 'analysis' && mainline.length > 0 && (
        <div className="mt-3 border-t border-neutral-800 pt-3">
          <button
            onClick={makePuzzles}
            disabled={reviewing}
            className="w-full rounded bg-neutral-700 py-1.5 text-xs font-semibold text-neutral-100 hover:bg-neutral-600 disabled:opacity-50"
          >
            {gen
              ? `Mining… ${gen.done}/${gen.total} · ${gen.found} found (click to stop)`
              : '⚡ Make puzzles from this game'}
          </button>
          {gen && (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-neutral-800">
              <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${Math.round((gen.done / gen.total) * 100)}%` }} />
            </div>
          )}
          {genResult !== null && !gen && (
            <p className="mt-1.5 text-xs text-emerald-300">
              {genResult > 0
                ? `✓ Added ${genResult} puzzle${genResult === 1 ? '' : 's'} — find them under Tactics → My games.`
                : 'No new tactics found in this game.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
