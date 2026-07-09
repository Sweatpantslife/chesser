import { useMemo, useState } from 'react';
import { STARTING_FEN } from '@chesser/shared';
import { useGame } from '../store/game';
import { useRepertoire } from '../store/repertoire';
import { Modal } from './Modal';

export function SaveLineDialog({ onClose }: { onClose: () => void }) {
  const history = useGame((s) => s.history);
  const viewPly = useGame((s) => s.viewPly);
  const startFen = useGame((s) => s.startFen);
  const user = useRepertoire((s) => s.user);
  const createRepertoire = useRepertoire((s) => s.createRepertoire);
  const addLine = useRepertoire((s) => s.addLine);

  const sans = useMemo(() => history.slice(0, viewPly).map((h) => h.san), [history, viewPly]);
  const fromStart = startFen === STARTING_FEN;

  const defaultName = useMemo(() => {
    let s = '';
    for (let i = 0; i < Math.min(sans.length, 6); i++) s += (i % 2 === 0 ? `${i / 2 + 1}.` : '') + sans[i] + ' ';
    return s.trim() + (sans.length > 6 ? '…' : '');
  }, [sans]);

  const [target, setTarget] = useState<string>(user[0]?.id ?? '__new');
  const [newRepName, setNewRepName] = useState('My repertoire');
  const [lineName, setLineName] = useState(defaultName);
  const [side, setSide] = useState<'white' | 'black'>('white');

  const save = () => {
    let repId = target;
    if (target === '__new') repId = createRepertoire(newRepName);
    addLine(repId, { name: lineName.trim() || defaultName, side, moves: sans });
    onClose();
  };

  return (
    <Modal onClose={onClose} labelledBy="save-line-title" className="w-full max-w-sm rounded-xl bg-panel p-4 shadow-2xl">
        <h3 id="save-line-title" className="mb-2 text-sm font-semibold text-ink">Save line to repertoire</h3>

        {sans.length === 0 ? (
          <p className="text-sm text-neutral-400">Make some moves on the board first, then save the line.</p>
        ) : !fromStart ? (
          <p className="text-sm text-amber-300">Repertoire lines must start from the initial position.</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded bg-panelmute p-2 font-mono text-xs text-neutral-300">{defaultName}</div>

            <div>
              <label htmlFor="save-line-repertoire" className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">
                Repertoire
              </label>
              <select
                id="save-line-repertoire"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none"
              >
                {user.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
                <option value="__new">+ New repertoire…</option>
              </select>
              {target === '__new' && (
                <input
                  value={newRepName}
                  onChange={(e) => setNewRepName(e.target.value)}
                  placeholder="repertoire name"
                  aria-label="New repertoire name"
                  className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none"
                />
              )}
            </div>

            <div>
              <label htmlFor="save-line-name" className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">
                Line name
              </label>
              <input
                id="save-line-name"
                value={lineName}
                onChange={(e) => setLineName(e.target.value)}
                className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none"
              />
            </div>

            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">You play</div>
              <div className="flex gap-1">
                {(['white', 'black'] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setSide(c)}
                    aria-pressed={side === c}
                    className={`flex-1 rounded px-2 py-1 text-sm capitalize ${
                      side === c ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600">
                Cancel
              </button>
              <button onClick={save} className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800">
                Save line
              </button>
            </div>
          </div>
        )}
    </Modal>
  );
}
