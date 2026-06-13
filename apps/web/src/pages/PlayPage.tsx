import { useEffect } from 'react';
import { Board } from '../board/Board';
import { EvalBar } from '../components/EvalBar';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { MoveList } from '../components/MoveList';
import { BotPanel } from '../components/BotPanel';
import { Controls } from '../components/Controls';
import { PromotionDialog } from '../components/PromotionDialog';
import { engine } from '../lib/engine';
import { useGame } from '../store/game';

function StatusLine() {
  const status = useGame((s) => s.status);
  const thinking = useGame((s) => s.thinking);
  const mode = useGame((s) => s.mode);
  const isGameOver = useGame((s) => s.isGameOver);
  return (
    <div className="flex h-7 items-center gap-2 text-sm">
      <span className={isGameOver ? 'font-semibold text-amber-300' : 'text-neutral-300'}>{status}</span>
      {thinking && <span className="animate-pulse text-emerald-400">· bot is thinking…</span>}
      {mode === 'analysis' && !isGameOver && <span className="text-neutral-600">· analysis board</span>}
    </div>
  );
}

function BoardArea() {
  const fen = useGame((s) => s.fen);
  const orientation = useGame((s) => s.orientation);
  const turnColor = useGame((s) => s.turnColor);
  const movableColor = useGame((s) => s.movableColor);
  const dests = useGame((s) => s.dests);
  const lastMove = useGame((s) => s.lastMove);
  const inCheck = useGame((s) => s.inCheck);
  const evalScore = useGame((s) => s.evalScore);
  const analysisOn = useGame((s) => s.analysisOn);
  const userMove = useGame((s) => s.userMove);

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="flex gap-2">
        {analysisOn && <EvalBar score={evalScore} orientation={orientation} />}
        <div className="relative flex-1">
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={turnColor}
            movableColor={movableColor}
            dests={dests}
            lastMove={lastMove}
            inCheck={inCheck}
            onMove={userMove}
          />
          <PromotionDialog />
        </div>
      </div>
    </div>
  );
}

export function PlayPage() {
  // Own the single analysis stream while this page is mounted.
  useEffect(() => {
    useGame.getState()._refreshAnalysis();
    return () => engine.stopAnalysis();
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      <div className="order-2 space-y-3 lg:order-1">
        <BotPanel />
      </div>
      <div className="order-1 space-y-3 lg:order-2">
        <StatusLine />
        <BoardArea />
        <Controls />
      </div>
      <div className="order-3 space-y-3">
        <AnalysisPanel />
        <MoveList />
      </div>
    </div>
  );
}
