import { useState } from 'react';
import { useGame } from '../store/game';
import { toPgn } from '../lib/pgn';
import { PgnDialog } from './PgnDialog';
import { SaveLineDialog } from './SaveLineDialog';

function botLabel(style: string, elo?: number, maia?: number): string {
  if (style === 'human') return `Maia ${maia ?? ''}`.trim();
  const s = style.charAt(0).toUpperCase() + style.slice(1);
  return `Stockfish ${s}${elo ? ` (${elo >= 3190 ? 'max' : elo})` : ''}`;
}

export function Controls() {
  const { history, viewPly, mode, playerColor, botConfig, stepView, goToPly, flip, takeback, newGame } = useGame();
  const [copied, setCopied] = useState(false);
  const [pgnOpen, setPgnOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const copyPgn = async () => {
    const opp = botLabel(botConfig.style, botConfig.elo, botConfig.maiaRating);
    const white = mode === 'play' ? (playerColor === 'white' ? 'You' : opp) : 'White';
    const black = mode === 'play' ? (playerColor === 'black' ? 'You' : opp) : 'Black';
    const pgn = toPgn(
      history.map((h) => h.san),
      { white, black, result: '*' },
    );
    try {
      await navigator.clipboard.writeText(pgn);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };

  const btn = 'rounded bg-neutral-700 px-2.5 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600 disabled:opacity-40';
  const atStart = viewPly === 0;
  const atEnd = viewPly === history.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button className={btn} onClick={() => goToPly(0)} disabled={atStart} title="First">
        ⏮
      </button>
      <button className={btn} onClick={() => stepView(-1)} disabled={atStart} title="Previous">
        ◀
      </button>
      <button className={btn} onClick={() => stepView(1)} disabled={atEnd} title="Next">
        ▶
      </button>
      <button className={btn} onClick={() => goToPly(history.length)} disabled={atEnd} title="Last">
        ⏭
      </button>
      <div className="mx-1 h-5 w-px bg-neutral-700" />
      <button className={btn} onClick={flip} title="Flip board">
        ⇅ Flip
      </button>
      <button className={btn} onClick={takeback} disabled={history.length === 0} title="Take back">
        ↶ Takeback
      </button>
      <button className={btn} onClick={() => newGame({ mode: 'analysis' })} title="Analysis board">
        Analyse
      </button>
      <button className={btn} onClick={copyPgn} disabled={history.length === 0} title="Copy PGN">
        {copied ? '✓ Copied' : 'PGN'}
      </button>
      <button className={btn} onClick={() => setPgnOpen(true)} title="Import a PGN to review">
        Import
      </button>
      <button className={btn} onClick={() => setSaveOpen(true)} disabled={mode !== 'analysis' || viewPly === 0} title="Save this line to a repertoire">
        ★ Save line
      </button>
      {pgnOpen && <PgnDialog onClose={() => setPgnOpen(false)} />}
      {saveOpen && <SaveLineDialog onClose={() => setSaveOpen(false)} />}
    </div>
  );
}
