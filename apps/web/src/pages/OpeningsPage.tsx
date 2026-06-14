import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { ReviewStats } from '../components/ReviewStats';
import { useProgress } from '../store/progress';
import { useRepertoire, BUILTIN_REPERTOIRE, type RepLine } from '../store/repertoire';
import { dueLabel } from '../lib/srs';
import { playMoveSound } from '../lib/sound';
import type { Color } from '../store/game';

type Phase = 'idle' | 'playing' | 'done';

export function OpeningsPage() {
  const game = useRef(new Chess());
  const run = useRef({ errors: 0, reveals: 0, graded: false });

  const user = useRepertoire((s) => s.user);
  const createRepertoire = useRepertoire((s) => s.createRepertoire);
  const renameRepertoire = useRepertoire((s) => s.renameRepertoire);
  const deleteRepertoire = useRepertoire((s) => s.deleteRepertoire);
  const deleteLine = useRepertoire((s) => s.deleteLine);
  const reps = useMemo(() => [BUILTIN_REPERTOIRE, ...user], [user]);

  const [repId, setRepId] = useState('builtin');
  const rep = reps.find((r) => r.id === repId) ?? BUILTIN_REPERTOIRE;
  const lines = rep.lines;
  const lineIds = useMemo(() => lines.map((l) => l.id), [lines]);

  const [line, setLine] = useState<RepLine | null>(lines[0] ?? null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [ply, setPly] = useState(0);
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [stats, setStats] = useState({ correct: 0, wrong: 0 });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const grade = useProgress((s) => s.grade);
  const cards = useProgress((s) => s.cards);
  const dueIds = useProgress((s) => s.dueIds);

  const side = line?.side ?? 'white';
  const traineeToMove = phase === 'playing' && !!line && game.current.turn() === (side === 'white' ? 'w' : 'b');

  // Reset when switching repertoire.
  useEffect(() => {
    setLine(lines[0] ?? null);
    setPhase('idle');
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repId]);

  const sync = () => {
    const hist = game.current.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.current.fen());
    setLastMove(last ? [last.from, last.to] : undefined);
  };

  const start = (l: RepLine) => {
    game.current = new Chess();
    run.current = { errors: 0, reveals: 0, graded: false };
    setLine(l);
    setPhase('playing');
    setPly(0);
    setFeedback(null);
    sync();
  };

  const reviewNext = () => {
    const due = dueIds('openings', lineIds);
    const pool = due.length > 0 ? due : lineIds.filter((id) => !cards[`openings:${id}`]?.last);
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? lineIds[0];
    const l = lines.find((x) => x.id === pick);
    if (l) start(l);
  };

  useEffect(() => {
    if (phase !== 'playing' || !line) return;
    if (ply >= line.moves.length) {
      if (!run.current.graded) {
        run.current.graded = true;
        const g = run.current.reveals > 0 || run.current.errors >= 3 ? 'again' : run.current.errors >= 1 ? 'hard' : 'good';
        grade('openings', line.id, g);
      }
      setPhase('done');
      setFeedback({ kind: 'ok', text: 'Line complete — saved to your review schedule!' });
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
  }, [phase, ply, line, side, grade]);

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
    if (!traineeToMove || !line) return;
    const expected = new Chess(game.current.fen()).move(line.moves[ply]!);
    if (expected.from === from && expected.to === to) {
      game.current.move(line.moves[ply]!);
      playMoveSound(expected.san);
      setStats((s) => ({ ...s, correct: s.correct + 1 }));
      setFeedback({ kind: 'ok', text: `✓ ${expected.san}` });
      sync();
      setPly((p) => p + 1);
    } else {
      run.current.errors += 1;
      setStats((s) => ({ ...s, wrong: s.wrong + 1 }));
      setFeedback({ kind: 'bad', text: 'Not the line — try again, or reveal.' });
      sync();
    }
  };

  const reveal = () => {
    if (phase !== 'playing' || !line || ply >= line.moves.length) return;
    run.current.reveals += 1;
    const mv = game.current.move(line.moves[ply]!);
    setStats((s) => ({ ...s, wrong: s.wrong + 1 }));
    setFeedback({ kind: 'info', text: `Answer: ${mv.san}` });
    sync();
    setPly((p) => p + 1);
  };

  const moveNo = Math.floor(ply / 2) + 1;
  const orientation: Color = side;
  const playedSan = game.current.history();
  const editable = !rep.builtin;

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
      {/* repertoire + lines */}
      <div className="order-2 space-y-3 lg:order-1">
        <div className="rounded-lg bg-panel p-3">
          <h3 className="mb-2 text-sm font-semibold text-ink">Repertoire</h3>
          <select
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none"
          >
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} {r.builtin ? '' : `(${r.lines.length})`}
              </option>
            ))}
          </select>

          <div className="mt-2 flex items-center gap-2">
            {creating ? (
              <>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="new repertoire"
                  className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-ink outline-none"
                />
                <button
                  onClick={() => {
                    const id = createRepertoire(newName);
                    setNewName('');
                    setCreating(false);
                    setRepId(id);
                  }}
                  className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
                >
                  Create
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setCreating(true)} className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-600">
                  + New
                </button>
                {editable && (
                  <>
                    <button
                      onClick={() => {
                        const n = window.prompt('Rename repertoire', rep.name);
                        if (n) renameRepertoire(rep.id, n);
                      }}
                      className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-600"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete "${rep.name}"?`)) {
                          deleteRepertoire(rep.id);
                          setRepId('builtin');
                        }
                      }}
                      className="rounded bg-neutral-700 px-2 py-1 text-xs text-rose-300 hover:bg-neutral-600"
                    >
                      Delete
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          <div className="mt-3">
            <ReviewStats deck="openings" ids={lineIds} />
          </div>
          <button
            onClick={reviewNext}
            disabled={lineIds.length === 0}
            className="mt-2 w-full rounded bg-emerald-600 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Review due lines
          </button>
        </div>

        <div className="scroll-thin max-h-[55vh] overflow-y-auto rounded-lg bg-panel p-3">
          {lines.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No lines yet. Build one on the <b className="text-neutral-300">Play</b> board, then “★ Save line”.
            </p>
          ) : (
            (['white', 'black'] as const).map((c) => {
              const group = lines.filter((l) => l.side === c);
              if (group.length === 0) return null;
              return (
                <div key={c} className="mb-2">
                  <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">As {c}</div>
                  <div className="space-y-1">
                    {group.map((l) => {
                      const cd = dueLabel((cards[`openings:${l.id}`] ?? { last: 0, due: 0 }) as any);
                      return (
                        <div key={l.id} className="flex items-center gap-1">
                          <button
                            onClick={() => start(l)}
                            className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs ${
                              line?.id === l.id ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                            }`}
                          >
                            <span className="truncate">{l.name}</span>
                            <span className={`shrink-0 text-[10px] ${cd === 'due' ? 'text-amber-300' : 'opacity-60'}`}>{cd}</span>
                          </button>
                          {editable && (
                            <button
                              onClick={() => {
                                deleteLine(rep.id, l.id);
                                if (line?.id === l.id) {
                                  setLine(null);
                                  setPhase('idle');
                                }
                              }}
                              title="Delete line"
                              className="shrink-0 rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-700 hover:text-rose-300"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* board */}
      <div className="order-1 space-y-3 lg:order-2">
        <div className="flex h-7 items-center gap-3 text-sm">
          <span className="text-neutral-300">{line?.name ?? 'Pick a line'}</span>
          {line && (
            <>
              <span className="text-neutral-600">·</span>
              <span className="text-neutral-400">
                you play <b className="text-neutral-200">{side}</b>
              </span>
            </>
          )}
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
          {phase !== 'playing' && line && (
            <button onClick={() => start(line)} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
              {phase === 'done' ? 'Repeat line' : 'Start drill'}
            </button>
          )}
          {phase === 'playing' && (
            <button onClick={reveal} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
              Reveal move
            </button>
          )}
        </div>
      </div>

      {/* info */}
      <div className="order-3 space-y-3">
        <div className="rounded-lg bg-panel p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold text-ink">Move {moveNo}</span>
            <span className="text-xs text-neutral-400">
              <span className="text-emerald-400">{stats.correct}✓</span> · <span className="text-rose-400">{stats.wrong}✗</span>
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
          {line?.idea && <p className="text-xs leading-snug text-neutral-400">{line.idea}</p>}
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
