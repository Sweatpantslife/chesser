import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useGame } from '../store/game';
import { translateEndReason } from '../lib/gameStatusText';
import { BotAvatar } from './BotAvatar';

const btn = 'btn-press rounded-full px-3 py-1.5 text-sm font-semibold disabled:opacity-50';
const neutralBtn = `${btn} bg-neutral-700 text-neutral-200 hover:bg-neutral-600`;

/**
 * The in-game action bar for vs-bot games: an opponent chip, resign / offer-draw
 * / claim-draw while the game is live, and a result banner with rematch / switch
 * colours once it's over.
 */
export function GameActions() {
  const { t } = useTranslation('game');
  const mode = useGame((s) => s.mode);
  const opponent = useGame((s) => s.opponent);
  const playerColor = useGame((s) => s.playerColor);
  const isGameOver = useGame((s) => s.isGameOver);
  const winner = useGame((s) => s.winner);
  const endReason = useGame((s) => s.endReason);
  const drawClaimable = useGame((s) => s.drawClaimable);
  const drawOffer = useGame((s) => s.drawOffer);
  const thinking = useGame((s) => s.thinking);
  const viewPly = useGame((s) => s.viewPly);
  const historyLen = useGame((s) => s.history.length);
  const gameNo = useGame((s) => s.gameNo);

  const resign = useGame((s) => s.resign);
  const offerDraw = useGame((s) => s.offerDraw);
  const claimDraw = useGame((s) => s.claimDraw);
  const rematch = useGame((s) => s.rematch);
  const switchColors = useGame((s) => s.switchColors);
  const analyzeFinishedGame = useGame((s) => s.analyzeFinishedGame);
  const reopenSummary = useGame((s) => s.reopenSummary);
  const hasSummary = useGame((s) => s.gameSummary?.gameNo === s.gameNo);

  const [confirmResign, setConfirmResign] = useState(false);
  // Reset the resign confirmation whenever a new game starts.
  useEffect(() => setConfirmResign(false), [gameNo]);

  if (mode !== 'play' || !opponent || !playerColor) return null;

  const atLive = viewPly === historyLen;
  const youWon = winner !== null && winner !== 'draw' && winner === playerColor;
  const youLost = winner !== null && winner !== 'draw' && winner !== playerColor;
  const drew = winner === 'draw';
  const beatLadderBot = youWon && !!opponent.id;

  return (
    <div className="rounded-2xl bg-panel p-3 shadow-soft">
      {/* opponent chip */}
      <div className="mb-3 flex items-center gap-2.5">
        <BotAvatar name={opponent.name} accent={opponent.accent} motif={opponent.motif} size={40} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">
            {opponent.name}
            {opponent.rating != null && <span className="ml-1 font-normal text-neutral-400">· {opponent.rating}</span>}
          </div>
          <div className="text-xs text-neutral-400">
            <Trans
              t={t}
              i18nKey="actions.youPlay"
              values={{ color: t(`colors.${playerColor}`) }}
              components={{ color: <span className="capitalize text-neutral-300" /> }}
            />
            {thinking && <span className="ml-1 animate-pulse-soft text-emerald-400">· {t('actions.thinking')}</span>}
          </div>
        </div>
      </div>

      {!isGameOver ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {!confirmResign ? (
              <button className={neutralBtn} onClick={() => setConfirmResign(true)}>
                🏳 {t('actions.resign')}
              </button>
            ) : (
              <>
                <button className={`${btn} bg-rose-600 text-white hover:bg-rose-500`} onClick={resign}>
                  {t('actions.confirmResign')}
                </button>
                <button className={neutralBtn} onClick={() => setConfirmResign(false)}>
                  {t('common:actions.cancel')}
                </button>
              </>
            )}
            <button
              className={neutralBtn}
              onClick={offerDraw}
              disabled={historyLen < 2 || thinking || !atLive || drawOffer === 'pending'}
              title={t('actions.offerDrawTitle')}
            >
              ½ {t('actions.offerDraw')}
            </button>
            <button
              className={neutralBtn}
              onClick={claimDraw}
              disabled={!drawClaimable}
              title={drawClaimable ? t('actions.claimDrawTitle') : t('actions.claimDrawUnavailable')}
            >
              {t('actions.claimDraw')}
            </button>
          </div>
          {drawOffer === 'pending' && <p className="text-xs text-neutral-400">{t('actions.offeringDraw')}</p>}
          {drawOffer === 'declined' && <p className="text-xs text-amber-300">{t('actions.drawDeclined')}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <div
            className={`pop-in rounded-xl px-3 py-2 text-sm font-semibold ${
              youWon ? 'bg-emerald-900/50 text-emerald-300' : youLost ? 'bg-rose-900/50 text-rose-300' : 'bg-neutral-700/60 text-neutral-200'
            }`}
          >
            {youWon ? t('actions.youWon') : youLost ? t('actions.youLost') : drew ? t('actions.draw') : t('actions.gameOver')}
            {endReason && <span className="ml-1 font-normal opacity-80">· {translateEndReason(endReason)}</span>}
          </div>
          {beatLadderBot && (
            <p className="text-xs text-emerald-400">✓ {t('actions.ladderCleared')}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {hasSummary && (
              <button className={`${btn} bg-brand-600 text-white hover:bg-brand-700`} onClick={() => void analyzeFinishedGame()}>
                🔍 {t('actions.analyzeGame')}
              </button>
            )}
            <button className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`} onClick={rematch}>
              ↻ {t('actions.rematch')}
            </button>
            <button className={neutralBtn} onClick={switchColors}>
              ⇄ {t('actions.switchColours')}
            </button>
            {hasSummary && (
              <button className={neutralBtn} onClick={reopenSummary}>
                📊 {t('actions.summary')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
