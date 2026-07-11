import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { ReviewStats } from '../components/ReviewStats';
import { OpeningCatalogBrowser } from '../components/OpeningCatalogBrowser';
import { useProgress } from '../store/progress';
import { useRepertoire, BUILTIN_REPERTOIRE, type Repertoire, type RepLine } from '../store/repertoire';
import { catalogLine, catalogOpeningOf } from '../trainers/openingCatalog';
import { buildBook, classifyMove } from '../lib/lineBook';
import { recordReview } from '../lib/gamify';
import { dueLabel } from '../lib/srs';
import { playMoveSound } from '../lib/sound';
import type { Color } from '../store/game';

type Phase = 'idle' | 'playing' | 'done';

/** "My repertoire": the user's picks from the curated opening catalog. */
function usePickedRepertoire(): Repertoire {
  const picked = useRepertoire((s) => s.picked);
  return useMemo(
    () => ({
      id: 'mine',
      name: 'My repertoire',
      builtin: true, // lines are catalog-owned; removal goes through togglePicked
      updatedAt: 0,
      lines: picked.flatMap((id) => {
        const l = catalogLine(id);
        const o = catalogOpeningOf(id);
        return l && o ? [{ id: l.id, name: `${o.name} — ${l.name}`, side: l.side, moves: l.moves, eco: l.eco, idea: l.idea }] : [];
      }),
    }),
    [picked],
  );
}

export function OpeningsPage() {
  const game = useRef(new Chess());
  const run = useRef({ errors: 0, reveals: 0, graded: false });

  const user = useRepertoire((s) => s.user);
  const createRepertoire = useRepertoire((s) => s.createRepertoire);
  const renameRepertoire = useRepertoire((s) => s.renameRepertoire);
  const deleteRepertoire = useRepertoire((s) => s.deleteRepertoire);
  const deleteLine = useRepertoire((s) => s.deleteLine);
  const togglePicked = useRepertoire((s) => s.togglePicked);
  const myRep = usePickedRepertoire();
  const reps = useMemo(() => [myRep, BUILTIN_REPERTOIRE, ...user], [myRep, user]);

  const [repId, setRepId] = useState('mine');
  const rep = reps.find((r) => r.id === repId) ?? myRep;
  const lines = rep.lines;
  const lineIds = useMemo(() => lines.map((l) => l.id), [lines]);

  const [line, setLine] = useState<RepLine | null>(lines[0] ?? null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [ply, setPly] = useState(0);
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [stats, setStats] = useState({ correct: 0, wrong: 0 });
  const [syncKey, setSyncKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [browsing, setBrowsing] = useState(false);

  const grade = useProgress((s) => s.grade);
  const cards = useProgress((s) => s.cards);
  const dueIds = useProgress((s) => s.dueIds);

  const side = line?.side ?? 'white';
  const traineeToMove = phase === 'playing' && !!line && game.current.turn() === (side === 'white' ? 'w' : 'b');

  // Position book over the repertoire's same-side lines: accepts sibling-line
  // moves at forks and recognises transpositions between lines.
  const book = useMemo(() => buildBook(lines, side), [lines, side]);

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
    setStats({ correct: 0, wrong: 0 });
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
        recordReview(g !== 'again');
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
    const verdict = classifyMove(book, line, ply, game.current.fen(), from, to);
    if (verdict.kind === 'expected') {
      game.current.move(verdict.san);
      playMoveSound(verdict.san);
      setStats((s) => ({ ...s, correct: s.correct + 1 }));
      setFeedback({ kind: 'ok', text: `✓ ${verdict.san}` });
      sync();
      setPly((p) => p + 1);
    } else if (verdict.kind === 'alternate') {
      // Also in your repertoire: a fork or transposition into a sibling line.
      const target = lines.find((l) => l.id === verdict.lineId);
      game.current.move(verdict.san);
      playMoveSound(verdict.san);
      setStats((s) => ({ ...s, correct: s.correct + 1 }));
      if (target) {
        setFeedback({ kind: 'ok', text: `✓ ${verdict.san} — continuing as ${target.name}` });
        setLine(target);
        setPly(verdict.ply + 1);
      } else {
        setFeedback({ kind: 'ok', text: `✓ ${verdict.san}` });
        setPly((p) => p + 1);
      }
      sync();
    } else {
      run.current.errors += 1;
      setStats((s) => ({ ...s, wrong: s.wrong + 1 }));
      setFeedback({ kind: 'bad', text: 'Not in your repertoire — try again, or reveal.' });
      sync();
      // Snap the board back. chessground has already rendered the rejected
      // move; on the first ply sync() leaves every Board prop identical
      // (same fen, lastMove still undefined), so without this bump the board
      // stays desynced and no further input registers.
      setSyncKey((k) => k + 1);
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

  // For display, clamp to the line's last half-move: once the drill is done,
  // ply === line.moves.length and the raw calc would show one move too many
  // (e.g. "Move 9" after an 8-move line).
  const displayPly = line && line.moves.length > 0 ? Math.min(ply, line.moves.length - 1) : ply;
  const moveNo = Math.floor(displayPly / 2) + 1;
  const orientation: Color = side;
  const playedSan = game.current.history();
  const editable = !rep.builtin;
  const removable = editable || rep.id === 'mine';

  const removeLine = (l: RepLine) => {
    if (rep.id === 'mine') togglePicked(l.id);
    else deleteLine(rep.id, l.id);
    if (line?.id === l.id) {
      setLine(null);
      setPhase('idle');
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
      {browsing && <OpeningCatalogBrowser onClose={() => setBrowsing(false)} />}

      {/* repertoire + lines */}
      <div className="order-2 space-y-3 lg:order-1">
        <div className="rounded-2xl bg-panel shadow-soft p-3">
          <h3 className="mb-2 text-sm font-semibold text-ink">Repertoire</h3>
          <select
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
            aria-label="Repertoire"
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none"
          >
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} {r.id === 'builtin' ? '' : `(${r.lines.length})`}
              </option>
            ))}
          </select>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {rep.id === 'mine' && (
              <button
                onClick={() => setBrowsing(true)}
                className="btn-press rounded bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700"
              >
                📖 Browse openings
              </button>
            )}
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
                  className="rounded bg-emerald-700 px-2 py-1 text-xs text-white"
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
                          setRepId('mine');
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
            className="mt-2 w-full rounded bg-emerald-700 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Review due lines
          </button>
        </div>

        <div className="scroll-thin max-h-[55vh] overflow-y-auto rounded-2xl bg-panel shadow-soft p-3">
          {lines.length === 0 ? (
            rep.id === 'mine' ? (
              <div className="space-y-2 text-xs text-neutral-400">
                <p>Your repertoire is empty. Pick openings to learn as White and as Black from the curated catalog.</p>
                <button
                  onClick={() => setBrowsing(true)}
                  className="btn-press w-full rounded bg-brand-600 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Browse openings
                </button>
              </div>
            ) : (
              <p className="text-xs text-neutral-400">
                No lines yet. Build one on the <b className="text-neutral-300">Play</b> board, then “★ Save line”.
              </p>
            )
          ) : (
            (['white', 'black'] as const).map((c) => {
              const group = lines.filter((l) => l.side === c);
              if (group.length === 0) return null;
              return (
                <div key={c} className="mb-2">
                  <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">As {c}</div>
                  <div className="space-y-1">
                    {group.map((l) => {
                      const cd = dueLabel((cards[`openings:${l.id}`] ?? { last: 0, due: 0 }) as any);
                      const selected = line?.id === l.id;
                      return (
                        <div key={l.id} className="flex items-center gap-1">
                          <button
                            onClick={() => start(l)}
                            className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs ${
                              selected ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                            }`}
                          >
                            <span className="truncate">{l.name}</span>
                            <span
                              className={`shrink-0 text-xs ${
                                cd === 'due'
                                  ? selected
                                    ? 'text-amber-100'
                                    : 'text-gold-300'
                                  : selected
                                    ? 'text-emerald-100'
                                    : 'text-neutral-300'
                              }`}
                            >
                              {cd}
                            </span>
                          </button>
                          {removable && (
                            <button
                              onClick={() => removeLine(l)}
                              title="Remove line"
                              aria-label="Remove line"
                              className="shrink-0 rounded px-1.5 py-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-rose-300"
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
          <span className="truncate text-neutral-300">{line?.name ?? 'Pick a line'}</span>
          {line?.eco && <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">{line.eco}</span>}
          {line && (
            <>
              <span className="text-neutral-400">·</span>
              <span className="shrink-0 text-neutral-400">
                you play <b className="text-neutral-200">{side}</b>
              </span>
            </>
          )}
          {traineeToMove && <span className="animate-pulse-soft shrink-0 text-emerald-400">· your move</span>}
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
            syncKey={syncKey}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {phase !== 'playing' && line && (
            <button onClick={() => start(line)} className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800">
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
        <div className="rounded-2xl bg-panel shadow-soft p-3">
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
        <div className="rounded-2xl bg-panelmute p-2">
          <div className="mb-1 px-1 text-xs uppercase tracking-wide text-neutral-400">Moves</div>
          <div className="px-1 font-mono text-sm text-neutral-200">
            {playedSan.length === 0 ? (
              <span className="text-neutral-400">—</span>
            ) : (
              playedSan.map((san, i) => (
                <span key={i}>
                  {i % 2 === 0 && <span className="text-neutral-400">{i / 2 + 1}.</span>} {san}{' '}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
