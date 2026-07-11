import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGetPublicProfile, classifyProfileError, profileUrl, type PublicProfile } from '../lib/socialApi';
import { ACHIEVEMENTS_BY_ID } from '../lib/achievements';
import { downloadProfileCard } from '../lib/profileCard';
import { IconDownload } from '../components/icons';
import { ReportProfileButton } from '../components/ReportProfileButton';

/**
 * A player's public, shareable profile (#/profile/NAME) — renders exactly the
 * sections the owner opted to share (see the Profile tab's share panel). The
 * page works signed-out: it's the landing target of a shared link.
 */

const CATEGORY_META: { id: 'puzzles' | 'bots' | 'blitz'; icon: string }[] = [
  { id: 'puzzles', icon: '🧩' },
  { id: 'bots', icon: '♟️' },
  { id: 'blitz', icon: '⚡' },
];

function StatCard({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">
          {icon}
        </span>
        <span className="font-display text-sm font-semibold text-ink">{label}</span>
      </div>
      {children}
    </div>
  );
}

function RecordBar({ wins, draws, losses }: { wins: number; draws: number; losses: number }) {
  const { t } = useTranslation('profile');
  const total = wins + draws + losses;
  if (total === 0) return <p className="text-xs text-neutral-400">{t('public.record.none')}</p>;
  const pct = (n: number) => (n / total) * 100;
  return (
    <div>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-800"
        role="img"
        aria-label={t('public.record.aria', { wins, draws, losses })}
      >
        <div className="h-full bg-emerald-500" style={{ width: `${pct(wins)}%` }} />
        <div className="h-full bg-neutral-500" style={{ width: `${pct(draws)}%` }} />
        <div className="h-full bg-rose-500" style={{ width: `${pct(losses)}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-neutral-400">
        <span className="text-emerald-400">{t('public.record.wins', { count: wins })}</span>
        <span>{t('public.record.draws', { count: draws })}</span>
        <span className="text-rose-400">{t('public.record.losses', { count: losses })}</span>
      </div>
    </div>
  );
}

export function PublicProfilePage({ username }: { username: string }) {
  const { t } = useTranslation(['profile', 'progress']);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setProfile(null);
    apiGetPublicProfile(username)
      .then((p) => {
        if (!cancelled) {
          setProfile(p);
          setState('ready');
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setState(classifyProfileError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl(username));
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard unavailable (permissions/non-secure context) — no-op.
    }
  };

  if (state === 'loading') {
    return (
      <p role="status" className="mx-auto max-w-[760px] py-16 text-center text-sm text-neutral-400">
        {t('public.loading')}
      </p>
    );
  }
  if (state === 'error') {
    return (
      <div className="mx-auto max-w-[560px] rounded-2xl bg-panel p-8 text-center shadow-soft">
        <div aria-hidden="true" className="mb-2 text-3xl">
          📡
        </div>
        <h2 className="font-display text-base font-semibold text-ink">{t('public.error.title')}</h2>
        <p role="alert" className="mt-1 text-sm text-neutral-400">
          {t('public.error.body')}
        </p>
      </div>
    );
  }
  if (state !== 'ready' || !profile) {
    return (
      <div className="mx-auto max-w-[560px] rounded-2xl bg-panel p-8 text-center shadow-soft">
        <div aria-hidden="true" className="mb-2 text-3xl">
          🕵️
        </div>
        <h2 className="font-display text-base font-semibold text-ink">{t('public.missing.title')}</h2>
        <p className="mt-1 text-sm text-neutral-400">
          {t('public.missing.body')}
        </p>
      </div>
    );
  }

  const shared = profile;
  const hasAnything =
    shared.ratings || shared.record || shared.rushBest !== undefined || shared.streak || shared.achievements || shared.favoriteOpenings;

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-4">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-800/60 via-panel to-panel p-5 shadow-soft">
        <div className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 font-display text-3xl font-bold text-white shadow-glow"
          >
            {(shared.username[0] ?? '?').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-2xl font-bold text-ink">{shared.username}</h2>
            <p className="text-xs text-neutral-400">{t('since', { date: shared.memberSince })}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void copyLink()}
              className="btn-press rounded-full bg-brand-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
            >
              {copied ? t('copied') : t('copyLink')}
            </button>
            <button
              onClick={() => void downloadProfileCard(shared).catch(() => undefined)}
              title={t('downloadCard')}
              className="btn-press flex items-center gap-1.5 rounded-full bg-neutral-800 px-4 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink"
            >
              <IconDownload size={14} />
              {t('public.card')}
            </button>
          </div>
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? t('linkCopied') : ''}
        </span>
      </div>

      {!hasAnything && (
        <p className="rounded-2xl bg-panel p-6 text-center text-sm text-neutral-400 shadow-soft">
          {t('public.nothingShared', { username: shared.username })}
        </p>
      )}

      {shared.ratings && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Untouched categories (0 played) are noise on a public card. */}
          {CATEGORY_META.filter((c) => (shared.ratings![c.id]?.played ?? 0) > 0).map((c) => {
            const r = shared.ratings![c.id]!;
            return (
              <StatCard key={c.id} label={t(`categories.${c.id}`)} icon={c.icon}>
                <div className="font-display text-3xl font-bold text-brand-300">{r.elo}</div>
                <div className="mt-0.5 text-xs text-neutral-400">
                  {t('public.ratings.peakPlayed', { peak: r.peak, played: r.played })}
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  {c.id === 'puzzles'
                    ? t('public.ratings.solved', { won: r.won, lost: r.lost })
                    : t('public.ratings.wdl', { won: r.won, drawn: r.drawn, lost: r.lost })}
                </div>
              </StatCard>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {shared.rushBest !== undefined && (
          <StatCard label={t('public.rush.label')} icon="🏃">
            <div className="font-display text-3xl font-bold text-gold-400">{shared.rushBest}</div>
            <div className="mt-0.5 text-xs text-neutral-400">{t('public.rush.hint')}</div>
          </StatCard>
        )}
        {shared.streak && (
          <StatCard label={t('public.streak.label')} icon="🔥">
            <div className="font-display text-3xl font-bold text-accent-400">
              {shared.streak.current}
              <span className="ml-1 text-sm font-semibold text-neutral-400">{t('public.streak.days', { count: shared.streak.current })}</span>
            </div>
            <div className="mt-0.5 text-xs text-neutral-400">
              {t('public.streak.best', { count: shared.streak.best })}
            </div>
          </StatCard>
        )}
        {shared.record && (
          <StatCard label={t('public.record.label')} icon="⚔️">
            <RecordBar wins={shared.record.wins} draws={shared.record.draws} losses={shared.record.losses} />
          </StatCard>
        )}
      </div>

      {shared.achievements && shared.achievements.length > 0 && (
        <div className="rounded-2xl bg-panel p-4 shadow-soft">
          <h3 className="mb-3 font-display text-sm font-semibold text-ink">{t('public.achievements')}</h3>
          <ul className="flex flex-wrap gap-2">
            {shared.achievements.map((a) => {
              const meta = ACHIEVEMENTS_BY_ID[a.id];
              if (!meta) return null;
              return (
                <li
                  key={a.id}
                  title={t(`progress:achievements.${a.id}.desc`, { defaultValue: meta.desc })}
                  className="flex items-center gap-1.5 rounded-full bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-300"
                >
                  <span aria-hidden="true">{meta.icon}</span>
                  {t(`progress:achievements.${a.id}.name`, { defaultValue: meta.name })}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {shared.favoriteOpenings && shared.favoriteOpenings.length > 0 && (
        <div className="rounded-2xl bg-panel p-4 shadow-soft">
          <h3 className="mb-3 font-display text-sm font-semibold text-ink">{t('public.openings.title')}</h3>
          <ul className="space-y-2">
            {shared.favoriteOpenings.map((o) => (
              <li key={o.name} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-semibold text-ink">
                  {o.eco && <span className="mr-2 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-bold text-neutral-400">{o.eco}</span>}
                  {o.name}
                </span>
                <span className="shrink-0 text-xs text-neutral-400">
                  {t('public.openings.row', { count: o.games, wins: o.wins })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col items-center gap-1">
        <p className="text-center text-xs text-neutral-400">{t('public.footer', { username: shared.username })}</p>
        <ReportProfileButton username={shared.username} />
      </div>
    </div>
  );
}
