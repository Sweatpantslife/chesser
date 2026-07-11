import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { OPENING_CATALOG } from '../trainers/openingCatalog';
import { useRepertoire } from '../store/repertoire';

/**
 * The repertoire builder: browse the curated opening catalog (per side) and
 * pick named lines into "My repertoire". Picks persist via the repertoire
 * store and sync with the rest of the account blob.
 */
export function OpeningCatalogBrowser({ onClose }: { onClose: () => void }) {
  const picked = useRepertoire((s) => s.picked);
  const togglePicked = useRepertoire((s) => s.togglePicked);
  const setPicked = useRepertoire((s) => s.setPicked);
  const [side, setSide] = useState<'white' | 'black'>('white');

  const openings = useMemo(() => OPENING_CATALOG.filter((o) => o.side === side), [side]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);

  return (
    <Modal onClose={onClose} labelledBy="catalog-title" className="w-full max-w-xl rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="catalog-title" className="font-display text-lg font-bold text-ink">
          Build your repertoire
        </h2>
        <button
          onClick={onClose}
          className="btn-press rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          Done · {picked.length} line{picked.length === 1 ? '' : 's'}
        </button>
      </div>

      <div className="mb-3 flex gap-1 rounded-full bg-neutral-800 p-1 text-sm" role="tablist" aria-label="Side">
        {(['white', 'black'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className={`flex-1 rounded-full px-3 py-1 font-semibold capitalize ${
              side === s ? 'bg-brand-600 text-white' : 'text-neutral-300 hover:text-white'
            }`}
          >
            As {s}
          </button>
        ))}
      </div>

      <div className="scroll-thin max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {openings.map((o) => {
          const allIn = o.lines.every((l) => pickedSet.has(l.id));
          return (
            <div key={o.id} className="rounded-xl bg-panelmute p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-ink">{o.name}</span>
                  <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">{o.eco}</span>
                </div>
                <button
                  onClick={() => {
                    const ids = o.lines.map((l) => l.id);
                    setPicked(allIn ? picked.filter((id) => !ids.includes(id)) : [...picked, ...ids]);
                  }}
                  className="shrink-0 rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-600"
                >
                  {allIn ? 'Remove all' : 'Add all'}
                </button>
              </div>
              <p className="mb-2 text-xs leading-snug text-neutral-400">{o.summary}</p>
              <div className="space-y-1">
                {o.lines.map((l) => {
                  const on = pickedSet.has(l.id);
                  return (
                    <button
                      key={l.id}
                      onClick={() => togglePicked(l.id)}
                      aria-pressed={on}
                      className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                        on ? 'bg-emerald-900/50 ring-1 ring-emerald-600/60' : 'bg-neutral-800 hover:bg-neutral-700'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                          on ? 'bg-emerald-500 text-white' : 'bg-neutral-600 text-neutral-300'
                        }`}
                      >
                        {on ? '✓' : '+'}
                      </span>
                      <span className="min-w-0">
                        <span className="font-semibold text-neutral-100">{l.name}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-neutral-400">{l.eco}</span>
                        <span className="mt-0.5 block leading-snug text-neutral-400">{l.idea}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
