import type { ReactNode } from 'react';

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg bg-panel p-3 text-center">
      <div className="text-2xl font-bold text-ink">{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-400">{hint}</div>}
    </div>
  );
}

export function ProgressBar({ label, seen, total, due }: { label: string; seen: number; total: number; due: number }) {
  const pct = total ? Math.round((seen / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-400">
          <span className="text-neutral-200">{seen}</span>/{total} learned
          {due > 0 && <span className="ml-2 text-amber-300">{due} due</span>}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const HEAT_COLORS = ['#1b2029', '#14532d', '#166534', '#16a34a', '#34d399'];
const heatLevel = (v: number) => (v === 0 ? 0 : v <= 3 ? 1 : v <= 9 ? 2 : v <= 19 ? 3 : 4);

/** GitHub-style activity calendar. `days` are chronological, starting on a Sunday. */
export function Heatmap({ days }: { days: { date: string; value: number }[] }) {
  if (days.every((d) => d.value === 0)) {
    return (
      <p className="rounded border border-dashed border-neutral-700 px-3 py-2 text-sm text-neutral-400">
        No activity yet — solved puzzles and drills will light up this calendar.
      </p>
    );
  }
  return (
    <div
      className="grid w-full gap-[3px]"
      style={{ gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column', gridAutoColumns: '1fr' }}
    >
      {days.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${d.value} review${d.value === 1 ? '' : 's'}`}
          className="aspect-square rounded-[2px]"
          style={{ background: HEAT_COLORS[heatLevel(d.value)] }}
        />
      ))}
    </div>
  );
}

/** A compact rating-over-time line with min/max labels. */
export function RatingSparkline({ data }: { data: number[] }) {
  const n = data.length;
  if (n < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1, max - min);
  const H = 40;
  const pts = data.map((v, i) => `${(i / (n - 1)) * 100},${H - ((v - min) / span) * (H - 4) - 2}`).join(' ');
  return (
    <div className="flex items-center gap-3">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="h-12 flex-1">
        <polyline points={pts} fill="none" stroke="#34d399" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="text-right text-xs text-neutral-400">
        <div className="text-emerald-300">{max}</div>
        <div>{min}</div>
      </div>
    </div>
  );
}

export interface DayPoint {
  date: string;
  reviews: number;
  acc: number | null; // 0–100, null when no reviews that day
}

/** Reviews-per-day bars with an accuracy-% line overlaid. */
export function ActivityChart({ data }: { data: DayPoint[] }) {
  if (data.every((d) => d.reviews === 0)) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded border border-dashed border-neutral-700 px-3 text-center text-sm text-neutral-400">
        No activity yet — play a game or solve a puzzle to start the chart.
      </div>
    );
  }
  const n = data.length;
  const maxReviews = Math.max(1, ...data.map((d) => d.reviews));
  const H = 100;
  const accPoints = data
    .map((d, i) => (d.acc == null ? null : `${i + 0.5},${H - (d.acc / 100) * H}`))
    .filter((p): p is string => p !== null);

  return (
    <svg viewBox={`0 0 ${n} ${H}`} preserveAspectRatio="none" className="h-28 w-full">
      {/* accuracy gridlines at 50% and 100% */}
      <line x1={0} y1={H / 2} x2={n} y2={H / 2} stroke="#3a4150" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      {data.map((d, i) => {
        const h = (d.reviews / maxReviews) * (H - 4);
        return <rect key={d.date} x={i + 0.12} y={H - h} width={0.76} height={h} fill="#34d39966" rx={0.15} />;
      })}
      {accPoints.length > 1 && (
        <polyline points={accPoints.join(' ')} fill="none" stroke="#fbbf24" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      )}
      {data.map((d, i) =>
        d.acc == null ? null : (
          <circle key={`c-${d.date}`} cx={i + 0.5} cy={H - (d.acc / 100) * H} r={1.1} fill="#fbbf24" vectorEffect="non-scaling-stroke" />
        ),
      )}
    </svg>
  );
}
