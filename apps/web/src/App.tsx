import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { useGame } from './store/game';
import { useAuth } from './store/auth';
import { AccountButton } from './components/AccountPanel';
import { InstallButton } from './components/InstallButton';
import { SettingsDialog } from './components/SettingsDialog';
import { PlayPage } from './pages/PlayPage';
import { HomePage } from './pages/HomePage';
import { HumansPage } from './humans/HumansPage';
import { LearnPage } from './pages/LearnPage';
import { MastersPage } from './pages/MastersPage';
import { OpeningsPage } from './pages/OpeningsPage';
import { ExplorerPage } from './pages/ExplorerPage';
import { TacticsPage } from './pages/TacticsPage';
import { EndgamePage } from './pages/EndgamePage';
import { EndgameDrillsPage } from './pages/EndgameDrillsPage';
import { CoordinatePage } from './pages/CoordinatePage';
import { StatsPage } from './pages/StatsPage';
import { ProfilePage } from './pages/ProfilePage';
import { TrainPage, type TrainTab } from './pages/TrainPage';
import { CoachPage } from './pages/CoachPage';
import { StudyPlanPage } from './pages/StudyPlanPage';
import { ArchivePage } from './pages/ArchivePage';
import { LeaderboardsPage } from './pages/LeaderboardsPage';
import { PublicProfilePage } from './pages/PublicProfilePage';
import { LevelBadge } from './components/LevelBadge';
import { GamifyToasts } from './components/GamifyToasts';
import { Celebration } from './components/Celebration';
import { initGamify } from './lib/gamify';
import { parseHashRoute, profileHashUser } from './lib/hashRoute';
import { initSocial } from './store/social';
import { playSound } from './lib/sound';
import type { DeckTarget } from './lib/decks';
import {
  IconArchive,
  IconBolt,
  IconCoach,
  IconCoords,
  IconCrown,
  IconEndgame,
  IconExplorer,
  IconFriends,
  IconGear,
  IconLearn,
  IconOpenings,
  IconPlay,
  IconProfile,
  IconSparkles,
  IconStats,
  IconTactics,
  IconToday,
  IconTrain,
  IconTrophy,
  LogoMark,
  Wordmark,
} from './components/icons';

type View =
  | 'home'
  | 'play'
  | 'learn'
  | 'masters'
  | 'friends'
  | 'openings'
  | 'explorer'
  | 'tactics'
  | 'endgame'
  | 'endgame-drills'
  | 'train'
  | 'coach'
  | 'plan'
  | 'coordinates'
  | 'archive'
  | 'stats'
  | 'leaders'
  | 'profile'
  | 'shared-profile';

const TABS: { id: View; label: string; hint: string; icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }> }[] = [
  { id: 'home', label: 'Today', hint: 'streak · daily quests · goals', icon: IconToday },
  { id: 'play', label: 'Play', hint: 'vs bots & analysis', icon: IconPlay },
  { id: 'learn', label: 'Learn', hint: 'rules & guided lessons', icon: IconLearn },
  { id: 'masters', label: 'Masters', hint: 'annotated master games', icon: IconCrown },
  { id: 'friends', label: 'Friends', hint: 'pass & play · online friend games', icon: IconFriends },
  { id: 'openings', label: 'Openings', hint: 'repertoire drills', icon: IconOpenings },
  { id: 'explorer', label: 'Explorer', hint: 'opening explorer · master & online games', icon: IconExplorer },
  { id: 'tactics', label: 'Tactics', hint: 'tactics puzzles', icon: IconTactics },
  { id: 'endgame', label: 'Endgame', hint: 'theory & technique', icon: IconEndgame },
  { id: 'endgame-drills', label: 'Drills', hint: 'endgame drills · tablebase-checked', icon: IconBolt },
  { id: 'train', label: 'Train', hint: 'vision · mates · anti-blunder', icon: IconTrain },
  { id: 'coach', label: 'Coach', hint: 'your weaknesses · targeted training', icon: IconCoach },
  { id: 'plan', label: 'Plan', hint: 'your weekly study plan', icon: IconSparkles },
  { id: 'coordinates', label: 'Coords', hint: 'board-vision trainer', icon: IconCoords },
  { id: 'archive', label: 'Archive', hint: 'your games · results & trends', icon: IconArchive },
  { id: 'stats', label: 'Stats', hint: 'progress dashboard', icon: IconStats },
  { id: 'leaders', label: 'Ranks', hint: 'leaderboards · weekly race', icon: IconTrophy },
  { id: 'profile', label: 'Profile', hint: 'level · ratings · badges', icon: IconProfile },
];

function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 ${ok ? 'bg-emerald-900/60 text-emerald-300' : 'bg-neutral-800 text-neutral-400'}`}>
      {children}
    </span>
  );
}

function Header({ view, setView }: { view: View; setView: (v: View) => void }) {
  const connected = useGame((s) => s.connected);
  const availability = useGame((s) => s.availability);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-800/80 bg-page/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <h1 className="flex items-center gap-2">
          <LogoMark size={30} />
          <Wordmark className="text-ink" />
          <span className="sr-only">— play &amp; train chess</span>
        </h1>
        {/* On small screens the tabs scroll horizontally in one row (scrollbar hidden)
            instead of wrapping into cramped lines; from sm up they wrap as before. */}
        <nav
          aria-label="Primary"
          className="scrollbar-none order-3 flex w-full gap-1 overflow-x-auto sm:order-2 sm:w-auto sm:flex-wrap sm:overflow-x-visible"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = view === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  playSound('uiClick');
                  setView(t.id);
                }}
                title={t.hint}
                aria-current={active ? 'page' : undefined}
                className={`btn-press flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold sm:min-h-0 ${
                  active
                    ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow'
                    : 'text-neutral-300 hover:bg-neutral-800 hover:text-ink'
                }`}
              >
                {/* white/85, not brand-300: the active pill's gradient stays dark in
                    both themes, while brand-300 flips dark in light mode. */}
                <Icon size={16} className={active ? 'text-white/85' : 'text-neutral-400'} />
                {t.label}
              </button>
            );
          })}
        </nav>
        <div className="order-2 flex items-center gap-2.5 text-xs sm:order-3">
          {availability && (
            <span className="hidden gap-2 text-neutral-400 md:flex">
              <Badge ok={availability.stockfish}>Stockfish</Badge>
              <Badge ok={availability.lc0}>Maia</Badge>
              {availability.syzygy && (
                <Badge ok>Syzygy{availability.syzygyMaxPieces ? ` ≤${availability.syzygyMaxPieces}` : ''}</Badge>
              )}
            </span>
          )}
          <span
            role="status"
            title={
              connected
                ? 'Connected to the engine server'
                : 'Trying to reach the engine server — bot play and analysis resume once connected'
            }
            className={`flex items-center gap-1.5 font-semibold ${connected ? 'text-emerald-400' : 'text-rose-400'}`}
          >
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'animate-pulse-soft bg-rose-400'}`} />
            {connected ? 'online' : 'connecting…'}
          </span>
          <LevelBadge onClick={() => setView('profile')} />
          <InstallButton />
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
            className="btn-press flex min-h-11 min-w-11 items-center justify-center rounded-full bg-neutral-800 p-2 text-neutral-300 hover:bg-neutral-700 hover:text-ink sm:min-h-0 sm:min-w-0"
          >
            <IconGear size={16} />
          </button>
          <AccountButton />
        </div>
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}

export default function App() {
  const init = useGame((s) => s.init);
  const authInit = useAuth((s) => s.init);
  // A shared friend-game link (#/friend/CODE) lands straight on the Friends
  // view and a shared profile link (#/profile/NAME) on that public profile;
  // everyone else starts the day on the Today page.
  const [view, setView] = useState<View>(() => {
    const route = parseHashRoute(window.location.hash);
    return route.kind === 'friend' ? 'friends' : route.kind === 'profile' ? 'shared-profile' : 'home';
  });
  const [profileUser, setProfileUser] = useState<string | null>(() => profileHashUser(window.location.hash));
  const [trainTab, setTrainTab] = useState<TrainTab>('mates');
  // Set when the Today page's "Daily puzzle" entry is used, so the Tactics
  // page opens straight onto today's puzzle (cleared on any manual nav).
  const [tacticsDaily, setTacticsDaily] = useState(false);
  // Set by the Today page's sprint entries (Puzzle Rush / Storm), so the
  // Tactics page opens straight on that mode (cleared on any manual nav).
  const [tacticsMode, setTacticsMode] = useState<'rush' | 'storm' | null>(null);

  useEffect(() => {
    const onHash = () => {
      const route = parseHashRoute(window.location.hash);
      if (route.kind === 'friend') {
        setView('friends');
      } else if (route.kind === 'profile') {
        setProfileUser(route.user);
        setView('shared-profile');
      } else if (route.kind === 'exit-overlay') {
        // The hash was cleared (Back out of a profile link). Normal tabs
        // don't live in the hash, but a shared profile exists ONLY via its
        // hash — so leaving the hash leaves the view too.
        setView((v) => (v === 'shared-profile' ? 'home' : v));
      }
      // 'ignore' (in-page anchors like the #main skip link, foreign hashes):
      // never navigate — the skip link must move focus, not views.
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Open a player's public profile (leaderboard rows, own share preview).
  // pushState (not location.hash) avoids double-handling via hashchange while
  // still making Back return to the previous view via the listener above.
  const openProfile = (username: string) => {
    window.history.pushState(null, '', `#/profile/${encodeURIComponent(username)}`);
    setProfileUser(username);
    setView('shared-profile');
  };

  // Jump to a deck's trainer (used by the unified review summary on Stats).
  const goto = (target: DeckTarget) => {
    if (target.trainTab) setTrainTab(target.trainTab);
    setView(target.view);
  };

  // All navigation funnels through here so one-shot flags don't go stale.
  const nav = (v: View) => {
    setTacticsDaily(false);
    setTacticsMode(null);
    // Leaving a shared profile: drop its hash so the URL matches the new view.
    if (v !== 'shared-profile' && window.location.hash.startsWith('#/profile/')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setView(v);
  };

  useEffect(() => {
    init();
    authInit();
    initGamify();
    initSocial();
  }, [init, authInit]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-brand-600 focus:px-3 focus:py-1.5 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <Header view={view} setView={nav} />
      {/* key={view} remounts the content on tab switch so .page-fade replays
          its fade (disabled under prefers-reduced-motion in index.css). */}
      <main key={view} id="main" className="page-fade flex-1 p-4">
        {view === 'home' && (
          <HomePage
            go={nav}
            onDailyPuzzle={() => {
              setTacticsDaily(true);
              setView('tactics');
            }}
            onSprint={(m) => {
              setTacticsMode(m);
              setView('tactics');
            }}
          />
        )}
        {view === 'play' && <PlayPage />}
        {view === 'learn' && <LearnPage />}
        {view === 'masters' && <MastersPage goPlay={() => setView('play')} />}
        {/* Kept mounted so a live human-vs-human game survives tab switches.
            `active` lets the friends panel poll (and auto-join accepted
            challenges) only while the tab is actually visible. */}
        <div className={view === 'friends' ? undefined : 'hidden'}>
          <HumansPage active={view === 'friends'} />
        </div>
        {view === 'openings' && <OpeningsPage />}
        {view === 'explorer' && <ExplorerPage goAnalyze={() => setView('play')} />}
        {view === 'tactics' && (
          <TacticsPage openDaily={tacticsDaily} onDailyOpened={() => setTacticsDaily(false)} openMode={tacticsMode} />
        )}
        {view === 'endgame' && <EndgamePage />}
        {view === 'endgame-drills' && <EndgameDrillsPage />}
        {view === 'train' && <TrainPage tab={trainTab} setTab={setTrainTab} />}
        {view === 'coach' && <CoachPage goPlay={() => setView('play')} />}
        {view === 'plan' && <StudyPlanPage go={nav} />}
        {view === 'coordinates' && <CoordinatePage />}
        {view === 'archive' && <ArchivePage goPlay={() => setView('play')} />}
        {view === 'stats' && <StatsPage goto={goto} />}
        {view === 'leaders' && <LeaderboardsPage onViewProfile={openProfile} />}
        {view === 'profile' && <ProfilePage goPlay={() => setView('play')} onViewPublicProfile={openProfile} />}
        {view === 'shared-profile' && profileUser && <PublicProfilePage username={profileUser} />}
      </main>
      <GamifyToasts />
      <Celebration />
    </div>
  );
}
