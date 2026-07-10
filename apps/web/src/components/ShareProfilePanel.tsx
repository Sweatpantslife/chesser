import { useState } from 'react';
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

const SECTIONS: { key: keyof SocialPrefs; label: string; desc: string }[] = [
  { key: 'showRatings', label: 'Ratings', desc: 'Puzzles · Bots · Blitz, with peaks' },
  { key: 'showRush', label: 'Puzzle Rush best', desc: 'Your top run' },
  { key: 'showStreak', label: 'Streak', desc: 'Current + best day streak' },
  { key: 'showRecord', label: 'W/D/L record', desc: 'Wins, draws, losses vs bots' },
  { key: 'showAchievements', label: 'Achievements', desc: 'Your latest badges' },
  { key: 'showOpenings', label: 'Favorite openings', desc: 'Most-played openings' },
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
        <h3 className="mb-1 font-display text-sm font-semibold text-ink">Share your profile</h3>
        <p className="text-xs text-neutral-400">
          Sign in (top right) to publish a shareable profile card and join the leaderboards. Sharing is opt-in, per stat.
        </p>
      </div>
    );
  }
  if (!prefs) {
    return (
      <div className="rounded-2xl bg-panel p-4 shadow-soft">
        <h3 className="mb-1 font-display text-sm font-semibold text-ink">Share your profile</h3>
        <p role="status" className="text-xs text-neutral-400">
          Loading your share settings…
        </p>
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
        <h3 className="font-display text-sm font-semibold text-ink">Share your profile</h3>
        {busy && (
          <span role="status" className="text-xs text-neutral-400">
            Saving…
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-neutral-400">
        Everything is private by default. Flip on what you want the world to see — only your display name plus the sections below are
        ever shown, nothing else.
      </p>

      <div className="divide-y divide-neutral-800/70">
        <Toggle
          checked={prefs.profile}
          onChange={(v) => void save({ profile: v })}
          label="Public profile page"
          desc="Anyone with your link can view the shared sections"
        />
        <Toggle
          checked={prefs.leaderboards}
          onChange={(v) => void save({ leaderboards: v })}
          label="Leaderboards"
          desc="Rank your ratings + Puzzle Rush best on the public boards"
        />
        {SECTIONS.map((s) => (
          <Toggle
            key={s.key}
            checked={prefs[s.key]}
            onChange={(v) => void setPref(s.key)(v)}
            disabled={!prefs.profile}
            label={s.label}
            desc={s.desc}
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
          Your profile link
        </label>
        <input
          id="share-profile-link"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-full border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-300"
        />
        <button
          onClick={() => void copyLink()}
          disabled={!prefs.profile}
          title={prefs.profile ? 'Copy your profile link' : 'Enable the public profile first'}
          className="btn-press rounded-full bg-brand-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <button
          onClick={() => onPreview(username)}
          disabled={!prefs.profile}
          title={prefs.profile ? 'See your profile as others do' : 'Enable the public profile first'}
          className="btn-press rounded-full bg-neutral-800 px-4 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink disabled:opacity-50"
        >
          Preview
        </button>
        <button
          onClick={() => void shareCard()}
          disabled={!prefs.profile || cardBusy}
          title={prefs.profile ? 'Download a shareable card image' : 'Enable the public profile first'}
          className="btn-press flex items-center gap-1.5 rounded-full bg-neutral-800 px-4 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink disabled:opacity-50"
        >
          <IconDownload size={14} />
          {cardBusy ? 'Rendering…' : 'Card image'}
        </button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? 'Profile link copied to the clipboard' : ''}
      </span>
    </div>
  );
}
