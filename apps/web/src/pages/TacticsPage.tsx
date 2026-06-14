import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { ReviewStats } from '../components/ReviewStats';
import { PUZZLES, type Difficulty } from '../trainers/tactics';
import { useProgress } from '../store/progress';
import type { Color } from '../store/game';

type Phase = 'solving' | 'solved' | 'failed';
type Filter = 'all' | Difficulty;

const ALL_IDS = PUZZLES.map((p) => p.id);

const DIFF_COLOR: Record<Difficulty, string> = {
  easy: 'text-emerald-300',
  medium: 'text-amber-300',
  hard: 'text-rose-300',
};

export function TacticsPage() {
  const game = useRef(new Chess());
  const attempt = useRef({ failed: false, revealed: false });
  const [filter, setFilter] = useState<Filter>('all');
  const [pos, setPos] = useState(0);
  const [phase, setPhase] = useState<Phase>('solving');
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [sessionSolved, setSessionSolved] = useState(0);

  const grade = useProgress((s) => s.grade);
  const dueIds = useProgress((s) => s.dueIds);
  const cards = useProgress((s) => s.cards);

  const queue = useMemo(() => PUZZLES.filter((p) => filter === 'all' || p.difficulty === filter), [filter]);
  const puzzle = queue[pos] ?? queue[0];

  const load = (i: number, q = queue) => {
    const p = q[i];
    if (!p) return;
    game.current = new Chess(p.fen);
    attempt.current = { failed: false, revealed: false };
    setPos(i);
    setPhase('solving');
    setFeedback({ kind: 'info', text: `${p.turn === 'white' ? 'White' : 'Black'} to play and win.` });
    setFen(game.current.fen());
    setLastMove(undefined);
  };

  useEffect(() => {
    if (queue.length) load(0, queue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

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
    if (key.slice(0, 2) === from && key.slice(2, 4) === to) {
      const mv = game.current.move({ from, to, promotion: key[4] });
      sync();
      setPhase('solved');
      setSessionSolved((n) => n + 1);
      setFeedback({ kind: 'ok', text: `✓ ${mv.san} — ${puzzle.theme}!` });
      grade('tactics', puzzle.id, attempt.current.failed ? 'hard' : 'good');
      demoRest(1);
    } else {
      attempt.current.failed = true;
      setPhase('failed');
      setFeedback({ kind: 'bad', text: 'Not the winning move. Try again, or reveal.' });
      sync();
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
    attempt.current.revealed = true;
    const key = puzzle.solution[0]!;
    game.current = new Chess(puzzle.fen);
    const mv = game.current.move({ from: key.slice(0, 2), to: key.slice(2, 4), promotion: key[4] });
    setPhase('solved');
    setFeedback({ kind: 'info', text: `Solution: ${mv.san}` });
    grade('tactics', puzzle.id, 'again');
    sync();
    demoRest(1);
  };

  const next = () => load((pos + 1) % queue.length);

  const reviewDue = () => {
    const due = dueIds('tactics', queue.map((p) => p.id));
    if (due.length === 0) {
      setFeedback({ kind: 'info', text: 'No reviews due right now — try new puzzles!' });
      return;
    }
    const id = due[0]!;
    const i = queue.findIndex((p) => p.id === id);
    if (i >= 0) load(i);
  };

  if (!puzzle) {
    return (
      <div className="mx-auto max-w-md rounded-lg bg-panel p-4 text-sm text-neutral-400">
        No puzzles for this filter. Generate more with <code className="text-neutral-200">pnpm gen:tactics</code>.
      </div>
    );
  }

  const orientation: Color = puzzle.turn;
  const solvedCard = cards[`tactics:${puzzle.id}`];

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      <div className="order-2 space-y-3 lg:order-1">
        <div className="rounded-lg bg-panel p-3">
          <h3 className="mb-1 text-sm font-semibold text-ink">Tactics</h3>
          <p className="mb-2 text-xs text-neutral-400">Find the one winning move — every puzzle is engine-verified.</p>
          <ReviewStats deck="tactics" ids={ALL_IDS} />
          <div className="mt-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Difficulty</div>
            <div className="flex gap-1">
              {(['all', 'easy', 'medium', 'hard'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 rounded px-1.5 py-1 text-xs capitalize ${
                    filter === f ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={reviewDue}
            className="mt-3 w-full rounded bg-emerald-600 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Review due
          </button>
        </div>
      </div>

      <div className="order-1 space-y-3 lg:order-2">
        <div className="flex h-7 items-center gap-2 text-sm">
          <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200">{puzzle.theme}</span>
          <span className={`text-xs capitalize ${DIFF_COLOR[puzzle.difficulty]}`}>{puzzle.difficulty}</span>
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
          {phase !== 'solved' && (
            <button onClick={reveal} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
              Reveal
            </button>
          )}
          <button onClick={next} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
            Next puzzle →
          </button>
        </div>
      </div>

      <div className="order-3 space-y-3">
        <div className="rounded-lg bg-panel p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-neutral-300">
              Puzzle {pos + 1}/{queue.length}
            </span>
            <span className="text-xs text-neutral-400">{sessionSolved} solved this session</span>
          </div>
          {feedback && (
            <p
              className={`text-sm ${
                feedback.kind === 'ok' ? 'text-emerald-300' : feedback.kind === 'bad' ? 'text-rose-300' : 'text-neutral-300'
              }`}
            >
              {feedback.text}
            </p>
          )}
          {solvedCard?.last && phase === 'solving' && (
            <p className="mt-2 text-xs text-neutral-500">You’ve seen this one before — recall the idea.</p>
          )}
          {phase === 'solved' && (
            <button
              onClick={next}
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
