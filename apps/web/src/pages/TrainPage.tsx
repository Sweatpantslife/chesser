import { VisionPage } from './VisionPage';
import { MatesPage } from './MatesPage';
import { AntiBlunderPage } from './AntiBlunderPage';

export type TrainTab = 'vision' | 'mates' | 'blunders';

const TABS: { id: TrainTab; label: string; hint: string }[] = [
  { id: 'vision', label: 'Vision', hint: 'blindfold & calculation' },
  { id: 'mates', label: 'Checkmates', hint: 'pattern library & drills' },
  { id: 'blunders', label: 'Anti-blunder', hint: '“are you sure?” trainer' },
];

export function TrainPage({ tab, setTab }: { tab: TrainTab; setTab: (t: TrainTab) => void }) {
  return (
    <div className="space-y-4">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            title={t.hint}
            aria-pressed={tab === t.id}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === t.id ? 'bg-brand-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'vision' && <VisionPage />}
      {tab === 'mates' && <MatesPage />}
      {tab === 'blunders' && <AntiBlunderPage />}
    </div>
  );
}
