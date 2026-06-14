import { useGamify, levelProgress } from '../store/gamify';
import { useRatings, RATING_CATEGORIES } from '../store/ratings';
import { useSettings } from '../store/settings';
import { useLadder } from '../store/ladder';
import { BOT_ROSTER, type RosterBot } from '../data/botRoster';
import { RatingMeter } from '../components/RatingMeter';
import { DailyGoal } from '../components/DailyGoal';
import { AchievementGrid } from '../components/AchievementGrid';

function LevelHeader() {
  const xp = useGamify((s) => s.xp);
  const { level, intoLevel, span, toNext, pct } = levelProgress(xp);
  return (
    <div className="rounded-lg bg-panel p-4">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full bg-emerald-600 text-white">
          <span className="text-[9px] uppercase tracking-wide opacity-80">level</span>
          <span className="text-2xl font-bold leading-none">{level}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-semibold text-ink">{xp.toLocaleString()} XP</span>
            <span className="text-xs text-neutral-500">{toNext} XP to level {level + 1}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-right text-[11px] text-neutral-600">
            {intoLevel} / {span}
          </div>
        </div>
      </div>
    </div>
  );
}

function MeterToggle() {
  const meter = useSettings((s) => s.ratingMeter);
  const setMeter = useSettings((s) => s.setRatingMeter);
  return (
    <div className="inline-flex overflow-hidden rounded border border-neutral-700 text-xs">
      {(['elo', 'glicko'] as const).map((m) => (
        <button
          key={m}
          onClick={() => setMeter(m)}
          className={`px-2.5 py-1 capitalize ${meter === m ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
        >
          {m === 'glicko' ? 'Glicko-2' : 'Elo'}
        </button>
      ))}
    </div>
  );
}

/** Picks the opponent nearest the player's Glicko bots rating — the next
 *  un-cleared rung if there is one, otherwise the closest match overall. */
function suggestOpponent(glicko: number, defeated: Record<string, number>): RosterBot {
  const nearest = (pool: RosterBot[]) =>
    pool.reduce((best, b) => (Math.abs(b.rating - glicko) < Math.abs(best.rating - glicko) ? b : best), pool[0]!);
  const unbeaten = BOT_ROSTER.filter((b) => !(b.id in defeated));
  return nearest(unbeaten.length ? unbeaten : BOT_ROSTER);
}

function SuggestedOpponent({ goPlay }: { goPlay: () => void }) {
  const glicko = useRatings((s) => Math.round(s.categories.bots.glicko.rating));
  const defeated = useLadder((s) => s.defeated);
  const bot = suggestOpponent(glicko, defeated);
  return (
    <div className="rounded-lg bg-panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">Suggested next opponent</h3>
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl"
          style={{ background: `${bot.accent}22`, border: `1px solid ${bot.accent}66` }}
        >
          {bot.motif}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">
            {bot.name} <span className="font-normal text-neutral-500">· {bot.rating}</span>
          </div>
          <div className="truncate text-xs text-neutral-500">{bot.title}</div>
        </div>
        <button onClick={goPlay} className="shrink-0 rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
          Play
        </button>
      </div>
      <p className="mt-2 text-[11px] text-neutral-600">Matched to your Glicko-2 bots rating ({glicko}).</p>
    </div>
  );
}

export function ProfilePage({ goPlay }: { goPlay: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">Profile</h2>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>Show ratings as</span>
          <MeterToggle />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LevelHeader />
        <DailyGoal />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {RATING_CATEGORIES.map((cat) => (
          <RatingMeter key={cat} category={cat} />
        ))}
      </div>

      <SuggestedOpponent goPlay={goPlay} />

      <AchievementGrid />
    </div>
  );
}
