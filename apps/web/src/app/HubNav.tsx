/**
 * Secondary (per-hub) navigation: a horizontal strip of router links shown at
 * the top of a hub, so every page that used to be a top-level tab stays
 * reachable in ≤2 taps (hub → section). Phase-1 chrome only — the pages
 * themselves render unchanged below.
 */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { playSound } from '../lib/sound';

export interface HubTab {
  /** i18n key under nav:sections.* — also the testid suffix. */
  id: string;
  to: string;
  /** Exact-match only (hub index tabs), so siblings can nest below the hub. */
  end?: boolean;
}

const tabBase = 'btn-press flex min-h-11 items-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold sm:min-h-9';
const tabActive = 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow';
const tabIdle = 'text-neutral-300 hover:bg-neutral-800 hover:text-ink';

/**
 * `label` = aria-label for the group, e.g. t('sectionsNavLabel', {hub}).
 * `trailing` renders after the tabs (secondary links like "Game history →").
 */
export function HubTabs({ label, tabs, trailing }: { label: string; tabs: HubTab[]; trailing?: ReactNode }) {
  const { t } = useTranslation('nav');
  return (
    <nav
      aria-label={label}
      className="scrollbar-none mx-auto mb-4 flex w-full max-w-[1200px] items-center gap-1 overflow-x-auto"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.id}
          to={tab.to}
          end={tab.end ?? false}
          onClick={() => playSound('uiClick')}
          title={t(`sections.${tab.id}.hint`, { defaultValue: '' }) || undefined}
          className={({ isActive }) => `${tabBase} ${isActive ? tabActive : tabIdle}`}
        >
          {t(`sections.${tab.id}.label`)}
        </NavLink>
      ))}
      {trailing}
    </nav>
  );
}

/** A quieter trailing link for non-tab destinations next to a HubTabs strip. */
export function HubSideLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      onClick={() => playSound('uiClick')}
      className={({ isActive }) =>
        `btn-press flex min-h-11 items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium sm:min-h-9 ${
          isActive ? tabActive : 'text-neutral-400 underline decoration-neutral-600 underline-offset-4 hover:text-ink'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
