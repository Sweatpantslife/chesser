import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { EmptyPuzzleArt } from '../components/icons';
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
  themeDisplayLabel,
} from '../lib/puzzleService';
import { playMoveSound } from '../lib/sound';
import { todayStr } from '../lib/clock';
import { useTimeoutRef } from '../lib/useTimeoutRef';
import { RushMode } from './RushMode';
import { StormMode } from './StormMode';
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

export type TacticsMode = 'practice' | 'rush' | 'storm' | 'mistakes';

export function TacticsPage({
  openDaily = false,
  onDailyOpened,
  openMode,
}: {
  openDaily?: boolean;
  onDailyOpened?: () => void;
  /** Deep link from the Today page: land straight on a sprint mode. */
  openMode?: TacticsMode | null;
}) {
  const { t } = useTranslation('tactics');
  const [mode, setMode] = useState<TacticsMode>(openMode ?? 'practice');
  const mistakeCount = useMistakes((s) => s.cards.length);
  const labels = {
    practice: t('tabs.practice'),
    rush: t('tabs.rush'),
    storm: t('tabs.storm'),
    mistakes: mistakeCount ? t('tabs.mistakesCount', { n: mistakeCount }) : t('tabs.mistakes'),
  };
  return (
    <div className="space-y-4">
      <div className="mx-auto flex w-full max-w-[1200px] gap-1">
        {(['practice', 'rush', 'storm', 'mistakes'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-3 py-1.5 text-sm ${
              mode === m ? 'bg-brand-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            {labels[m]}
          </button>
        ))}
      </div>
      {mode === 'practice' ? (
        <PracticeTactics openDaily={openDaily} onDailyOpened={onDailyOpened} />
      ) : mode === 'rush' ? (
        <RushMode />
      ) : mode === 'storm' ? (
        <StormMode />
      ) : (
        <MistakesMode />
      )}
    </div>
  );
}

function PracticeTactics({ openDaily = false, onDailyOpened }: { openDaily?: boolean; onDailyOpened?: () => void }) {
  const { t } = useTranslation('tactics');
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
    for (const th of FILTER_THEMES) {
      let n = 0;
      for (const p of byDifficulty) if (puzzleHasTheme(p, th.tag)) n++;
      if (n > 0) c.set(th.tag, n);
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
    setFeedback({ kind: 'info', text: t(`practice.toPlayWin.${p.turn}`) });
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
      setFeedback({
        kind: 'ok',
        text: check.altMate
          ? t('practice.feedback.checkmate', { san: mv.san })
          : t('practice.feedback.solvedTheme', { san: mv.san, theme: themeDisplayLabel(puzzle.theme) }),
      });
      grade('tactics', puzzle.id, attempt.current.failed ? 'hard' : 'good');
      rateOnce(!attempt.current.failed && !attempt.current.revealed);
      if (!check.altMate) demoRest(1);
    } else {
      attempt.current.failed = true;
      rateOnce(false);
      setPhase('failed');
      setFeedback({ kind: 'bad', text: t('practice.feedback.wrong') });
      sync();
    }
  };

  const retry = () => {
    if (!puzzle) return;
    game.current = new Chess(puzzle.fen);
    setPhase('solving');
    setFeedback({ kind: 'info', text: t('practice.feedback.tryAgain') });
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
    setFeedback({ kind: 'info', text: t('practice.feedback.solution', { san: mv.san }) });
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
        loadDirect(p, t('practice.override.rated'));
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
        loadDirect(p, t('practice.override.review'));
        return;
      }
    }
    setFeedback({ kind: 'info', text: t('practice.feedback.noReviews') });
  };

  // Same puzzle for everyone on a given date, and it works offline.
  const daily = () => {
    loadDirect(getDailyPuzzle(todayStr()), t('sidebar.dailyPuzzle'));
  };

  // Deep link from the Today page: land straight on the daily puzzle.
  // Declared after the filter-reset effect so it wins the initial load.
  // The flag is one-shot: consuming it here means a later remount (e.g.
  // toggling Practice → Rush → Practice) won't reload the daily puzzle
  // over an in-progress attempt.
  useEffect(() => {
    if (openDaily) {
      daily();
      onDailyOpened?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const SOURCES: { id: Source; label: string }[] = [
    { id: 'builtin', label: t('source.builtin') },
    { id: 'mine', label: mine.length ? t('source.mineCount', { n: mine.length }) : t('source.mine') },
    { id: 'all', label: t('source.all') },
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
        <div className="order-1 flex flex-col items-center gap-3 rounded-2xl bg-panel shadow-soft p-6 text-center text-sm text-neutral-400 lg:order-2">
          <EmptyPuzzleArt width={150} height={112} />
          {source === 'mine' ? (
            <div>
              <div className="mb-1 font-display text-base font-semibold text-ink">{t('practice.empty.mineTitle')}</div>
              <Trans t={t} i18nKey="practice.empty.mineBody" components={{ b: <b /> }} />
            </div>
          ) : (
            <div>
              <div className="mb-1 font-display text-base font-semibold text-ink">{t('practice.empty.filterTitle')}</div>
              <Trans t={t} i18nKey="practice.empty.filterBody" components={{ code: <code className="text-neutral-200" /> }} />
            </div>
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
          <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200">{themeDisplayLabel(puzzle.theme)}</span>
          <span className={`text-xs capitalize ${DIFF_COLOR[puzzle.difficulty]}`}>{t(`difficulty.${puzzle.difficulty}`)}</span>
          <span className="text-xs text-neutral-400">{t('practice.rated', { rating: pr })}</span>
          <span className="text-neutral-400">{t(`practice.toMove.${puzzle.turn}`)}</span>
          {solverToMove && <span className="animate-pulse-soft text-emerald-400">{t('practice.yourMove')}</span>}
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
              {t('practice.buttons.tryAgain')}
            </button>
          )}
          {phase !== 'solved' && (
            <button onClick={reveal} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
              {t('practice.buttons.reveal')}
            </button>
          )}
          <button onClick={next} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
            {t('practice.buttons.nextPuzzleArrow')}
          </button>
        </div>
      </div>

      <div className="order-3 space-y-3">
        <div className="rounded-2xl bg-panel shadow-soft p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-neutral-300">
              {override ? override.label : t('practice.counter', { current: pos + 1, total: queue.length })}
            </span>
            <span className="text-xs text-neutral-400">{t('practice.solvedSession', { count: sessionSolved })}</span>
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
                {t('practice.ratingDelta', { delta: `${delta >= 0 ? '+' : ''}${delta}` })}
              </span>{' '}
              <span className="text-neutral-400">→ {rating}</span>
            </p>
          )}
          {puzzle.source && <p className="mt-2 text-xs text-neutral-400">{t('practice.fromSource', { source: puzzle.source })}</p>}
          {solvedCard?.last && phase === 'solving' && (
            <p className="mt-2 text-xs text-neutral-400">{t('practice.seenBefore')}</p>
          )}
          {phase === 'solved' && (
            <button
              onClick={next}
              className="mt-3 w-full rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              {t('practice.buttons.nextPuzzle')}
            </button>
          )}
          {source !== 'builtin' && mine.some((m) => m.id === puzzle.id) && (
            <button
              onClick={() => {
                removePuzzle(puzzle.id);
                setFeedback({ kind: 'info', text: t('practice.feedback.removed') });
              }}
              className="mt-2 w-full rounded bg-neutral-800 py-1.5 text-xs text-neutral-400 hover:bg-rose-900/50 hover:text-rose-200"
            >
              {t('practice.buttons.deletePuzzle')}
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
  const { t } = useTranslation('tactics');
  const themes = FILTER_THEMES.filter((th) => (props.themeCounts.get(th.tag) ?? 0) > 0);
  return (
    <div className="order-2 space-y-3 lg:order-1">
      <div className="rounded-2xl bg-panel shadow-soft p-3">
        <h3 className="mb-1 font-display text-sm font-semibold text-ink">{t('sidebar.title')}</h3>
        <p className="mb-2 text-xs text-neutral-400">{t('sidebar.blurb')}</p>

        <div className="mb-3 flex items-center justify-between rounded bg-panelmute px-2.5 py-1.5">
          <span className="text-xs uppercase tracking-wide text-neutral-400">
            {t('sidebar.yourRating')} <span className="text-neutral-400">· {props.meter === 'glicko' ? 'Glicko' : 'Elo'}</span>
          </span>
          <span className="font-mono text-lg font-bold text-emerald-300">{props.rating}</span>
        </div>

        <ReviewStats deck="tactics" ids={ALL_IDS} />

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('sidebar.source')}</div>
          <div className="flex gap-1">
            {props.sources.map((s) => (
              <button
                key={s.id}
                onClick={() => props.setSource(s.id)}
                className={`flex-1 rounded px-1.5 py-1 text-xs ${
                  props.source === s.id ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('sidebar.difficulty')}</div>
          <div className="flex gap-1">
            {(['all', 'easy', 'medium', 'hard'] as const).map((f) => (
              <button
                key={f}
                onClick={() => props.setDiffFilter(f)}
                className={`flex-1 rounded px-1.5 py-1 text-xs capitalize ${
                  props.diffFilter === f ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {t(`difficulty.${f}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('sidebar.theme')}</div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => props.setThemeFilter('all')}
              className={`rounded px-2 py-1 text-xs ${
                props.themeFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
              }`}
            >
              {t('sidebar.allThemes')}
            </button>
            {themes.map((th) => (
              <button
                key={th.tag}
                onClick={() => props.setThemeFilter(th.tag)}
                title={t('sidebar.themeCount', { count: props.themeCounts.get(th.tag) })}
                className={`rounded px-2 py-1 text-xs ${
                  props.themeFilter === th.tag ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {th.label}
              </button>
            ))}
            {themes.length === 0 && <span className="px-1 py-1 text-xs text-neutral-400">{t('sidebar.noThemes')}</span>}
          </div>
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
          <input type="checkbox" checked={props.ratedOrder} onChange={(e) => props.setRatedOrder(e.target.checked)} />
          {t('sidebar.ratedOrder')}
        </label>

        <button
          onClick={props.reviewDue}
          className="mt-3 w-full rounded bg-emerald-700 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          {t('sidebar.reviewDue')}
        </button>

        <button
          onClick={props.onDaily}
          className="mt-2 w-full rounded bg-neutral-700 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600"
        >
          {t('sidebar.dailyPuzzle')}
        </button>
      </div>
    </div>
  );
}
