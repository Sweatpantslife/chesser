import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { EvalBar } from '../components/EvalBar';
import { engine } from '../lib/engine';
import { useAnalysis } from '../lib/useAnalysis';
import { ENDGAMES, type EndgameStudy } from '../trainers/endgames';
import { formatScore } from '../lib/format';
import type { Color } from '../store/game';

type Phase = 'playing' | 'won' | 'drawn' | 'lost';

export function EndgamePage() {
  const game = useRef(new Chess());
  const gameId = useRef(0);
  const [study, setStudy] = useState<EndgameStudy>(ENDGAMES[0]!);
  const [phase, setPhase] = useState<Phase>('playing');
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [thinking, setThinking] = useState(false);

  const youPlay = study.youPlay;
  const yourTurn = phase === 'playing' && !thinking && game.current.turn() === (youPlay === 'white' ? 'w' : 'b');
  const analysis = useAnalysis(fen, phase === 'playing', 1);

  const sync = () => {
    const hist = game.current.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.current.fen());
    setLastMove(last ? [last.from, last.to] : undefined);
  };

  const outcomeAfterMove = (): Phase => {
    if (game.current.isCheckmate()) {
      // side to move is mated; if that's the defender, you won
      return game.current.turn() === (youPlay === 'white' ? 'w' : 'b') ? 'lost' : 'won';
    }
    if (game.current.isStalemate() || game.current.isInsufficientMaterial() || game.current.isDraw()) {
      return study.goal === 'draw' ? 'drawn' : 'drawn';
    }
    return 'playing';
  };

  const askEngine = () => {
    if (game.current.isGameOver()) return;
    if (game.current.turn() === (youPlay === 'white' ? 'w' : 'b')) return;
    const id = gameId.current;
    setThinking(true);
    const fenNow = game.current.fen();
    engine
      .botMove(fenNow, { style: 'balanced', elo: 3190, moveTimeMs: 500 })
      .then((res) => {
        if (gameId.current !== id) return;
        game.current.move({ from: res.uci.slice(0, 2), to: res.uci.slice(2, 4), promotion: res.uci[4] });
        setThinking(false);
        sync();
        const o = outcomeAfterMove();
        if (o !== 'playing') setPhase(o);
      })
      .catch(() => gameId.current === id && setThinking(false));
  };

  const load = (s: EndgameStudy) => {
    gameId.current++;
    game.current = new Chess(s.fen);
    setStudy(s);
    setPhase('playing');
    setThinking(false);
    setFen(game.current.fen());
    setLastMove(undefined);
    // if the defender is on move first, let the engine reply
    setTimeout(() => {
      if (game.current.turn() !== (s.youPlay === 'white' ? 'w' : 'b')) askEngine();
    }, 300);
  };

  useEffect(() => {
    load(ENDGAMES[0]!);
    return () => engine.stopAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    try {
      game.current.move({ from, to, promotion: 'q' }); // auto-queen
    } catch {
      return;
    }
    sync();
    const o = outcomeAfterMove();
    if (o !== 'playing') {
      setPhase(o);
      return;
    }
    askEngine();
  };

  // derive a coaching status from the live evaluation (your POV)
  const status = useMemo(() => {
    if (phase === 'won') return { text: '✓ Checkmate — solved!', cls: 'text-emerald-300 font-semibold' };
    if (phase === 'drawn') return { text: study.goal === 'draw' ? '✓ Held the draw!' : '½ Drawn — the win slipped away.', cls: 'text-amber-300 font-semibold' };
    if (phase === 'lost') return { text: 'You got mated! Restart and try again.', cls: 'text-rose-300 font-semibold' };
    const sc = analysis.score;
    if (!sc) return { text: thinking ? 'Engine defending…' : 'Your move.', cls: 'text-neutral-300' };
    const yourPov = youPlay === 'white' ? sc : { ...sc, value: -sc.value };
    if (yourPov.kind === 'mate' && yourPov.value > 0) return { text: `Winning — mate in ${yourPov.value}. Convert it!`, cls: 'text-emerald-300' };
    if (study.goal === 'win' && (yourPov.kind === 'cp' ? yourPov.value < 200 : yourPov.value < 0))
      return { text: 'Careful — your advantage is slipping.', cls: 'text-amber-300' };
    return { text: thinking ? 'Engine defending…' : 'Your move — keep converting.', cls: 'text-neutral-300' };
  }, [phase, analysis.score, thinking, youPlay, study.goal]);

  const orientation: Color = youPlay;

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      <div className="order-2 space-y-3 lg:order-1">
        <div className="rounded-lg bg-panel p-3">
          <h3 className="mb-2 text-sm font-semibold text-ink">Endgame studies</h3>
          <div className="space-y-1">
            {ENDGAMES.map((s) => (
              <button
                key={s.id}
                onClick={() => load(s)}
                className={`w-full rounded px-2 py-1.5 text-left text-xs ${
                  study.id === s.id ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                }`}
              >
                <span className="font-medium">{s.name}</span>
                <span className="ml-1 text-[10px] uppercase opacity-60">{s.goal}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="order-1 space-y-3 lg:order-2">
        <div className="flex h-7 items-center gap-2 text-sm">
          <span className={status.cls}>{status.text}</span>
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
          {analysis.score && phase === 'playing' && (
            <p className="mt-2 font-mono text-xs text-neutral-500">eval {formatScore(analysis.score)} · depth {analysis.depth}</p>
          )}
        </div>
      </div>
    </div>
  );
}
