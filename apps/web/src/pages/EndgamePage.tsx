import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { EngineAvailability, TablebaseResult } from '@chesser/shared';
import { Board } from '../board/Board';
import { EvalBar } from '../components/EvalBar';
import { engine } from '../lib/engine';
import { useAnalysis } from '../lib/useAnalysis';
import { fetchTablebase, categoryLabel, judgeMove } from '../lib/tablebase';
import { playMoveSound } from '../lib/sound';
import { ENDGAMES, type EndgameStudy } from '../trainers/endgames';
import { formatScore } from '../lib/format';
import type { Color } from '../store/game';

type Phase = 'playing' | 'won' | 'drawn' | 'lost';

const HOLD_PLIES = 20; // plies to survive before a draw study counts as held

export function EndgamePage() {
  const game = useRef(new Chess());
  const gameId = useRef(0);
  const [study, setStudy] = useState<EndgameStudy>(ENDGAMES[0]!);
  const [phase, setPhase] = useState<Phase>('playing');
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [thinking, setThinking] = useState(false);
  const [tb, setTb] = useState<TablebaseResult | null>(null);
  const [moveNote, setMoveNote] = useState<{ kind: 'ok' | 'good' | 'bad'; text: string } | null>(null);
  const [syzygy, setSyzygy] = useState<{ on: boolean; max?: number }>(() => ({
    on: engine.availability?.syzygy ?? false,
    max: engine.availability?.syzygyMaxPieces,
  }));

  const youPlay = study.youPlay;
  const youChar = youPlay === 'white' ? 'w' : 'b';
  const yourTurn = phase === 'playing' && !thinking && game.current.turn() === youChar;
  const analysis = useAnalysis(fen, phase === 'playing' && (!tb || !tb.available), 1);

  const sync = () => {
    const hist = game.current.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.current.fen());
    setLastMove(last ? [last.from, last.to] : undefined);
  };

  const outcomeAfterMove = (): Phase => {
    if (game.current.isCheckmate()) return game.current.turn() === youChar ? 'lost' : 'won';
    if (game.current.isStalemate() || game.current.isInsufficientMaterial() || game.current.isDraw()) return 'drawn';
    if (study.goal === 'draw' && game.current.history().length >= HOLD_PLIES) return 'drawn';
    return 'playing';
  };

  // Keep tablebase data in sync with the position (best-effort; may be unavailable).
  useEffect(() => {
    let cancelled = false;
    const pieces = fen.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length;
    if (pieces > 7) {
      setTb(null);
      return;
    }
    fetchTablebase(fen).then((r) => !cancelled && setTb(r.available ? r : null));
    return () => {
      cancelled = true;
    };
  }, [fen]);

  const askDefender = async () => {
    if (game.current.isGameOver() || game.current.turn() === youChar) return;
    const id = gameId.current;
    setThinking(true);
    const fenNow = game.current.fen();
    let uci: string | null = null;

    // Prefer tablebase-perfect defence; fall back to a full-strength engine.
    const t = await fetchTablebase(fenNow);
    const tbBest = t.available ? t.moves?.[0] : undefined;
    if (tbBest) uci = tbBest.uci;
    if (!uci) {
      try {
        const res = await engine.botMove(fenNow, { style: 'balanced', elo: 3190, moveTimeMs: 500 });
        uci = res.uci;
      } catch {
        /* leave null */
      }
    }
    if (gameId.current !== id) return;
    if (!uci) {
      setThinking(false);
      return;
    }
    const dmv = game.current.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (dmv) playMoveSound(dmv.san);
    setThinking(false);
    sync();
    const o = outcomeAfterMove();
    if (o !== 'playing') setPhase(o);
  };

  const load = (s: EndgameStudy) => {
    gameId.current++;
    game.current = new Chess(s.fen);
    setStudy(s);
    setPhase('playing');
    setThinking(false);
    setMoveNote(null);
    setTb(null);
    setFen(game.current.fen());
    setLastMove(undefined);
    setTimeout(() => {
      if (game.current.turn() !== (s.youPlay === 'white' ? 'w' : 'b')) askDefender();
    }, 300);
  };

  useEffect(() => {
    load(ENDGAMES[0]!);
    return () => engine.stopAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track whether the server has local Syzygy tablebases loaded into Stockfish.
  useEffect(() => {
    const apply = (a: EngineAvailability) => setSyzygy({ on: a.syzygy ?? false, max: a.syzygyMaxPieces });
    const fn = (w: { engines: EngineAvailability }) => apply(w.engines);
    engine.onWelcome.add(fn);
    if (engine.availability) apply(engine.availability);
    return () => {
      engine.onWelcome.delete(fn);
    };
  }, []);

  const dests = useMemo(() => {
    const map = new Map<string, string[]>();
    if (yourTurn) {
      for (const m of game.current.moves({ verbose: true })) {
        const arr = map.get(m.from) ?? [];
        arr.push(m.to);
        map.set(m.from, arr);
      }
    }
    return map;
  }, [fen, yourTurn]);

  const onMove = (from: string, to: string) => {
    if (!yourTurn) return;
    const uci = from + to + (game.current.get(from as any)?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : '');
    const before = tb; // tablebase snapshot of the position we're moving from
    let mv;
    try {
      mv = game.current.move({ from, to, promotion: 'q' });
    } catch {
      return;
    }
    if (mv) playMoveSound(mv.san);
    setMoveNote(before ? judgeMove(before, uci, study.goal) : null);
    sync();
    const o = outcomeAfterMove();
    if (o !== 'playing') {
      setPhase(o);
      return;
    }
    askDefender();
  };

  const status = useMemo(() => {
    if (phase === 'won') return { text: '✓ Checkmate — solved!', cls: 'text-emerald-300 font-semibold' };
    if (phase === 'drawn')
      return {
        text: study.goal === 'draw' ? '✓ Held the draw!' : '½ Drawn — the win slipped away.',
        cls: 'text-amber-300 font-semibold',
      };
    if (phase === 'lost') return { text: 'You got mated! Restart and try again.', cls: 'text-rose-300 font-semibold' };
    if (tb?.available) return { text: categoryLabel(tb.category, tb.dtm), cls: 'text-sky-300' };
    const sc = analysis.score;
    if (!sc) return { text: thinking ? 'Engine defending…' : 'Your move.', cls: 'text-neutral-300' };
    const yourPov = youPlay === 'white' ? sc : { ...sc, value: -sc.value };
    if (yourPov.kind === 'mate' && yourPov.value > 0) return { text: `Winning — mate in ${yourPov.value}.`, cls: 'text-emerald-300' };
    if (study.goal === 'win' && (yourPov.kind === 'cp' ? yourPov.value < 200 : yourPov.value < 0))
      return { text: 'Careful — your advantage is slipping.', cls: 'text-amber-300' };
    return { text: thinking ? 'Engine defending…' : 'Your move — keep converting.', cls: 'text-neutral-300' };
  }, [phase, analysis.score, thinking, youPlay, study.goal, tb]);

  const orientation: Color = youPlay;

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      <div className="order-2 space-y-3 lg:order-1">
        <div className="rounded-lg bg-panel p-3">
          <h3 className="mb-2 text-sm font-semibold text-ink">Endgame studies</h3>
          <div className="scroll-thin max-h-[60vh] space-y-1 overflow-y-auto">
            {ENDGAMES.map((s) => (
              <button
                key={s.id}
                onClick={() => load(s)}
                className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs ${
                  study.id === s.id ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                }`}
              >
                <span className="truncate">{s.name}</span>
                <span className="shrink-0 text-[10px] uppercase opacity-60">{s.goal}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="order-1 space-y-3 lg:order-2">
        <div className="flex h-7 items-center gap-3 text-sm">
          <span className={status.cls}>{status.text}</span>
          {moveNote && phase === 'playing' && (
            <span className={moveNote.kind === 'bad' ? 'text-rose-300' : moveNote.kind === 'good' ? 'text-emerald-300' : 'text-amber-300'}>
              · {moveNote.text}
            </span>
          )}
        </div>
        <div className="mx-auto w-full max-w-[540px]">
          <div className="flex gap-2">
            <EvalBar score={analysis.score} orientation={orientation} />
            <div className="flex-1">
              <Board
                fen={fen}
                orientation={orientation}
                turnColor={game.current.turn() === 'w' ? 'white' : 'black'}
                movableColor={yourTurn ? youPlay : undefined}
                dests={dests}
                lastMove={lastMove}
                inCheck={game.current.inCheck()}
                onMove={onMove}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => load(study)} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
            Restart
          </button>
          <button
            onClick={() => load(ENDGAMES[(ENDGAMES.findIndex((e) => e.id === study.id) + 1) % ENDGAMES.length]!)}
            className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600"
          >
            Next study →
          </button>
        </div>
      </div>

      <div className="order-3 space-y-3">
        <div className="rounded-lg bg-panel p-3">
          <h4 className="mb-1 text-sm font-semibold text-ink">{study.name}</h4>
          <p className="mb-2 text-xs text-neutral-400">
            You play <b className="capitalize text-neutral-200">{youPlay}</b> — goal:{' '}
            <b className="text-neutral-200">{study.goal === 'win' ? 'checkmate' : 'hold the draw'}</b>.
          </p>
          <p className="text-xs leading-snug text-neutral-400">{study.technique}</p>
          {phase === 'playing' && (
            <p className="mt-2 font-mono text-xs text-neutral-500">
              {tb?.available
                ? `${tb.source === 'syzygy' ? 'syzygy' : 'tablebase'} · ${tb.category}${tb.dtz != null ? ` · dtz ${tb.dtz}` : ''}`
                : analysis.score
                  ? `eval ${formatScore(analysis.score)} · depth ${analysis.depth}`
                  : ''}
            </p>
          )}
          {syzygy.on && (
            <p className="mt-2 text-[11px] leading-snug text-emerald-400/80">
              ♟ Syzygy {syzygy.max ?? 7}-man tablebases loaded — the defender is perfect.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
