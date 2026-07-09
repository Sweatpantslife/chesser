import { useState } from 'react';
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
    'min-h-11 min-w-11 rounded bg-neutral-700 px-2.5 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600 disabled:opacity-50 sm:min-h-0 sm:min-w-0';
  const atStart = viewPly === 0;
  const atEnd = viewPly === history.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button className={btn} onClick={() => goToPly(0)} disabled={atStart} title="First" aria-label="First move">
        ⏮
      </button>
      <button className={btn} onClick={() => stepView(-1)} disabled={atStart} title="Previous" aria-label="Previous move">
        ◀
      </button>
      <button className={btn} onClick={() => stepView(1)} disabled={atEnd} title="Next" aria-label="Next move">
        ▶
      </button>
      <button className={btn} onClick={() => goToPly(history.length)} disabled={atEnd} title="Last" aria-label="Last move">
        ⏭
      </button>
      <div className="mx-1 h-5 w-px bg-neutral-700" />
      <button className={btn} onClick={flip} title="Flip board (f)">
        ⇅ Flip
      </button>
      <button className={btn} onClick={takeback} disabled={history.length === 0} title="Take back">
        ↶ Takeback
      </button>
      <button className={btn} onClick={() => newGame({ mode: 'analysis' })} title="Analysis board">
        Analyse
      </button>
      <button className={btn} onClick={copyPgn} disabled={history.length === 0} title="Copy PGN">
        {copied ? '✓' : 'PGN'}
      </button>
      <button className={btn} onClick={() => setLibOpen(true)} title="Open / import / FEN">
        Library
      </button>
      <button className={btn} onClick={saveGame} disabled={history.length === 0} title="Save game to your library">
        {savedGame ? '✓ Saved' : 'Save'}
      </button>
      <button className={btn} onClick={() => setSaveOpen(true)} disabled={mode !== 'analysis' || viewPly === 0} title="Save this line to a repertoire">
        ★ Line
      </button>
      {libOpen && <LibraryDialog onClose={() => setLibOpen(false)} />}
      {saveOpen && <SaveLineDialog onClose={() => setSaveOpen(false)} />}
    </div>
  );
}
