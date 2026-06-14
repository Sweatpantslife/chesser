import { useEffect, useState } from 'react';
import { useGame } from '../store/game';
import { BotAvatar } from './BotAvatar';

const btn = 'rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40';
const neutralBtn = `${btn} bg-neutral-700 text-neutral-200 hover:bg-neutral-600`;

/**
 * The in-game action bar for vs-bot games: an opponent chip, resign / offer-draw
 * / claim-draw while the game is live, and a result banner with rematch / switch
 * colours once it's over.
 */
export function GameActions() {
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
    <div className="rounded-lg bg-panel p-3">
      {/* opponent chip */}
      <div className="mb-3 flex items-center gap-2.5">
        <BotAvatar name={opponent.name} accent={opponent.accent} motif={opponent.motif} size={40} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">
            {opponent.name}
            {opponent.rating != null && <span className="ml-1 font-normal text-neutral-400">· {opponent.rating}</span>}
          </div>
          <div className="text-xs text-neutral-500">
            You play <span className="capitalize text-neutral-300">{playerColor}</span>
            {thinking && <span className="ml-1 animate-pulse text-emerald-400">· thinking…</span>}
          </div>
        </div>
      </div>

      {!isGameOver ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {!confirmResign ? (
              <button className={neutralBtn} onClick={() => setConfirmResign(true)}>
                🏳 Resign
              </button>
            ) : (
              <>
                <button className={`${btn} bg-rose-600 text-white hover:bg-rose-500`} onClick={resign}>
                  Confirm resign
                </button>
                <button className={neutralBtn} onClick={() => setConfirmResign(false)}>
                  Cancel
                </button>
              </>
            )}
            <button
              className={neutralBtn}
              onClick={offerDraw}
              disabled={historyLen < 2 || thinking || !atLive || drawOffer === 'pending'}
              title="Offer the bot a draw"
            >
              ½ Offer draw
            </button>
            <button
              className={neutralBtn}
              onClick={claimDraw}
              disabled={!drawClaimable}
              title={drawClaimable ? 'Claim the draw' : 'Available on threefold repetition or the 50-move rule'}
            >
              Claim draw
            </button>
          </div>
          {drawOffer === 'pending' && <p className="text-xs text-neutral-400">Offering a draw…</p>}
          {drawOffer === 'declined' && <p className="text-xs text-amber-300">The bot declines the draw.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <div
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              youWon ? 'bg-emerald-900/50 text-emerald-300' : youLost ? 'bg-rose-900/50 text-rose-300' : 'bg-neutral-700/60 text-neutral-200'
            }`}
          >
            {youWon ? 'You won! 🎉' : youLost ? 'You lost.' : drew ? 'Draw.' : 'Game over.'}
            {endReason && <span className="ml-1 font-normal opacity-80">· {endReason}</span>}
          </div>
          {beatLadderBot && (
            <p className="text-xs text-emerald-400">✓ Ladder rung cleared — the next opponent is unlocked.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`} onClick={rematch}>
              ↻ Rematch
            </button>
            <button className={neutralBtn} onClick={switchColors}>
              ⇄ Switch colours
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
