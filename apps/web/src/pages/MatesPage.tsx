import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { ReviewStats } from '../components/ReviewStats';
import { MATE_PATTERNS, MATE_DRILLS, MATE_DRILL_IDS, type MatePattern } from '../trainers/mates';
import { useProgress } from '../store/progress';
import { recordReview } from '../lib/gamify';
import { dueLabel } from '../lib/srs';
import { playMoveSound } from '../lib/sound';
import type { Color } from '../store/game';

type Phase = 'solving' | 'solved' | 'failed';

export function MatesPage() {
  const game = useRef(new Chess());
  const attempt = useRef({ failed: false, revealed: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [idx, setIdx] = useState(0); // index into MATE_DRILLS
  const [phase, setPhase] = useState<Phase>('solving');
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [solvedCount, setSolvedCount] = useState(0);

  const grade = useProgress((s) => s.grade);
  const dueIds = useProgress((s) => s.dueIds);
  const cards = useProgress((s) => s.cards);

  const drill = MATE_DRILLS[idx]!;
  const pattern = useMemo(() => MATE_PATTERNS.find((p) => p.id === drill.patternId)!, [drill.patternId]);

  const load = (i: number) => {
    const d = MATE_DRILLS[i];
    if (!d) return;
    if (timer.current) clearTimeout(timer.current); // stop any in-flight solution animation
    game.current = new Chess(d.fen);
    attempt.current = { failed: false, revealed: false };
    setIdx(i);
    setPhase('solving');
    setFeedback({
      kind: 'info',
      text: `${d.turn === 'white' ? 'White' : 'Black'} to mate in ${d.mateIn}.`,
    });
    setFen(game.current.fen());
    setLastMove(undefined);
  };

  useEffect(() => {
    load(0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = () => {
    const hist = game.current.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.current.fen());
    setLastMove(last ? [last.from, last.to] : undefined);
  };

  const solverToMove = phase === 'solving' && game.current.turn() === (drill.turn === 'white' ? 'w' : 'b');

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
    if (timer.current) clearTimeout(timer.current);
    let step = fromStep;
    const tick = () => {
      const u = drill.solution[step];
      if (!u) return;
      game.current.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      sync();
      step++;
      timer.current = step < drill.solution.length ? setTimeout(tick, 650) : null;
    };
    timer.current = setTimeout(tick, 500);
  };

  const onMove = (from: string, to: string) => {
    if (!solverToMove) return;
    const key = drill.solution[0]!;
    if (key.slice(0, 2) === from && key.slice(2, 4) === to) {
      const mv = game.current.move({ from, to, promotion: key[4] });
      playMoveSound(mv.san);
      sync();
      setPhase('solved');
      setSolvedCount((n) => n + 1);
      setFeedback({ kind: 'ok', text: `✓ ${mv.san} — ${pattern.name}!` });
      grade('mates', drill.id, attempt.current.failed ? 'hard' : 'good');
      recordReview(true);
      demoRest(1);
    } else {
      attempt.current.failed = true;
      setPhase('failed');
      setFeedback({ kind: 'bad', text: 'Not the mating move. Try again, or reveal.' });
      sync();
    }
  };

  const retry = () => {
    game.current = new Chess(drill.fen);
    setPhase('solving');
    setFeedback({ kind: 'info', text: 'Try again.' });
    setFen(game.current.fen());
    setLastMove(undefined);
  };

  const reveal = () => {
    attempt.current.revealed = true;
    const key = drill.solution[0]!;
    game.current = new Chess(drill.fen);
    const mv = game.current.move({ from: key.slice(0, 2), to: key.slice(2, 4), promotion: key[4] });
    setPhase('solved');
    setFeedback({ kind: 'info', text: `The key move is ${mv.san}.` });
    grade('mates', drill.id, 'again');
    recordReview(false);
    sync();
    demoRest(1);
  };

  const next = () => load((idx + 1) % MATE_DRILLS.length);

  const reviewDue = () => {
    const due = dueIds('mates', MATE_DRILL_IDS);
    if (due.length === 0) {
      setFeedback({ kind: 'info', text: 'No mate drills due right now — learn a new pattern!' });
      return;
    }
    const i = MATE_DRILLS.findIndex((d) => d.id === due[0]);
    if (i >= 0) load(i);
  };

  const orientation: Color = drill.turn;

  const drillNoInPattern = pattern.drills.findIndex((d) => d.id === drill.id) + 1;

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
      {/* pattern library */}
      <div className="order-2 space-y-3 lg:order-1">
        <div className="rounded-lg bg-panel p-3">
          <h3 className="mb-1 text-sm font-semibold text-ink">Checkmate patterns</h3>
          <p className="mb-2 text-xs text-neutral-400">Learn the classic mating nets, then drill them to recall.</p>
          <ReviewStats deck="mates" ids={MATE_DRILL_IDS} />
          <button
            onClick={reviewDue}
            className="mt-3 w-full rounded bg-emerald-700 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            Review due
          </button>
        </div>

        <div className="scroll-thin max-h-[60vh] space-y-2 overflow-y-auto rounded-lg bg-panel p-3">
          {MATE_PATTERNS.map((p: MatePattern) => (
            <div key={p.id}>
              <div className="mb-1 flex items-baseline gap-1 text-xs uppercase tracking-wide text-neutral-400">
                <span>{p.name}</span>
                {p.aka && <span className="normal-case text-neutral-400">· {p.aka}</span>}
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {p.drills.map((d, i) => {
                  const cd = dueLabel((cards[`mates:${d.id}`] ?? { last: 0, due: 0 }) as never);
                  const active = d.id === drill.id;
                  const gi = MATE_DRILLS.findIndex((x) => x.id === d.id);
                  return (
                    <button
                      key={d.id}
                      onClick={() => load(gi)}
                      className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                        active ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                      }`}
                    >
                      <span>#{i + 1}</span>
                      <span className="opacity-70">M{d.mateIn}</span>
                      <span className={`text-xs ${cd === 'due' ? 'text-amber-300' : 'opacity-60'}`}>{cd}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* board */}
      <div className="order-1 space-y-3 lg:order-2">
        <div className="flex h-7 items-center gap-2 text-sm">
          <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200">{pattern.name}</span>
          <span className="text-xs text-rose-300">mate in {drill.mateIn}</span>
          <span className="capitalize text-neutral-400">{drill.turn} to move</span>
          {solverToMove && <span className="animate-pulse text-emerald-400">· your move</span>}
        </div>
        <div className="mx-auto w-full max-w-[540px]">
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={game.current.turn() === 'w' ? 'white' : 'black'}
            movableColor={solverToMove ? drill.turn : undefined}
            dests={dests}
            lastMove={lastMove}
            inCheck={game.current.inCheck()}
            onMove={onMove}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {phase === 'failed' && (
            <button
              onClick={retry}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Try again
            </button>
          )}
          {phase !== 'solved' && (
            <button onClick={reveal} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
              Reveal
            </button>
          )}
          <button onClick={next} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
            Next drill →
          </button>
        </div>
      </div>

      {/* info */}
      <div className="order-3 space-y-3">
        <div className="rounded-lg bg-panel p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-neutral-300">
              {pattern.name} #{drillNoInPattern}
            </span>
            <span className="text-xs text-neutral-400">{solvedCount} solved this session</span>
          </div>
          {feedback && (
            <p
              className={`mb-2 text-sm ${
                feedback.kind === 'ok' ? 'text-emerald-300' : feedback.kind === 'bad' ? 'text-rose-300' : 'text-neutral-300'
              }`}
            >
              {feedback.text}
            </p>
          )}
          <p className="text-xs leading-snug text-neutral-400">{pattern.description}</p>
          {phase === 'solved' && (
            <button
              onClick={next}
              className="mt-3 w-full rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Next drill
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
