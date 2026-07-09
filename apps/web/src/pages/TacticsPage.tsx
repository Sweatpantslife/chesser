import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { ReviewStats } from '../components/ReviewStats';
import { PUZZLES, type Difficulty, type Puzzle } from '../trainers/tactics';
import { useProgress } from '../store/progress';
import { useCustomPuzzles } from '../store/customPuzzles';
import { useRatings, ratingValue } from '../store/ratings';
import { useSettings } from '../store/settings';
import { puzzleRatingOf } from '../lib/puzzleRating';
import {
  checkKeyMove,
  ensureBandsFor,
  FILTER_THEMES,
  getDailyPuzzle,
  getLoadedPuzzles,
  getNextPuzzle,
  puzzleHasTheme,
  recordResult,
} from '../lib/puzzleService';
import { playMoveSound } from '../lib/sound';
import { useTimeoutRef } from '../lib/useTimeoutRef';
import { RushMode } from './RushMode';
import { MistakesMode } from './MistakesMode';
import { useMistakes } from '../store/mistakes';
import type { Color } from '../store/game';

type Phase = 'solving' | 'solved' | 'failed';
type DiffFilter = 'all' | Difficulty;
type Source = 'builtin' | 'mine' | 'all';

/** A puzzle from either the bundled set or your own games. */
type AnyPuzzle = Puzzle & { rating?: number; source?: string };

const ALL_IDS = PUZZLES.map((p) => p.id);

const DIFF_COLOR: Record<Difficulty, string> = {
  easy: 'text-emerald-300',
  medium: 'text-amber-300',
  hard: 'text-rose-300',
};

export function TacticsPage() {
  const [mode, setMode] = useState<'practice' | 'rush' | 'mistakes'>('practice');
  const mistakeCount = useMistakes((s) => s.cards.length);
  const labels = { practice: 'Practice', rush: 'Puzzle rush', mistakes: `My mistakes${mistakeCount ? ` (${mistakeCount})` : ''}` };
  return (
    <div className="space-y-4">
      <div className="mx-auto flex w-full max-w-[1200px] gap-1">
        {(['practice', 'rush', 'mistakes'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-3 py-1.5 text-sm ${
              mode === m ? 'bg-emerald-700 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            {labels[m]}
          </button>
        ))}
      </div>
      {mode === 'practice' ? <PracticeTactics /> : mode === 'rush' ? <RushMode /> : <MistakesMode />}
    </div>
  );
}

function PracticeTactics() {
  const game = useRef(new Chess());
  const attempt = useRef({ failed: false, revealed: false, rated: false });
  const sessionSeen = useRef(new Set<string>());
  const demoTimer = useTimeoutRef();

  const [source, setSource] = useState<Source>('builtin');
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('all');
  const [themeFilter, setThemeFilter] = useState<'all' | string>('all');
  const [ratedOrder, setRatedOrder] = useState(false);
  const [pos, setPos] = useState(0);
  // A puzzle served outside the sequential queue (rated pick / daily puzzle).
  const [override, setOverride] = useState<{ p: AnyPuzzle; label: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('solving');
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [sessionSolved, setSessionSolved] = useState(0);
  const [delta, setDelta] = useState<number | null>(null);

  const grade = useProgress((s) => s.grade);
  const dueIds = useProgress((s) => s.dueIds);
  const cards = useProgress((s) => s.cards);
  const mine = useCustomPuzzles((s) => s.puzzles);
  const removePuzzle = useCustomPuzzles((s) => s.remove);
  const meter = useSettings((s) => s.ratingMeter);
  const puzzlesCat = useRatings((s) => s.categories.puzzles);
  // What the player sees follows their chosen meter; difficulty selection always
  // uses the confidence-aware Glicko-2 rating.
  const rating = ratingValue(puzzlesCat, meter);
  const decisionRating = Math.round(puzzlesCat.glicko.rating);

  // Source + difficulty + theme filters drive the queue (natural order).
  const sourced: AnyPuzzle[] = useMemo(
    () => (source === 'mine' ? mine : source === 'all' ? [...mine, ...PUZZLES] : PUZZLES),
    [source, mine],
  );
  const byDifficulty = useMemo(
    () => sourced.filter((p) => diffFilter === 'all' || p.difficulty === diffFilter),
    [sourced, diffFilter],
  );
  const themeCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of FILTER_THEMES) {
      let n = 0;
      for (const p of byDifficulty) if (puzzleHasTheme(p, t.tag)) n++;
      if (n > 0) c.set(t.tag, n);
    }
    return c;
  }, [byDifficulty]);
  const queue = useMemo(
    () => byDifficulty.filter((p) => themeFilter === 'all' || puzzleHasTheme(p, themeFilter)),
    [byDifficulty, themeFilter],
  );
  const puzzle = override?.p ?? queue[pos] ?? queue[0];

  const setupBoard = (p: AnyPuzzle) => {
    // Stop any in-flight solution animation: its pending ticks belong to the
    // previous puzzle and would play illegal moves on the new position.
    if (demoTimer.current) clearTimeout(demoTimer.current);
    demoTimer.current = null;
    game.current = new Chess(p.fen);
    attempt.current = { failed: false, revealed: false, rated: false };
    setPhase('solving');
    setDelta(null);
    setFeedback({ kind: 'info', text: `${p.turn === 'white' ? 'White' : 'Black'} to play and win.` });
    setFen(game.current.fen());
    setLastMove(undefined);
  };

  const load = (i: number, q = queue) => {
    const p = q[i];
    if (!p) return;
    setOverride(null);
    setPos(i);
    setupBoard(p);
  };

  /** Load a puzzle served by the puzzle service (may not be in the queue). */
  const loadDirect = (p: AnyPuzzle, label: string) => {
    setOverride({ p, label });
    setupBoard(p);
  };

  // Warm the rating bands around the player's level for adaptive serving.
  useEffect(() => {
    void ensureBandsFor(decisionRating);
  }, [decisionRating]);

  // Reset to the first puzzle whenever the filters change the queue identity.
  useEffect(() => {
    sessionSeen.current = new Set();
    if (queue.length) load(0, queue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, diffFilter, themeFilter]);

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

  // Record a rated result at most once per puzzle attempt.
  const rateOnce = (success: boolean) => {
    if (!puzzle || attempt.current.rated) return;
    attempt.current.rated = true;
    sessionSeen.current.add(puzzle.id);
    const res = recordResult(puzzle, success);
    setDelta(meter === 'elo' ? res.eloDelta : res.glickoDelta);
  };

  const demoRest = (fromStep: number) => {
    if (demoTimer.current) clearTimeout(demoTimer.current);
    let step = fromStep;
    const tick = () => {
      const uci = puzzle?.solution[step];
      if (!uci) return;
      game.current.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      sync();
      step++;
      demoTimer.current = puzzle && step < puzzle.solution.length ? setTimeout(tick, 600) : null;
    };
    demoTimer.current = setTimeout(tick, 500);
  };

  const onMove = (from: string, to: string) => {
    if (!solverToMove || !puzzle) return;
    const key = puzzle.solution[0]!;
    // Exact match, or any alternate immediate mate when the key move mates.
    const check = checkKeyMove(game.current.fen(), key, from, to);
    if (check.ok) {
      const mv = game.current.move({ from, to, promotion: check.altMate ? check.promotion : key[4] });
      playMoveSound(mv.san);
      sync();
      setPhase('solved');
      setSessionSolved((n) => n + 1);
      setFeedback({ kind: 'ok', text: check.altMate ? `✓ ${mv.san} — checkmate!` : `✓ ${mv.san} — ${puzzle.theme}!` });
      grade('tactics', puzzle.id, attempt.current.failed ? 'hard' : 'good');
      rateOnce(!attempt.current.failed && !attempt.current.revealed);
      if (!check.altMate) demoRest(1);
    } else {
      attempt.current.failed = true;
      rateOnce(false);
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
    rateOnce(false);
    const key = puzzle.solution[0]!;
    game.current = new Chess(puzzle.fen);
    const mv = game.current.move({ from: key.slice(0, 2), to: key.slice(2, 4), promotion: key[4] });
    setPhase('solved');
    setFeedback({ kind: 'info', text: `Solution: ${mv.san}` });
    grade('tactics', puzzle.id, 'again');
    sync();
    demoRest(1);
  };

  const next = () => {
    // Adaptive serving for the bundled set goes through the puzzle service:
    // rating-windowed pick over embedded core + lazily fetched bands.
    if (ratedOrder && source === 'builtin') {
      const p = getNextPuzzle({
        rating: decisionRating,
        themes: themeFilter === 'all' ? undefined : [themeFilter],
        excludeIds: sessionSeen.current,
        difficulty: diffFilter === 'all' ? undefined : diffFilter,
      });
      if (p) {
        loadDirect(p, 'Rated pick');
        return;
      }
    }
    if (queue.length === 0) return;
    if (ratedOrder) {
      // Pick the unseen puzzle closest to your rating; once all are seen, reset
      // and pick the closest overall (still rating-ordered, not sequential).
      const closest = (skipSeen: boolean) => {
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < queue.length; i++) {
          if (skipSeen && sessionSeen.current.has(queue[i]!.id)) continue;
          const d = Math.abs(puzzleRatingOf(queue[i]!) - decisionRating);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
        return best;
      };
      let best = closest(true);
      if (best < 0) {
        sessionSeen.current = new Set();
        best = closest(false);
      }
      load(best >= 0 ? best : 0);
    } else {
      load((pos + 1) % queue.length);
    }
  };

  const reviewDue = () => {
    const due = dueIds('tactics', queue.map((p) => p.id));
    if (due.length) {
      const i = queue.findIndex((p) => p.id === due[0]);
      if (i >= 0) {
        load(i);
        return;
      }
    }
    // Cards from rated picks / the daily puzzle can reference band-served
    // puzzles that never appear in the sequential queue — review those too.
    if (source !== 'mine') {
      const loaded = getLoadedPuzzles();
      const dueLoaded = dueIds('tactics', loaded.map((p) => p.id));
      const p = dueLoaded.length ? loaded.find((x) => x.id === dueLoaded[0]) : undefined;
      if (p) {
        loadDirect(p, 'Review');
        return;
      }
    }
    setFeedback({ kind: 'info', text: 'No reviews due right now — try new puzzles!' });
  };

  // Same puzzle for everyone on a given date, and it works offline.
  const daily = () => {
    loadDirect(getDailyPuzzle(new Date().toISOString().slice(0, 10)), 'Daily puzzle');
  };

  const SOURCES: { id: Source; label: string }[] = [
    { id: 'builtin', label: 'Curated' },
    { id: 'mine', label: `My games${mine.length ? ` (${mine.length})` : ''}` },
    { id: 'all', label: 'All' },
  ];

  const sidebar = (
    <Sidebar
      source={source}
      setSource={setSource}
      sources={SOURCES}
      rating={rating}
      meter={meter}
      diffFilter={diffFilter}
      setDiffFilter={setDiffFilter}
      themeFilter={themeFilter}
      setThemeFilter={setThemeFilter}
      themeCounts={themeCounts}
      ratedOrder={ratedOrder}
      setRatedOrder={setRatedOrder}
      reviewDue={reviewDue}
      onDaily={daily}
    />
  );

  if (!puzzle) {
    return (
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
        {sidebar}
        <div className="order-1 rounded-lg bg-panel p-4 text-sm text-neutral-400 lg:order-2">
          {source === 'mine' ? (
            <>
              No puzzles from your games yet. Open a game on the <b>Play</b> tab, then use{' '}
              <b>“Make puzzles from this game”</b> in the Game-review panel.
            </>
          ) : (
            <>
              No puzzles for this filter. Generate more with <code className="text-neutral-200">pnpm gen:tactics</code>.
            </>
          )}
        </div>
        <div className="order-3" />
      </div>
    );
  }

  const orientation: Color = puzzle.turn;
  const solvedCard = cards[`tactics:${puzzle.id}`];
  const pr = puzzleRatingOf(puzzle);

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      {sidebar}

      <div className="order-1 space-y-3 lg:order-2">
        <div className="flex min-h-7 flex-wrap items-center gap-2 text-sm">
          <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200">{puzzle.theme}</span>
          <span className={`text-xs capitalize ${DIFF_COLOR[puzzle.difficulty]}`}>{puzzle.difficulty}</span>
          <span className="text-xs text-neutral-400">rated {pr}</span>
          <span className="text-neutral-400">{puzzle.turn === 'white' ? 'White' : 'Black'} to move</span>
          {solverToMove && <span className="animate-pulse-soft text-emerald-400">· your move</span>}
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
            <button onClick={retry} className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800">
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
              {override ? override.label : `Puzzle ${pos + 1}/${queue.length}`}
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
          {delta !== null && (
            <p className="mt-1 text-xs">
              <span className={delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {delta >= 0 ? '+' : ''}
                {delta} rating
              </span>{' '}
              <span className="text-neutral-400">→ {rating}</span>
            </p>
          )}
          {puzzle.source && <p className="mt-2 text-xs text-neutral-400">from {puzzle.source}</p>}
          {solvedCard?.last && phase === 'solving' && (
            <p className="mt-2 text-xs text-neutral-400">You’ve seen this one before — recall the idea.</p>
          )}
          {phase === 'solved' && (
            <button
              onClick={next}
              className="mt-3 w-full rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Next puzzle
            </button>
          )}
          {source !== 'builtin' && mine.some((m) => m.id === puzzle.id) && (
            <button
              onClick={() => {
                removePuzzle(puzzle.id);
                setFeedback({ kind: 'info', text: 'Removed from your puzzles.' });
              }}
              className="mt-2 w-full rounded bg-neutral-800 py-1.5 text-xs text-neutral-400 hover:bg-rose-900/50 hover:text-rose-200"
            >
              Delete this puzzle
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Sidebar(props: {
  source: Source;
  setSource: (s: Source) => void;
  sources: { id: Source; label: string }[];
  rating: number;
  meter: 'elo' | 'glicko';
  diffFilter: DiffFilter;
  setDiffFilter: (d: DiffFilter) => void;
  themeFilter: 'all' | string;
  setThemeFilter: (t: 'all' | string) => void;
  themeCounts: Map<string, number>;
  ratedOrder: boolean;
  setRatedOrder: (b: boolean) => void;
  reviewDue: () => void;
  onDaily: () => void;
}) {
  const themes = FILTER_THEMES.filter((t) => (props.themeCounts.get(t.tag) ?? 0) > 0);
  return (
    <div className="order-2 space-y-3 lg:order-1">
      <div className="rounded-lg bg-panel p-3">
        <h3 className="mb-1 text-sm font-semibold text-ink">Tactics</h3>
        <p className="mb-2 text-xs text-neutral-400">Find the one winning move — every puzzle is engine-verified.</p>

        <div className="mb-3 flex items-center justify-between rounded bg-panelmute px-2.5 py-1.5">
          <span className="text-xs uppercase tracking-wide text-neutral-400">
            Your rating <span className="text-neutral-400">· {props.meter === 'glicko' ? 'Glicko' : 'Elo'}</span>
          </span>
          <span className="font-mono text-lg font-bold text-emerald-300">{props.rating}</span>
        </div>

        <ReviewStats deck="tactics" ids={ALL_IDS} />

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Source</div>
          <div className="flex gap-1">
            {props.sources.map((s) => (
              <button
                key={s.id}
                onClick={() => props.setSource(s.id)}
                className={`flex-1 rounded px-1.5 py-1 text-xs ${
                  props.source === s.id ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Difficulty</div>
          <div className="flex gap-1">
            {(['all', 'easy', 'medium', 'hard'] as const).map((f) => (
              <button
                key={f}
                onClick={() => props.setDiffFilter(f)}
                className={`flex-1 rounded px-1.5 py-1 text-xs capitalize ${
                  props.diffFilter === f ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Theme</div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => props.setThemeFilter('all')}
              className={`rounded px-2 py-1 text-xs ${
                props.themeFilter === 'all' ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
              }`}
            >
              All
            </button>
            {themes.map((t) => (
              <button
                key={t.tag}
                onClick={() => props.setThemeFilter(t.tag)}
                title={`${props.themeCounts.get(t.tag)} puzzles`}
                className={`rounded px-2 py-1 text-xs ${
                  props.themeFilter === t.tag ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {t.label}
              </button>
            ))}
            {themes.length === 0 && <span className="px-1 py-1 text-xs text-neutral-400">no themes here</span>}
          </div>
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
          <input type="checkbox" checked={props.ratedOrder} onChange={(e) => props.setRatedOrder(e.target.checked)} />
          Serve puzzles near my rating
        </label>

        <button
          onClick={props.reviewDue}
          className="mt-3 w-full rounded bg-emerald-700 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Review due
        </button>

        <button
          onClick={props.onDaily}
          className="mt-2 w-full rounded bg-neutral-700 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600"
        >
          Daily puzzle
        </button>
      </div>
    </div>
  );
}
