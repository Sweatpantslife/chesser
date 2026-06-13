import { useEffect, type ReactNode } from 'react';
import { Board } from './board/Board';
import { EvalBar } from './components/EvalBar';
import { AnalysisPanel } from './components/AnalysisPanel';
import { MoveList } from './components/MoveList';
import { BotPanel } from './components/BotPanel';
import { Controls } from './components/Controls';
import { PromotionDialog } from './components/PromotionDialog';
import { useGame } from './store/game';

function Header() {
  const connected = useGame((s) => s.connected);
  const availability = useGame((s) => s.availability);
  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-bold text-ink">♟ Chesser</h1>
        <span className="text-xs text-neutral-500">play &amp; train · Stockfish + Lc0/Maia</span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        {availability && (
          <span className="hidden gap-2 text-neutral-500 sm:flex">
            <Badge ok={availability.stockfish}>Stockfish</Badge>
            <Badge ok={availability.lc0}>Maia</Badge>
          </span>
        )}
        <span className={`flex items-center gap-1.5 ${connected ? 'text-emerald-400' : 'text-rose-400'}`}>
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          {connected ? 'engine online' : 'connecting…'}
        </span>
      </div>
    </header>
  );
}

function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`rounded px-1.5 py-0.5 ${ok ? 'bg-emerald-900/60 text-emerald-300' : 'bg-neutral-800 text-neutral-600'}`}>
      {children}
    </span>
  );
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

export default function App() {
  const init = useGame((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto grid w-full max-w-[1200px] flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
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
      </main>
    </div>
  );
}
