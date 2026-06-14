import { useState } from 'react';
import { useGame } from '../store/game';

export function PgnDialog({ onClose }: { onClose: () => void }) {
  const loadPgn = useGame((s) => s.loadPgn);
  const [pgn, setPgn] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (loadPgn(pgn.trim())) onClose();
    else setError('Could not read that PGN — check the moves and try again.');
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-panel p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 text-sm font-semibold text-ink">Import PGN for review</h3>
        <p className="mb-2 text-xs text-neutral-400">
          Paste a game; it loads on the analysis board where you can step through it with the engine.
        </p>
        <textarea
          value={pgn}
          onChange={(e) => {
            setPgn(e.target.value);
            setError(null);
          }}
          rows={8}
          placeholder={'[Event "..."]\n\n1. e4 e5 2. Nf3 Nc6 ...'}
          className="w-full rounded bg-neutral-900 p-2 font-mono text-xs text-ink outline-none focus:ring-1 focus:ring-emerald-500"
        />
        {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
            Cancel
          </button>
          <button
            onClick={load}
            disabled={!pgn.trim()}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Load game
          </button>
        </div>
      </div>
    </div>
  );
}
