import { useEffect, useMemo, useRef, useState } from 'react';
import { STARTING_FEN } from '@chesser/shared';
import { useGame } from '../store/game';
import { detectOpening, searchOpenings, type OpeningEntry, type OpeningInfo } from '../lib/openings';

function toPgn(san: string[]): string {
  let s = '';
  for (let i = 0; i < san.length; i++) s += (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + san[i] + ' ';
  return s.trim();
}

export function OpeningName() {
  const history = useGame((s) => s.history);
  const viewPly = useGame((s) => s.viewPly);
  const startFen = useGame((s) => s.startFen);
  const loadPgn = useGame((s) => s.loadPgn);

  const fromStart = startFen === STARTING_FEN;
  const path = useMemo(() => history.slice(0, viewPly).map((h) => h.san), [history, viewPly]);

  const [info, setInfo] = useState<OpeningInfo | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OpeningEntry[]>([]);
  const [open, setOpen] = useState(false);

  // Detect the opening for the currently-viewed position. We only touch the
  // (lazily-loaded) ECO dataset once there's actually a move to name, so the
  // default board doesn't pull it in on first paint.
  useEffect(() => {
    if (!fromStart || path.length === 0) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    detectOpening(path).then((r) => !cancelled && setInfo(r));
    return () => {
      cancelled = true;
    };
  }, [path, fromStart]);

  // Debounced name search.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => {
      searchOpenings(query).then(setResults);
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const loadLine = (e: OpeningEntry) => {
    loadPgn(toPgn(e.san));
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="rounded-lg bg-panel p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Opening</h3>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          {open ? 'Close' : 'Look up'}
        </button>
      </div>

      <div className="mt-1 min-h-[2.25rem]">
        {info ? (
          <div className="flex items-baseline gap-2">
            <span className="rounded bg-neutral-700 px-1.5 py-0.5 font-mono text-xs text-neutral-200">{info.eco}</span>
            <span className="text-sm leading-tight text-neutral-200">{info.name}</span>
          </div>
        ) : (
          <p className="text-xs text-neutral-400">
            {fromStart ? 'No named opening yet — play a few moves.' : 'Opening names are shown from the standard start position.'}
          </p>
        )}
      </div>

      {open && (
        <div className="mt-2 border-t border-neutral-800 pt-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search openings (e.g. Najdorf, C50)…"
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none placeholder:text-neutral-400"
          />
          {results.length > 0 && (
            <div className="scroll-thin mt-2 max-h-56 space-y-1 overflow-y-auto">
              {results.map((e, i) => (
                <button
                  key={`${e.eco}-${e.name}-${i}`}
                  onClick={() => loadLine(e)}
                  title={toPgn(e.san)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-neutral-700"
                >
                  <span className="w-9 shrink-0 font-mono text-xs text-neutral-400">{e.eco}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-neutral-200">{e.name}</span>
                </button>
              ))}
            </div>
          )}
          {query.trim() && results.length === 0 && <p className="mt-2 text-xs text-neutral-400">No matches.</p>}
          {!query.trim() && (
            <p className="mt-2 text-xs text-neutral-400">Find any opening by name or ECO code, then load it onto the board.</p>
          )}
        </div>
      )}
    </div>
  );
}
