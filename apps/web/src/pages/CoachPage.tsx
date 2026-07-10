import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import { Board } from '../board/Board';
import { StatCard } from '../components/Charts';
import { EmptyStatsArt } from '../components/icons';
import { checkKeyMove, ensureBandsFor, getNextPuzzle, recordResult } from '../lib/puzzleService';
import { playMoveSound, playSound } from '../lib/sound';
import { useTimeoutRef } from '../lib/useTimeoutRef';
import { awardCoachReward } from '../lib/coachRewards';
import {
  buildWeaknessProfile,
  describeExample,
  insightFor,
  type WeaknessEntry,
  type WeaknessExample,
  type WeaknessKind,
  type WeaknessProfile,
} from '../lib/weakness';
import { bootstrapFromReportCache, useCoach } from '../store/coach';
import { useGame, type Color } from '../store/game';
import { useRatings } from '../store/ratings';
import { useSettings } from '../store/settings';
import { buildWeaknessFacts } from '../lib/coachApi';
import { AiNarrative } from '../components/analysis/AiCoach';
import type { CoachWeaknessFacts } from '@chesser/shared';
import type { Puzzle } from '../trainers/tactics';

/**
 * The coach surface: a ranked "your weaknesses" profile aggregated from the
 * player's reviewed games (lib/weakness over the digests in store/coach),
 * plain-language insights with real examples from those games, and an inline
 * "train your weaknesses" flow that serves theme-matched puzzles at the
 * player's rating via the existing puzzle service.
 */

const PHASE_LABEL: Record<string, string> = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

const NO_DESTS = new Map<string, string[]>();
const noop = () => undefined;

/** Read-only mini board for a mistake example, with the better move drawn. */
function ExampleBoard({ example }: { example: WeaknessExample }) {
  const shapes = useMemo<DrawShape[]>(
    () =>
      example.bestUci
        ? [{ orig: example.bestUci.slice(0, 2) as DrawShape['orig'], dest: example.bestUci.slice(2, 4) as DrawShape['dest'], brush: 'green' }]
        : [],
    [example.bestUci],
  );
  const turnColor: Color = example.fenBefore.split(' ')[1] === 'b' ? 'black' : 'white';
  return (
    <Board
      fen={example.fenBefore}
      orientation={example.playerColor}
      turnColor={turnColor}
      movableColor={undefined}
      dests={NO_DESTS}
      lastMove={undefined}
      inCheck={false}
      onMove={noop}
      shapes={shapes}
    />
  );
}

function TrendChip({ trend }: { trend: number | null }) {
  if (trend === null) return null;
  if (trend <= -0.3)
    return <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-xs text-emerald-300">improving ↓</span>;
  if (trend >= 0.3)
    return <span className="rounded-full bg-rose-900/50 px-2 py-0.5 text-xs text-rose-300">on the rise ↑</span>;
  return <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">steady</span>;
}

function WeaknessCard({
  entry,
  rank,
  maxScore,
  profile,
  training,
  onTrain,
  onOpen,
  aiFacts,
}: {
  entry: WeaknessEntry;
  rank: number;
  maxScore: number;
  profile: WeaknessProfile;
  training: boolean;
  onTrain: () => void;
  onOpen: (example: WeaknessExample) => void;
  /** AI Coach facts for this weakness (top entry only); null = rule-based text. */
  aiFacts?: CoachWeaknessFacts | null;
}) {
  // Subscribe to the raw log (stable reference) and derive stats memoized —
  // selecting trainingStats() directly would return a fresh object per render.
  const trainingLog = useCoach((s) => s.trainingLog);
  const stats = useMemo(() => useCoach.getState().trainingStats(entry.kind), [trainingLog, entry.kind]);
  const example = entry.examples[0];
  const improved =
    stats.recentRate !== null && stats.firstRate !== null && stats.attempts > 10 && stats.recentRate > stats.firstRate;
  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft" data-testid={`weakness-${entry.kind}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg" aria-hidden>
          {entry.meta.icon}
        </span>
        <h4 className="font-display text-sm font-semibold text-ink">
          #{rank} {entry.meta.label}
        </h4>
        <TrendChip trend={entry.trend} />
        <span className="ml-auto text-xs text-neutral-400">
          {entry.count}× in {entry.games} game{entry.games === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-600 to-accent-400"
          style={{ width: `${Math.max(8, Math.round((entry.score / maxScore) * 100))}%` }}
        />
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        {example && (
          <div className="w-full max-w-[240px] shrink-0 sm:w-[220px]">
            <ExampleBoard example={example} />
            <button
              onClick={() => onOpen(example)}
              className="btn-press mt-1.5 w-full rounded bg-neutral-800 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-ink"
              title="Load this position on the analysis board"
            >
              Open in analysis →
            </button>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <AiNarrative facts={aiFacts ?? null} fallback={insightFor(entry, profile)} />
          {entry.examples.length > 1 && (
            <ul className="mt-2 space-y-1 text-xs text-neutral-400">
              {entry.examples.slice(1).map((ex) => (
                <li key={`${ex.gameKey}:${ex.ply}`}>
                  <button onClick={() => onOpen(ex)} className="text-left hover:text-neutral-200 hover:underline">
                    Also: {describeExample(ex)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {stats.attempts > 0 && (
            <p className="mt-2 text-xs text-neutral-400">
              Trained {stats.attempts}× · {stats.solved} solved
              {stats.recentRate !== null && <> · last 10: {Math.round(stats.recentRate * 100)}%</>}
              {improved && <span className="text-emerald-400"> — up from {Math.round((stats.firstRate ?? 0) * 100)}%, nice!</span>}
            </p>
          )}
          <button
            onClick={onTrain}
            data-testid={`train-${entry.kind}`}
            className={`btn-press mt-3 rounded px-3 py-1.5 text-sm font-semibold ${
              training ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow' : 'bg-emerald-700 text-white hover:bg-emerald-800'
            }`}
          >
            {training ? 'Training now' : 'Train this weakness'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline weakness trainer (theme-matched puzzles from the puzzle service)
// ---------------------------------------------------------------------------

type TrainPhase = 'solving' | 'solved' | 'failed';

function WeaknessTrainer({ entry, onClose }: { entry: WeaknessEntry; onClose: () => void }) {
  const game = useRef(new Chess());
  const attempt = useRef({ failed: false, rated: false });
  const served = useRef(new Set<string>());
  const demoTimer = useTimeoutRef();

  const decisionRating = useRatings((s) => Math.round(s.categories.puzzles.glicko.rating));
  const recordTraining = useCoach((s) => s.recordTraining);

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [phase, setPhase] = useState<TrainPhase>('solving');
  const [fen, setFen] = useState('');
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState<string>('');
  const [session, setSession] = useState({ solved: 0, attempts: 0 });
  const [exhausted, setExhausted] = useState(false);

  const serveNext = () => {
    if (demoTimer.current) clearTimeout(demoTimer.current);
    demoTimer.current = null;
    const p = getNextPuzzle({ rating: decisionRating, themes: entry.meta.puzzleThemes, excludeIds: served.current });
    if (!p) {
      setExhausted(true);
      setPuzzle(null);
      return;
    }
    served.current.add(p.id);
    game.current = new Chess(p.fen);
    attempt.current = { failed: false, rated: false };
    setPuzzle(p);
    setPhase('solving');
    setFen(game.current.fen());
    setLastMove(undefined);
    setFeedback(`${p.turn === 'white' ? 'White' : 'Black'} to move — find the ${entry.meta.label.toLowerCase()} idea.`);
  };

  // Warm the rating bands, then serve the first puzzle for this weakness.
  useEffect(() => {
    served.current = new Set();
    setExhausted(false);
    void ensureBandsFor(decisionRating);
    serveNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.kind]);

  const sync = () => {
    const hist = game.current.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.current.fen());
    setLastMove(last ? [last.from, last.to] : undefined);
  };

  const solverToMove = phase === 'solving' && !!puzzle && game.current.turn() === (puzzle.turn === 'white' ? 'w' : 'b');

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

  /** Record the attempt once: existing rating/XP pipeline + coach tracking. */
  const rateOnce = (success: boolean) => {
    if (!puzzle || attempt.current.rated) return;
    attempt.current.rated = true;
    recordResult(puzzle, success);
    recordTraining(entry.kind, puzzle.id, success);
    awardCoachReward({ kind: 'weakness-trained', weakness: entry.kind, solved: success });
    setSession((s) => ({ solved: s.solved + (success ? 1 : 0), attempts: s.attempts + 1 }));
  };

  /** Auto-play the rest of the solution so the idea lands. */
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
    const check = checkKeyMove(game.current.fen(), key, from, to);
    if (check.ok) {
      const mv = game.current.move({ from, to, promotion: check.altMate ? check.promotion : key[4] });
      playMoveSound(mv.san);
      sync();
      setPhase('solved');
      setFeedback(check.altMate ? `✓ ${mv.san} — checkmate!` : `✓ ${mv.san} — exactly the pattern.`);
      rateOnce(!attempt.current.failed);
      if (!check.altMate) demoRest(1);
    } else {
      attempt.current.failed = true;
      rateOnce(false);
      setPhase('failed');
      setFeedback('Not it — the pattern is still on the board. Try again or reveal.');
      sync();
    }
  };

  const retry = () => {
    if (!puzzle) return;
    game.current = new Chess(puzzle.fen);
    setPhase('solving');
    setFeedback('Fresh look — take your time.');
    setFen(game.current.fen());
    setLastMove(undefined);
  };

  const reveal = () => {
    if (!puzzle) return;
    rateOnce(false);
    const key = puzzle.solution[0]!;
    game.current = new Chess(puzzle.fen);
    const mv = game.current.move({ from: key.slice(0, 2), to: key.slice(2, 4), promotion: key[4] });
    setPhase('solved');
    setFeedback(`Solution: ${mv.san}. Watch how it plays out.`);
    sync();
    demoRest(1);
  };

  const stop = () => {
    if (session.attempts > 0) {
      playSound('lessonComplete');
      awardCoachReward({ kind: 'training-session', weakness: entry.kind, solved: session.solved, attempts: session.attempts });
    }
    onClose();
  };

  return (
    <Section
      title={`Training: ${entry.meta.label}`}
      aside={
        <span className="text-xs text-neutral-400" data-testid="trainer-session">
          {session.solved}/{session.attempts} this session · themes: {entry.meta.puzzleThemes.join(', ')}
        </span>
      }
    >
      {exhausted || !puzzle ? (
        <p className="text-sm text-neutral-400">
          No matching puzzles are loaded right now — check your connection and try again in a moment.
        </p>
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="mx-auto w-full max-w-[480px] lg:mx-0">
            <Board
              fen={fen}
              orientation={puzzle.turn}
              turnColor={game.current.turn() === 'w' ? 'white' : 'black'}
              movableColor={solverToMove ? puzzle.turn : undefined}
              dests={dests}
              lastMove={lastMove}
              inCheck={game.current.inCheck()}
              onMove={onMove}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200">{puzzle.theme}</span>
              <span className="text-xs text-neutral-400">rated {puzzle.rating ?? '—'} · you {decisionRating}</span>
              {solverToMove && <span className="animate-pulse-soft text-emerald-400">your move</span>}
            </div>
            <p className="text-sm text-neutral-300" data-testid="trainer-feedback">
              {feedback}
            </p>
            <div className="flex flex-wrap gap-2">
              {phase === 'failed' && (
                <button onClick={retry} className="btn-press rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800">
                  Try again
                </button>
              )}
              {phase !== 'solved' && (
                <button onClick={reveal} className="btn-press rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
                  Reveal
                </button>
              )}
              <button onClick={serveNext} className="btn-press rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
                Next puzzle →
              </button>
              <button onClick={stop} className="btn-press rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-700">
                Done training
              </button>
            </div>
            <p className="text-xs leading-relaxed text-neutral-400">{entry.meta.advice}</p>
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function CoachPage({ goPlay }: { goPlay: () => void }) {
  const games = useCoach((s) => s.games);
  const loadFen = useGame((s) => s.loadFen);
  const aiCoach = useSettings((s) => s.aiCoach);
  const [trainingKind, setTrainingKind] = useState<WeaknessKind | null>(null);

  // Back-fill digests from reviews cached before this feature existed.
  useEffect(() => {
    bootstrapFromReportCache();
  }, []);

  const profile = useMemo(() => buildWeaknessProfile(Object.values(games)), [games]);
  const maxScore = profile.weaknesses[0]?.score ?? 1;
  const training = profile.weaknesses.find((w) => w.kind === trainingKind) ?? null;

  const openExample = (ex: WeaknessExample) => {
    if (loadFen(ex.fenBefore)) goPlay();
  };

  if (profile.games === 0) {
    return (
      <div className="mx-auto w-full max-w-[1000px]">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-700 bg-panel/60 p-6 text-center text-sm text-neutral-400 sm:flex-row sm:text-left">
          <EmptyStatsArt width={150} height={112} className="shrink-0" />
          <div>
            <div className="mb-1 font-display text-base font-semibold text-ink">Your coach is ready when you are</div>
            Play a game against a bot on the <b>Play</b> tab and run a game review — the coach studies your reviewed games,
            spots recurring patterns, and builds a training plan around them.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Games studied" value={profile.games} hint="reviewed vs bots" />
        <StatCard label="Your accuracy" value={`${profile.accuracy}%`} hint="across those games" />
        <StatCard
          label="Weakest phase"
          value={profile.worstPhase ? PHASE_LABEL[profile.worstPhase] : '—'}
          hint={
            profile.worstPhase
              ? `${profile.phases.find((p) => p.phase === profile.worstPhase)?.accuracy ?? '—'}% accuracy`
              : 'not enough moves yet'
          }
        />
        <StatCard label="Focus areas" value={profile.weaknesses.length} hint="recurring patterns" />
      </div>

      {training && <WeaknessTrainer entry={training} onClose={() => setTrainingKind(null)} />}

      {profile.weaknesses.length === 0 ? (
        <div className="rounded-2xl bg-panel p-6 text-center text-sm text-neutral-400 shadow-soft">
          <div className="mb-1 font-display text-base font-semibold text-ink">Nothing recurring yet — great sign!</div>
          No pattern has shown up twice across your reviewed games. Keep playing and reviewing; the coach re-measures after
          every review.
        </div>
      ) : (
        <div className="space-y-4" data-testid="weakness-list">
          {profile.weaknesses.map((entry, i) => (
            <WeaknessCard
              key={entry.kind}
              entry={entry}
              rank={i + 1}
              maxScore={maxScore}
              profile={profile}
              training={trainingKind === entry.kind}
              onTrain={() => setTrainingKind(trainingKind === entry.kind ? null : entry.kind)}
              onOpen={openExample}
              aiFacts={aiCoach && i === 0 ? buildWeaknessFacts(entry, profile) : null}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Phase accuracy" aside={<span className="text-xs text-neutral-400">your moves only</span>}>
          <div className="space-y-2">
            {profile.phases.map((p) => (
              <div key={p.phase} className="flex items-center gap-2 text-sm">
                <span className="w-24 text-neutral-300">{PHASE_LABEL[p.phase]}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className={`h-full rounded-full ${p.phase === profile.worstPhase ? 'bg-rose-500/80' : 'bg-emerald-500/70'}`}
                    style={{ width: `${p.moves > 0 ? p.accuracy : 0}%` }}
                  />
                </div>
                <span className="w-24 text-right text-xs text-neutral-400">
                  {p.moves > 0 ? `${p.accuracy}% · ${p.moves} mv` : 'no moves'}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Tendencies">
          <div className="space-y-2 text-sm text-neutral-300">
            {(['white', 'black'] as const).map((side) => {
              const c = profile.colors[side];
              return (
                <div key={side} className="flex items-center justify-between">
                  <span className="capitalize">As {side}</span>
                  <span className="text-xs text-neutral-400">
                    {c.games > 0 ? `${c.wins}W ${c.losses}L ${c.draws}D · ${c.accuracy}% accuracy` : 'no games yet'}
                  </span>
                </div>
              );
            })}
            {profile.openings.slice(0, 3).map((o) => (
              <div key={o.name} className="flex items-center justify-between border-t border-neutral-800 pt-2">
                <span className="truncate">{o.name}</span>
                <span className="ml-2 shrink-0 text-xs text-neutral-400">
                  {o.games} games · {o.accuracy}%
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
