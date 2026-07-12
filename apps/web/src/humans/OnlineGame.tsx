/**
 * Friend-link online game. The server is authoritative: this component sends
 * intents (move / resign / draw) and renders whatever state comes back. The
 * seat token lives in localStorage, so refreshing the page (or a network blip)
 * rejoins the same seat and the game resumes where it was.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { FriendGameState } from '@chesser/shared';
import { Board } from '../board/Board';
import { playMoveSound } from '../lib/sound';
import type { Color } from '../store/game';
import { boardEnd, buildPgn, colorOfFen, destsOf, needsPromotion, opposite } from './chessUtil';
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
import { FALLBACK_BLACK_NAME, FALLBACK_WHITE_NAME, recordCasualGame } from './casualHistory';
import { FriendClient, type FriendIntent, type Seat } from './friendClient';

export function OnlineGame({ intent, onExit }: { intent: FriendIntent; onExit: () => void }) {
  const { t } = useTranslation('friends');
  const [seat, setSeat] = useState<Seat | null>(null);
  const [state, setState] = useState<FriendGameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{ from: string; to: string } | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [copied, setCopied] = useState(false);
  const [boardNonce, setBoardNonce] = useState(0);
  // Clock projection between server updates.
  const receivedAtRef = useRef(0);
  const [, setClockTick] = useState(0);

  const clientRef = useRef<FriendClient | null>(null);
  const prevPliesRef = useRef(0);
  const loggedRef = useRef(false);

  useEffect(() => {
    const client = new FriendClient(intent, {
      onSeat: (s) => {
        setSeat(s);
        // Make the URL shareable/refreshable: refresh rejoins this game.
        // replaceState avoids firing hashchange, which would remount us.
        history.replaceState(null, '', `#/play/friends/${s.code}`);
      },
      onState: (st) => {
        receivedAtRef.current = performance.now();
        if (st.sans.length > prevPliesRef.current && st.sans.length > 0) {
          playMoveSound(st.sans[st.sans.length - 1]!);
        }
        prevPliesRef.current = st.sans.length;
        setState(st);
        setError(null);
      },
      onError: (message) => {
        // "Game not found" before any state means the room is gone — dead end.
        setError(message);
        if (/not found/i.test(message)) setFatal(message);
        setBoardNonce((n) => n + 1);
      },
      onConnection: setConnected,
    });
    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smooth clock countdown between server states.
  const active = state?.status === 'active' && !!state.clock;
  useEffect(() => {
    if (!active) return;
    const iv = window.setInterval(() => setClockTick((t) => t + 1), 150);
    return () => window.clearInterval(iv);
  }, [active]);

  // Log the finished game once (casual — never touches bot ratings). The room
  // code doubles as a dedupe key so refreshing a finished game can't double-log.
  useEffect(() => {
    if (!state || state.status !== 'over' || !state.result || loggedRef.current) return;
    loggedRef.current = true;
    if (state.result.reason === 'aborted') return;
    recordCasualGame({
      at: Date.now(),
      mode: 'online',
      winner: state.result.winner,
      reason: state.result.reason,
      moves: Math.ceil(state.sans.length / 2),
      white: state.players.white?.name ?? FALLBACK_WHITE_NAME,
      black: state.players.black?.name ?? FALLBACK_BLACK_NAME,
      key: state.code,
    });
  }, [state]);

  const myColor: Color = seat?.color ?? 'white';
  const oppColor = opposite(myColor);
  const end = state ? boardEnd(state.fen) : null;
  const over = state?.status === 'over';
  const myTurn = !!state && state.status === 'active' && state.turn === myColor;

  // Click-to-navigate replay of the live game.
  const replay = useReplay(state?.sans ?? []);
  const viewing = replay.view !== null;
  const dests = useMemo(
    () => (state && myTurn && !viewing ? destsOf(state.fen) : new Map<string, string[]>()),
    [state, myTurn, viewing],
  );

  /** Clock projected to now (only the running side counts down). */
  const clockOf = (side: Color): number | null => {
    if (!state?.clock) return null;
    const base = side === 'white' ? state.clock.whiteMs : state.clock.blackMs;
    if (state.status !== 'active' || state.turn !== side) return base;
    return Math.max(0, base - (performance.now() - receivedAtRef.current));
  };

  const onMove = (from: string, to: string) => {
    if (!state || !myTurn) return;
    if (needsPromotion(state.fen, from, to)) {
      setPendingPromo({ from, to });
      return;
    }
    clientRef.current?.move(from + to);
  };

  const leave = () => {
    // Drop the game code from the URL (both the canonical and legacy forms),
    // staying on the Friends section.
    const h = window.location.hash;
    if (/^#\/(play\/friends|friend)\//.test(h)) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/play/friends`);
    }
    onExit();
  };

  const shareLink = seat ? `${location.origin}${location.pathname}#/play/friends/${seat.code}` : '';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the link is shown as text anyway */
    }
  };

  if (fatal) {
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-2xl bg-panel shadow-soft p-4">
        <p className="text-sm text-rose-300" data-testid="online-error">
          {fatal}
        </p>
        <button className={neutralBtn} onClick={leave}>
          {t('actions.back')}
        </button>
      </div>
    );
  }

  if (!state || !seat) {
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-2xl bg-panel shadow-soft p-4">
        <p className="animate-pulse-soft text-sm text-neutral-400">{connected ? t('connect.settingUp') : t('connect.connecting')}</p>
        {error && <p className="text-sm text-rose-300">{error}</p>}
        <button className={neutralBtn} onClick={leave}>
          {t('actions.back')}
        </button>
      </div>
    );
  }

  const me = state.players[myColor];
  const opp = state.players[oppColor];
  // Reasons arrive as canonical English identifiers from the server;
  // `reasonText` localizes known ones at display time (English is byte-identical).
  const status = over
    ? state.result!.winner === 'draw'
      ? t('status.drawReason', { reason: reasonText(t, state.result!.reason) })
      : t('status.winsReason', { player: colorName(t, state.result!.winner), reason: reasonText(t, state.result!.reason) })
    : state.status === 'waiting'
      ? t('status.waitingFriend')
      : t(end?.check ? 'status.toMoveCheck' : 'status.toMove', { player: colorName(t, state.turn) });

  return (
    <div className="mx-auto grid w-full max-w-[1000px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <div className="flex h-7 flex-wrap items-center gap-2 text-sm">
          <span data-testid="online-status" className={over ? 'font-semibold text-amber-300' : 'text-neutral-300'}>
            {status}
          </span>
          <span className="text-neutral-400">
            <Trans
              t={t}
              i18nKey="status.onlineTag"
              values={{ code: state.code }}
              components={{ code: <span className="font-mono text-neutral-300" data-testid="game-code" /> }}
            />
          </span>
          {!connected && <span className="animate-pulse-soft text-rose-400">{t('status.reconnecting')}</span>}
        </div>

        {state.status === 'waiting' && (
          <div className="space-y-2 rounded-2xl bg-panel shadow-soft p-3" data-testid="invite-box">
            <p className="text-sm text-neutral-300">{t('invite.lead')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-full overflow-x-auto rounded bg-panelmute px-2 py-1 text-xs text-emerald-300" data-testid="invite-link">
                {shareLink}
              </code>
              <button className={primaryBtn} onClick={() => void copyLink()}>
                {copied ? t('invite.copied') : t('invite.copyLink')}
              </button>
            </div>
            <p className="text-xs text-neutral-400">
              <Trans
                t={t}
                i18nKey="invite.codeHint"
                values={{ code: state.code }}
                components={{ code: <span className="font-mono text-neutral-300" /> }}
              />
            </p>
          </div>
        )}

        <div className="mx-auto w-full max-w-[560px] space-y-2">
          <PlayerBar
            side={oppColor}
            name={opp?.name ?? t('players.waiting')}
            active={!over && state.status === 'active' && state.turn === oppColor}
            connected={opp ? opp.connected : undefined}
            clockMs={clockOf(oppColor)}
            flagged={over && state.result?.reason === 'on time' && state.result.winner === myColor}
          />
          <div className="relative">
            <Board
              // Remounting on status changes refreshes chessground's cached
              // bounds after the layout shift when the invite box goes away
              // (stale bounds make clicks land on the wrong squares); the
              // nonce remount snaps back moves the server rejected.
              key={`${state.status}-${boardNonce}`}
              fen={replay.view?.fen ?? state.fen}
              orientation={myColor}
              turnColor={replay.view ? colorOfFen(replay.view.fen) : state.turn}
              movableColor={myTurn && !viewing ? myColor : undefined}
              dests={dests}
              lastMove={
                replay.view
                  ? replay.view.lastMove
                  : state.moves.length > 0
                    ? [state.moves[state.moves.length - 1]!.slice(0, 2), state.moves[state.moves.length - 1]!.slice(2, 4)]
                    : undefined
              }
              inCheck={viewing ? boardEnd(replay.view!.fen).check : !!end?.check}
              onMove={onMove}
            />
            {pendingPromo && (
              <Promotion
                color={myColor}
                onPick={(p) => {
                  const pp = pendingPromo;
                  setPendingPromo(null);
                  clientRef.current?.move(pp.from + pp.to + p);
                }}
                onCancel={() => {
                  setPendingPromo(null);
                  setBoardNonce((n) => n + 1); // snap back
                }}
              />
            )}
          </div>
          <PlayerBar
            side={myColor}
            name={me ? t('players.named', { name: me.name }) : t('players.you')}
            active={!over && state.status === 'active' && state.turn === myColor}
            connected={me ? me.connected : undefined}
            clockMs={clockOf(myColor)}
            flagged={over && state.result?.reason === 'on time' && state.result.winner === oppColor}
          />
        </div>

        {state.status === 'active' && opp && !opp.connected && (
          <p className="text-sm text-amber-300" data-testid="opp-disconnected">
            {t('status.oppDisconnected')}
          </p>
        )}
        {error && (
          <p className="text-sm text-rose-300" data-testid="online-error">
            {error}
          </p>
        )}

        <div className="rounded-2xl bg-panel shadow-soft p-3">
          {!over ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {state.status === 'waiting' || state.sans.length < 2 ? (
                  // Standard no-fault escape hatch before the game really starts.
                  <button className={neutralBtn} onClick={() => clientRef.current?.abort()} data-testid="abort">
                    {t('actions.abort')}
                  </button>
                ) : !confirmResign ? (
                  <button className={neutralBtn} onClick={() => setConfirmResign(true)} data-testid="resign">
                    {t('actions.resign')}
                  </button>
                ) : (
                  <>
                    <button
                      className={dangerBtn}
                      data-testid="confirm-resign"
                      onClick={() => {
                        setConfirmResign(false);
                        clientRef.current?.resign();
                      }}
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
                  onClick={() => clientRef.current?.offerDraw()}
                  disabled={state.status !== 'active' || state.drawOffer !== null || state.sans.length < 2}
                  data-testid="offer-draw"
                >
                  {t('actions.offerDraw')}
                </button>
              </div>
              {state.drawOffer === myColor && <p className="text-xs text-neutral-400">{t('draw.offeredWaiting')}</p>}
              {state.drawOffer === oppColor && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-300" data-testid="draw-prompt">
                  <span>{t('draw.promptOnline', { name: opp?.name ?? t('players.opponent') })}</span>
                  <button className={primaryBtn} onClick={() => clientRef.current?.respondDraw(true)} data-testid="accept-draw">
                    {t('actions.accept')}
                  </button>
                  <button className={neutralBtn} onClick={() => clientRef.current?.respondDraw(false)}>
                    {t('actions.decline')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <ResultBanner winner={state.result!.winner} reason={state.result!.reason} />
              {state.result!.reason !== 'aborted' && (
                <p className="text-sm text-neutral-400" data-testid="online-outcome">
                  {state.result!.winner === 'draw' ? t('outcome.drew') : state.result!.winner === myColor ? t('outcome.won') : t('outcome.lost')}
                </p>
              )}
              <button className={neutralBtn} onClick={leave}>
                {t('actions.back')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <HumanMoveList sans={state.sans} replay={replay} />
        {state.sans.length > 0 && (
          <CopyPgnButton
            pgn={buildPgn({
              sans: state.sans,
              white: state.players.white?.name ?? 'White',
              black: state.players.black?.name ?? 'Black',
              result: state.result?.reason === 'aborted' ? null : (state.result?.winner ?? null),
              event: 'Casual friend game',
            })}
          />
        )}
        <button className={`${btn} w-full bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-300`} onClick={leave}>
          {t('actions.leave')}
        </button>
      </div>
    </div>
  );
}
