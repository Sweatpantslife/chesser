import { createElement, useEffect } from 'react';
import { useSettings, PIECE_SETS, type BoardTheme, type PieceSet } from '../store/settings';
import { loadAllPieceSets } from '../styles/pieceSets';
import { Modal } from './Modal';

const THEMES: { id: BoardTheme; swatch: string }[] = [
  { id: 'brown', swatch: '#b58863' },
  { id: 'blue', swatch: '#8ca2ad' },
  { id: 'green', swatch: '#86a666' },
  { id: 'gray', swatch: '#9b9b9b' },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }) {
  // Track colour is a non-text state indicator: emerald-600 keeps ≥3:1 against
  // the panel bg (emerald-700 would drop to ~2.8:1), so it stays at 600.
  return (
    <label className="flex cursor-pointer items-center justify-between py-1.5 text-sm text-neutral-200">
      {label}
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-emerald-600' : 'bg-neutral-600'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

/** A king swatch rendered with the given piece set's CSS. The generated set
 *  CSS targets the chessground `piece` *element* (`.pieces-<id> piece.king.white`),
 *  so the swatch must be a real <piece> element — a class on a span never matches. */
function PieceSwatch({ set }: { set: PieceSet }) {
  return (
    <span className={`pieces-${set} block h-7 w-7`} aria-hidden="true">
      {createElement('piece', { className: 'king white piece-preview block h-full w-full' })}
    </span>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { sound, premove, arrows, boardTheme, pieceSet, ratingMeter, setSound, setPremove, setArrows, setBoardTheme, setPieceSet, setRatingMeter } =
    useSettings();

  // Load every set's CSS so the previews below render.
  useEffect(() => loadAllPieceSets(), []);

  return (
    <Modal
      onClose={onClose}
      labelledBy="settings-title"
      className="scroll-thin max-h-[85vh] w-full max-w-xs overflow-y-auto rounded-xl bg-panel p-4 shadow-2xl"
    >
        <h3 id="settings-title" className="mb-2 text-sm font-semibold text-ink">Settings</h3>
        <Toggle on={sound} onChange={setSound} label="Move sounds" />
        <Toggle on={premove} onChange={setPremove} label="Premoves (vs bot)" />
        <Toggle on={arrows} onChange={setArrows} label="Engine arrows (analysis)" />

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Headline rating</div>
          <div className="flex gap-1">
            {([
              { id: 'elo', label: 'Elo' },
              { id: 'glicko', label: 'Glicko-2' },
            ] as const).map((m) => (
              <button
                key={m.id}
                onClick={() => setRatingMeter(m.id)}
                aria-pressed={ratingMeter === m.id}
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  ratingMeter === m.id ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-neutral-400">Glicko-2 always drives difficulty &amp; pairings behind the scenes.</p>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Board theme</div>
          <div className="flex gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setBoardTheme(t.id)}
                aria-label={`${t.id} board theme`}
                aria-pressed={boardTheme === t.id}
                className={`h-8 w-8 rounded ring-2 ${boardTheme === t.id ? 'ring-emerald-400' : 'ring-transparent'}`}
                style={{ background: t.swatch }}
                title={t.id}
              />
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Pieces</div>
          <div className="grid grid-cols-3 gap-2">
            {PIECE_SETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPieceSet(p.id)}
                title={p.label}
                aria-pressed={pieceSet === p.id}
                className={`flex flex-col items-center gap-1 rounded p-1.5 ring-2 ${
                  pieceSet === p.id ? 'bg-neutral-700 ring-emerald-400' : 'ring-transparent hover:bg-neutral-800'
                }`}
              >
                <PieceSwatch set={p.id} />
                <span className="max-w-full truncate text-xs text-neutral-300">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        <button onClick={onClose} className="mt-4 w-full rounded bg-neutral-700 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
          Done
        </button>
    </Modal>
  );
}
