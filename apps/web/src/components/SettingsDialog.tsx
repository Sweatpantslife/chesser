import { useEffect } from 'react';
import { useSettings, PIECE_SETS, type BoardTheme, type PieceSet } from '../store/settings';
import { loadAllPieceSets } from '../styles/pieceSets';

const THEMES: { id: BoardTheme; swatch: string }[] = [
  { id: 'brown', swatch: '#b58863' },
  { id: 'blue', swatch: '#8ca2ad' },
  { id: 'green', swatch: '#86a666' },
  { id: 'gray', swatch: '#9b9b9b' },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1.5 text-sm text-neutral-200">
      {label}
      <button
        onClick={() => onChange(!on)}
        className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-emerald-600' : 'bg-neutral-600'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

/** A king swatch rendered with the given piece set's CSS. */
function PieceSwatch({ set }: { set: PieceSet }) {
  return (
    <span className={`pieces-${set} block h-7 w-7`}>
      <span className="piece king white piece-preview block h-full w-full" />
    </span>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { sound, premove, boardTheme, pieceSet, setSound, setPremove, setBoardTheme, setPieceSet } = useSettings();

  // Load every set's CSS so the previews below render.
  useEffect(() => loadAllPieceSets(), []);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="scroll-thin max-h-[85vh] w-full max-w-xs overflow-y-auto rounded-xl bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-sm font-semibold text-ink">Settings</h3>
        <Toggle on={sound} onChange={setSound} label="Move sounds" />
        <Toggle on={premove} onChange={setPremove} label="Premoves (vs bot)" />

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Board theme</div>
          <div className="flex gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setBoardTheme(t.id)}
                className={`h-8 w-8 rounded ring-2 ${boardTheme === t.id ? 'ring-emerald-400' : 'ring-transparent'}`}
                style={{ background: t.swatch }}
                title={t.id}
              />
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Pieces</div>
          <div className="grid grid-cols-3 gap-2">
            {PIECE_SETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPieceSet(p.id)}
                title={p.label}
                className={`flex flex-col items-center gap-1 rounded p-1.5 ring-2 ${
                  pieceSet === p.id ? 'bg-neutral-700 ring-emerald-400' : 'ring-transparent hover:bg-neutral-800'
                }`}
              >
                <PieceSwatch set={p.id} />
                <span className="max-w-full truncate text-[10px] text-neutral-300">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        <button onClick={onClose} className="mt-4 w-full rounded bg-neutral-700 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
          Done
        </button>
      </div>
    </div>
  );
}
