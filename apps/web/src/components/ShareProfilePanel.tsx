import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth';
import { useSocial } from '../store/social';
import { apiGetPublicProfile, profileUrl, type SocialPrefs } from '../lib/socialApi';
import { computeFavoriteOpenings } from '../lib/favoriteOpenings';
import { downloadProfileCard } from '../lib/profileCard';
import { IconDownload } from './icons';

/**
 * The Profile tab's share affordance: opt-in switches for the public profile
 * and leaderboards, a copy-able share link, and a downloadable card image.
 * Everything defaults OFF — the server exposes only what's flipped on here,
 * and never more than the display name + the chosen stats.
 */

const SECTION_KEYS: (keyof SocialPrefs)[] = [
  'showRatings',
  'showRush',
  'showStreak',
  'showRecord',
  'showAchievements',
  'showOpenings',
];

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  desc: string;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 py-1.5 ${disabled ? 'opacity-50' : ''}`}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block truncate text-xs text-neutral-400">{desc}</span>
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer h-6 w-11 cursor-pointer appearance-none rounded-full bg-neutral-700 transition-colors checked:bg-brand-600 disabled:cursor-not-allowed"
        />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function ShareProfilePanel({ onPreview }: { onPreview: (username: string) => void }) {
  const { t } = useTranslation('profile');
  const token = useAuth((s) => s.token);
  const username = useAuth((s) => s.username);
  const prefs = useSocial((s) => s.prefs);
  const busy = useSocial((s) => s.busy);
  const error = useSocial((s) => s.error);
  const save = useSocial((s) => s.save);
  const [copied, setCopied] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);

  if (!token || !username) {
    return (
      <div className="rounded-2xl bg-panel p-4 shadow-soft">
        <h3 className="mb-1 font-display text-sm font-semibold text-ink">{t('share.title')}</h3>
        <p className="text-xs text-neutral-400">
          {t('share.signedOut')}
        </p>
      </div>
    );
  }
  if (!prefs) {
    // Same silent-failure guard as the Leaderboards page: with prefs null a
    // failed fetch would otherwise leave "Loading…" up forever.
    return (
      <div className="rounded-2xl bg-panel p-4 shadow-soft">
        <h3 className="mb-1 font-display text-sm font-semibold text-ink">{t('share.title')}</h3>
        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="alert" className="text-xs text-rose-400">
              {t('share.loadError', { error })}
            </p>
            <button
              onClick={() => void useSocial.getState().load()}
              className="btn-press rounded-full bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink"
            >
              {t('share.retry')}
            </button>
          </div>
        ) : (
          <p role="status" className="text-xs text-neutral-400">
            {t('share.loading')}
          </p>
        )}
      </div>
    );
  }

  const setPref = (key: keyof SocialPrefs) => async (v: boolean) => {
    // Turning openings on also refreshes the sanitized display data behind it.
    if (key === 'showOpenings' && v) {
      const openings = await computeFavoriteOpenings(token, username).catch(() => []);
      void save({ [key]: v }, openings);
    } else {
      void save({ [key]: v });
    }
  };

  const link = profileUrl(username);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard unavailable — the read-only input still allows manual copy.
    }
  };

  const shareCard = async () => {
    setCardBusy(true);
    try {
      // Render from the server's copy so the card shows exactly what the
      // public page shows — opted-in sections only.
      const profile = await apiGetPublicProfile(username);
      await downloadProfileCard(profile);
    } catch {
      // Profile not public yet or render failed; the button is disabled in
      // the former case, so this is transient.
    } finally {
      setCardBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-ink">{t('share.title')}</h3>
        {busy && (
          <span role="status" className="text-xs text-neutral-400">
            {t('share.saving')}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-neutral-400">
        {t('share.intro')}
      </p>

      <div className="divide-y divide-neutral-800/70">
        <Toggle
          checked={prefs.profile}
          onChange={(v) => void save({ profile: v })}
          label={t('share.profileToggle.label')}
          desc={t('share.profileToggle.desc')}
        />
        <Toggle
          checked={prefs.leaderboards}
          onChange={(v) => void save({ leaderboards: v })}
          label={t('share.leaderboardsToggle.label')}
          desc={t('share.leaderboardsToggle.desc')}
        />
        {SECTION_KEYS.map((key) => (
          <Toggle
            key={key}
            checked={prefs[key]}
            onChange={(v) => void setPref(key)(v)}
            disabled={!prefs.profile}
            label={t(`share.sections.${key}.label`)}
            desc={t(`share.sections.${key}.desc`)}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-400">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="share-profile-link" className="sr-only">
          {t('share.linkLabel')}
        </label>
        <input
          id="share-profile-link"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-full border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-300"
        />
        {/* Neutral on purpose: Overview's single accent CTA is the suggested
            opponent's "Play" (one accent primary per Profile tab). */}
        <button
          onClick={() => void copyLink()}
          disabled={!prefs.profile}
          title={prefs.profile ? t('share.copyTitle') : t('share.enableFirst')}
          className="btn-press rounded-full bg-neutral-800 px-4 py-1.5 text-sm font-bold text-neutral-200 hover:bg-neutral-700 hover:text-ink disabled:opacity-50"
        >
          {copied ? t('copied') : t('copyLink')}
        </button>
        <button
          onClick={() => onPreview(username)}
          disabled={!prefs.profile}
          title={prefs.profile ? t('share.previewTitle') : t('share.enableFirst')}
          className="btn-press rounded-full bg-neutral-800 px-4 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink disabled:opacity-50"
        >
          {t('share.preview')}
        </button>
        <button
          onClick={() => void shareCard()}
          disabled={!prefs.profile || cardBusy}
          title={prefs.profile ? t('downloadCard') : t('share.enableFirst')}
          className="btn-press flex items-center gap-1.5 rounded-full bg-neutral-800 px-4 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink disabled:opacity-50"
        >
          <IconDownload size={14} />
          {cardBusy ? t('share.rendering') : t('share.cardImage')}
        </button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t('linkCopied') : ''}
      </span>
    </div>
  );
}
