import { useEffect, useState, type ReactNode } from 'react';
import { useGame } from './store/game';
import { useAuth } from './store/auth';
import { AccountButton } from './components/AccountPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { PlayPage } from './pages/PlayPage';
import { OpeningsPage } from './pages/OpeningsPage';
import { TacticsPage } from './pages/TacticsPage';
import { EndgamePage } from './pages/EndgamePage';
import { CoordinatePage } from './pages/CoordinatePage';
import { StatsPage } from './pages/StatsPage';
import { TrainPage, type TrainTab } from './pages/TrainPage';
import type { DeckTarget } from './lib/decks';

type View = 'play' | 'openings' | 'tactics' | 'endgame' | 'train' | 'coordinates' | 'stats';

const TABS: { id: View; label: string; hint: string }[] = [
  { id: 'play', label: 'Play', hint: 'vs bots & analysis' },
  { id: 'openings', label: 'Openings', hint: 'repertoire drills' },
  { id: 'tactics', label: 'Middlegame', hint: 'tactics puzzles' },
  { id: 'endgame', label: 'Endgame', hint: 'theory & technique' },
  { id: 'train', label: 'Train', hint: 'vision · mates · anti-blunder' },
  { id: 'coordinates', label: 'Coords', hint: 'board-vision trainer' },
  { id: 'stats', label: 'Stats', hint: 'progress dashboard' },
];

function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`rounded px-1.5 py-0.5 ${ok ? 'bg-emerald-900/60 text-emerald-300' : 'bg-neutral-800 text-neutral-600'}`}>
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
          <span className="hidden text-xs text-neutral-500 sm:inline">Stockfish + Lc0/Maia</span>
        </div>
        <nav className="order-3 flex w-full flex-wrap gap-1 sm:order-2 sm:w-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              title={t.hint}
              className={`min-w-[4.5rem] flex-1 rounded px-3 py-1.5 text-sm sm:flex-none ${
                view === t.id ? 'bg-emerald-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="order-2 flex items-center gap-3 text-xs sm:order-3">
          {availability && (
            <span className="hidden gap-2 text-neutral-500 md:flex">
              <Badge ok={availability.stockfish}>Stockfish</Badge>
              <Badge ok={availability.lc0}>Maia</Badge>
              {availability.syzygy && (
                <Badge ok>Syzygy{availability.syzygyMaxPieces ? ` ≤${availability.syzygyMaxPieces}` : ''}</Badge>
              )}
            </span>
          )}
          <span className={`flex items-center gap-1.5 ${connected ? 'text-emerald-400' : 'text-rose-400'}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            {connected ? 'online' : 'connecting…'}
          </span>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-700"
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
  const [view, setView] = useState<View>('play');
  const [trainTab, setTrainTab] = useState<TrainTab>('mates');

  // Jump to a deck's trainer (used by the unified review summary on Stats).
  const goto = (target: DeckTarget) => {
    if (target.trainTab) setTrainTab(target.trainTab);
    setView(target.view);
  };

  useEffect(() => {
    init();
    authInit();
  }, [init, authInit]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header view={view} setView={setView} />
      <main className="flex-1 p-4">
        {view === 'play' && <PlayPage />}
        {view === 'openings' && <OpeningsPage />}
        {view === 'tactics' && <TacticsPage />}
        {view === 'endgame' && <EndgamePage />}
        {view === 'train' && <TrainPage tab={trainTab} setTab={setTrainTab} />}
        {view === 'coordinates' && <CoordinatePage />}
        {view === 'stats' && <StatsPage goto={goto} />}
      </main>
    </div>
  );
}
