import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGame } from '../store/game';
import { useAuth } from '../store/auth';
import { toPgn } from '../lib/pgn';
import { deriveGameResult } from '../lib/gameResult';
import { apiSaveGame } from '../lib/api';
import { LibraryDialog } from './LibraryDialog';
import { SaveLineDialog } from './SaveLineDialog';

function botLabel(style: string, elo?: number, maia?: number): string {
  if (style === 'human') return `Maia ${maia ?? ''}`.trim();
  const s = style.charAt(0).toUpperCase() + style.slice(1);
  return `Stockfish ${s}${elo ? ` (${elo >= 3190 ? 'max' : elo})` : ''}`;
}

export function Controls() {
  const { t } = useTranslation('game');
  const { history, viewPly, mode, playerColor, botConfig, opponent, stepView, goToPly, flip, takeback, newGame } = useGame();
  const winner = useGame((s) => s.winner);
  const isGameOver = useGame((s) => s.isGameOver);
  const gameSummary = useGame((s) => s.gameSummary);
  const gameNo = useGame((s) => s.gameNo);
  const token = useAuth((s) => s.token);
  const [copied, setCopied] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedGame, setSavedGame] = useState(false);

  // Keyed on playerColor (not mode), so a finished bot game handed to the
  // analysis board still exports the real participants, not "White"/"Black".
  const names = () => {
    const opp = opponent?.name ?? botLabel(botConfig.style, botConfig.elo, botConfig.maiaRating);
    const white = playerColor ? (playerColor === 'white' ? 'You' : opp) : 'White';
    const black = playerColor ? (playerColor === 'black' ? 'You' : opp) : 'Black';
    return { white, black };
  };

  /** PGN result of the current game — '*' only when it's genuinely unfinished. */
  const gameResult = (): string => deriveGameResult({ gameSummary, gameNo, isGameOver, winner, history });

  const copyPgn = async () => {
    const { white, black } = names();
    const pgn = toPgn(history.map((h) => h.san), { white, black, result: gameResult() });
    try {
      await navigator.clipboard.writeText(pgn);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };

  const saveGame = async () => {
    if (!token) {
      setLibOpen(true);
      return;
    }
    const { white, black } = names();
    const result = gameResult();
    const pgn = toPgn(history.map((h) => h.san), { white, black, result });
    try {
      await apiSaveGame(token, { pgn, white, black, result, source: mode });
      setSavedGame(true);
      setTimeout(() => setSavedGame(false), 1400);
    } catch {
      /* ignore */
    }
  };

  // min-h/min-w give 44px touch targets on phones; desktop keeps the compact size.
  const btn =
    'btn-press min-h-11 min-w-11 rounded-full bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 sm:min-h-0 sm:min-w-0';
  const atStart = viewPly === 0;
  const atEnd = viewPly === history.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button className={btn} onClick={() => goToPly(0)} disabled={atStart} title={t('controls.first')} aria-label={t('controls.firstAria')}>
        ⏮
      </button>
      <button className={btn} onClick={() => stepView(-1)} disabled={atStart} title={t('controls.previous')} aria-label={t('controls.previousAria')}>
        ◀
      </button>
      <button className={btn} onClick={() => stepView(1)} disabled={atEnd} title={t('controls.next')} aria-label={t('controls.nextAria')}>
        ▶
      </button>
      <button className={btn} onClick={() => goToPly(history.length)} disabled={atEnd} title={t('controls.last')} aria-label={t('controls.lastAria')}>
        ⏭
      </button>
      <div className="mx-1 h-5 w-px bg-neutral-700" />
      <button className={btn} onClick={flip} title={t('controls.flipTitle')}>
        ⇅ {t('controls.flip')}
      </button>
      <button className={btn} onClick={takeback} disabled={history.length === 0} title={t('controls.takebackTitle')}>
        ↶ {t('controls.takeback')}
      </button>
      <button className={btn} onClick={() => newGame({ mode: 'analysis' })} title={t('controls.analyseTitle')}>
        {t('controls.analyse')}
      </button>
      <button className={btn} onClick={copyPgn} disabled={history.length === 0} title={t('controls.pgnTitle')}>
        {copied ? '✓' : t('controls.pgn')}
      </button>
      <button className={btn} onClick={() => setLibOpen(true)} title={t('controls.libraryTitle')}>
        {t('controls.library')}
      </button>
      <button className={btn} onClick={saveGame} disabled={history.length === 0} title={t('controls.saveTitle')}>
        {savedGame ? `✓ ${t('controls.saved')}` : t('controls.save')}
      </button>
      <button className={btn} onClick={() => setSaveOpen(true)} disabled={mode !== 'analysis' || viewPly === 0} title={t('controls.lineTitle')}>
        ★ {t('controls.line')}
      </button>
      {libOpen && <LibraryDialog onClose={() => setLibOpen(false)} />}
      {saveOpen && <SaveLineDialog onClose={() => setSaveOpen(false)} />}
    </div>
  );
}
