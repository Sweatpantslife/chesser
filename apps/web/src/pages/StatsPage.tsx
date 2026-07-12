import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useProgress } from '../store/progress';
import { useRepertoire } from '../store/repertoire';
import { useCoordinate } from '../store/coordinate';
import { useCustomPuzzles } from '../store/customPuzzles';
import { useRatings, ratingValue, ratingPeak, RATING_CATEGORIES } from '../store/ratings';
import { useGamify, levelProgress } from '../store/gamify';
import { useStreak } from '../store/streak';
import { useSprints } from '../store/sprints';
import { useSettings } from '../store/settings';
import { ReviewSummary } from '../components/ReviewSummary';
import { RatingMeter } from '../components/RatingMeter';
import { DECK_META, useReviewSummary } from '../lib/decks';
import { ActivityChart, HEAT_COLORS, Heatmap, ProgressBar, StatCard, type DayPoint } from '../components/Charts';
import { EmptyStatsArt } from '../components/icons';

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
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function StatsPage() {
  const { t } = useTranslation('stats');
  const history = useProgress((s) => s.history);
  const streak = useProgress((s) => s.streak);
  const bestStreak = useProgress((s) => s.bestStreak);

  const legacyRushBest = useRepertoire((s) => s.rushHighScore);
  const sprintRushBest = useSprints((s) => Math.max(s.puzzleRushBest.timed3.score, s.puzzleRushBest.survival.score));
  const rushBest = Math.max(legacyRushBest, sprintRushBest);
  const stormBest = useSprints((s) => s.puzzleStormBest.score);
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
  const dayStreak = useStreak((s) => s.current());

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
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-700 bg-panel/60 p-6 text-center text-sm text-neutral-400 sm:flex-row sm:text-left">
          <EmptyStatsArt width={150} height={112} className="shrink-0" />
          <div>
            <div className="mb-1 font-display text-base font-semibold text-ink">{t('empty.title')}</div>
            {t('empty.body')}
          </div>
        </div>
      )}

      <ReviewSummary />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
        <StatCard label={t('cards.level')} value={<span>⭐ {level}</span>} hint={t('cards.levelHint', { xp: xp.toLocaleString() })} />
        <StatCard label={t('cards.puzzleRating')} value={puzzleRating} hint={t('cards.puzzleRatingHint', { peak: puzzlePeak, meter })} />
        <StatCard label={t('cards.reviewStreak')} value={<span>📚 {streak}</span>} hint={t('cards.reviewStreakHint', { best: bestStreak })} />
        <StatCard label={t('cards.dayStreak')} value={<span>🔥 {dayStreak}</span>} hint={t('cards.dayStreakHint')} />
        <StatCard label={t('cards.reviews')} value={totals.reviews} hint={t('cards.reviewsHint', { count: totals.activeDays })} />
        <StatCard label={t('cards.accuracy')} value={t('percent', { value: totals.acc })} hint={t('cards.accuracyHint', { count: totals.correct })} />
        <StatCard label={t('cards.today')} value={todayReviews} hint={t('cards.todayHint')} />
        <StatCard label={t('cards.dueNow')} value={review.totalDue} hint={t('cards.dueNowHint')} />
      </div>

      <Section
        title={t('sections.ratings')}
        aside={
          <span className="text-xs text-neutral-400">
            {t('sections.ratingsAside', { solved: puzzlesSolved, custom: customPuzzles })}
          </span>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {RATING_CATEGORIES.map((cat) => (
            <RatingMeter key={cat} category={cat} />
          ))}
        </div>
      </Section>

      <Section title={t('sections.activity')} aside={<span className="text-xs text-neutral-400">{t('sections.activityAside', { weeks: HEATMAP_WEEKS })}</span>}>
        <Heatmap days={heat} />
        {/* colour legend only makes sense once the calendar has data */}
        {heat.some((d) => d.value > 0) && (
          <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-neutral-400">
            {t('legend.less')}
            {HEAT_COLORS.map((c) => (
              <span key={c} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />
            ))}
            {t('legend.more')}
          </div>
        )}
      </Section>

      <Section title={t('sections.last30')} aside={<span className="text-xs text-neutral-400">{t('sections.last30Aside')}</span>}>
        <ActivityChart data={series} />
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title={t('sections.learning')}>
          <div className="space-y-3">
            {review.decks.map((d) => (
              <ProgressBar key={d.deck} label={DECK_META[d.deck].label} total={d.total} seen={d.seen} due={d.due} />
            ))}
          </div>
        </Section>

        <Section title={t('sections.bests')}>
          <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
            {[
              { label: t('bests.puzzleRush'), value: rushBest },
              { label: t('bests.puzzleStorm'), value: stormBest },
              { label: t('bests.coordWhite'), value: coordBest.white },
              { label: t('bests.coordBlack'), value: coordBest.black },
              { label: t('bests.squareColour'), value: coordByMode.color },
              { label: t('bests.knightsTour'), value: coordByMode.knight },
            ].map((b) => (
              <div key={b.label}>
                <div className="font-display text-2xl font-bold text-brand-300">{b.value}</div>
                <div className="text-xs uppercase tracking-wide text-neutral-400">{b.label}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
