import { useEffect, useState, type ReactNode } from 'react';
import { useGame } from './store/game';
import { useAuth } from './store/auth';
import { AccountButton } from './components/AccountPanel';
import { InstallButton } from './components/InstallButton';
import { SettingsDialog } from './components/SettingsDialog';
import { PlayPage } from './pages/PlayPage';
import { HumansPage } from './humans/HumansPage';
import { OpeningsPage } from './pages/OpeningsPage';
import { TacticsPage } from './pages/TacticsPage';
import { EndgamePage } from './pages/EndgamePage';
import { CoordinatePage } from './pages/CoordinatePage';
import { StatsPage } from './pages/StatsPage';
import { ProfilePage } from './pages/ProfilePage';
import { TrainPage, type TrainTab } from './pages/TrainPage';
import { LevelBadge } from './components/LevelBadge';
import { GamifyToasts } from './components/GamifyToasts';
import { initGamify } from './lib/gamify';
import type { DeckTarget } from './lib/decks';

type View = 'play' | 'friends' | 'openings' | 'tactics' | 'endgame' | 'train' | 'coordinates' | 'stats' | 'profile';

const TABS: { id: View; label: string; hint: string }[] = [
  { id: 'play', label: 'Play', hint: 'vs bots & analysis' },
  { id: 'friends', label: 'Friends', hint: 'pass & play · online friend games' },
  { id: 'openings', label: 'Openings', hint: 'repertoire drills' },
  { id: 'tactics', label: 'Tactics', hint: 'tactics puzzles' },
  { id: 'endgame', label: 'Endgame', hint: 'theory & technique' },
  { id: 'train', label: 'Train', hint: 'vision · mates · anti-blunder' },
  { id: 'coordinates', label: 'Coords', hint: 'board-vision trainer' },
  { id: 'stats', label: 'Stats', hint: 'progress dashboard' },
  { id: 'profile', label: 'Profile', hint: 'level · ratings · badges' },
];

function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`rounded px-1.5 py-0.5 ${ok ? 'bg-emerald-900/60 text-emerald-300' : 'bg-neutral-800 text-neutral-400'}`}>
      {children}
    </span>
  );
}

function Header({ view, setView }: { view: View; setView: (v: View) => void }) {
  const connected = useGame((s) => s.connected);
  const availability = useGame((s) => s.availability);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <header className="border-b border-neutral-800">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-bold text-ink">♟ Chesser</h1>
          <span className="hidden text-xs text-neutral-400 sm:inline">Stockfish + Lc0/Maia</span>
        </div>
        {/* On small screens the 8 tabs scroll horizontally in one row (scrollbar hidden)
            instead of wrapping into cramped lines; from sm up they wrap as before. */}
        <nav
          aria-label="Primary"
          className="scrollbar-none order-3 flex w-full gap-1 overflow-x-auto sm:order-2 sm:w-auto sm:flex-wrap sm:overflow-x-visible"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              title={t.hint}
              aria-current={view === t.id ? 'page' : undefined}
              className={`min-h-11 min-w-[4.5rem] shrink-0 whitespace-nowrap rounded px-3 py-1.5 text-sm sm:min-h-0 ${
                view === t.id ? 'bg-emerald-700 text-white' : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="order-2 flex items-center gap-3 text-xs sm:order-3">
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
            className={`flex items-center gap-1.5 ${connected ? 'text-emerald-400' : 'text-rose-400'}`}
          >
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            {connected ? 'online' : 'connecting…'}
          </span>
          <LevelBadge onClick={() => setView('profile')} />
          <InstallButton />
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
            className="min-h-11 min-w-11 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-700 sm:min-h-0 sm:min-w-0"
          >
            ⚙
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
  // A shared friend-game link (#/friend/CODE) lands straight on the Friends view.
  const [view, setView] = useState<View>(() => (window.location.hash.startsWith('#/friend/') ? 'friends' : 'play'));
  const [trainTab, setTrainTab] = useState<TrainTab>('mates');

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith('#/friend/')) setView('friends');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Jump to a deck's trainer (used by the unified review summary on Stats).
  const goto = (target: DeckTarget) => {
    if (target.trainTab) setTrainTab(target.trainTab);
    setView(target.view);
  };

  useEffect(() => {
    init();
    authInit();
    initGamify();
  }, [init, authInit]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-emerald-700 focus:px-3 focus:py-1.5 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <Header view={view} setView={setView} />
      {/* key={view} remounts the content on tab switch so .page-fade replays
          its 150ms fade (disabled under prefers-reduced-motion in index.css). */}
      <main key={view} id="main" className="page-fade flex-1 p-4">
        {view === 'play' && <PlayPage />}
        {/* Kept mounted so a live human-vs-human game survives tab switches. */}
        <div className={view === 'friends' ? undefined : 'hidden'}>
          <HumansPage />
        </div>
        {view === 'openings' && <OpeningsPage />}
        {view === 'tactics' && <TacticsPage />}
        {view === 'endgame' && <EndgamePage />}
        {view === 'train' && <TrainPage tab={trainTab} setTab={setTrainTab} />}
        {view === 'coordinates' && <CoordinatePage />}
        {view === 'stats' && <StatsPage goto={goto} />}
        {view === 'profile' && <ProfilePage goPlay={() => setView('play')} />}
      </main>
      <GamifyToasts />
    </div>
  );
}
