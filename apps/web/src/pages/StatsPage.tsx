import { useMemo, type ReactNode } from 'react';
import { useProgress } from '../store/progress';
import { useRepertoire, BUILTIN_REPERTOIRE } from '../store/repertoire';
import { useCoordinate } from '../store/coordinate';
import { useCustomPuzzles } from '../store/customPuzzles';
import { usePuzzleRating } from '../store/puzzleRating';
import { PUZZLES } from '../trainers/tactics';
import { ActivityChart, Heatmap, ProgressBar, RatingSparkline, StatCard, type DayPoint } from '../components/Charts';

const HEATMAP_WEEKS = 18;

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastNDays(n: number): string[] {
  const today = new Date();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    out.push(utcDay(d));
  }
  return out;
}

function heatmapDays(weeks: number): string[] {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (weeks * 7 - 1));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // snap back to Sunday
  const days: string[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(utcDay(d));
  return days;
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="rounded-lg bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function StatsPage() {
  const history = useProgress((s) => s.history);
  const streak = useProgress((s) => s.streak);
  const bestStreak = useProgress((s) => s.bestStreak);
  const cards = useProgress((s) => s.cards);

  const rushBest = useRepertoire((s) => s.rushHighScore);
  const userReps = useRepertoire((s) => s.user);
  const coordBest = useCoordinate((s) => s.bestBySide);
  const customPuzzles = useCustomPuzzles((s) => s.puzzles.length);
  const puzzleRating = usePuzzleRating((s) => s.rating);
  const puzzlePeak = usePuzzleRating((s) => s.peak);
  const puzzlesSolved = usePuzzleRating((s) => s.solved);
  const ratingHistory = usePuzzleRating((s) => s.history);

  const today = utcDay(new Date());

  const totals = useMemo(() => {
    let reviews = 0;
    let correct = 0;
    let activeDays = 0;
    for (const v of Object.values(history)) {
      reviews += v.reviews;
      correct += v.correct;
      if (v.reviews > 0) activeDays++;
    }
    return { reviews, correct, activeDays, acc: reviews ? Math.round((correct / reviews) * 100) : 0 };
  }, [history]);

  const todayReviews = history[today]?.reviews ?? 0;

  const deckCounts = useMemo(() => {
    const openingIds = [...BUILTIN_REPERTOIRE.lines.map((l) => l.id), ...userReps.flatMap((r) => r.lines.map((l) => l.id))];
    const tacticIds = PUZZLES.map((p) => p.id);
    const now = Date.now();
    const count = (deck: string, ids: string[]) => {
      let seen = 0;
      let due = 0;
      for (const id of ids) {
        const c = cards[`${deck}:${id}`];
        if (c?.last) {
          seen++;
          if (c.due <= now) due++;
        }
      }
      return { seen, due, total: ids.length };
    };
    return { openings: count('openings', openingIds), tactics: count('tactics', tacticIds) };
  }, [cards, userReps]);

  const heat = useMemo(
    () => heatmapDays(HEATMAP_WEEKS).map((date) => ({ date, value: history[date]?.reviews ?? 0 })),
    [history],
  );

  const series: DayPoint[] = useMemo(
    () =>
      lastNDays(30).map((date) => {
        const d = history[date];
        const reviews = d?.reviews ?? 0;
        return { date, reviews, acc: reviews ? Math.round(((d?.correct ?? 0) / reviews) * 100) : null };
      }),
    [history],
  );

  // Rating over the last 30 days, carried forward across inactive days.
  const ratingSeries = useMemo(() => {
    const days = lastNDays(30);
    const out: number[] = [];
    let last = 0;
    let started = false;
    for (const d of days) {
      if (ratingHistory[d] != null) {
        last = ratingHistory[d]!;
        started = true;
      }
      if (started) out.push(last);
    }
    return out;
  }, [ratingHistory]);

  const empty = totals.reviews === 0;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-4">
      {empty && (
        <div className="rounded-lg border border-dashed border-neutral-700 bg-panel/60 p-4 text-sm text-neutral-400">
          No training history yet. Solve tactics, drill openings or run the coordinate trainer — your accuracy and volume will
          show up here.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Puzzle rating" value={puzzleRating} hint={`peak ${puzzlePeak}`} />
        <StatCard label="Day streak" value={<span>🔥 {streak}</span>} hint={`best ${bestStreak}`} />
        <StatCard label="Reviews" value={totals.reviews} hint={`${totals.activeDays} active days`} />
        <StatCard label="Accuracy" value={`${totals.acc}%`} hint={`${totals.correct} correct`} />
        <StatCard label="Today" value={todayReviews} hint="reviews" />
        <StatCard label="Coord. best" value={Math.max(coordBest.white, coordBest.black)} hint="board vision" />
      </div>

      <Section title="Activity" aside={<span className="text-xs text-neutral-500">last {HEATMAP_WEEKS} weeks</span>}>
        <Heatmap days={heat} />
        <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-neutral-500">
          less
          {['#1b2029', '#14532d', '#166534', '#16a34a', '#34d399'].map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />
          ))}
          more
        </div>
      </Section>

      <Section
        title="Last 30 days"
        aside={<span className="text-xs text-neutral-500">reviews ▮ · accuracy ▬</span>}
      >
        <ActivityChart data={series} />
      </Section>

      <Section
        title="Puzzle rating"
        aside={
          <span className="text-xs text-neutral-500">
            {puzzlesSolved} solved · {customPuzzles} from your games
          </span>
        }
      >
        {ratingSeries.length >= 2 ? (
          <RatingSparkline data={ratingSeries} />
        ) : (
          <p className="text-xs text-neutral-500">
            Solve rated puzzles in the Middlegame trainer to build a rating — currently {puzzleRating}.
          </p>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Learning progress">
          <div className="space-y-3">
            <ProgressBar label="Openings" {...deckCounts.openings} />
            <ProgressBar label="Tactics" {...deckCounts.tactics} />
          </div>
        </Section>

        <Section title="Personal bests">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-bold text-emerald-400">{rushBest}</div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Puzzle rush</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">{coordBest.white}</div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Coord. white</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">{coordBest.black}</div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Coord. black</div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
