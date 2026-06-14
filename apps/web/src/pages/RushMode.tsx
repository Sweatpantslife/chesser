import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { PUZZLES, type Puzzle } from '../trainers/tactics';
import { useRepertoire } from '../store/repertoire';
import { playMoveSound } from '../lib/sound';
import type { Color } from '../store/game';

const RUSH_SECONDS = 300;
const MAX_STRIKES = 3;

type Phase = 'idle' | 'running' | 'over';

function shuffleRamp(): Puzzle[] {
  // ramp difficulty: easy → hard, shuffled within each band for variety
  const byBand: { easy: Puzzle[]; medium: Puzzle[]; hard: Puzzle[] } = { easy: [], medium: [], hard: [] };
  for (const p of PUZZLES) byBand[p.difficulty].push(p);
  for (const band of [byBand.easy, byBand.medium, byBand.hard]) band.sort(() => Math.random() - 0.5);
  return [...byBand.easy, ...byBand.medium, ...byBand.hard];
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function RushMode() {
  const game = useRef(new Chess());
  const pool = useRef<Puzzle[]>([]);
  const busy = useRef(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [timeLeft, setTimeLeft] = useState(RUSH_SECONDS);
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null);

  const highScore = useRepertoire((s) => s.rushHighScore);
  const setHighScore = useRepertoire((s) => s.setRushHighScore);

  const puzzle = pool.current[idx];

  const loadAt = (i: number) => {
    const p = pool.current[i % pool.current.length];
    if (!p) return;
    game.current = new Chess(p.fen);
    setIdx(i % pool.current.length);
    setFen(game.current.fen());
    setLastMove(undefined);
    setFlash(null);
    busy.current = false;
  };

  const start = () => {
    pool.current = shuffleRamp();
    setScore(0);
    setStrikes(0);
    setTimeLeft(RUSH_SECONDS);
    setPhase('running');
    loadAt(0);
  };

  const finish = (finalScore: number) => {
    setPhase('over');
    setHighScore(finalScore);
  };

  // countdown
  useEffect(() => {
    if (phase !== 'running') return;
    if (timeLeft <= 0) {
      finish(score);
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, timeLeft, score]);

  const solverToMove = phase === 'running' && !!puzzle && !busy.current && game.current.turn() === (puzzle.turn === 'white' ? 'w' : 'b');

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

  const onMove = (from: string, to: string) => {
    if (!solverToMove || !puzzle) return;
    busy.current = true;
    const key = puzzle.solution[0]!;
    if (key.slice(0, 2) === from && key.slice(2, 4) === to) {
      const mv = game.current.move({ from, to, promotion: key[4] });
      playMoveSound(mv.san);
      const hist = game.current.history({ verbose: true });
      const last = hist[hist.length - 1];
      setFen(game.current.fen());
      setLastMove(last ? [last.from, last.to] : undefined);
      setFlash('ok');
      const next = score + 1;
      setScore(next);
      setTimeout(() => loadAt(idx + 1), 300);
    } else {
      setFlash('bad');
      const s = strikes + 1;
      setStrikes(s);
      setTimeout(() => {
        if (s >= MAX_STRIKES) finish(score);
        else loadAt(idx + 1);
      }, 450);
    }
  };

  const orientation: Color = puzzle?.turn ?? 'white';

  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-3">
        <div className="flex h-7 items-center gap-3 text-sm">
          {phase === 'running' && puzzle && (
            <>
              <span className="capitalize text-neutral-400">{puzzle.turn} to move — find the win</span>
              {flash === 'ok' && <span className="text-emerald-400">✓</span>}
              {flash === 'bad' && <span className="text-rose-400">✗ strike!</span>}
            </>
          )}
        </div>
        <div
          className={`mx-auto w-full max-w-[520px] rounded-lg ring-2 transition-colors ${
            flash === 'ok' ? 'ring-emerald-500' : flash === 'bad' ? 'ring-rose-500' : 'ring-transparent'
          }`}
        >
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={game.current.turn() === 'w' ? 'white' : 'black'}
            movableColor={solverToMove ? orientation : undefined}
            dests={dests}
            lastMove={lastMove}
            inCheck={game.current.inCheck()}
            onMove={onMove}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg bg-panel p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Time</div>
          <div className={`font-mono text-3xl ${timeLeft <= 30 && phase === 'running' ? 'text-rose-400' : 'text-ink'}`}>
            {fmtTime(timeLeft)}
          </div>
          <div className="mt-3 flex items-center justify-center gap-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">Score</div>
              <div className="text-2xl font-bold text-emerald-400">{score}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">Strikes</div>
              <div className="text-2xl">
                {Array.from({ length: MAX_STRIKES }).map((_, i) => (
                  <span key={i} className={i < strikes ? 'text-rose-500' : 'text-neutral-700'}>
                    ✕
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs text-neutral-400">Best: {highScore}</div>
        </div>

        {phase === 'idle' && (
          <div className="rounded-lg bg-panel p-4 text-sm text-neutral-300">
            <p className="mb-3">Solve as many as you can in 5 minutes. Three wrong moves and you’re out — difficulty ramps up as you go.</p>
            <button onClick={start} className="w-full rounded bg-emerald-600 py-2 font-semibold text-white hover:bg-emerald-500">
              Start rush
            </button>
          </div>
        )}
        {phase === 'over' && (
          <div className="rounded-lg bg-panel p-4 text-center">
            <div className="text-sm text-neutral-400">Run over</div>
            <div className="my-1 text-4xl font-bold text-emerald-400">{score}</div>
            {score >= highScore && score > 0 && <div className="mb-2 text-xs text-amber-300">🏆 New best!</div>}
            <button onClick={start} className="mt-2 w-full rounded bg-emerald-600 py-2 font-semibold text-white hover:bg-emerald-500">
              Play again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
