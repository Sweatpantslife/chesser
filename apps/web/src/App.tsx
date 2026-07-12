import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  HashRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGame } from './store/game';
import { useAuth } from './store/auth';
import { AccountButton } from './components/AccountPanel';
import { HomePage } from './pages/HomePage';
import type { TacticsMode } from './pages/TacticsPage';
import { Footer } from './components/Footer';
import { ConsentNotice } from './components/ConsentNotice';
import { LevelBadge } from './components/LevelBadge';
import { GamifyToasts } from './components/GamifyToasts';
import { Celebration } from './components/Celebration';
import { initGamify } from './lib/gamify';
import { initSocial } from './store/social';
import { playSound } from './lib/sound';
import { legacyRedirect, profileAliasRedirect, viewPath } from './app/paths';
import { Sidebar, BottomBar, StatusDot } from './app/PrimaryNav';
import { HubTabs, HubSideLink, type HubTab } from './app/HubNav';
import { TrainTabs, type TrainTab } from './app/TrainTabs';
import { TrainHub } from './app/TrainHub';
import { useMistakes } from './store/mistakes';
import { AboutPage } from './app/AboutPage';
import { WhatMovedTour } from './app/WhatMovedTour';
import { IconGear, LogoMark, Wordmark } from './components/icons';

// Route-level code splitting: only the app shell + Home page ship in the
// initial chunk. Every other view — and the settings dialog — is a lazy
// chunk fetched on first navigation (then cached; the service worker also
// precaches them in the background, so offline still covers every view).
const SettingsDialog = lazy(() => import('./components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })));
const PlayPage = lazy(() => import('./pages/PlayPage').then((m) => ({ default: m.PlayPage })));
const HumansPage = lazy(() => import('./humans/HumansPage').then((m) => ({ default: m.HumansPage })));
const LearnPage = lazy(() => import('./pages/LearnPage').then((m) => ({ default: m.LearnPage })));
const MastersPage = lazy(() => import('./pages/MastersPage').then((m) => ({ default: m.MastersPage })));
const OpeningsPage = lazy(() => import('./pages/OpeningsPage').then((m) => ({ default: m.OpeningsPage })));
const ExplorerPage = lazy(() => import('./pages/ExplorerPage').then((m) => ({ default: m.ExplorerPage })));
const TacticsPage = lazy(() => import('./pages/TacticsPage').then((m) => ({ default: m.TacticsPage })));
const EndgamePage = lazy(() => import('./pages/EndgamePage').then((m) => ({ default: m.EndgamePage })));
const EndgameDrillsPage = lazy(() => import('./pages/EndgameDrillsPage').then((m) => ({ default: m.EndgameDrillsPage })));
const VisionPage = lazy(() => import('./pages/VisionPage').then((m) => ({ default: m.VisionPage })));
const MatesPage = lazy(() => import('./pages/MatesPage').then((m) => ({ default: m.MatesPage })));
const AntiBlunderPage = lazy(() => import('./pages/AntiBlunderPage').then((m) => ({ default: m.AntiBlunderPage })));
const CoordinatePage = lazy(() => import('./pages/CoordinatePage').then((m) => ({ default: m.CoordinatePage })));
const StatsPage = lazy(() => import('./pages/StatsPage').then((m) => ({ default: m.StatsPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const StudyPlanPage = lazy(() => import('./pages/StudyPlanPage').then((m) => ({ default: m.StudyPlanPage })));
const ArchivePage = lazy(() => import('./pages/ArchivePage').then((m) => ({ default: m.ArchivePage })));
const LeaderboardsPage = lazy(() => import('./pages/LeaderboardsPage').then((m) => ({ default: m.LeaderboardsPage })));
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage').then((m) => ({ default: m.PublicProfilePage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/TermsPage').then((m) => ({ default: m.TermsPage })));

/** Top bar: logo (mobile — the sidebar carries it on desktop) + account cluster. */
function Header() {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-800/80 bg-page/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-2.5">
        <h1 className="flex items-center gap-2 lg:sr-only">
          <LogoMark size={30} />
          <Wordmark className="text-ink" />
          <span className="sr-only">{t('srTagline')}</span>
        </h1>
        <div className="ml-auto flex items-center gap-2.5 text-xs">
          {/* Connection status lives in the sidebar footer on desktop. */}
          <span className="lg:hidden">
            <StatusDot />
          </span>
          <LevelBadge onClick={() => navigate('/profile')} />
          <button
            onClick={() => setSettingsOpen(true)}
            title={t('settings')}
            aria-label={t('settings')}
            className="btn-press flex min-h-11 min-w-11 items-center justify-center rounded-full bg-neutral-800 p-2 text-neutral-300 hover:bg-neutral-700 hover:text-ink sm:min-h-0 sm:min-w-0"
          >
            <IconGear size={16} />
          </button>
          <AccountButton />
        </div>
      </div>
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </header>
  );
}

/* ------------------------------- hubs ---------------------------------- */

/**
 * Suspense sits INSIDE each hub, so the hub's own tab strip stays visible
 * while a lazy sub-page chunk is in flight (no whole-page blink).
 */
function PlayHub({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('nav');
  const tabs: HubTab[] = [
    { id: 'bots', to: '/play', end: true },
    { id: 'friends', to: '/play/friends' },
  ];
  return (
    <div>
      <HubTabs
        label={t('hubSections', { hub: t('hubs.play.label') })}
        tabs={tabs}
        trailing={
          <>
            <HubSideLink to="/play/analysis">{t('sections.analysis.label')}</HubSideLink>
            {/* Owner decision: the game archive lives under Profile; Play links to it. */}
            <HubSideLink to="/profile/archive">{t('sections.gameHistory')} →</HubSideLink>
          </>
        }
      />
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}

function LearnHub({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('nav');
  const tabs: HubTab[] = [
    { id: 'lessons', to: '/learn', end: true },
    { id: 'openings', to: '/learn/openings' },
    { id: 'masters', to: '/learn/masters' },
  ];
  return (
    <div>
      <HubTabs label={t('hubSections', { hub: t('hubs.learn.label') })} tabs={tabs} />
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}

function ProfileHub({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('nav');
  const tabs: HubTab[] = [
    { id: 'overview', to: '/profile', end: true },
    { id: 'progress', to: '/profile/progress' },
    { id: 'archive', to: '/profile/archive' },
    { id: 'leaderboards', to: '/profile/leaderboards' },
    { id: 'about', to: '/profile/about' },
  ];
  return (
    <div>
      <HubTabs label={t('hubSections', { hub: t('hubs.profile.label') })} tabs={tabs} />
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}

/**
 * Chrome for Train sub-pages: a way back to the hub's card grid, the page's
 * `h1` (route-change focus lands here — see useRouteFocus) and, when a page
 * has peer modes (Tactics, Endgames), the second-level segmented tabs.
 */
function TrainSection({ section, tabs, children }: { section: string; tabs?: TrainTab[]; children: React.ReactNode }) {
  const { t } = useTranslation('nav');
  return (
    <div>
      <div className="mx-auto mb-4 w-full max-w-[1200px]">
        <Link
          to="/train"
          onClick={() => playSound('uiClick')}
          className="btn-press inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-2 py-1.5 text-sm font-semibold text-neutral-400 hover:bg-neutral-800 hover:text-ink sm:min-h-9"
        >
          ← {t('hubs.train.label')}
        </Link>
        <h1 className="mt-1 px-2 font-display text-xl font-bold text-ink">{t(`sections.${section}.label`)}</h1>
        <p className="px-2 text-xs text-neutral-400">{t(`sections.${section}.hint`)}</p>
        {tabs && (
          <div className="mt-2">
            <TrainTabs label={t('hubSections', { hub: t('hubs.train.label') })} tabs={tabs} />
          </div>
        )}
      </div>
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}

/* --------------------------- route wrappers ----------------------------- */

function HomeRoute() {
  const navigate = useNavigate();
  return (
    <HomePage
      go={(v) => navigate(viewPath(v))}
      onDailyPuzzle={() => navigate('/train/tactics?daily=1')}
      onSprint={(m) => navigate(`/train/tactics/${m}`)}
    />
  );
}

const TACTICS_MODES: TacticsMode[] = ['practice', 'rush', 'storm', 'mistakes'];

/** Tactics sub-page: mode tabs are routed second-level tabs (real links). */
function TacticsRoute() {
  const { mode } = useParams();
  const [params, setParams] = useSearchParams();
  const mistakeCount = useMistakes((s) => s.cards.length);
  // Canonical practice URL is /train/tactics (no segment); unknown modes land there too.
  if (mode !== undefined && (mode === 'practice' || !TACTICS_MODES.includes(mode as TacticsMode))) {
    return <Navigate to="/train/tactics" replace />;
  }
  const tabs: TrainTab[] = [
    { id: 'practice', to: '/train/tactics', end: true },
    { id: 'rush', to: '/train/tactics/rush' },
    { id: 'storm', to: '/train/tactics/storm' },
    { id: 'mistakes', to: '/train/tactics/mistakes', badge: mistakeCount },
  ];
  return (
    <TrainSection section="tactics" tabs={tabs}>
      <TacticsPage
        mode={(mode as TacticsMode | undefined) ?? 'practice'}
        openDaily={params.get('daily') === '1'}
        onDailyOpened={() => setParams({}, { replace: true })}
      />
    </TrainSection>
  );
}

function EndgamesRoute({ tab }: { tab: 'study' | 'drill' }) {
  const tabs: TrainTab[] = [
    { id: 'study', to: '/train/endgames', end: true },
    { id: 'drill', to: '/train/endgames/drill' },
  ];
  return (
    <TrainSection section="endgames" tabs={tabs}>
      {tab === 'study' ? <EndgamePage /> : <EndgameDrillsPage />}
    </TrainSection>
  );
}

function OpeningsRoute({ view }: { view: 'repertoire' | 'explore' }) {
  const navigate = useNavigate();
  const tabs: HubTab[] = [
    { id: 'repertoire', to: '/learn/openings', end: true },
    { id: 'explore', to: '/learn/openings/explore' },
  ];
  const { t } = useTranslation('nav');
  return (
    <div>
      <HubTabs label={t('hubSections', { hub: t('sections.openings.label') })} tabs={tabs} />
      {view === 'repertoire' ? <OpeningsPage /> : <ExplorerPage goAnalyze={() => navigate('/play/analysis')} />}
    </div>
  );
}

function PublicProfileRoute() {
  const { username = '' } = useParams();
  // Reserved hub segments are never usernames (see app/paths.ts).
  const alias = profileAliasRedirect(username);
  if (alias) return <Navigate to={alias} replace />;
  return <PublicProfilePage username={username} />;
}

/**
 * Catch-all: every pre-IA URL (old share links, emails, bookmarks — e.g.
 * #/friend/CODE, #/privacy, #/tactics) redirects to its new home; anything
 * truly unknown lands on Home rather than a dead end.
 */
function LegacyRedirectRoute() {
  const { pathname, search } = useLocation();
  const to = legacyRedirect(pathname);
  return <Navigate to={to ? { pathname: to, search } : '/'} replace />;
}

function AppRoutes() {
  const navigate = useNavigate();
  const goAnalysis = () => navigate('/play/analysis');
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />

      {/* Play — Bots · Friends (+ Analysis sub-page, Game-history link) */}
      <Route path="/play" element={<PlayHub><PlayPage /></PlayHub>} />
      <Route path="/play/analysis" element={<PlayHub><PlayPage /></PlayHub>} />
      {/* Friends renders through the keep-mounted slot in AppShell so a live
          human-vs-human game survives navigation; the route only draws chrome. */}
      <Route path="/play/friends" element={<PlayHub>{null}</PlayHub>} />
      <Route path="/play/friends/:code" element={<PlayHub>{null}</PlayHub>} />

      {/* Train — hub cards + Coach & Plan strip; each trainer is a sub-page */}
      <Route path="/train" element={<TrainHub />} />
      <Route path="/train/tactics" element={<TacticsRoute />} />
      <Route path="/train/tactics/:mode" element={<TacticsRoute />} />
      <Route path="/train/endgames" element={<EndgamesRoute tab="study" />} />
      <Route path="/train/endgames/drill" element={<EndgamesRoute tab="drill" />} />
      <Route path="/train/vision" element={<TrainSection section="vision"><VisionPage /></TrainSection>} />
      <Route path="/train/checkmates" element={<TrainSection section="checkmates"><MatesPage /></TrainSection>} />
      <Route path="/train/anti-blunder" element={<TrainSection section="antiBlunder"><AntiBlunderPage /></TrainSection>} />
      <Route path="/train/coordinates" element={<TrainSection section="coordinates"><CoordinatePage /></TrainSection>} />
      <Route path="/train/plan" element={<TrainSection section="plan"><StudyPlanPage /></TrainSection>} />

      {/* Learn — Lessons · Openings (Repertoire/Explore) · Masters */}
      <Route path="/learn" element={<LearnHub><LearnPage /></LearnHub>} />
      <Route path="/learn/openings" element={<LearnHub><OpeningsRoute view="repertoire" /></LearnHub>} />
      <Route path="/learn/openings/explore" element={<LearnHub><OpeningsRoute view="explore" /></LearnHub>} />
      <Route path="/learn/masters" element={<LearnHub><MastersPage goPlay={goAnalysis} /></LearnHub>} />

      {/* Profile — Overview · Progress · Archive · Leaderboards · About */}
      <Route
        path="/profile"
        element={
          <ProfileHub>
            <ProfilePage goPlay={() => navigate('/play')} onViewPublicProfile={(u) => navigate(`/profile/${encodeURIComponent(u)}`)} />
          </ProfileHub>
        }
      />
      <Route path="/profile/progress" element={<ProfileHub><StatsPage /></ProfileHub>} />
      <Route path="/profile/archive" element={<ProfileHub><ArchivePage goPlay={goAnalysis} /></ProfileHub>} />
      <Route
        path="/profile/leaderboards"
        element={<ProfileHub><LeaderboardsPage onViewProfile={(u) => navigate(`/profile/${encodeURIComponent(u)}`)} /></ProfileHub>}
      />
      <Route path="/profile/about" element={<ProfileHub><AboutPage /></ProfileHub>} />
      <Route path="/profile/about/privacy" element={<ProfileHub><PrivacyPage /></ProfileHub>} />
      <Route path="/profile/about/terms" element={<ProfileHub><TermsPage /></ProfileHub>} />
      {/* Shared public profiles: #/profile/NAME URLs are preserved as-is.
          Static hub tabs above outrank the param route; reserved words are
          additionally guarded inside. */}
      <Route path="/profile/:username" element={<PublicProfileRoute />} />

      {/* Legacy URLs (redirect table) + unknown → Home */}
      <Route path="*" element={<LegacyRedirectRoute />} />
    </Routes>
  );
}

/* ------------------------------- shell ---------------------------------- */

/** Move focus to the new page's first heading on route change (a11y). */
function useRouteFocus() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    const main = document.getElementById('main');
    if (!main) return;
    // Ground focus in the content region immediately…
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
    // …then hand it to the page's first heading once the (possibly lazy)
    // page has rendered. Retries stop if the user moved focus themselves.
    let cancelled = false;
    const tryHeading = (attempt: number) => {
      if (cancelled) return;
      const active = document.activeElement;
      if (active !== main && active !== document.body) return; // user took over
      const heading = main.querySelector<HTMLElement>('h1, h2');
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus();
      } else if (attempt < 6) {
        window.setTimeout(() => tryHeading(attempt + 1), 50);
      }
    };
    tryHeading(0);
    return () => {
      cancelled = true;
    };
  }, [pathname]);
}

function AppShell() {
  const { t } = useTranslation('nav');
  const init = useGame((s) => s.init);
  const authInit = useAuth((s) => s.init);
  const location = useLocation();
  useRouteFocus();

  // HumansPage stays mounted once visited (a live human-vs-human game must
  // survive navigation), but with code splitting we don't mount — or fetch —
  // it at all until Play → Friends is first opened. Flipped in an effect
  // (not during render) so a discarded/suspended render can't half-commit it.
  const friendsMatch = useMatch('/play/friends/*');
  const [friendsVisited, setFriendsVisited] = useState(!!friendsMatch);
  useEffect(() => {
    if (friendsMatch) setFriendsVisited(true);
  }, [friendsMatch]);

  useEffect(() => {
    init();
    authInit();
    initGamify();
    initSocial();
  }, [init, authInit]);

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        onClick={(e) => {
          // Hash routing owns location.hash — move focus without navigating.
          e.preventDefault();
          const main = document.getElementById('main');
          if (main) {
            main.setAttribute('tabindex', '-1');
            main.focus();
          }
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-brand-600 focus:px-3 focus:py-1.5 focus:text-sm focus:text-white"
      >
        {t('skipToContent')}
      </a>
      <Sidebar />
      {/* pb clears the fixed bottom bar on small screens. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col pb-16 lg:pb-0">
        <Header />
        <main id="main" className="flex-1 p-4">
          {/* key replays .page-fade on navigation (disabled under
              prefers-reduced-motion in index.css). Lazy route chunks resolve
              in a few ms from cache/SW; while one is in flight the content
              area is simply empty (no spinner flash). */}
          <div key={location.pathname} className="page-fade">
            <Suspense fallback={null}>
              <AppRoutes />
            </Suspense>
          </div>
          {/* Keep-mounted Friends slot (outside the keyed fade wrapper, so a
              live game never remounts). `active` lets the friends panel poll
              only while the section is actually visible. */}
          {friendsVisited && (
            <div className={friendsMatch ? undefined : 'hidden'}>
              <Suspense fallback={null}>
                <HumansPage active={!!friendsMatch} />
              </Suspense>
            </div>
          )}
        </main>
        <Footer />
      </div>
      <BottomBar />
      <GamifyToasts />
      <Celebration />
      <ConsentNotice />
      <WhatMovedTour />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}
