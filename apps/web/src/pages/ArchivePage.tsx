import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../store/auth';
import { useGame } from '../store/game';
import { useAnalysisReport } from '../store/analysisReport';
import { useRatings } from '../store/ratings';
import { useSettings } from '../store/settings';
import { bootstrapFromReportCache, useCoach } from '../store/coach';
import { apiListGames, type SavedGame } from '../lib/api';
import { listCasualGames } from '../humans/casualHistory';
import {
  applyReview,
  fromCasualGame,
  fromSavedGame,
  KIND_LABELS,
  peekCachedReview,
  selfNames,
  storedFriendName,
  type ArchiveGame,
  type ArchiveResult,
} from '../lib/archive';
import {
  accuracyPoints,
  averageAccuracy,
  bucketTrend,
  DEFAULT_FILTER,
  filterGames,
  openingCounts,
  periodStart,
  pickBucketSize,
  ratingSeries,
  wdlCounts,
  type ArchiveFilter,
  type ColorFilter,
  type PeriodFilter,
  type ResultFilter,
  type TrendPoint,
  type WdlCounts,
} from '../lib/archiveStats';
import { detectOpening } from '../lib/openings';
import { buildWeaknessProfile } from '../lib/weakness';
import { playSound } from '../lib/sound';
import { StatCard } from '../components/Charts';
import { EmptyBoardArt, EmptyStatsArt } from '../components/icons';

/** Session-wide memo of detected openings, keyed by report-cache gameKey. */
const detectedOpenings = new Map<string, { eco: string | null; name: string } | null>();

// ---------------------------------------------------------------------------
// Small presentational bits
// ---------------------------------------------------------------------------

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
        {aside && <span className="text-right text-xs text-neutral-400">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

const RESULT_CHIP: Record<ArchiveResult, { label: string; cls: string; title: string }> = {
  win: { label: 'W', cls: 'bg-emerald-900/60 text-emerald-300', title: 'Win' },
  draw: { label: 'D', cls: 'bg-neutral-800 text-neutral-300', title: 'Draw' },
  loss: { label: 'L', cls: 'bg-rose-900/60 text-rose-300', title: 'Loss' },
  unknown: { label: '–', cls: 'bg-neutral-800 text-neutral-400', title: 'No result from your side' },
};

function ResultChip({ result }: { result: ArchiveResult }) {
  const c = RESULT_CHIP[result];
  return (
    <span title={c.title} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.cls}`}>
      {c.label}
      <span className="sr-only">{c.title}</span>
    </span>
  );
}

/** "You played white/black" swatch — chess.* tokens, never the neutral ramp. */
function ColorDot({ color }: { color: 'white' | 'black' }) {
  return (
    <span
      title={`You played ${color}`}
      className={`h-3 w-3 shrink-0 rounded-[4px] ring-1 ring-neutral-600 ${color === 'white' ? 'bg-chess-white' : 'bg-chess-black'}`}
    />
  );
}

/** Win/draw/loss split: counts as text (never color alone) + a stacked bar. */
function WdlBar({ counts, label }: { counts: WdlCounts; label: string }) {
  const decided = counts.wins + counts.draws + counts.losses;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-400">
          <span className="font-semibold text-emerald-300">{counts.wins}W</span>
          {' · '}
          <span className="text-neutral-300">{counts.draws}D</span>
          {' · '}
          <span className="font-semibold text-rose-300">{counts.losses}L</span>
          {counts.winRate != null && <span> · {counts.winRate}% wins</span>}
        </span>
      </div>
      {decided > 0 ? (
        <div className="flex h-2.5 w-full gap-0.5" role="img" aria-label={`${counts.wins} wins, ${counts.draws} draws, ${counts.losses} losses`}>
          {counts.wins > 0 && <div title={`${counts.wins} wins`} className="rounded-full bg-emerald-600" style={{ flexGrow: counts.wins, flexBasis: 0 }} />}
          {counts.draws > 0 && <div title={`${counts.draws} draws`} className="rounded-full bg-neutral-500" style={{ flexGrow: counts.draws, flexBasis: 0 }} />}
          {counts.losses > 0 && <div title={`${counts.losses} losses`} className="rounded-full bg-rose-600" style={{ flexGrow: counts.losses, flexBasis: 0 }} />}
        </div>
      ) : (
        <div className="h-2.5 w-full rounded-full bg-neutral-800" />
      )}
    </div>
  );
}

interface ChartSeries {
  label: string;
  /** A theme-aware CSS color (var(--c-…)) — both themes keep it AA vs panel. */
  color: string;
  points: TrendPoint[];
  /** Formats a value for tooltips/labels (e.g. adds '%'). */
  format: (v: number) => string;
}

/** Chart timestamps are UTC bucket starts (see lib/archiveStats bucketStart) /
 *  UTC-midnight rating days — format them in UTC so the label matches the
 *  bucket's ISO date instead of drifting a day west of Greenwich. */
const shortDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Minimal theme-token line chart (one y-axis, 1–2 series). Identity is never
 * color-alone: every series is named in the legend with its latest value, and
 * each dot carries a native tooltip.
 */
function TrendChart({ series }: { series: ChartSeries[] }) {
  const drawn = series.filter((s) => s.points.length > 0);
  const all = drawn.flatMap((s) => s.points);
  if (all.length === 0) return null; // callers render their own empty state
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  let v0 = Math.min(...all.map((p) => p.value));
  let v1 = Math.max(...all.map((p) => p.value));
  if (v1 - v0 < 1) {
    v0 -= 1;
    v1 += 1;
  }
  const pad = (v1 - v0) * 0.1;
  const lo = v0 - pad;
  const hi = v1 + pad;
  const H = 100;
  const x = (t: number) => (t1 === t0 ? 50 : ((t - t0) / (t1 - t0)) * 100);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const fmt = drawn[0]!.format;

  return (
    <div>
      <div className="flex items-stretch gap-3">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-32 min-w-0 flex-1" role="img" aria-label="Trend chart">
          <line x1={0} y1={y((v0 + v1) / 2)} x2={100} y2={y((v0 + v1) / 2)} stroke="var(--c-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {drawn.map((s) => (
            <g key={s.label}>
              {s.points.length > 1 && (
                <polyline
                  points={s.points.map((p) => `${x(p.t)},${y(p.value)}`).join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {s.points.length <= 60 &&
                s.points.map((p) => (
                  <circle key={p.t} cx={x(p.t)} cy={y(p.value)} r={1.6} fill={s.color}>
                    <title>{`${s.label} — ${shortDate(p.t)}: ${s.format(p.value)}`}</title>
                  </circle>
                ))}
            </g>
          ))}
        </svg>
        <div className="flex shrink-0 flex-col justify-between py-0.5 text-right text-xs text-neutral-400">
          <span>{fmt(v1)}</span>
          <span>{fmt(v0)}</span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
        <span>
          {shortDate(t0)}
          {t1 !== t0 && <> – {shortDate(t1)}</>}
        </span>
        <span className="flex flex-wrap items-center gap-3">
          {drawn.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
              <span className="font-semibold text-neutral-300">{s.format(s.points[s.points.length - 1]!.value)}</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function EmptyChartNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-24 items-center justify-center rounded-xl border border-dashed border-neutral-700 px-3 text-center text-sm text-neutral-400">
      {children}
    </p>
  );
}

function Pills<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
      <span className="text-xs text-neutral-400">{label}</span>
      <div className="flex gap-0.5 rounded-full bg-panelmute p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={value === o.id}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              value === o.id ? 'bg-brand-600 text-white' : 'text-neutral-300 hover:bg-neutral-700 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game list
// ---------------------------------------------------------------------------

function GameRow({ game, onOpen }: { game: ArchiveGame; onOpen: (g: ArchiveGame) => void }) {
  const title = game.userColor && game.opponent ? `You vs ${game.opponent}` : `${game.white} vs ${game.black}`;
  const subtitle = [
    KIND_LABELS[game.kind],
    game.moves > 0 ? `${game.moves} move${game.moves === 1 ? '' : 's'}` : null,
    game.opening?.name ?? null,
    game.resultRaw !== '*' ? game.resultRaw : 'unfinished',
  ]
    .filter(Boolean)
    .join(' · ');

  const body = (
    <>
      <ResultChip result={game.result} />
      {game.userColor && <ColorDot color={game.userColor} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-neutral-200">{title}</span>
        <span className="block truncate text-xs text-neutral-400">{subtitle}</span>
      </span>
      {game.accuracy != null && (
        <span title="Your accuracy in the saved review" className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-brand-300">
          {game.accuracy.toFixed(1)}%
        </span>
      )}
      {/* Deliberately LOCAL time (unlike the UTC-bucketed charts): the list
          answers "when did I play this?" in the user's own timezone. A game
          played late evening west of UTC may therefore sit in the next day's
          chart bucket — the tooltip carries the exact time. */}
      <span title={new Date(game.playedAt).toLocaleString()} className="shrink-0 text-xs text-neutral-400">
        {new Date(game.playedAt).toLocaleDateString()}
      </span>
    </>
  );

  // Not openable: casual games never store moves; a saved game without a
  // gameKey has a PGN that didn't parse (or holds no moves) — a clickable row
  // would silently no-op, since openGame only navigates when loadPgn succeeds.
  if (!game.pgn || !game.gameKey) {
    return (
      <div
        title={
          !game.pgn
            ? "Casual games only log their result — the moves aren't stored, so there's nothing to review."
            : "This game can't be opened — its saved PGN has no readable moves."
        }
        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left"
      >
        {body}
      </div>
    );
  }
  return (
    <button
      onClick={() => onOpen(game)}
      title="Open this game on the analysis board"
      className="btn-press flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-neutral-800"
    >
      {body}
    </button>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-1.5" role="status" aria-label="Loading your games">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-2.5 rounded-xl px-2.5 py-2">
          <span className="h-7 w-7 rounded-full bg-neutral-800" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="block h-3 w-1/2 rounded bg-neutral-800" />
            <span className="block h-2.5 w-2/3 rounded bg-neutral-800" />
          </span>
          <span className="h-3 w-16 rounded bg-neutral-800" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const LIST_PREVIEW = 30;

export function ArchivePage({ goPlay }: { goPlay: () => void }) {
  const token = useAuth((s) => s.token);
  const username = useAuth((s) => s.username);

  const [tab, setTab] = useState<'games' | 'insights'>('games');
  const [filter, setFilter] = useState<ArchiveFilter>(DEFAULT_FILTER);
  // Reference time for the period filters. Kept in state (not Date.now() inside
  // the memos below) so a tab left open for days refreshes its '7d'/'30d'
  // cutoffs when the user comes back to it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);
  const [saved, setSaved] = useState<SavedGame[] | null>(token ? null : []);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [openings, setOpenings] = useState<Record<string, { eco: string | null; name: string } | null>>({});
  const [casualGames] = useState(() => listCasualGames());

  // Coach digests back-fill from the report cache (same as the Coach tab).
  useEffect(() => {
    bootstrapFromReportCache();
  }, []);

  useEffect(() => {
    if (!token) {
      setSaved([]);
      return;
    }
    let cancelled = false;
    setSaved(null);
    setLoadError(false);
    apiListGames(token)
      .then((r) => {
        if (!cancelled) setSaved(r.games);
      })
      .catch(() => {
        if (!cancelled) {
          setSaved([]);
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, retryNonce]);

  const loading = token != null && saved === null;

  // Normalize both sources into ArchiveGames (newest first), enriched with any
  // cached review (accuracy / opening / player side) — read without touching
  // the report cache's LRU order.
  const games = useMemo(() => {
    const self = selfNames(username, storedFriendName());
    const fromLibrary = (saved ?? []).map((g) => {
      const norm = fromSavedGame(g, self);
      return norm.gameKey ? applyReview(norm, peekCachedReview(norm.gameKey)) : norm;
    });
    const fromCasual = casualGames.map((r, i) => fromCasualGame(r, i, self));
    return [...fromLibrary, ...fromCasual].sort((a, b) => b.playedAt - a.playedAt);
  }, [saved, username, casualGames]);

  // Name the openings of games whose review didn't already carry one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, { eco: string | null; name: string } | null> = {};
      let any = false;
      for (const g of games) {
        if (g.opening || !g.gameKey || g.sans.length === 0) continue;
        let hit = detectedOpenings.get(g.gameKey);
        if (hit === undefined) {
          const info = await detectOpening(g.sans).catch(() => null);
          if (cancelled) return;
          hit = info ? { eco: info.eco, name: info.name } : null;
          detectedOpenings.set(g.gameKey, hit);
        }
        next[g.gameKey] = hit;
        any = true;
      }
      if (!cancelled && any) setOpenings(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [games]);

  const resolvedGames = useMemo(
    () => games.map((g) => (!g.opening && g.gameKey && openings[g.gameKey] ? { ...g, opening: openings[g.gameKey]! } : g)),
    [games, openings],
  );

  const filtered = useMemo(() => filterGames(resolvedGames, filter, now), [resolvedGames, filter, now]);
  const filterActive = filter.result !== 'all' || filter.color !== 'all' || filter.period !== 'all';

  const openGame = (g: ArchiveGame) => {
    if (!g.pgn) return;
    playSound('uiClick');
    if (useGame.getState().loadPgn(g.pgn)) {
      // Re-light a cached review instantly (same path the Play page uses);
      // without one, the Review button there runs the engine as usual.
      useAnalysisReport.getState().tryHydrateFromCache();
      goPlay();
    }
  };

  // — Insights inputs —
  const meter = useSettings((s) => s.ratingMeter);
  const botsHistory = useRatings((s) => s.categories.bots.history);
  const blitzHistory = useRatings((s) => s.categories.blitz.history);
  const coachGames = useCoach((s) => s.games);

  const wdl = useMemo(() => wdlCounts(filtered), [filtered]);
  const wdlWhite = useMemo(() => wdlCounts(filtered.filter((g) => g.userColor === 'white')), [filtered]);
  const wdlBlack = useMemo(() => wdlCounts(filtered.filter((g) => g.userColor === 'black')), [filtered]);
  const avgAcc = useMemo(() => averageAccuracy(filtered), [filtered]);
  const reviewed = useMemo(() => filtered.filter((g) => g.accuracy != null).length, [filtered]);
  const accTrend = useMemo(() => {
    const pts = accuracyPoints(filtered);
    return bucketTrend(pts, pickBucketSize(pts)).map((b) => ({ t: b.start, value: b.value }));
  }, [filtered]);
  const openingsTop = useMemo(() => openingCounts(filtered, 6), [filtered]);
  const ratingLines = useMemo(() => {
    const from = periodStart(filter.period, now);
    const pct = (v: number) => `${Math.round(v)}`;
    return [
      { label: 'Bots', color: 'var(--c-brand-400)', points: ratingSeries(botsHistory, meter).filter((p) => p.t >= from), format: pct },
      { label: 'Blitz', color: 'var(--c-gold-400)', points: ratingSeries(blitzHistory, meter).filter((p) => p.t >= from), format: pct },
    ].filter((l) => l.points.length > 0);
  }, [botsHistory, blitzHistory, meter, filter.period, now]);
  // Coach digests carry the review's result / player colour / timestamp, so
  // the strengths & weaknesses card can honour the same Result/Color/Period
  // slice as every sibling Insights section (digest createdAt plays the role
  // of playedAt — the same "when it entered the archive" semantics saved
  // games use).
  const digestCount = useMemo(() => Object.keys(coachGames).length, [coachGames]);
  const profile = useMemo(() => {
    const sliced = filterGames(
      Object.values(coachGames).map((d) => ({ digest: d, result: d.result, userColor: d.playerColor, playedAt: d.createdAt })),
      filter,
      now,
    );
    return buildWeaknessProfile(sliced.map((s) => s.digest));
  }, [coachGames, filter, now]);
  const strengths = useMemo(() => {
    const out: string[] = [];
    const phases = profile.phases.filter((p) => p.moves > 0).sort((a, b) => b.accuracy - a.accuracy);
    if (phases[0]) out.push(`Strongest phase: ${phases[0].phase} (${phases[0].accuracy}% accuracy)`);
    const w = profile.colors.white;
    const b = profile.colors.black;
    if (w.games > 0 && b.games > 0 && w.accuracy !== b.accuracy) {
      const better = w.accuracy > b.accuracy ? ('white' as const) : ('black' as const);
      const bt = better === 'white' ? w : b;
      const ot = better === 'white' ? b : w;
      out.push(`More accurate as ${better === 'white' ? 'White' : 'Black'} (${bt.accuracy}% vs ${ot.accuracy}%)`);
    }
    for (const entry of profile.weaknesses) {
      if (entry.trend != null && entry.trend < 0) out.push(`Improving: ${entry.meta.label.toLowerCase()} — fewer in your recent games`);
    }
    return out;
  }, [profile]);

  const tabBtn = (id: 'games' | 'insights', label: string) => (
    <button
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`flex-1 rounded-full px-3 py-1.5 text-sm font-semibold sm:flex-none ${
        tab === id ? 'bg-brand-600 text-white' : 'text-neutral-300 hover:bg-neutral-700 hover:text-ink'
      }`}
    >
      {label}
    </button>
  );

  const visible = showAll ? filtered : filtered.slice(0, LIST_PREVIEW);

  // Rating history lives in the ratings store, not the archive — the trend can
  // (and should) render even when no archived game matches the current slice.
  const ratingSection = (
    <Section title="Rating trend" aside={`rated bot games · ${meter}`}>
      {ratingLines.length > 0 ? (
        <TrendChart series={ratingLines} />
      ) : (
        <EmptyChartNote>No rated games in this period — finish a game against a bot to start your rating history.</EmptyChartNote>
      )}
    </Section>
  );

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-full bg-panelmute p-1" role="group" aria-label="Archive sections">
          {tabBtn('games', 'Games')}
          {tabBtn('insights', 'Insights')}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Pills<ResultFilter>
            label="Result"
            value={filter.result}
            onChange={(result) => setFilter((f) => ({ ...f, result }))}
            options={[
              { id: 'all', label: 'All' },
              { id: 'win', label: 'Wins' },
              { id: 'draw', label: 'Draws' },
              { id: 'loss', label: 'Losses' },
            ]}
          />
          <Pills<ColorFilter>
            label="Color"
            value={filter.color}
            onChange={(color) => setFilter((f) => ({ ...f, color }))}
            options={[
              { id: 'all', label: 'Any' },
              { id: 'white', label: 'White' },
              { id: 'black', label: 'Black' },
            ]}
          />
          <Pills<PeriodFilter>
            label="Period"
            value={filter.period}
            onChange={(period) => setFilter((f) => ({ ...f, period }))}
            options={[
              { id: 'all', label: 'All time' },
              { id: '7d', label: '7d' },
              { id: '30d', label: '30d' },
              { id: '90d', label: '90d' },
              { id: '365d', label: 'Year' },
            ]}
          />
        </div>
      </div>

      {loadError && (
        <p role="status" className="flex items-center justify-between gap-2 rounded-xl bg-panel px-3 py-2 text-sm text-amber-300">
          Could not load your saved games — check your connection.
          <button onClick={() => setRetryNonce((n) => n + 1)} className="rounded-full bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-200 hover:bg-neutral-700">
            Retry
          </button>
        </p>
      )}

      {tab === 'games' && (
        <div className="rounded-2xl bg-panel p-3 shadow-soft">
          {loading ? (
            <LoadingRows />
          ) : games.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-4 text-center text-sm text-neutral-400 sm:flex-row sm:text-left">
              <EmptyBoardArt width={150} height={112} className="shrink-0" />
              <div>
                <div className="mb-1 font-display text-base font-semibold text-ink">No games in your archive yet</div>
                Finish a game against a bot and hit “Save” on the board — it lands here with its result, opening and (after a
                review) accuracy.
                {!token && <> Sign in first so your games follow your account; pass &amp; play results from this device also show here.</>}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-neutral-400">
              No games match these filters.
              <button
                onClick={() => setFilter(DEFAULT_FILTER)}
                className="rounded-full bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-neutral-700"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between px-1 text-xs text-neutral-400">
                <span>
                  {filtered.length} game{filtered.length === 1 ? '' : 's'}
                  {filterActive ? ' (filtered)' : ''}
                </span>
                {!token && <span>Sign in to save bot games to your archive</span>}
              </div>
              <ul className="space-y-0.5">
                {visible.map((g) => (
                  <li key={g.id}>
                    <GameRow game={g} onOpen={openGame} />
                  </li>
                ))}
              </ul>
              {filtered.length > LIST_PREVIEW && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-2 w-full rounded-full bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-neutral-700"
                >
                  {showAll ? 'Show fewer' : `Show all ${filtered.length}`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'insights' &&
        (loading ? (
          <div className="rounded-2xl bg-panel p-3 shadow-soft">
            <LoadingRows />
          </div>
        ) : filtered.length === 0 ? (
          <>
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-700 bg-panel/60 p-6 text-center text-sm text-neutral-400 sm:flex-row sm:text-left">
              <EmptyStatsArt width={150} height={112} className="shrink-0" />
              <div>
                <div className="mb-1 font-display text-base font-semibold text-ink">
                  {games.length === 0 ? 'Your dashboard starts with a game' : 'Nothing in this slice'}
                </div>
                {games.length === 0
                  ? 'Play and save games — win/loss trends, openings and accuracy charts grow from your archive.'
                  : 'No archived games match the current filters — widen the period or clear the filters to see your trends.'}
              </div>
            </div>
            {ratingLines.length > 0 && ratingSection}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Games" value={wdl.total} hint={filterActive ? 'in this slice' : 'all time'} />
              <StatCard label="Record" value={`${wdl.wins}-${wdl.draws}-${wdl.losses}`} hint="W-D-L" />
              <StatCard label="Win rate" value={wdl.winRate != null ? `${wdl.winRate}%` : '—'} hint={wdl.unknown > 0 ? `${wdl.unknown} without a result` : 'of games with a result'} />
              <StatCard label="Accuracy" value={avgAcc != null ? `${avgAcc}%` : '—'} hint={reviewed > 0 ? `avg of ${reviewed} review${reviewed === 1 ? '' : 's'}` : 'no reviews yet'} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title="Win / draw / loss">
                <div className="space-y-3">
                  <WdlBar counts={wdl} label="All games" />
                  <WdlBar counts={wdlWhite} label="As White" />
                  <WdlBar counts={wdlBlack} label="As Black" />
                </div>
              </Section>

              {ratingSection}

              <Section title="Accuracy trend" aside="from your game reviews">
                {accTrend.length > 0 ? (
                  <TrendChart series={[{ label: 'Accuracy', color: 'var(--c-brand-400)', points: accTrend, format: (v) => `${v}%` }]} />
                ) : (
                  <EmptyChartNote>No reviewed games in this slice — open a game and run “Review” to chart your accuracy.</EmptyChartNote>
                )}
              </Section>

              <Section title="Most-played openings">
                {openingsTop.length > 0 ? (
                  <ul className="space-y-2">
                    {openingsTop.map((o) => (
                      <li key={o.name} className="flex items-center gap-2">
                        {o.eco && <span className="w-9 shrink-0 rounded bg-neutral-800 px-1 py-0.5 text-center font-mono text-xs text-neutral-300">{o.eco}</span>}
                        <span className="min-w-0 flex-1 truncate text-sm text-neutral-200" title={o.name}>
                          {o.name}
                        </span>
                        <span className="shrink-0 text-xs text-neutral-400">
                          {o.games} game{o.games === 1 ? '' : 's'} ·{' '}
                          <span className="font-semibold text-emerald-300">{o.wins}W</span> <span className="text-neutral-300">{o.draws}D</span>{' '}
                          <span className="font-semibold text-rose-300">{o.losses}L</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyChartNote>No named openings yet — openings are detected from each saved game’s moves.</EmptyChartNote>
                )}
              </Section>
            </div>

            <Section title="Strengths & weaknesses" aside="from reviewed games · full detail on the Coach tab">
              {profile.games === 0 ? (
                <EmptyChartNote>
                  {digestCount > 0
                    ? 'No reviewed games match the current filters — widen the period or clear the filters to see this breakdown.'
                    : 'Review a finished game (Play → Review) and the coach will chart what you do well and what keeps costing you.'}
                </EmptyChartNote>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">Strengths</h4>
                    {strengths.length > 0 ? (
                      <ul className="space-y-1.5 text-sm text-neutral-200">
                        {strengths.map((s) => (
                          <li key={s} className="flex items-start gap-2">
                            <span aria-hidden className="mt-0.5 text-emerald-400">✓</span>
                            {s}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-neutral-400">Not enough reviewed games to call out strengths yet.</p>
                    )}
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-300">Weaknesses</h4>
                    {profile.weaknesses.length > 0 ? (
                      <ul className="space-y-2">
                        {profile.weaknesses.slice(0, 3).map((w) => (
                          <li key={w.kind} className="text-sm text-neutral-200">
                            <span className="mr-1.5" aria-hidden>
                              {w.meta.icon}
                            </span>
                            {w.meta.label}
                            <span className="ml-1.5 text-xs text-neutral-400">
                              ×{w.count} in {w.games} game{w.games === 1 ? '' : 's'}
                              {w.trend != null && (w.trend < 0 ? ' · improving' : w.trend > 0 ? ' · rising' : '')}
                            </span>
                            <span className="block text-xs text-neutral-400">{w.meta.summary}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-neutral-400">No recurring weakness found in your recent reviews — keep it up.</p>
                    )}
                  </div>
                </div>
              )}
            </Section>
          </>
        ))}
    </div>
  );
}
