/**
 * Pass-and-play: two people alternate on one device. Unrated by design — the
 * result is logged as a casual game and never touches the bot ratings.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { useTranslation } from 'react-i18next';
import { Board } from '../board/Board';
import { playMoveSound } from '../lib/sound';
import type { Color, TimeControl } from '../store/game';
import { boardEnd, buildPgn, colorOfFen, destsOf, hasMatingMaterial, needsPromotion, opposite } from './chessUtil';
import { Promotion } from './Promotion';
import {
  CopyPgnButton,
  HumanMoveList,
  PlayerBar,
  ResultBanner,
  btn,
  colorName,
  dangerBtn,
  neutralBtn,
  primaryBtn,
  reasonText,
  useReplay,
} from './bits';
import { recordCasualGame } from './casualHistory';

export interface LocalGameConfig {
  white: string;
  black: string;
  timeControl: TimeControl | null;
  autoFlip: boolean;
}

interface ManualResult {
  winner: Color | 'draw';
  reason: string;
}

export function LocalGame({ config, onExit }: { config: LocalGameConfig; onExit: () => void }) {
  const { t } = useTranslation('friends');
  const chessRef = useRef<Chess>(new Chess());
  const [fen, setFen] = useState(() => chessRef.current.fen());
  const [sans, setSans] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<[string, string] | undefined>(undefined);
  const [manual, setManual] = useState<ManualResult | null>(null);
  const [clock, setClock] = useState(() =>
    config.timeControl ? { whiteMs: config.timeControl.initialMs, blackMs: config.timeControl.initialMs } : null,
  );
  const [pendingPromo, setPendingPromo] = useState<{ from: string; to: string } | null>(null);
  const [drawOfferBy, setDrawOfferBy] = useState<Color | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [manualOrientation, setManualOrientation] = useState<Color>('white');

  const turn = colorOfFen(fen);
  const end = boardEnd(fen);
  /**
   * Claimable draws come from the *history-carrying* instance: threefold
   * repetition is invisible to a Chess built from a bare FEN.
   */
  const claimable = useMemo(() => {
    if (chessRef.current.isThreefoldRepetition()) return 'threefold repetition';
    if (Number(fen.split(' ')[4] ?? '0') >= 100) return 'fifty-move rule';
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);
  /** Flag is derived: a clock at zero ends the game for that side. */
  const flagged: Color | null = clock ? (clock.whiteMs <= 0 ? 'white' : clock.blackMs <= 0 ? 'black' : null) : null;
  const result: ManualResult | null =
    manual ??
    (flagged
      ? hasMatingMaterial(fen, opposite(flagged))
        ? { winner: opposite(flagged), reason: 'on time' }
        : { winner: 'draw', reason: 'timeout vs insufficient material' }
      : end.over
        ? { winner: end.winner!, reason: end.reason }
        : null);
  const over = result !== null;
  const nameOf = (c: Color) => (c === 'white' ? config.white : config.black);
  const orientation: Color = config.autoFlip && !over ? turn : manualOrientation;
  const topSide = opposite(orientation);

  // Click-to-navigate replay; the live game keeps running underneath.
  const replay = useReplay(sans);
  const viewing = replay.view !== null;
  const shownFen = replay.view?.fen ?? fen;
  const shownLast = replay.view ? replay.view.lastMove : lastMove;
  const shownCheck = viewing ? boardEnd(shownFen).check : end.check;

  // Real-time clock: charge the side to move; flag at zero.
  useEffect(() => {
    if (!clock || over) return;
    let last = performance.now();
    const iv = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      setClock((c) => {
        if (!c) return c;
        const key = turn === 'white' ? 'whiteMs' : 'blackMs';
        return { ...c, [key]: Math.max(0, c[key] - dt) };
      });
    }, 100);
    return () => window.clearInterval(iv);
  }, [clock !== null, over, turn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Log the finished game exactly once, as casual (never into bot ratings).
  const loggedRef = useRef(false);
  useEffect(() => {
    if (!result || loggedRef.current) return;
    loggedRef.current = true;
    recordCasualGame({
      at: Date.now(),
      mode: 'local',
      winner: result.winner,
      reason: result.reason,
      moves: Math.ceil(sans.length / 2),
      white: config.white,
      black: config.black,
    });
  }, [result, sans.length, config.white, config.black]);

  const apply = (from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n') => {
    const c = chessRef.current;
    let mv;
    try {
      mv = c.move({ from, to, promotion });
    } catch {
      setFen(c.fen()); // snap the board back
      return;
    }
    if (!mv) return;
    playMoveSound(mv.san);
    if (clock && config.timeControl) {
      const key = turn === 'white' ? 'whiteMs' : 'blackMs';
      setClock((cl) => (cl ? { ...cl, [key]: cl[key] + config.timeControl!.incrementMs } : cl));
    }
    setFen(mv.after);
    setSans((s) => [...s, mv.san]);
    setLastMove([mv.from, mv.to]);
    setDrawOfferBy(null);
    setConfirmResign(false);
  };

  const onMove = (from: string, to: string) => {
    if (over) return;
    if (needsPromotion(fen, from, to)) {
      setPendingPromo({ from, to });
      return;
    }
    apply(from, to);
  };

  const claimDraw = () => {
    if (!claimable || over) return;
    setManual({ winner: 'draw', reason: claimable });
  };

  const rematch = () => {
    chessRef.current = new Chess();
    loggedRef.current = false;
    setFen(chessRef.current.fen());
    setSans([]);
    setLastMove(undefined);
    setManual(null);
    setClock(config.timeControl ? { whiteMs: config.timeControl.initialMs, blackMs: config.timeControl.initialMs } : null);
    setPendingPromo(null);
    setDrawOfferBy(null);
    setConfirmResign(false);
  };

  // Reasons are canonical English identifiers; `reasonText` localizes known
  // ones at display time (English output is byte-identical to the raw value).
  const status = over
    ? result.winner === 'draw'
      ? t('status.drawReason', { reason: reasonText(t, result.reason) })
      : t('status.winsReason', { player: colorName(t, result.winner), reason: reasonText(t, result.reason) })
    : `${t(end.check ? 'status.toMoveCheck' : 'status.toMove', { player: colorName(t, turn) })}${
        claimable ? ` · ${t('status.drawClaimable', { reason: reasonText(t, claimable) })}` : ''
      }`;

  return (
    <div className="mx-auto grid w-full max-w-[1000px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <div className="flex h-7 items-center gap-2 text-sm">
          <span data-testid="human-status" className={over ? 'font-semibold text-amber-300' : 'text-neutral-300'}>
            {status}
          </span>
          <span className="text-neutral-400">{t('local.tag')}</span>
        </div>
        <div className="mx-auto w-full max-w-[560px] space-y-2">
          <PlayerBar
            side={topSide}
            name={nameOf(topSide)}
            active={turn === topSide && !over}
            clockMs={clock ? (topSide === 'white' ? clock.whiteMs : clock.blackMs) : null}
            flagged={flagged === topSide}
          />
          <div className="relative">
            <Board
              fen={shownFen}
              orientation={orientation}
              turnColor={colorOfFen(shownFen)}
              movableColor={over || viewing ? undefined : turn}
              dests={over || viewing ? new Map() : destsOf(fen)}
              lastMove={shownLast}
              inCheck={shownCheck}
              onMove={onMove}
            />
            {pendingPromo && (
              <Promotion
                color={turn}
                onPick={(p) => {
                  const pp = pendingPromo;
                  setPendingPromo(null);
                  apply(pp.from, pp.to, p);
                }}
                onCancel={() => {
                  setPendingPromo(null);
                  setFen(chessRef.current.fen()); // snap back
                }}
              />
            )}
          </div>
          <PlayerBar
            side={orientation}
            name={nameOf(orientation)}
            active={turn === orientation && !over}
            clockMs={clock ? (orientation === 'white' ? clock.whiteMs : clock.blackMs) : null}
            flagged={flagged === orientation}
          />
        </div>

        <div className="rounded-2xl bg-panel shadow-soft p-3">
          {!over ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {!confirmResign ? (
                  <button className={neutralBtn} onClick={() => setConfirmResign(true)} data-testid="resign">
                    {t('actions.resignAs', { player: colorName(t, turn) })}
                  </button>
                ) : (
                  <>
                    <button
                      className={dangerBtn}
                      data-testid="confirm-resign"
                      onClick={() => setManual({ winner: opposite(turn), reason: t('reasons.playerResigned', { name: nameOf(turn) }) })}
                    >
                      {t('actions.confirmResign')}
                    </button>
                    <button className={neutralBtn} onClick={() => setConfirmResign(false)}>
                      {t('common:actions.cancel')}
                    </button>
                  </>
                )}
                <button
                  className={neutralBtn}
                  onClick={() => setDrawOfferBy(turn)}
                  disabled={drawOfferBy !== null || sans.length < 2}
                  data-testid="offer-draw"
                >
                  {t('actions.offerDraw')}
                </button>
                <button
                  className={neutralBtn}
                  onClick={claimDraw}
                  disabled={!claimable}
                  title={claimable ? t('actions.claimDrawTitle') : t('actions.claimDrawUnavailable')}
                >
                  {t('actions.claimDraw')}
                </button>
                {!config.autoFlip && (
                  <button className={neutralBtn} onClick={() => setManualOrientation(opposite(manualOrientation))}>
                    {t('actions.flipBoard')}
                  </button>
                )}
              </div>
              {drawOfferBy && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-300" data-testid="draw-prompt">
                  <span>{t('draw.promptLocal', { to: nameOf(opposite(drawOfferBy)), from: nameOf(drawOfferBy) })}</span>
                  <button className={primaryBtn} onClick={() => setManual({ winner: 'draw', reason: 'agreement' })}>
                    {t('actions.accept')}
                  </button>
                  <button className={neutralBtn} onClick={() => setDrawOfferBy(null)}>
                    {t('actions.decline')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <ResultBanner winner={result.winner} reason={result.reason} />
              <div className="flex flex-wrap gap-1.5">
                <button className={primaryBtn} onClick={rematch} data-testid="rematch">
                  {t('actions.rematch')}
                </button>
                <button className={neutralBtn} onClick={onExit}>
                  {t('actions.back')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <HumanMoveList sans={sans} replay={replay} />
        {sans.length > 0 && (
          <CopyPgnButton
            pgn={buildPgn({ sans, white: config.white, black: config.black, result: result?.winner ?? null, event: 'Casual pass & play' })}
          />
        )}
        <button className={`${btn} w-full bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-300`} onClick={onExit}>
          {t('actions.leave')}
        </button>
      </div>
    </div>
  );
}
