import { useMemo, type ReactNode } from 'react';
import { useProgress } from '../store/progress';
import { useRepertoire } from '../store/repertoire';
import { useCoordinate } from '../store/coordinate';
import { useCustomPuzzles } from '../store/customPuzzles';
import { useRatings, ratingValue, ratingPeak, RATING_CATEGORIES } from '../store/ratings';
import { useGamify, levelProgress } from '../store/gamify';
import { useSettings } from '../store/settings';
import { ReviewSummary } from '../components/ReviewSummary';
import { RatingMeter } from '../components/RatingMeter';
import { DECK_META, useReviewSummary, type DeckTarget } from '../lib/decks';
import { ActivityChart, Heatmap, ProgressBar, StatCard, type DayPoint } from '../components/Charts';

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

export function StatsPage({ goto }: { goto: (target: DeckTarget) => void }) {
  const history = useProgress((s) => s.history);
  const streak = useProgress((s) => s.streak);
  const bestStreak = useProgress((s) => s.bestStreak);

  const rushBest = useRepertoire((s) => s.rushHighScore);
  const coordBest = useCoordinate((s) => s.bestBySide);
  const coordByMode = useCoordinate((s) => s.bestByMode);
  const customPuzzles = useCustomPuzzles((s) => s.puzzles.length);
  const meter = useSettings((s) => s.ratingMeter);
  const puzzlesCat = useRatings((s) => s.categories.puzzles);
  const puzzleRating = ratingValue(puzzlesCat, meter);
  const puzzlePeak = ratingPeak(puzzlesCat, meter);
  const puzzlesSolved = puzzlesCat.won;

  const xp = useGamify((s) => s.xp);
  const level = useMemo(() => levelProgress(xp).level, [xp]);
  const goalStreak = useGamify((s) => s.activeStreak());

  const review = useReviewSummary();
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

  const empty = totals.reviews === 0;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-4">
      {empty && (
        <div className="rounded-lg border border-dashed border-neutral-700 bg-panel/60 p-4 text-sm text-neutral-400">
          No training history yet. Solve tactics, drill openings, learn checkmate patterns or run the coordinate trainer — your
          accuracy and volume will show up here.
        </div>
      )}

      <ReviewSummary goto={goto} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Level" value={<span>⭐ {level}</span>} hint={`${xp.toLocaleString()} XP`} />
        <StatCard label="Puzzle rating" value={puzzleRating} hint={`peak ${puzzlePeak} · ${meter}`} />
        <StatCard label="Day streak" value={<span>🔥 {streak}</span>} hint={`best ${bestStreak}`} />
        <StatCard label="Goal streak" value={<span>🔥 {goalStreak}</span>} hint="daily goals" />
        <StatCard label="Reviews" value={totals.reviews} hint={`${totals.activeDays} active days`} />
        <StatCard label="Accuracy" value={`${totals.acc}%`} hint={`${totals.correct} correct`} />
        <StatCard label="Today" value={todayReviews} hint="reviews" />
        <StatCard label="Due now" value={review.totalDue} hint="all decks" />
      </div>

      <Section
        title="Ratings"
        aside={
          <span className="text-xs text-neutral-400">
            {puzzlesSolved} solved · {customPuzzles} from your games
          </span>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {RATING_CATEGORIES.map((cat) => (
            <RatingMeter key={cat} category={cat} />
          ))}
        </div>
      </Section>

      <Section title="Activity" aside={<span className="text-xs text-neutral-400">last {HEATMAP_WEEKS} weeks</span>}>
        <Heatmap days={heat} />
        {/* colour legend only makes sense once the calendar has data */}
        {heat.some((d) => d.value > 0) && (
          <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-neutral-400">
            less
            {['#1b2029', '#14532d', '#166534', '#16a34a', '#34d399'].map((c) => (
              <span key={c} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />
            ))}
            more
          </div>
        )}
      </Section>

      <Section title="Last 30 days" aside={<span className="text-xs text-neutral-400">reviews ▮ · accuracy ▬</span>}>
        <ActivityChart data={series} />
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Learning progress">
          <div className="space-y-3">
            {review.decks.map((d) => (
              <ProgressBar key={d.deck} label={DECK_META[d.deck].label} total={d.total} seen={d.seen} due={d.due} />
            ))}
          </div>
        </Section>

        <Section title="Personal bests">
          <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-5">
            {[
              { label: 'Puzzle rush', value: rushBest },
              { label: 'Coord. white', value: coordBest.white },
              { label: 'Coord. black', value: coordBest.black },
              { label: 'Sq. colour', value: coordByMode.color },
              { label: "Knight's tour", value: coordByMode.knight },
            ].map((b) => (
              <div key={b.label}>
                <div className="text-2xl font-bold text-emerald-400">{b.value}</div>
                <div className="text-xs uppercase tracking-wide text-neutral-400">{b.label}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
