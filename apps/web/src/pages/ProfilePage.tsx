import { useTranslation } from 'react-i18next';
import { useGamify, levelProgress } from '../store/gamify';
import { useRatings } from '../store/ratings';
import { useLadder } from '../store/ladder';
import { BOT_ROSTER, type RosterBot } from '../data/botRoster';
import { RatingsPanel } from '../components/RatingsPanel';
import { DailyGoal } from '../components/DailyGoal';
import { AchievementGrid } from '../components/AchievementGrid';
import { ShareProfilePanel } from '../components/ShareProfilePanel';
import mascotUrl from '../assets/img/mascot.svg';

function LevelHeader() {
  const { t } = useTranslation('profile');
  const xp = useGamify((s) => s.xp);
  const { level, intoLevel, span, toNext, pct } = levelProgress(xp);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-800/60 via-panel to-panel p-4 shadow-soft">
      <img
        src={mascotUrl}
        alt=""
        className="float-soft pointer-events-none absolute bottom-1 right-2 hidden h-24 w-24 sm:block"
      />
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-glow">
          <span className="text-[10px] uppercase tracking-wide">{t('level.badge')}</span>
          <span className="font-display text-2xl font-bold leading-none">{level}</span>
        </div>
        <div className="min-w-0 flex-1 pr-16 sm:pr-20">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-display font-semibold text-ink">{t('level.xp', { xp })}</span>
            <span className="text-xs text-neutral-400">{t('level.toNext', { xp: toNext, level: level + 1 })}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-400 to-accent-400 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 text-right text-xs text-neutral-400">
            {intoLevel} / {span}
          </div>
        </div>
      </div>
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
  const { t } = useTranslation(['profile', 'bots']);
  const glicko = useRatings((s) => Math.round(s.categories.bots.glicko.rating));
  const defeated = useLadder((s) => s.defeated);
  const bot = suggestOpponent(glicko, defeated);
  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <h3 className="mb-3 font-display text-sm font-semibold text-ink">{t('suggested.title')}</h3>
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl"
          style={{ background: `${bot.accent}22`, border: `1px solid ${bot.accent}66` }}
        >
          {bot.motif}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">
            {bot.name} <span className="font-normal text-neutral-400">· {bot.rating}</span>
          </div>
          <div className="truncate text-xs text-neutral-400">{t(`bots:roster.${bot.id}.title`, { defaultValue: bot.title })}</div>
        </div>
        <button
          onClick={goPlay}
          className="btn-press shrink-0 rounded-full bg-brand-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          {t('suggested.play')}
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-400">{t('suggested.matched', { rating: glicko })}</p>
    </div>
  );
}

export function ProfilePage({ goPlay, onViewPublicProfile }: { goPlay: () => void; onViewPublicProfile: (username: string) => void }) {
  const { t } = useTranslation('profile');
  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-4">
      <h1 className="font-display text-xl font-bold text-ink">{t('title')}</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LevelHeader />
        <DailyGoal />
      </div>

      {/* THE canonical ratings display (stats consolidation) — every other
          surface links here instead of repeating the meters. */}
      <RatingsPanel />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SuggestedOpponent goPlay={goPlay} />
        <ShareProfilePanel onPreview={onViewPublicProfile} />
      </div>

      <AchievementGrid />
    </div>
  );
}
