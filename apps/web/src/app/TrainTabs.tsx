/**
 * Second-level segmented tabs for Train sub-pages (Tactics modes, Endgames
 * Study/Drill). Peers within ONE page — never a third nav level below them.
 *
 * A11y: real router links (`aria-current="page"` comes from NavLink), and the
 * active state is weight + an indicator bar — never colour alone. The strip
 * scrolls horizontally on small screens. Train-local on purpose: the shared
 * HubTabs pill strip keeps its glow style for the other hubs.
 */
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { playSound } from '../lib/sound';

export interface TrainTab {
  /** i18n key under nav:sections.* — also the testid suffix. */
  id: string;
  to: string;
  /** Exact-match only (index tabs), so sibling tabs can nest below. */
  end?: boolean;
  /** Optional count chip (e.g. saved mistakes); hidden when 0/undefined. */
  badge?: number;
}

export function TrainTabs({ label, tabs }: { label: string; tabs: TrainTab[] }) {
  const { t } = useTranslation('nav');
  return (
    <nav aria-label={label} className="scrollbar-none flex w-full items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => (
        <NavLink
          key={tab.id}
          to={tab.to}
          end={tab.end ?? false}
          onClick={() => playSound('uiClick')}
          data-testid={`train-tab-${tab.id}`}
          className={({ isActive }) =>
            `btn-press relative flex min-h-11 items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 text-sm sm:min-h-9 ${
              isActive ? 'font-bold text-ink' : 'font-medium text-neutral-400 hover:text-ink'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {t(`sections.${tab.id}.label`)}
              {typeof tab.badge === 'number' && tab.badge > 0 && (
                <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-neutral-300">
                  {tab.badge}
                </span>
              )}
              {/* Indicator bar: the not-colour-only half of the active state. */}
              <span
                aria-hidden="true"
                className={`absolute inset-x-3 bottom-0.5 h-0.5 rounded-full ${isActive ? 'bg-brand-500' : 'bg-transparent'}`}
              />
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
