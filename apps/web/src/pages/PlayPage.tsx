import { useEffect, useMemo } from 'react';
import type { DrawShape } from 'chessground/draw';
import { Board } from '../board/Board';
import { EvalBar } from '../components/EvalBar';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { MoveList } from '../components/MoveList';
import { PlayPanel } from '../components/PlayPanel';
import { GameActions } from '../components/GameActions';
import { Controls } from '../components/Controls';
import { Clock } from '../components/Clock';
import { ExplorerPanel } from '../components/ExplorerPanel';
import { OpeningName } from '../components/OpeningName';
import { ReviewPanel } from '../components/ReviewPanel';
import { PromotionDialog } from '../components/PromotionDialog';
import { engine } from '../lib/engine';
import { useGame, type Color } from '../store/game';
import { useSettings } from '../store/settings';
import { useLadder } from '../store/ladder';

// Brushes for the top engine lines, best → worst.
const ARROW_BRUSHES = ['green', 'blue', 'yellow', 'red'];

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
  const analysisLines = useGame((s) => s.analysisLines);
  const userMove = useGame((s) => s.userMove);
  const mode = useGame((s) => s.mode);
  const arrowsOn = useSettings((s) => s.arrows);

  const topSide: Color = orientation === 'white' ? 'black' : 'white';

  // Engine best-move arrows — analysis board only, so play isn't spoiled.
  const shapes = useMemo<DrawShape[]>(() => {
    if (mode !== 'analysis' || !analysisOn || !arrowsOn) return [];
    return analysisLines
      .filter((l) => l.pvUci[0])
      .map((l, i) => ({
        orig: l.pvUci[0]!.slice(0, 2) as DrawShape['orig'],
        dest: l.pvUci[0]!.slice(2, 4) as DrawShape['dest'],
        brush: ARROW_BRUSHES[i] ?? 'blue',
        modifiers: { lineWidth: i === 0 ? 12 : Math.max(6, 11 - i * 2) },
      }));
  }, [analysisLines, analysisOn, arrowsOn, mode]);

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
            premove={mode === 'play'}
            shapes={shapes}
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

  // Advance the ladder when you win a game against a roster opponent.
  useEffect(() => {
    let handled = -1;
    return useGame.subscribe((s) => {
      if (!s.isGameOver || handled === s.gameNo) return;
      handled = s.gameNo;
      if (s.opponent?.id && s.winner !== null && s.winner !== 'draw' && s.winner === s.playerColor) {
        useLadder.getState().markDefeated(s.opponent.id);
      }
    });
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

  // Keyboard navigation through the move list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const s = useGame.getState();
      if (e.key === 'ArrowLeft') s.stepView(-1);
      else if (e.key === 'ArrowRight') s.stepView(1);
      else if (e.key === 'Home') s.goToPly(0);
      else if (e.key === 'End') s.goToPly(s.history.length);
      else if (e.key === 'f' || e.key === 'F') s.flip();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      <div className="order-2 space-y-3 lg:order-1">
        <PlayPanel />
      </div>
      <div className="order-1 space-y-3 lg:order-2">
        <StatusLine />
        <BoardArea />
        <GameActions />
        <Controls />
      </div>
      <div className="order-3 space-y-3">
        <AnalysisPanel />
        <OpeningName />
        <ReviewPanel />
        <MoveList />
        <ExplorerPanel />
      </div>
    </div>
  );
}
