import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { PUZZLES } from '../trainers/tactics';
import type { Color } from '../store/game';

type Phase = 'solving' | 'solved' | 'failed';

export function TacticsPage() {
  const game = useRef(new Chess());
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('solving');
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [stats, setStats] = useState({ solved: 0, attempts: 0 });
  const [revealed, setRevealed] = useState(false);

  const puzzle = PUZZLES[idx];

  const load = (i: number) => {
    const p = PUZZLES[i];
    if (!p) return;
    game.current = new Chess(p.fen);
    setIdx(i);
    setPhase('solving');
    setFeedback({ kind: 'info', text: `${p.turn === 'white' ? 'White' : 'Black'} to play and win.` });
    setRevealed(false);
    setFen(game.current.fen());
    setLastMove(undefined);
  };

  // initialise on mount
  useEffect(() => {
    if (puzzle) load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = () => {
    const hist = game.current.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.current.fen());
    setLastMove(last ? [last.from, last.to] : undefined);
  };

  const solverToMove = phase === 'solving' && puzzle && game.current.turn() === (puzzle.turn === 'white' ? 'w' : 'b');

  const dests = useMemo(() => {
    const map = new Map<string, string[]>();
    if (solverToMove) {
      for (const m of game.current.moves({ verbose: true })) {
        const arr = map.get(m.from) ?? [];
        arr.push(m.to);
        map.set(m.from, arr);
      }
    }
    return map;
  }, [fen, solverToMove]);

  // Play out the rest of the engine line as a demonstration.
  const demoRest = (fromStep: number) => {
    let step = fromStep;
    const tick = () => {
      const uci = puzzle?.solution[step];
      if (!uci) return;
      game.current.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      sync();
      step++;
      if (puzzle && step < puzzle.solution.length) setTimeout(tick, 600);
    };
    setTimeout(tick, 500);
  };

  const onMove = (from: string, to: string) => {
    if (!solverToMove || !puzzle) return;
    const key = puzzle.solution[0]!;
    setStats((s) => ({ ...s, attempts: s.attempts + 1 }));
    if (key.slice(0, 2) === from && key.slice(2, 4) === to) {
      const mv = game.current.move({ from, to, promotion: key[4] });
      sync();
      setPhase('solved');
      setStats((s) => ({ ...s, solved: s.solved + 1 }));
      setFeedback({ kind: 'ok', text: `✓ ${mv.san} — ${puzzle.theme}!` });
      demoRest(1);
    } else {
      setPhase('failed');
      setFeedback({ kind: 'bad', text: 'Not the winning move. Try again, or reveal.' });
      sync(); // snap back
    }
  };

  const retry = () => {
    if (!puzzle) return;
    game.current = new Chess(puzzle.fen);
    setPhase('solving');
    setFeedback({ kind: 'info', text: 'Try again.' });
    setFen(game.current.fen());
    setLastMove(undefined);
  };

  const reveal = () => {
    if (!puzzle) return;
    const key = puzzle.solution[0]!;
    game.current = new Chess(puzzle.fen);
    const mv = game.current.move({ from: key.slice(0, 2), to: key.slice(2, 4), promotion: key[4] });
    setRevealed(true);
    setPhase('solved');
    setFeedback({ kind: 'info', text: `Solution: ${mv.san}` });
    sync();
    demoRest(1);
  };

  if (!puzzle) {
    return (
      <div className="mx-auto max-w-md rounded-lg bg-panel p-4 text-sm text-neutral-400">
        No puzzles found. Generate some with <code className="text-neutral-200">node scripts/gen-tactics.mjs</code>.
      </div>
    );
  }

  const orientation: Color = puzzle.turn;

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      <div className="order-2 space-y-3 lg:order-1">
        <div className="rounded-lg bg-panel p-3">
          <h3 className="mb-1 text-sm font-semibold text-ink">Tactics</h3>
          <p className="mb-3 text-xs text-neutral-400">
            Find the one winning move. Every puzzle is engine-verified — exactly one move wins.
          </p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-300">
              Puzzle {idx + 1}/{PUZZLES.length}
            </span>
            <span className="text-xs text-neutral-400">
              <span className="text-emerald-400">{stats.solved}</span> solved · {stats.attempts} tries
            </span>
          </div>
        </div>
      </div>

      <div className="order-1 space-y-3 lg:order-2">
        <div className="flex h-7 items-center gap-2 text-sm">
          <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200">{puzzle.theme}</span>
          <span className="capitalize text-neutral-400">{puzzle.turn} to move</span>
          {solverToMove && <span className="animate-pulse text-emerald-400">· your move</span>}
        </div>
        <div className="mx-auto w-full max-w-[540px]">
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={game.current.turn() === 'w' ? 'white' : 'black'}
            movableColor={solverToMove ? puzzle.turn : undefined}
            dests={dests}
            lastMove={lastMove}
            inCheck={game.current.inCheck()}
            onMove={onMove}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {phase === 'failed' && (
            <button onClick={retry} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
              Try again
            </button>
          )}
          {!revealed && phase !== 'solved' && (
            <button onClick={reveal} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
              Reveal
            </button>
          )}
          <button
            onClick={() => load((idx + 1) % PUZZLES.length)}
            className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600"
          >
            Next puzzle →
          </button>
        </div>
      </div>

      <div className="order-3 space-y-3">
        <div className="rounded-lg bg-panel p-3">
          {feedback && (
            <p
              className={`text-sm ${
                feedback.kind === 'ok' ? 'text-emerald-300' : feedback.kind === 'bad' ? 'text-rose-300' : 'text-neutral-300'
              }`}
            >
              {feedback.text}
            </p>
          )}
          {phase === 'solved' && (
            <button
              onClick={() => load((idx + 1) % PUZZLES.length)}
              className="mt-3 w-full rounded bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Next puzzle
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
