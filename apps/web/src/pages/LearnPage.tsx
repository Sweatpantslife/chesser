import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import { Board } from '../board/Board';
import { ALL_LESSONS, LESSON_TRACKS, nextLessonId } from '../learn';
import type { Lesson, LessonShape } from '../learn/types';
import {
  legalDests,
  playerMoveCount,
  solutionMove,
  startExercise,
  tryStep,
  type ExerciseState,
} from '../learn/engine';
import { useLessons } from '../store/lessons';
import { recordLesson } from '../lib/gamify';
import { playMoveSound } from '../lib/sound';
import { fireConfetti } from '../components/Celebration';
import heroUrl from '../assets/img/hero.webp';
import type { Color } from '../store/game';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const EMPTY_DESTS = new Map<string, string[]>();

const toDrawShapes = (shapes?: LessonShape[]): DrawShape[] =>
  (shapes ?? []).map((s) => ({ orig: s.orig, dest: s.dest, brush: s.brush ?? 'green' }) as DrawShape);

const turnOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

function inCheckOf(fen: string): boolean {
  try {
    return new Chess(fen).inCheck();
  } catch {
    return false;
  }
}

function Stars({ n, size = 'text-sm' }: { n: number; size?: string }) {
  return (
    <span className={`${size} tracking-tight`} aria-label={`${n} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? 'text-gold-400' : 'text-neutral-600'}>
          ★
        </span>
      ))}
    </span>
  );
}

// — Lesson catalogue —

function LessonCard({ lesson, onOpen }: { lesson: Lesson; onOpen: () => void }) {
  const done = useLessons((s) => !!s.completed[lesson.id]);
  const stars = useLessons((s) => s.completed[lesson.id]?.stars ?? 0);
  return (
    <button
      onClick={onOpen}
      aria-label={`${lesson.title}${done ? ' (completed)' : ''}`}
      className={`group card-lift flex flex-col gap-1 rounded-2xl p-3 text-left shadow-soft hover:bg-neutral-800 ${
        done ? 'bg-panel ring-1 ring-emerald-500/50' : 'bg-panel'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl" aria-hidden>
          {lesson.icon}
        </span>
        <span className="flex-1 text-sm font-semibold text-ink">{lesson.title}</span>
        {done ? <Stars n={stars} /> : <span className="text-xs font-semibold text-neutral-400 group-hover:text-brand-300">Start →</span>}
      </div>
      <p className="text-xs leading-snug text-neutral-400">{lesson.summary}</p>
    </button>
  );
}

function Catalogue({ onOpen }: { onOpen: (id: string) => void }) {
  const completed = useLessons((s) => s.completed);
  const done = ALL_LESSONS.filter((l) => !!completed[l.id]).length;
  const pct = Math.round((done / ALL_LESSONS.length) * 100);
  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-panel shadow-soft">
        <img
          src={heroUrl}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-right opacity-80"
        />
        <div className="relative bg-gradient-to-r from-page/95 via-page/80 to-page/30 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl font-bold text-ink">Learn chess, the fun way</h2>
            <span className="rounded-full bg-neutral-900/80 px-2.5 py-1 text-xs font-semibold text-neutral-200">
              {done}/{ALL_LESSONS.length} lessons complete
            </span>
          </div>
          <p className="mt-1 max-w-xl text-sm text-neutral-200">
            Short, hands-on lessons — every idea is something you play out on the board. New to chess? Start at the top and
            you’ll know all the rules in minutes.
          </p>
          <div
            className="mt-4 h-2.5 max-w-xl overflow-hidden rounded-full bg-neutral-900/80"
            role="progressbar"
            aria-label="Lessons completed"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-accent-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {LESSON_TRACKS.map((track) => (
        <section key={track.id} aria-label={track.title}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-brand-300">{track.title}</h3>
            <span className="text-xs text-neutral-400">{track.blurb}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {track.lessons.map((l) => (
              <LessonCard key={l.id} lesson={l} onOpen={() => onOpen(l.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// — Lesson player —

type Phase = 'info' | 'solving' | 'wrong' | 'stepDone' | 'lessonDone';

interface Feedback {
  kind: 'ok' | 'bad' | 'info';
  text: string;
}

function LessonPlayer({ lesson, onExit, onOpen }: { lesson: Lesson; onExit: () => void; onOpen: (id: string) => void }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('info');
  const [exState, setExState] = useState<ExerciseState | null>(null);
  const [displayFen, setDisplayFen] = useState(START_FEN);
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [wrongCount, setWrongCount] = useState(0);
  const [earnedStars, setEarnedStars] = useState(0);
  const [wasFirstTime, setWasFirstTime] = useState(false);
  /** True while a scripted opponent reply is animating (board input frozen). */
  const [replyPending, setReplyPending] = useState(false);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const complete = useLessons((s) => s.complete);

  const step = lesson.steps[stepIdx];

  const clearReplyTimer = () => {
    if (replyTimer.current) {
      clearTimeout(replyTimer.current);
      replyTimer.current = null;
    }
    setReplyPending(false);
  };

  const loadStep = (idx: number) => {
    clearReplyTimer();
    const s = lesson.steps[idx];
    if (!s) return;
    setStepIdx(idx);
    setLastMove(undefined);
    setFeedback(null);
    if (s.kind === 'exercise') {
      setExState(startExercise(s));
      setDisplayFen(s.fen);
      setPhase('solving');
    } else {
      setExState(null);
      setDisplayFen(s.fen ?? START_FEN);
      setPhase('info');
    }
  };

  useEffect(() => {
    setWrongCount(0);
    loadStep(0);
    return clearReplyTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  const dests = useMemo(() => {
    if (phase !== 'solving' || replyPending || !step || step.kind !== 'exercise' || !exState) return EMPTY_DESTS;
    return legalDests(exState.fen, step.onlyFrom);
  }, [phase, replyPending, step, exState]);

  const finishLesson = () => {
    const stars = wrongCount === 0 ? 3 : wrongCount <= 2 ? 2 : 1;
    const { firstTime } = complete(lesson.id, stars);
    recordLesson({ firstTime, stars });
    fireConfetti(stars * 30);
    setEarnedStars(stars);
    setWasFirstTime(firstTime);
    setPhase('lessonDone');
  };

  const advance = () => {
    if (stepIdx + 1 < lesson.steps.length) loadStep(stepIdx + 1);
    else finishLesson();
  };

  const applyAttempt = (from: string, to: string, viaReveal = false) => {
    // The replyTimer guard freezes input while a scripted opponent reply is
    // animating — the engine state is already past the reply, so a move made
    // mid-animation would be judged against a position the board isn't showing.
    if (!step || step.kind !== 'exercise' || !exState || phase !== 'solving' || replyTimer.current) return;
    const res = tryStep(step, exState, { from, to });
    if (res.verdict === 'illegal') return;
    playMoveSound(res.san);
    if (res.verdict === 'wrong') {
      setDisplayFen(res.fenAfter);
      setLastMove([from, to]);
      setPhase('wrong');
      setWrongCount((n) => n + 1);
      setFeedback({ kind: 'bad', text: res.message });
      return;
    }
    // correct
    if (viaReveal) setWrongCount((n) => n + 1);
    setDisplayFen(res.fenAfterPlayer);
    setLastMove([from, to]);
    setExState(res.state);
    const success = step.success ?? 'Nice!';
    if (res.reply) {
      const reply = res.reply;
      const finalFen = res.state.fen;
      setFeedback({ kind: 'ok', text: `✓ ${res.san}` });
      setReplyPending(true);
      replyTimer.current = setTimeout(() => {
        replyTimer.current = null; // unlock input — the board now matches the engine state
        setReplyPending(false);
        playMoveSound(reply.san);
        setDisplayFen(finalFen);
        setLastMove([reply.uci.slice(0, 2), reply.uci.slice(2, 4)]);
        if (res.done) {
          setPhase('stepDone');
          setFeedback({ kind: 'ok', text: `✓ ${success}` });
        } else {
          setFeedback({ kind: 'ok', text: `✓ ${res.san} — keep going!` });
        }
      }, 550);
      if (res.done) setPhase('stepDone'); // buttons appear; board updates after the reply animates
    } else if (res.done) {
      setPhase('stepDone');
      setFeedback({ kind: 'ok', text: `✓ ${success}` });
    }
  };

  const retry = () => {
    if (!exState) return;
    setDisplayFen(exState.fen);
    setLastMove(undefined);
    setPhase('solving'); // the hint stays on screen while they retry
  };

  const reveal = () => {
    if (!step || step.kind !== 'exercise' || !exState) return;
    if (phase === 'wrong') retry();
    const sol = solutionMove(step, exState);
    if (sol) applyAttempt(sol.from, sol.to, true);
  };

  const exerciseNo = useMemo(() => {
    if (!step || step.kind !== 'exercise') return null;
    const exSteps = lesson.steps.filter((s) => s.kind === 'exercise');
    return { i: exSteps.indexOf(step) + 1, n: exSteps.length };
  }, [lesson.steps, step]);

  const lineProgress =
    step?.kind === 'exercise' && step.goal.type === 'line' && exState && !exState.done
      ? { i: Math.floor(exState.ply / 2) + 1, n: playerMoveCount(step) }
      : null;

  const shapes = useMemo(
    () => toDrawShapes(step?.kind === 'exercise' || step?.kind === 'info' ? step.shapes : undefined),
    [step],
  );

  const turnColor = turnOf(displayFen);
  const solverColor = step?.kind === 'exercise' && exState ? turnOf(exState.fen) : 'white';
  const boardMovable = phase === 'solving' ? solverColor : undefined;

  if (!step) return null;

  return (
    <div className="mx-auto grid w-full max-w-[1000px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            onClick={onExit}
            className="btn-press rounded-full bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-300 hover:bg-neutral-700"
            aria-label="Back to all lessons"
          >
            ← Lessons
          </button>
          <span aria-hidden>{lesson.icon}</span>
          <span className="font-semibold text-ink">{lesson.title}</span>
          <span className="ml-auto flex items-center gap-1" aria-label={`Step ${stepIdx + 1} of ${lesson.steps.length}`}>
            {lesson.steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i < stepIdx ? 'w-3 bg-brand-500' : i === stepIdx ? 'w-5 bg-brand-300' : 'w-3 bg-neutral-700'
                }`}
              />
            ))}
          </span>
        </div>
        <div className="mx-auto w-full max-w-[540px]">
          <Board
            fen={displayFen}
            orientation="white"
            turnColor={turnColor}
            movableColor={boardMovable}
            dests={dests}
            lastMove={lastMove}
            inCheck={inCheckOf(displayFen)}
            onMove={(from, to) => applyAttempt(from, to)}
            shapes={shapes}
          />
        </div>
        {phase === 'solving' && !replyPending && (
          <div className="flex h-5 items-center gap-2 text-xs text-neutral-400">
            <span className="animate-pulse-soft text-emerald-400">● your move</span>
            {lineProgress && lineProgress.n > 1 && (
              <span>
                move {lineProgress.i} of {lineProgress.n}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {phase === 'lessonDone' ? (
          <div className="pop-in rounded-2xl bg-panel p-4 text-center shadow-soft">
            <div className="pop-in text-4xl" aria-hidden>
              🎉
            </div>
            <h3 className="mt-1 font-display text-lg font-bold text-ink">Lesson complete!</h3>
            <div className="mt-1">
              <Stars n={earnedStars} size="text-xl" />
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              {earnedStars === 3
                ? 'Flawless — not a single wrong move.'
                : earnedStars === 2
                  ? 'Solid! Replay it any time to earn 3 stars.'
                  : 'Done! Replay it any time to sharpen it up.'}
              {wasFirstTime ? ' XP earned.' : ''}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {nextLessonId(lesson.id) && (
                <button
                  autoFocus
                  onClick={() => onOpen(nextLessonId(lesson.id)!)}
                  className="btn-press w-full rounded-full bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-700"
                >
                  Next lesson →
                </button>
              )}
              <button
                onClick={onExit}
                className="btn-press w-full rounded-full bg-neutral-700 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-600"
              >
                Back to lessons
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-panel p-4 shadow-soft">
            {step.kind === 'info' ? (
              <>
                {step.title && <h3 className="mb-1 text-sm font-bold text-ink">{step.title}</h3>}
                <p className="text-sm leading-relaxed text-neutral-300">{step.text}</p>
                <button
                  autoFocus
                  onClick={advance}
                  className="btn-press mt-4 w-full rounded-full bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-700"
                >
                  Got it →
                </button>
              </>
            ) : (
              <>
                {exerciseNo && (
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-400">
                    Exercise {exerciseNo.i} of {exerciseNo.n}
                  </div>
                )}
                <p className="text-sm leading-relaxed text-neutral-300">{step.prompt}</p>
                <div role="status" aria-live="polite" className="mt-2 min-h-[1.5rem]">
                  {feedback && (
                    <p
                      className={`text-sm font-medium ${
                        feedback.kind === 'ok' ? 'text-emerald-300' : feedback.kind === 'bad' ? 'text-rose-300' : 'text-neutral-300'
                      }`}
                    >
                      {feedback.text}
                    </p>
                  )}
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {phase === 'wrong' && (
                    <button
                      autoFocus
                      onClick={retry}
                      className="btn-press w-full rounded-full bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-700"
                    >
                      Try again
                    </button>
                  )}
                  {phase === 'stepDone' && (
                    <button
                      autoFocus
                      onClick={advance}
                      className="btn-press w-full rounded-full bg-emerald-700 py-2 text-sm font-bold text-white hover:bg-emerald-600"
                    >
                      Continue →
                    </button>
                  )}
                  {(phase === 'solving' || phase === 'wrong') && wrongCount >= 2 && (
                    <button
                      onClick={reveal}
                      className="btn-press w-full rounded-full bg-neutral-700 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-600"
                    >
                      Show me
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <div className="rounded-2xl bg-panelmute p-3 text-xs leading-snug text-neutral-400">
          Make a mistake? No stress — you can retry every exercise, and replay any lesson from the Learn page.
        </div>
      </div>
    </div>
  );
}

export function LearnPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const lesson = openId ? ALL_LESSONS.find((l) => l.id === openId) : undefined;
  return lesson ? (
    <LessonPlayer lesson={lesson} onExit={() => setOpenId(null)} onOpen={setOpenId} />
  ) : (
    <Catalogue onOpen={setOpenId} />
  );
}
