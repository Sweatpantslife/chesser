import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { OPENING_LINES, type OpeningLine } from '../trainers/openings';
import type { Color } from '../store/game';

type Phase = 'idle' | 'playing' | 'done';

export function OpeningsPage() {
  const game = useRef(new Chess());
  const [line, setLine] = useState<OpeningLine>(OPENING_LINES[0]!);
  const [phase, setPhase] = useState<Phase>('idle');
  const [ply, setPly] = useState(0);
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [stats, setStats] = useState({ correct: 0, wrong: 0 });

  const side = line.side;
  const traineeToMove = phase === 'playing' && game.current.turn() === (side === 'white' ? 'w' : 'b');

  const sync = () => {
    const hist = game.current.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.current.fen());
    setLastMove(last ? [last.from, last.to] : undefined);
  };

  const start = (l: OpeningLine) => {
    game.current = new Chess();
    setLine(l);
    setPhase('playing');
    setPly(0);
    setFeedback(null);
    sync();
  };

  // Auto-play the opponent's book moves; detect completion.
  useEffect(() => {
    if (phase !== 'playing') return;
    if (ply >= line.moves.length) {
      setPhase('done');
      setFeedback({ kind: 'ok', text: 'Line complete — well done!' });
      return;
    }
    const opponentToMove = game.current.turn() !== (side === 'white' ? 'w' : 'b');
    if (!opponentToMove) return;
    const t = setTimeout(() => {
      game.current.move(line.moves[ply]!);
      sync();
      setPly((p) => p + 1);
    }, 450);
    return () => clearTimeout(t);
  }, [phase, ply, line, side]);

  const dests = useMemo(() => {
    const map = new Map<string, string[]>();
    if (traineeToMove) {
      for (const m of game.current.moves({ verbose: true })) {
        const arr = map.get(m.from) ?? [];
        arr.push(m.to);
        map.set(m.from, arr);
      }
    }
    return map;
  }, [fen, traineeToMove]);

  const onMove = (from: string, to: string) => {
    if (!traineeToMove) return;
    const expected = new Chess(game.current.fen()).move(line.moves[ply]!);
    if (expected.from === from && expected.to === to) {
      game.current.move(line.moves[ply]!);
      setStats((s) => ({ ...s, correct: s.correct + 1 }));
      setFeedback({ kind: 'ok', text: `✓ ${expected.san}` });
      sync();
      setPly((p) => p + 1);
    } else {
      setStats((s) => ({ ...s, wrong: s.wrong + 1 }));
      setFeedback({ kind: 'bad', text: 'Not the main line — try again, or reveal.' });
      sync(); // snap the attempted piece back
    }
  };

  const reveal = () => {
    if (phase !== 'playing' || ply >= line.moves.length) return;
    const mv = game.current.move(line.moves[ply]!);
    setStats((s) => ({ ...s, wrong: s.wrong + 1 }));
    setFeedback({ kind: 'info', text: `Answer: ${mv.san}` });
    sync();
    setPly((p) => p + 1);
  };

  const moveNo = Math.floor(ply / 2) + 1;
  const orientation: Color = side;
  const playedSan = game.current.history();

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
      {/* line picker */}
      <div className="order-2 space-y-3 lg:order-1">
        <div className="rounded-lg bg-panel p-3">
          <h3 className="mb-2 text-sm font-semibold text-ink">Repertoire</h3>
          {(['white', 'black'] as const).map((c) => (
            <div key={c} className="mb-2">
              <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">As {c}</div>
              <div className="space-y-1">
                {OPENING_LINES.filter((l) => l.side === c).map((l) => (
                  <button
                    key={l.id}
                    onClick={() => start(l)}
                    className={`w-full rounded px-2 py-1.5 text-left text-xs ${
                      line.id === l.id ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                    }`}
                  >
                    <span className="font-medium">{l.name}</span>
                    <span className="ml-1 text-[10px] opacity-60">{l.eco}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* board */}
      <div className="order-1 space-y-3 lg:order-2">
        <div className="flex h-7 items-center gap-3 text-sm">
          <span className="text-neutral-300">{line.name}</span>
          <span className="text-neutral-600">·</span>
          <span className="text-neutral-400">
            you play <b className="text-neutral-200">{side}</b>
          </span>
          {traineeToMove && <span className="animate-pulse text-emerald-400">· your move</span>}
        </div>
        <div className="mx-auto w-full max-w-[540px]">
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={game.current.turn() === 'w' ? 'white' : 'black'}
            movableColor={traineeToMove ? side : undefined}
            dests={dests}
            lastMove={lastMove}
            inCheck={game.current.inCheck()}
            onMove={onMove}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {phase === 'idle' && (
            <button onClick={() => start(line)} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
              Start drill
            </button>
          )}
          {phase === 'playing' && (
            <button onClick={reveal} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
              Reveal move
            </button>
          )}
          {phase === 'done' && (
            <button onClick={() => start(line)} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
              Repeat line
            </button>
          )}
          <button onClick={() => start(line)} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
            Restart
          </button>
        </div>
      </div>

      {/* info */}
      <div className="order-3 space-y-3">
        <div className="rounded-lg bg-panel p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold text-ink">Move {moveNo}</span>
            <span className="text-xs text-neutral-400">
              <span className="text-emerald-400">{stats.correct}✓</span> ·{' '}
              <span className="text-rose-400">{stats.wrong}✗</span>
            </span>
          </div>
          {feedback && (
            <p
              className={`mb-2 text-sm ${
                feedback.kind === 'ok' ? 'text-emerald-300' : feedback.kind === 'bad' ? 'text-rose-300' : 'text-amber-300'
              }`}
            >
              {feedback.text}
            </p>
          )}
          <p className="text-xs leading-snug text-neutral-400">{line.idea}</p>
        </div>
        <div className="rounded-lg bg-panelmute p-2">
          <div className="mb-1 px-1 text-xs uppercase tracking-wide text-neutral-500">Moves</div>
          <div className="px-1 font-mono text-sm text-neutral-200">
            {playedSan.length === 0 ? (
              <span className="text-neutral-600">—</span>
            ) : (
              playedSan.map((san, i) => (
                <span key={i}>
                  {i % 2 === 0 && <span className="text-neutral-500">{i / 2 + 1}.</span>} {san}{' '}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
