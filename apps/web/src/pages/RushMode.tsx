import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { type Puzzle } from '../trainers/tactics';
import { checkKeyMove, ensureBandsFor, getLoadedPuzzles } from '../lib/puzzleService';
import {
  RUSH_DURATION_MS,
  RUSH_MAX_STRIKES,
  formatClock,
  initialRush,
  mulberry32,
  pickSprintPuzzle,
  rushEnd,
  rushMiss,
  rushSolve,
  rushTargetRating,
  type RushState,
  type RushVariant,
} from '../lib/sprint';
import { useSprints } from '../store/sprints';
import { useRepertoire } from '../store/repertoire';
import { now } from '../lib/clock';
import { playMoveSound, playSound } from '../lib/sound';
import { recordRush } from '../lib/gamify';
import { fireConfetti } from '../components/Celebration';
import { useTimeoutRef } from '../lib/useTimeoutRef';
import type { Color } from '../store/game';

/**
 * PUZZLE RUSH — solve as many puzzles as you can while the difficulty ramps
 * up; three wrong moves and the run is over. Two variants: a 3-minute timed
 * sprint and survival (no clock, strikes only).
 *
 * All run logic (lives, streaks, ramp, selection) lives in lib/sprint.ts —
 * pure and seeded. This component only owns the seed (rolled at start), the
 * clock ticks (lib/clock `now()`), and the board.
 */

type Phase = 'idle' | 'running' | 'over';

const VARIANTS: { id: RushVariant; label: string; blurb: string }[] = [
  { id: 'timed3', label: '3 minutes', blurb: 'Race the clock — 3 strikes still end the run.' },
  { id: 'survival', label: 'Survival', blurb: 'No clock. Climb until three strikes end you.' },
];

export function RushMode() {
  const game = useRef(new Chess());
  const busy = useRef(false);
  const rng = useRef<() => number>(() => 0);
  const usedIds = useRef(new Set<string>());
  const endAt = useRef<number | null>(null);
  const finished = useRef(false);
  const advanceTimer = useTimeoutRef();

  const [variant, setVariant] = useState<RushVariant>('timed3');
  const [phase, setPhase] = useState<Phase>('idle');
  const [run, _setRun] = useState<RushState>(initialRush());
  // The live run state is mirrored in a ref so the interval tick and event
  // handlers always see the current value without stale-closure hazards.
  const runRef = useRef(run);
  const setRun = (next: RushState) => {
    runRef.current = next;
    _setRun(next);
  };
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null);
  const [isRecord, setIsRecord] = useState(false);

  const best = useSprints((s) => s.puzzleRushBest[variant]);
  const recordRushRun = useSprints((s) => s.recordRushRun);
  const setLegacyHighScore = useRepertoire((s) => s.setRushHighScore);

  const loadNext = (state: RushState) => {
    const target = rushTargetRating(state.solved);
    void ensureBandsFor(target); // enrich the pool for upcoming picks
    const p = pickSprintPuzzle(getLoadedPuzzles(), target, usedIds.current, rng.current);
    if (!p) return;
    usedIds.current.add(p.id);
    game.current = new Chess(p.fen);
    setPuzzle(p);
    setFen(game.current.fen());
    setLastMove(undefined);
    setFlash(null);
    busy.current = false;
  };

  const finish = (state: RushState) => {
    if (finished.current) return;
    finished.current = true;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    endAt.current = null;
    setRun(state);
    setPhase('over');
    setLegacyHighScore(state.solved); // keeps the legacy rush badges/stat alive
    const record = recordRushRun(variant, state.solved, state.bestStreak);
    recordRush(state.solved); // XP + daily quests + achievements
    setIsRecord(record);
    if (record && state.solved > 0) {
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
    const duration = RUSH_DURATION_MS[variant];
    endAt.current = duration === null ? null : now() + duration;
    setTimeLeft(duration);
    setIsRecord(false);
    const fresh = initialRush();
    setRun(fresh);
    setPhase('running');
    loadNext(fresh);
  };

  // Countdown driven by the injectable clock (timed variant only).
  useEffect(() => {
    if (phase !== 'running' || endAt.current === null) return;
    const tick = () => {
      if (endAt.current === null) return;
      const left = endAt.current - now();
      setTimeLeft(left);
      if (left <= 0) finish(rushEnd(runRef.current, 'time'));
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
      const next = rushSolve(runRef.current);
      setRun(next);
      // Sound escalation: every 5-streak plays the flame-catch whoosh.
      if (next.streak > 0 && next.streak % 5 === 0) playSound('streak');
      advanceTimer.current = setTimeout(() => loadNext(next), 300);
    } else {
      playSound('wrongMove');
      setFlash('bad');
      const next = rushMiss(runRef.current);
      setRun(next);
      advanceTimer.current = setTimeout(() => {
        if (next.over) finish(next);
        else loadNext(next);
      }, 450);
    }
  };

  const giveUp = () => {
    finish(rushEnd(runRef.current, 'quit'));
  };

  const orientation: Color = puzzle?.turn ?? 'white';
  const lowTime = timeLeft !== null && timeLeft <= 30_000;

  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
      <div className="space-y-3">
        <div className="flex h-7 items-center gap-3 text-sm">
          {phase === 'running' && puzzle && (
            <>
              <span className="text-neutral-400">{puzzle.turn === 'white' ? 'White' : 'Black'} to move — find the win</span>
              {flash === 'ok' && <span className="text-emerald-400">✓{run.streak >= 2 ? ` ${run.streak} in a row!` : ''}</span>}
              {flash === 'bad' && <span className="text-rose-400">✗ strike!</span>}
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
        <div className="rounded-2xl bg-panel p-4 text-center shadow-soft" data-testid="rush-hud">
          {RUSH_DURATION_MS[variant] !== null ? (
            <>
              <div className="text-xs uppercase tracking-wide text-neutral-400">Time</div>
              <div className={`font-mono text-3xl ${lowTime && phase === 'running' ? 'animate-pulse-soft text-rose-400' : 'text-ink'}`}>
                {formatClock(timeLeft ?? RUSH_DURATION_MS[variant]!)}
              </div>
            </>
          ) : (
            <div className="text-xs uppercase tracking-wide text-neutral-400">Survival</div>
          )}
          <div className="mt-3 flex items-center justify-center gap-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-400">Score</div>
              <div className="text-2xl font-bold text-emerald-400" data-testid="rush-score">
                {run.solved}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-400">Strikes</div>
              <div className="text-2xl" data-testid="rush-strikes">
                {Array.from({ length: RUSH_MAX_STRIKES }).map((_, i) => (
                  <span key={i} className={i < run.strikes ? 'text-rose-500' : 'text-neutral-700'}>
                    ✕
                  </span>
                ))}
              </div>
            </div>
          </div>
          {run.streak >= 2 && phase === 'running' && (
            <div className="mt-2 text-xs font-semibold text-gold-400" data-testid="rush-streak">
              🔥 {run.streak} streak
            </div>
          )}
          <div className="mt-3 text-xs text-neutral-400" data-testid="rush-best">
            Best ({variant === 'timed3' ? '3 min' : 'survival'}): {best.score}
          </div>
        </div>

        {phase === 'idle' && (
          <div className="rounded-2xl bg-panel p-4 text-sm text-neutral-300 shadow-soft">
            <div className="mb-2 flex gap-1">
              {VARIANTS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVariant(v.id)}
                  className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${
                    variant === v.id ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <p className="mb-3">
              Solve as many as you can — difficulty ramps up as you go. {VARIANTS.find((v) => v.id === variant)!.blurb}
            </p>
            <button
              onClick={start}
              className="w-full rounded bg-emerald-700 py-2 font-semibold text-white hover:bg-emerald-800"
              data-testid="rush-start"
            >
              Start rush
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
          <div className="rounded-2xl bg-panel p-4 text-center shadow-soft" data-testid="rush-summary">
            <div className="text-sm text-neutral-400">
              {run.endReason === 'strikes' ? 'Struck out!' : run.endReason === 'time' ? "Time's up!" : 'Run over'}
            </div>
            <div className="my-1 text-4xl font-bold text-emerald-400">{run.solved}</div>
            {isRecord && run.solved > 0 && (
              <div className="mb-2 text-xs font-semibold text-gold-400" data-testid="rush-record">
                🏆 New best!
              </div>
            )}
            <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-neutral-300">
              <div className="rounded bg-panelmute px-2 py-1.5">
                <div className="text-neutral-400">Missed</div>
                <div className="text-sm font-semibold text-rose-300">{run.strikes}</div>
              </div>
              <div className="rounded bg-panelmute px-2 py-1.5">
                <div className="text-neutral-400">Best streak</div>
                <div className="text-sm font-semibold text-gold-400">{run.bestStreak}</div>
              </div>
            </div>
            <button
              onClick={start}
              className="mt-3 w-full rounded bg-emerald-700 py-2 font-semibold text-white hover:bg-emerald-800"
              data-testid="rush-again"
            >
              Play again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
