/**
 * Primary navigation for the 5-hub IA: Home · Play · Train · Learn · Profile.
 * Same items, order, icons and labels everywhere — a left sidebar on desktop
 * (lg+) and a fixed bottom bar on small screens. Always icon + visible text,
 * never icon-only. Active state via NavLink's aria-current="page".
 */
import type { ComponentType, SVGProps } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGame } from '../store/game';
import { InstallButton } from '../components/InstallButton';
import {
  IconLearn,
  IconPlay,
  IconProfile,
  IconToday,
  IconTrain,
  LogoMark,
  Wordmark,
} from '../components/icons';
import { playSound } from '../lib/sound';

type HubIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export const HUBS: { id: 'home' | 'play' | 'train' | 'learn' | 'profile'; path: string; end: boolean; icon: HubIcon }[] = [
  { id: 'home', path: '/', end: true, icon: IconToday },
  { id: 'play', path: '/play', end: false, icon: IconPlay },
  { id: 'train', path: '/train', end: false, icon: IconTrain },
  { id: 'learn', path: '/learn', end: false, icon: IconLearn },
  { id: 'profile', path: '/profile', end: false, icon: IconProfile },
];

export function StatusDot({ withLabel = true }: { withLabel?: boolean }) {
  const { t } = useTranslation('nav');
  const connected = useGame((s) => s.connected);
  return (
    <span
      role="status"
      title={connected ? t('status.connectedTooltip') : t('status.connectingTooltip')}
      className={`flex items-center gap-1.5 text-xs font-semibold ${connected ? 'text-emerald-400' : 'text-rose-400'}`}
    >
      <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'animate-pulse-soft bg-rose-400'}`} />
      {withLabel && (connected ? t('status.online') : t('status.connecting'))}
    </span>
  );
}

export function EngineBadges() {
  const availability = useGame((s) => s.availability);
  if (!availability) return null;
  const badge = (ok: boolean, label: string) => (
    <span className={`rounded-full px-2 py-0.5 ${ok ? 'bg-emerald-900/60 text-emerald-300' : 'bg-neutral-800 text-neutral-400'}`}>
      {label}
    </span>
  );
  return (
    <span className="flex flex-wrap gap-1.5 text-xs text-neutral-400">
      {badge(availability.stockfish, 'Stockfish')}
      {badge(availability.lc0, 'Maia')}
      {availability.syzygy &&
        badge(true, `Syzygy${availability.syzygyMaxPieces ? ` ≤${availability.syzygyMaxPieces}` : ''}`)}
    </span>
  );
}

const itemBase = 'btn-press flex items-center gap-2.5 rounded-full px-3.5 py-2.5 text-sm font-semibold';
const itemActive = 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow';
const itemIdle = 'text-neutral-300 hover:bg-neutral-800 hover:text-ink';

/** Desktop-only left sidebar (hidden below lg). */
export function Sidebar() {
  const { t } = useTranslation('nav');
  return (
    <div className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-neutral-800/80 bg-page/85 px-3 py-4 lg:flex">
      <a href="#/" className="mb-5 flex items-center gap-2 px-1.5" aria-label={t('footer.tagline')}>
        <LogoMark size={30} />
        <Wordmark className="text-ink" />
      </a>
      <nav aria-label={t('mainNav')} className="flex flex-col gap-1">
        {HUBS.map((hub) => {
          const Icon = hub.icon;
          return (
            <NavLink
              key={hub.id}
              to={hub.path}
              end={hub.end}
              onClick={() => playSound('uiClick')}
              title={t(`hubs.${hub.id}.hint`)}
              className={({ isActive }) => `${itemBase} ${isActive ? itemActive : itemIdle}`}
            >
              {({ isActive }) => (
                <>
                  {/* white/85, not brand-300: the active pill's gradient stays
                      dark in both themes (brand-300 flips in light mode). */}
                  <Icon size={18} className={isActive ? 'text-white/85' : 'text-neutral-400'} />
                  {t(`hubs.${hub.id}.label`)}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
      {/* Engine/connection status + install live down here on desktop
          (on mobile they're rows under Profile → About). */}
      <div className="mt-auto flex flex-col gap-2.5 px-1.5 pt-4">
        <EngineBadges />
        <StatusDot />
        <InstallButton />
      </div>
    </div>
  );
}

/** Mobile/tablet bottom bar (hidden from lg up). ≤5 items, 44px+ targets. */
export function BottomBar() {
  const { t } = useTranslation('nav');
  return (
    <nav
      aria-label={t('mainNav')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800/80 bg-page/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex h-16 max-w-[640px] items-stretch justify-around">
        {HUBS.map((hub) => {
          const Icon = hub.icon;
          return (
            <NavLink
              key={hub.id}
              to={hub.path}
              end={hub.end}
              onClick={() => playSound('uiClick')}
              className={({ isActive }) =>
                `flex min-w-16 flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-semibold ${
                  isActive ? 'text-brand-300' : 'text-neutral-400'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-7 w-12 items-center justify-center rounded-full ${
                      isActive ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white' : ''
                    }`}
                  >
                    <Icon size={19} />
                  </span>
                  {t(`hubs.${hub.id}.label`)}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
