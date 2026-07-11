import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { type Puzzle } from '../trainers/tactics';
import { checkKeyMove, ensureBandsFor, getLoadedPuzzles } from '../lib/puzzleService';
import {
  STORM_DURATION_MS,
  formatClock,
  initialStorm,
  mulberry32,
  pickSprintPuzzle,
  stormEnd,
  stormMiss,
  stormMultiplier,
  stormSolve,
  type StormState,
} from '../lib/sprint';
import { useSprints } from '../store/sprints';
import { useRatings } from '../store/ratings';
import { now } from '../lib/clock';
import { playMoveSound, playSound } from '../lib/sound';
import { recordStorm } from '../lib/gamify';
import { fireConfetti } from '../components/Celebration';
import { useTimeoutRef } from '../lib/useTimeoutRef';
import type { Color } from '../store/game';

/**
 * PUZZLE STORM — a fixed 3-minute window where the difficulty chases your
 * pace: fast, accurate solving pushes the puzzles harder, misses ease them
 * off. Consecutive solves build a combo that multiplies each solve's points
 * (×1 → ×1.5 → ×2 → ×3); a miss resets the combo but costs nothing else.
 *
 * All scoring/combo/adaptive rules live in lib/sprint.ts (pure, seeded);
 * this component owns the seed, the clock and the board.
 */

type Phase = 'idle' | 'running' | 'over';

export function StormMode() {
  const game = useRef(new Chess());
  const busy = useRef(false);
  const rng = useRef<() => number>(() => 0);
  const usedIds = useRef(new Set<string>());
  const endAt = useRef<number | null>(null);
  const shownAt = useRef(0);
  const finished = useRef(false);
  const advanceTimer = useTimeoutRef();

  const [phase, setPhase] = useState<Phase>('idle');
  const [run, _setRun] = useState<StormState>(initialStorm(1200));
  const runRef = useRef(run);
  const setRun = (next: StormState) => {
    runRef.current = next;
    _setRun(next);
  };
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [timeLeft, setTimeLeft] = useState(STORM_DURATION_MS);
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null);
  const [lastPoints, setLastPoints] = useState<number | null>(null);
  const [isRecord, setIsRecord] = useState(false);

  const best = useSprints((s) => s.puzzleStormBest);
  const recordStormRun = useSprints((s) => s.recordStormRun);
  const playerRating = useRatings((s) => Math.round(s.categories.puzzles.glicko.rating));

  const loadNext = (state: StormState) => {
    void ensureBandsFor(state.target); // enrich the pool as difficulty adapts
    const p = pickSprintPuzzle(getLoadedPuzzles(), state.target, usedIds.current, rng.current);
    if (!p) return;
    usedIds.current.add(p.id);
    game.current = new Chess(p.fen);
    setPuzzle(p);
    setFen(game.current.fen());
    setLastMove(undefined);
    setFlash(null);
    shownAt.current = now();
    busy.current = false;
  };

  const finish = (state: StormState) => {
    if (finished.current) return;
    finished.current = true;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    endAt.current = null;
    setRun(state);
    setPhase('over');
    const record = recordStormRun(state.score, state.bestCombo);
    recordStorm({ solved: state.solved, score: state.score }); // XP + storm quests/badges
    setIsRecord(record);
    if (record && state.score > 0) {
      playSound('achievement');
      fireConfetti(120);
    }
  };

  const start = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    // Seeding at the UI entry point is the one place randomness enters a run.
    rng.current = mulberry32(Date.now() >>> 0);
    usedIds.current = new Set();
    finished.current = false;
    endAt.current = now() + STORM_DURATION_MS;
    setTimeLeft(STORM_DURATION_MS);
    setIsRecord(false);
    setLastPoints(null);
    const fresh = initialStorm(playerRating);
    setRun(fresh);
    setPhase('running');
    loadNext(fresh);
  };

  // Countdown driven by the injectable clock.
  useEffect(() => {
    if (phase !== 'running') return;
    const tick = () => {
      if (endAt.current === null) return;
      const left = endAt.current - now();
      setTimeLeft(left);
      if (left <= 0) finish(stormEnd(runRef.current, 'time'));
    };
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const solverToMove =
    phase === 'running' && !!puzzle && !busy.current && game.current.turn() === (puzzle.turn === 'white' ? 'w' : 'b');

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, solverToMove]);

  const onMove = (from: string, to: string) => {
    if (!solverToMove || !puzzle) return;
    busy.current = true;
    const key = puzzle.solution[0]!;
    const check = checkKeyMove(game.current.fen(), key, from, to);
    if (check.ok) {
      const mv = game.current.move({ from, to, promotion: check.altMate ? check.promotion : key[4] });
      playMoveSound(mv.san);
      const hist = game.current.history({ verbose: true });
      const last = hist[hist.length - 1];
      setFen(game.current.fen());
      setLastMove(last ? [last.from, last.to] : undefined);
      setFlash('ok');
      const prevMult = stormMultiplier(runRef.current.combo);
      const res = stormSolve(runRef.current, now() - shownAt.current);
      setRun(res.state);
      setLastPoints(res.points);
      // Sound escalation: pip on every solve, flame-whoosh when a combo tier unlocks.
      if (res.multiplier > prevMult) playSound('streak');
      else playSound('xpGain');
      advanceTimer.current = setTimeout(() => loadNext(res.state), 300);
    } else {
      playSound('wrongMove');
      setFlash('bad');
      setLastPoints(null);
      const next = stormMiss(runRef.current);
      setRun(next);
      advanceTimer.current = setTimeout(() => loadNext(next), 450);
    }
  };

  const giveUp = () => {
    finish(stormEnd(runRef.current, 'quit'));
  };

  const orientation: Color = puzzle?.turn ?? 'white';
  const lowTime = timeLeft <= 30_000;
  const multiplier = stormMultiplier(run.combo);
  const accuracy = run.solved + run.missed > 0 ? Math.round((run.solved / (run.solved + run.missed)) * 100) : 0;

  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
      <div className="space-y-3">
        <div className="flex h-7 items-center gap-3 text-sm">
          {phase === 'running' && puzzle && (
            <>
              <span className="text-neutral-400">{puzzle.turn === 'white' ? 'White' : 'Black'} to move — find the win</span>
              {flash === 'ok' && lastPoints !== null && (
                <span className="font-semibold text-emerald-400" data-testid="storm-points-flash">
                  +{lastPoints}
                </span>
              )}
              {flash === 'bad' && <span className="text-rose-400">✗ combo lost</span>}
            </>
          )}
        </div>
        <div
          data-puzzle-id={puzzle?.id ?? ''}
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
        <div className="rounded-2xl bg-panel p-4 text-center shadow-soft" data-testid="storm-hud">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Time</div>
          <div className={`font-mono text-3xl ${lowTime && phase === 'running' ? 'animate-pulse-soft text-rose-400' : 'text-ink'}`}>
            {formatClock(timeLeft)}
          </div>
          <div className="mt-3 flex items-center justify-center gap-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-400">Score</div>
              <div className="text-2xl font-bold text-emerald-400" data-testid="storm-score">
                {run.score}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-400">Combo</div>
              <div
                className={`text-2xl font-bold ${multiplier > 1 ? 'animate-pulse-soft text-gold-400' : 'text-neutral-500'}`}
                data-testid="storm-combo"
              >
                {run.combo > 0 ? `${run.combo}×` : '—'}
              </div>
            </div>
          </div>
          {multiplier > 1 && phase === 'running' && (
            <div className="mt-1 text-xs font-semibold text-gold-400" data-testid="storm-multiplier">
              ⚡ ×{multiplier} points
            </div>
          )}
          <div className="mt-3 text-xs text-neutral-400" data-testid="storm-best">
            Best: {best.score}
          </div>
        </div>

        {phase === 'idle' && (
          <div className="rounded-2xl bg-panel p-4 text-sm text-neutral-300 shadow-soft">
            <p className="mb-3">
              3 minutes of puzzles that adapt to your pace — solve fast to push the difficulty and build a combo that multiplies
              your points. A miss breaks the combo but costs nothing else.
            </p>
            <button
              onClick={start}
              className="w-full rounded bg-emerald-700 py-2 font-semibold text-white hover:bg-emerald-800"
              data-testid="storm-start"
            >
              Start storm
            </button>
          </div>
        )}

        {phase === 'running' && (
          <button
            onClick={giveUp}
            className="w-full rounded bg-neutral-800 py-1.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          >
            End run
          </button>
        )}

        {phase === 'over' && (
          <div className="rounded-2xl bg-panel p-4 text-center shadow-soft" data-testid="storm-summary">
            <div className="text-sm text-neutral-400">{run.endReason === 'time' ? "Time's up!" : 'Run over'}</div>
            <div className="my-1 text-4xl font-bold text-emerald-400">{run.score}</div>
            {isRecord && run.score > 0 && (
              <div className="mb-2 text-xs font-semibold text-gold-400" data-testid="storm-record">
                🏆 New best!
              </div>
            )}
            <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-neutral-300">
              <div className="rounded bg-panelmute px-1.5 py-1.5">
                <div className="text-neutral-400">Solved</div>
                <div className="text-sm font-semibold text-emerald-300">{run.solved}</div>
              </div>
              <div className="rounded bg-panelmute px-1.5 py-1.5">
                <div className="text-neutral-400">Missed</div>
                <div className="text-sm font-semibold text-rose-300">{run.missed}</div>
              </div>
              <div className="rounded bg-panelmute px-1.5 py-1.5">
                <div className="text-neutral-400">Combo</div>
                <div className="text-sm font-semibold text-gold-400">{run.bestCombo}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-neutral-400">{accuracy}% accuracy</div>
            <button
              onClick={start}
              className="mt-3 w-full rounded bg-emerald-700 py-2 font-semibold text-white hover:bg-emerald-800"
              data-testid="storm-again"
            >
              Play again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
