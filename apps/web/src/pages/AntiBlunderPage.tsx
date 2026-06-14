import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { ReviewStats } from '../components/ReviewStats';
import { BLUNDER_POSITIONS, BLUNDER_IDS } from '../trainers/blunders';
import { useProgress } from '../store/progress';
import { playMoveSound } from '../lib/sound';
import type { Color } from '../store/game';

type Phase = 'solving' | 'confirm' | 'busted' | 'solved';

/** SAN of a UCI move from a FEN (for display). */
function sanOf(fen: string, uci: string): string {
  try {
    const g = new Chess(fen);
    const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return mv?.san ?? uci;
  } catch {
    return uci;
  }
}

export function AntiBlunderPage() {
  const game = useRef(new Chess());
  const attempt = useRef({ tempted: false });
  const pending = useRef<{ from: string; to: string } | null>(null);

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('solving');
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'info' | 'warn'; text: string } | null>(null);
  const [solvedCount, setSolvedCount] = useState(0);

  const grade = useProgress((s) => s.grade);
  const dueIds = useProgress((s) => s.dueIds);
  const cards = useProgress((s) => s.cards);

  const pos = BLUNDER_POSITIONS[idx]!;
  const temptingSan = useMemo(() => sanOf(pos.fen, pos.tempting), [pos]);
  const bestSan = useMemo(() => sanOf(pos.fen, pos.best[0]!), [pos]);

  const load = (i: number) => {
    const p = BLUNDER_POSITIONS[i];
    if (!p) return;
    game.current = new Chess(p.fen);
    attempt.current = { tempted: false };
    pending.current = null;
    setIdx(i);
    setPhase('solving');
    setFeedback({ kind: 'info', text: `${p.turn === 'white' ? 'White' : 'Black'} to move — find the safe, strong move.` });
    setFen(game.current.fen());
    setLastMove(undefined);
  };

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = () => {
    const hist = game.current.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.current.fen());
    setLastMove(last ? [last.from, last.to] : undefined);
  };

  const toMove = phase === 'solving' && game.current.turn() === (pos.turn === 'white' ? 'w' : 'b');

  const dests = useMemo(() => {
    const map = new Map<string, string[]>();
    if (toMove) {
      for (const m of game.current.moves({ verbose: true })) {
        const arr = map.get(m.from) ?? [];
        arr.push(m.to);
        map.set(m.from, arr);
      }
    }
    return map;
  }, [fen, toMove]);

  const succeed = (foundBest: boolean) => {
    setPhase('solved');
    setSolvedCount((n) => n + 1);
    grade('blunders', pos.id, foundBest && !attempt.current.tempted ? 'good' : 'hard');
    setFeedback({
      kind: 'ok',
      text: foundBest ? `✓ ${bestSan} — the right call. ${pos.explanation}` : `That dodges the trap. The model move was ${bestSan}. ${pos.explanation}`,
    });
  };

  const onMove = (from: string, to: string) => {
    if (!toMove) return;
    const uci = `${from}${to}`;
    if (uci === pos.tempting) {
      // Intercept the tempting blunder — make the player confirm.
      pending.current = { from, to };
      setPhase('confirm');
      setFeedback({ kind: 'warn', text: pos.warning });
      return; // board locks & snaps back to the position
    }
    // Any other move is committed on the board for feedback.
    const mv = game.current.move({ from, to });
    playMoveSound(mv.san);
    sync();
    succeed(uci === pos.best[0]);
  };

  const playLine = (uciLine: string[], fromStep: number) => {
    let step = fromStep;
    const tick = () => {
      const u = uciLine[step];
      if (!u) return;
      game.current.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      sync();
      step++;
      if (step < uciLine.length) setTimeout(tick, 650);
    };
    setTimeout(tick, 350);
  };

  const playAnyway = () => {
    setPhase('busted');
    grade('blunders', pos.id, 'again');
    setFeedback({ kind: 'bad', text: `${temptingSan}?? ${pos.explanation}` });
    // Replay the full refutation from the original position.
    game.current = new Chess(pos.fen);
    setFen(game.current.fen());
    playLine(pos.refutation, 0);
  };

  const takeBack = () => {
    attempt.current.tempted = true;
    pending.current = null;
    setPhase('solving');
    setFeedback({ kind: 'info', text: 'Good — a blunder-check just saved you. Now find a safe move.' });
  };

  const reveal = () => {
    game.current = new Chess(pos.fen);
    game.current.move({ from: pos.best[0]!.slice(0, 2), to: pos.best[0]!.slice(2, 4), promotion: pos.best[0]![4] });
    setPhase('solved');
    grade('blunders', pos.id, 'again');
    setFeedback({ kind: 'info', text: `The safe move is ${bestSan}. ${pos.explanation}` });
    sync();
  };

  const next = () => load((idx + 1) % BLUNDER_POSITIONS.length);

  const reviewDue = () => {
    const due = dueIds('blunders', BLUNDER_IDS);
    if (due.length === 0) {
      setFeedback({ kind: 'info', text: 'No blunder drills due right now — try a new one!' });
      return;
    }
    const i = BLUNDER_POSITIONS.findIndex((b) => b.id === due[0]);
    if (i >= 0) load(i);
  };

  const orientation: Color = pos.turn;

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      {/* sidebar */}
      <div className="order-2 space-y-3 lg:order-1">
        <div className="rounded-lg bg-panel p-3">
          <h3 className="mb-1 text-sm font-semibold text-ink">Anti-blunder</h3>
          <p className="mb-2 text-xs text-neutral-400">
            Find the strong move — but watch for the tempting one. Before you commit, the trainer asks:{' '}
            <em className="text-neutral-300">are you sure?</em>
          </p>
          <ReviewStats deck="blunders" ids={BLUNDER_IDS} />
          <button
            onClick={reviewDue}
            className="mt-3 w-full rounded bg-emerald-600 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Review due
          </button>
        </div>
        <div className="rounded-lg bg-panel p-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Positions</div>
          <div className="flex flex-wrap gap-1">
            {BLUNDER_POSITIONS.map((b, i) => {
              const cd = cards[`blunders:${b.id}`];
              const due = cd?.last && cd.due <= Date.now();
              return (
                <button
                  key={b.id}
                  onClick={() => load(i)}
                  className={`rounded px-2 py-1 text-xs ${
                    i === idx ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                  }`}
                >
                  {i + 1}
                  {due ? <span className="ml-0.5 text-amber-300">•</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* board */}
      <div className="order-1 space-y-3 lg:order-2">
        <div className="flex h-7 items-center gap-2 text-sm">
          <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200">{pos.theme}</span>
          <span className="capitalize text-neutral-400">{pos.turn} to move</span>
          {toMove && <span className="animate-pulse text-emerald-400">· your move</span>}
        </div>
        <div className="mx-auto w-full max-w-[540px]">
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={game.current.turn() === 'w' ? 'white' : 'black'}
            movableColor={toMove ? pos.turn : undefined}
            dests={dests}
            lastMove={lastMove}
            inCheck={game.current.inCheck()}
            onMove={onMove}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {phase !== 'solved' && phase !== 'busted' && phase !== 'confirm' && (
            <button onClick={reveal} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
              Reveal
            </button>
          )}
          <button onClick={next} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
            Next →
          </button>
        </div>
      </div>

      {/* info / are-you-sure */}
      <div className="order-3 space-y-3">
        {phase === 'confirm' ? (
          <div className="rounded-lg border border-amber-500/50 bg-amber-950/40 p-3">
            <div className="mb-1 text-sm font-semibold text-amber-300">⚠️ Are you sure?</div>
            <p className="mb-3 text-sm text-amber-100/90">
              You’re about to play <b>{temptingSan}</b>. {pos.warning}
            </p>
            <div className="flex gap-2">
              <button
                onClick={takeBack}
                className="flex-1 rounded bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Take it back
              </button>
              <button
                onClick={playAnyway}
                className="flex-1 rounded bg-neutral-700 py-2 text-sm text-neutral-200 hover:bg-neutral-600"
              >
                Play it anyway
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-panel p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-neutral-300">
                Position {idx + 1}/{BLUNDER_POSITIONS.length}
              </span>
              <span className="text-xs text-neutral-400">{solvedCount} solved this session</span>
            </div>
            {feedback && (
              <p
                className={`text-sm ${
                  feedback.kind === 'ok'
                    ? 'text-emerald-300'
                    : feedback.kind === 'bad'
                      ? 'text-rose-300'
                      : feedback.kind === 'warn'
                        ? 'text-amber-300'
                        : 'text-neutral-300'
                }`}
              >
                {feedback.text}
              </p>
            )}
            {(phase === 'solved' || phase === 'busted') && (
              <button
                onClick={next}
                className="mt-3 w-full rounded bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Next position
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
