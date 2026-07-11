import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Chess } from 'chess.js';
import { Board } from '../board/Board';
import { engine } from '../lib/engine';
import { whiteWinPercent } from '../lib/format';
import { useMistakes } from '../store/mistakes';
import { playMoveSound } from '../lib/sound';
import { useTimeoutRef } from '../lib/useTimeoutRef';
import type { Color } from '../store/game';

type Phase = 'solving' | 'checking' | 'good' | 'bad';

export function MistakesMode() {
  const { t } = useTranslation('tactics');
  const cards = useMistakes((s) => s.cards);
  const remove = useMistakes((s) => s.remove);
  const game = useRef(new Chess());
  const busy = useRef(false);
  const resetTimer = useTimeoutRef();
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('solving');
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [feedback, setFeedback] = useState('');

  const card = cards[idx];

  useEffect(() => {
    if (idx > 0 && idx >= cards.length) setIdx(0);
  }, [cards.length, idx]);

  useEffect(() => {
    if (!card) return;
    // A pending "try another" reset belongs to the previous card — drop it so
    // it can't fire into this one and put the old position back on the board.
    if (resetTimer.current) clearTimeout(resetTimer.current);
    game.current = new Chess(card.fen);
    busy.current = false;
    setPhase('solving');
    setFen(card.fen);
    setLastMove(undefined);
    setFeedback(t('mistakes.prompt', { san: card.playedSan }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id]);

  const solving = phase === 'solving' && !!card && !busy.current;

  const dests = useMemo(() => {
    const map = new Map<string, string[]>();
    if (solving) {
      for (const m of game.current.moves({ verbose: true })) {
        const arr = map.get(m.from) ?? [];
        arr.push(m.to);
        map.set(m.from, arr);
      }
    }
    return map;
  }, [fen, solving]);

  const onMove = async (from: string, to: string) => {
    if (!solving || !card) return;
    busy.current = true;
    let mv;
    try {
      mv = game.current.move({ from, to, promotion: 'q' });
    } catch {
      busy.current = false;
      return;
    }
    playMoveSound(mv.san);
    const hist = game.current.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.current.fen());
    setLastMove(last ? [last.from, last.to] : undefined);
    // Checkmate needs no engine check — and terminal positions get no eval
    // (which used to read as 50/50 and reject a mating answer as "still drops").
    if (game.current.isCheckmate()) {
      setPhase('good');
      setFeedback(t('mistakes.checkmate', { san: mv.san, played: card.playedSan }));
      busy.current = false;
      return;
    }
    setPhase('checking');
    setFeedback(t('mistakes.checking'));

    const score = await engine.evalOnce(game.current.fen(), { movetimeMs: 350 });
    const moverWin = card.side === 'white' ? whiteWinPercent(score) : 100 - whiteWinPercent(score);
    const loss = card.expected - moverWin;
    if (loss <= 8) {
      setPhase('good');
      setFeedback(t('mistakes.holdsUp', { san: mv.san, played: card.playedSan }));
      busy.current = false;
    } else {
      setPhase('bad');
      setFeedback(t('mistakes.stillDrops', { san: mv.san, loss: Math.round(loss) }));
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        resetTimer.current = null;
        game.current = new Chess(card.fen);
        setFen(card.fen);
        setLastMove(undefined);
        setPhase('solving');
        busy.current = false;
      }, 1200);
    }
  };

  const next = () => setIdx((i) => (cards.length ? (i + 1) % cards.length : 0));
  const learned = () => {
    if (!card) return;
    const wasLast = idx >= cards.length - 1;
    remove(card.id);
    if (wasLast) setIdx(0);
  };

  if (!card) {
    return (
      <div className="mx-auto max-w-md rounded-2xl bg-panel shadow-soft p-4 text-sm text-neutral-400">
        <Trans t={t} i18nKey="mistakes.empty" components={{ b: <b className="text-neutral-300" /> }} />
      </div>
    );
  }

  const orientation: Color = card.side;

  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-3">
        <div className="flex h-7 items-center gap-2 text-sm">
          <span
            className={`rounded px-2 py-0.5 text-xs ${card.severity === 'blunder' ? 'bg-rose-900/60 text-rose-300' : 'bg-orange-900/50 text-orange-300'}`}
          >
            {t(`mistakes.severity.${card.severity}`)}
          </span>
          <span className="text-neutral-400">{t(`mistakes.toMove.${card.side}`)}</span>
        </div>
        <div className="mx-auto w-full max-w-[520px]">
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={game.current.turn() === 'w' ? 'white' : 'black'}
            movableColor={solving ? card.side : undefined}
            dests={dests}
            lastMove={lastMove}
            inCheck={game.current.inCheck()}
            onMove={onMove}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl bg-panel shadow-soft p-3">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-semibold text-ink">{t('mistakes.title')}</span>
            <span className="text-xs text-neutral-400">{idx + 1}/{cards.length}</span>
          </div>
          <p
            className={`text-sm ${phase === 'good' ? 'text-emerald-300' : phase === 'bad' ? 'text-rose-300' : 'text-neutral-300'}`}
          >
            {feedback}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {phase === 'good' && (
              <button onClick={learned} className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800">
                {t('mistakes.gotIt')}
              </button>
            )}
            <button onClick={next} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
              {t('mistakes.skip')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
