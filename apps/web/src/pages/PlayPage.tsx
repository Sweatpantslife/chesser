import { useEffect } from 'react';
import { Board } from '../board/Board';
import { EvalBar } from '../components/EvalBar';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { MoveList } from '../components/MoveList';
import { BotPanel } from '../components/BotPanel';
import { Controls } from '../components/Controls';
import { Clock } from '../components/Clock';
import { PromotionDialog } from '../components/PromotionDialog';
import { engine } from '../lib/engine';
import { useGame, type Color } from '../store/game';

function ClockRow({ side }: { side: Color }) {
  const clock = useGame((s) => s.clock);
  const liveTurn = useGame((s) => s.liveTurn);
  const flagged = useGame((s) => s.flagged);
  const isGameOver = useGame((s) => s.isGameOver);
  if (!clock) return null;
  const ms = side === 'white' ? clock.whiteMs : clock.blackMs;
  return <Clock ms={ms} active={liveTurn === side && !isGameOver} flagged={flagged === side} />;
}

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

  const topSide: Color = orientation === 'white' ? 'black' : 'white';

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="mb-2 flex justify-end">
        <ClockRow side={topSide} />
      </div>
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
      <div className="mt-2 flex justify-end">
        <ClockRow side={orientation} />
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

  // Drive the chess clocks in real time (no-op unless a timed game is live).
  useEffect(() => {
    let last = performance.now();
    const iv = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      useGame.getState()._tick(dt);
    }, 100);
    return () => window.clearInterval(iv);
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
