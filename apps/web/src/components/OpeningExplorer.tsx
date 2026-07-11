import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ExplorerDb, ExplorerGame, ExplorerMove, ExplorerSpeed } from '@chesser/shared';
import { DEFAULT_FILTERS, type ExplorerFilters } from '../lib/explorerApi';
import { useExplorer } from '../lib/useExplorer';
import { detectOpening, type OpeningInfo } from '../lib/openings';

/**
 * Opening explorer panel: live continuation stats for a position from the
 * Lichess opening-explorer database (masters OTB games or online games with
 * speed/rating filters), plus the opening's name and notable games.
 *
 * Degrades gracefully: when the live database is unreachable it keeps naming
 * the opening from the bundled ECO data and says stats are unavailable.
 */

const PREFS_KEY = 'chesser-explorer-prefs';

/** UI-selectable speeds (the API also knows ultraBullet/correspondence — niche, omitted). */
const SPEED_CHOICES: { id: ExplorerSpeed; label: string }[] = [
  { id: 'bullet', label: 'Bullet' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'rapid', label: 'Rapid' },
  { id: 'classical', label: 'Classical' },
];

const RATING_CHOICES: { min: number; label: string }[] = [
  { min: 0, label: 'All ratings' },
  { min: 1400, label: '1400+' },
  { min: 1600, label: '1600+' },
  { min: 1800, label: '1800+' },
  { min: 2000, label: '2000+' },
  { min: 2200, label: '2200+' },
  { min: 2500, label: '2500' },
];

interface ExplorerPrefs {
  db: ExplorerDb;
  filters: ExplorerFilters;
}

function loadPrefs(): ExplorerPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ExplorerPrefs>;
      const speeds = SPEED_CHOICES.map((s) => s.id).filter((s) => p.filters?.speeds?.includes(s));
      return {
        db: p.db === 'lichess' ? 'lichess' : 'masters',
        filters: {
          speeds: speeds.length > 0 ? speeds : DEFAULT_FILTERS.speeds,
          minRating: RATING_CHOICES.some((r) => r.min === p.filters?.minRating) ? p.filters!.minRating! : 0,
        },
      };
    }
  } catch {
    /* corrupted prefs — fall through to defaults */
  }
  return { db: 'masters', filters: DEFAULT_FILTERS };
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);

/** Stacked white/draw/black share bar. Purely visual — numbers live in the row's label. */
function WdlBar({ white, draws, black, total }: { white: number; draws: number; black: number; total: number }) {
  const w = pct(white, total);
  const d = pct(draws, total);
  const b = pct(black, total);
  return (
    <div
      aria-hidden
      className="flex h-4 w-full overflow-hidden rounded-sm border border-neutral-700/60 text-[9px] font-semibold leading-[15px]"
    >
      <div className="bg-chess-white text-center text-chess-black" style={{ width: `${w}%` }}>
        {w >= 12 ? `${Math.round(w)}%` : ''}
      </div>
      {/* No label on the draw segment: no text color passes AA on this grey,
          and the exact share lives in the row's title/aria-label anyway. */}
      <div className="bg-neutral-500" style={{ width: `${d}%` }} />
      <div className="bg-chess-black text-center text-chess-white" style={{ width: `${b}%` }}>
        {b >= 12 ? `${Math.round(b)}%` : ''}
      </div>
    </div>
  );
}

function moveLabel(m: ExplorerMove): string {
  const share = (n: number) => `${Math.round(pct(n, m.total))}%`;
  return `${m.san} — ${m.total.toLocaleString()} games: white wins ${share(m.white)}, draw ${share(m.draws)}, black wins ${share(m.black)}`;
}

function GameRow({ g }: { g: ExplorerGame }) {
  const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '½-½';
  const chip =
    g.winner === 'white'
      ? 'bg-chess-white text-chess-black'
      : g.winner === 'black'
        ? 'bg-chess-black text-chess-white'
        : 'bg-neutral-700 text-neutral-200';
  const when = g.month ?? (g.year ? String(g.year) : null);
  return (
    <li>
      <a
        href={`https://lichess.org/${encodeURIComponent(g.id)}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`View ${g.white.name} vs ${g.black.name} on Lichess (opens in a new tab)`}
        className="flex min-h-9 items-center gap-2 rounded px-1 py-1 hover:bg-neutral-800"
      >
        <span className={`w-8 shrink-0 rounded text-center font-mono text-[10px] font-bold leading-4 ${chip}`}>{result}</span>
        <span className="min-w-0 flex-1 truncate text-xs">
          <span className={g.winner === 'white' ? 'font-semibold text-ink' : 'text-neutral-300'}>{g.white.name}</span>
          {g.white.rating ? <span className="text-neutral-400"> {g.white.rating}</span> : null}
          <span className="text-neutral-400"> · </span>
          <span className={g.winner === 'black' ? 'font-semibold text-ink' : 'text-neutral-300'}>{g.black.name}</span>
          {g.black.rating ? <span className="text-neutral-400"> {g.black.rating}</span> : null}
        </span>
        {when && <span className="shrink-0 text-[10px] text-neutral-400">{when}</span>}
      </a>
    </li>
  );
}

export interface OpeningExplorerProps {
  /** Position to explore (full FEN). */
  fen: string;
  /**
   * SAN moves leading here from the standard start position, used to name the
   * opening offline (bundled ECO data). Pass null when the line does not start
   * from the standard position.
   */
  pathSan: string[] | null;
  /** Called when the user picks a continuation. Omit to render read-only rows. */
  onPlayMove?: (m: ExplorerMove) => void;
  /** Optional extra action rendered at the end of each move row. */
  moveAction?: (m: ExplorerMove) => ReactNode;
  /** Optional content shown under the toolbar (e.g. a repertoire-save target). */
  children?: ReactNode;
}

export function OpeningExplorer({ fen, pathSan, onPlayMove, moveAction, children }: OpeningExplorerProps) {
  const [prefs, setPrefs] = useState<ExplorerPrefs>(loadPrefs);
  const { db, filters } = prefs;
  const { result, loading } = useExplorer(fen, db, filters);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode / quota — prefs just don't persist */
    }
  }, [prefs]);

  // Offline / out-of-book fallback: name the opening from the bundled ECO data.
  const pathKey = pathSan?.join(' ') ?? '';
  const [fallback, setFallback] = useState<OpeningInfo | null>(null);
  useEffect(() => {
    if (!pathSan || pathSan.length === 0) {
      setFallback(null);
      return;
    }
    let cancelled = false;
    detectOpening(pathSan).then((r) => !cancelled && setFallback(r));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey]);

  const setDb = (next: ExplorerDb) => setPrefs((p) => ({ ...p, db: next }));
  const toggleSpeed = (s: ExplorerSpeed) =>
    setPrefs((p) => {
      const on = p.filters.speeds.includes(s);
      const speeds = on ? p.filters.speeds.filter((x) => x !== s) : [...p.filters.speeds, s];
      if (speeds.length === 0) return p; // at least one speed stays selected
      return { ...p, filters: { ...p.filters, speeds } };
    });
  const setMinRating = (minRating: number) => setPrefs((p) => ({ ...p, filters: { ...p.filters, minRating } }));

  const available = result?.available === true;
  const moves = available ? (result!.moves ?? []) : [];
  const total = available ? (result!.total ?? 0) : 0;

  // Prefer the live database's name; otherwise fall back to the bundled ECO
  // data (works offline, and the API only names positions in its own book).
  const opening = (available ? result!.opening : null) ?? fallback;
  const openingName = opening?.name ?? null;
  const openingEco = opening?.eco;

  const games = useMemo(() => {
    if (!available) return { label: '', list: [] as ExplorerGame[] };
    const top = result!.topGames ?? [];
    const recent = result!.recentGames ?? [];
    const seen = new Set<string>();
    const list = [...top, ...recent].filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true))).slice(0, 5);
    return { label: top.length > 0 ? 'Top games' : 'Recent games', list };
  }, [available, result]);

  return (
    <section aria-label="Opening explorer" className="rounded-lg bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Opening explorer</h3>
        <div role="group" aria-label="Database" className="flex gap-1 text-xs">
          {(
            [
              { id: 'masters', label: 'Masters' },
              { id: 'lichess', label: 'Lichess' },
            ] as const
          ).map((d) => (
            <button
              key={d.id}
              onClick={() => setDb(d.id)}
              aria-pressed={db === d.id}
              title={d.id === 'masters' ? 'Over-the-board master games' : 'Online games played on Lichess'}
              className={`btn-press min-h-7 rounded-full px-2.5 py-0.5 font-semibold ${
                db === d.id ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-ink'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {db === 'lichess' && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <div role="group" aria-label="Time controls" className="flex flex-wrap gap-1">
            {SPEED_CHOICES.map((s) => {
              const on = filters.speeds.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleSpeed(s.id)}
                  aria-pressed={on}
                  className={`btn-press min-h-7 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    on ? 'bg-brand-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <select
            value={filters.minRating}
            onChange={(e) => setMinRating(Number(e.target.value))}
            aria-label="Minimum player rating"
            className="ml-auto min-h-7 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-ink outline-none"
          >
            {RATING_CHOICES.map((r) => (
              <option key={r.min} value={r.min}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-2 min-h-5 text-sm" aria-live="polite">
        {openingName ? (
          <span className="flex items-baseline gap-2">
            {openingEco && (
              <span className="rounded bg-neutral-700 px-1.5 py-0.5 font-mono text-xs text-neutral-200">{openingEco}</span>
            )}
            <span className="min-w-0 leading-tight text-neutral-200">{openingName}</span>
          </span>
        ) : (
          <span className="text-xs text-neutral-400">
            {pathSan && pathSan.length > 0 ? 'No book name for this position.' : 'Starting position — pick a first move below.'}
          </span>
        )}
      </div>

      {children}

      {!result && loading ? (
        <p className="py-2 text-xs text-neutral-400" role="status">
          Loading opening stats…
        </p>
      ) : !available ? (
        <div className="rounded bg-neutral-800/70 p-2 text-xs text-neutral-400" role="status">
          <p className="font-semibold text-neutral-300">Live stats unavailable</p>
          <p className="mt-1">
            The opening database (<code className="text-neutral-300">explorer.lichess.ovh</code>) can’t be reached right now.
            Opening names still work offline; move stats will return once the database is reachable.
          </p>
        </div>
      ) : moves.length === 0 ? (
        <p className="py-2 text-xs text-neutral-400">No games in this database from here.</p>
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="mb-1 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            <span className="w-11 shrink-0">Move</span>
            <span className="w-12 shrink-0 text-right">Games</span>
            <span className="min-w-0 flex-1">White · Draw · Black</span>
          </div>
          <ul className="space-y-0.5">
            {moves.map((m) => (
              <li key={m.uci} className="flex items-center gap-1">
                <button
                  disabled={!onPlayMove}
                  onClick={() => onPlayMove?.(m)}
                  aria-label={onPlayMove ? `Play ${moveLabel(m)}` : moveLabel(m)}
                  title={
                    `${m.total.toLocaleString()} games` + (m.averageRating ? ` · average rating ${m.averageRating}` : '')
                  }
                  className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-neutral-800 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="w-11 shrink-0 font-mono text-sm font-semibold text-ink">{m.san}</span>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-neutral-400">{fmtCount(m.total)}</span>
                  <span className="min-w-0 flex-1">
                    <WdlBar white={m.white} draws={m.draws} black={m.black} total={m.total} />
                  </span>
                </button>
                {moveAction?.(m)}
              </li>
            ))}
          </ul>

          {total > 0 && (
            <div className="mt-2 flex items-center gap-2 border-t border-neutral-800 px-1 pt-2">
              <span className="w-11 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">All</span>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-neutral-400" title={`${total.toLocaleString()} games`}>
                {fmtCount(total)}
              </span>
              <span className="min-w-0 flex-1">
                <WdlBar white={result!.white ?? 0} draws={result!.draws ?? 0} black={result!.black ?? 0} total={total} />
              </span>
            </div>
          )}

          {games.list.length > 0 && (
            <div className="mt-3 border-t border-neutral-800 pt-2">
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{games.label}</h4>
              <ul className="space-y-0.5">
                {games.list.map((g) => (
                  <GameRow key={g.id} g={g} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
