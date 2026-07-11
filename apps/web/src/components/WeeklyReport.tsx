/**
 * "Your week in chess" — the Today-page recap card.
 *
 * Pure aggregation lives in lib/weeklyReport (deterministic, clock-injected);
 * this component only gathers store snapshots, renders the stats, and shows
 * the narrative. The narrative is the rule-based template for everyone, and
 * silently upgrades to LLM wording when an AI key is available (the user's
 * own BYOK key, or a self-hoster's server env key). The AI wording is cached
 * in localStorage per facts-payload so re-opening the Today page never
 * re-bills the user's key for an unchanged week.
 */
import { useEffect, useMemo, useState } from 'react';
import { now } from '../lib/clock';
import {
  buildWeeklyNarrative,
  buildWeeklyReport,
  buildWeeklyReportFacts,
  type WeeklyReport,
} from '../lib/weeklyReport';
import { explainWithCoach, skillLevelFromRating } from '../lib/coachApi';
import { useGamify } from '../store/gamify';
import { useStreak } from '../store/streak';
import { useLessons } from '../store/lessons';
import { useCoach } from '../store/coach';
import { useSprints } from '../store/sprints';
import { useRatings } from '../store/ratings';
import { useSettings } from '../store/settings';
import { AiCoachBadge, useCoachAvailable } from './analysis/AiCoach';

const AI_CACHE_KEY = 'chesser-weekly-ai';

/** Cached AI wording for one exact facts payload (survives reloads). */
function readCachedAi(factsKey: string): string | null {
  try {
    const raw = localStorage.getItem(AI_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { key?: string; text?: string };
    return parsed.key === factsKey && typeof parsed.text === 'string' ? parsed.text : null;
  } catch {
    return null;
  }
}

function writeCachedAi(factsKey: string, text: string): void {
  try {
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify({ key: factsKey, text }));
  } catch {
    /* storage full/unavailable — the session memo still dedupes */
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-neutral-800/70 px-2.5 py-1.5">
      <div className="text-sm font-bold leading-tight text-ink">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</div>
    </div>
  );
}

function statsOf(r: WeeklyReport): { label: string; value: string }[] {
  const stats: { label: string; value: string }[] = [
    { label: 'days active', value: `${r.activeDays}/7` },
    { label: 'XP earned', value: r.xpEarned.toLocaleString() },
  ];
  if (r.games.played > 0) stats.push({ label: 'games (W–L–D)', value: `${r.games.wins}–${r.games.losses}–${r.games.draws}` });
  if (r.games.bestAccuracy !== null) stats.push({ label: 'best accuracy', value: `${r.games.bestAccuracy}%` });
  if (r.puzzles.delta !== null && r.puzzles.delta !== 0) {
    stats.push({ label: 'puzzle rating', value: `${r.puzzles.delta > 0 ? '+' : ''}${r.puzzles.delta}` });
  }
  if (r.sprints.newRushBest !== null) stats.push({ label: 'new Rush best', value: String(r.sprints.newRushBest) });
  if (r.sprints.newStormBest !== null) stats.push({ label: 'new Storm best', value: String(r.sprints.newStormBest) });
  if (r.lessons.completed > 0) stats.push({ label: 'lessons', value: String(r.lessons.completed) });
  if (r.training.attempts > 0) stats.push({ label: 'drills solved', value: `${r.training.solved}/${r.training.attempts}` });
  return stats.slice(0, 6);
}

export function WeeklyReportCard(): JSX.Element {
  // One reference time per mount — the report is deterministic given it.
  const [atMs] = useState(() => now());

  const days = useGamify((s) => s.days);
  const streak = useStreak((s) => s.current());
  const lessons = useLessons((s) => s.completed);
  const digests = useCoach((s) => s.games);
  const trainingLog = useCoach((s) => s.trainingLog);
  const rushBest = useSprints((s) => s.puzzleRushBest);
  const stormBest = useSprints((s) => s.puzzleStormBest);
  const puzzleHistory = useRatings((s) => s.categories.puzzles.history);
  const skillRating = useRatings((s) => s.categories.bots.glicko.rating);
  const aiCoach = useSettings((s) => s.aiCoach);
  const available = useCoachAvailable();

  const report = useMemo(
    () =>
      buildWeeklyReport(
        {
          days,
          streak,
          lessons,
          games: Object.values(digests),
          training: trainingLog,
          rushBests: [rushBest.timed3, rushBest.survival],
          stormBest,
          puzzleHistory,
        },
        atMs,
      ),
    [days, streak, lessons, digests, trainingLog, rushBest, stormBest, puzzleHistory, atMs],
  );

  const facts = useMemo(() => buildWeeklyReportFacts(report), [report]);
  const factsKey = useMemo(() => JSON.stringify(facts), [facts]);
  const fallback = facts.ruleBasedText ?? buildWeeklyNarrative(report);

  const [aiText, setAiText] = useState<string | null>(() => readCachedAi(factsKey));
  useEffect(() => {
    setAiText(readCachedAi(factsKey));
    if (!aiCoach || available !== true || !report.hasActivity || readCachedAi(factsKey) !== null) return;
    let live = true;
    void explainWithCoach(facts, skillLevelFromRating(Math.round(skillRating))).then((prose) => {
      if (!live || !prose) return;
      setAiText(prose);
      writeCachedAi(factsKey, prose);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factsKey, aiCoach, available]);

  return (
    <section data-testid="weekly-report" className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-ink">
          Your week in chess <span className="ml-1 text-xs font-normal text-neutral-400">{report.label}</span>
        </h2>
        {aiText && <AiCoachBadge />}
      </div>

      {report.hasActivity && (
        <div className="mb-3 flex flex-wrap gap-2">
          {statsOf(report).map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
      )}

      <p data-testid="weekly-narrative" className="text-sm leading-relaxed text-neutral-200">
        {aiText ?? fallback}
      </p>
      {aiText && <p className="mt-1 text-[10px] text-neutral-400">AI-generated from your verified weekly stats</p>}
      {available === false && (
        <p data-testid="weekly-ai-hint" className="mt-1.5 text-xs text-neutral-400">
          Add your own AI key in Settings to unlock a personalised AI recap — this summary works without one.
        </p>
      )}
    </section>
  );
}
