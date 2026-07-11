import { useTranslation } from 'react-i18next';
import { VisionPage } from './VisionPage';
import { MatesPage } from './MatesPage';
import { AntiBlunderPage } from './AntiBlunderPage';

export type TrainTab = 'vision' | 'mates' | 'blunders';

const TAB_IDS: TrainTab[] = ['vision', 'mates', 'blunders'];

export function TrainPage({ tab, setTab }: { tab: TrainTab; setTab: (t: TrainTab) => void }) {
  const { t } = useTranslation('train');
  return (
    <div className="space-y-4">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap gap-1">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            title={t(`tabs.${id}.hint`)}
            aria-pressed={tab === id}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === id ? 'bg-brand-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            {t(`tabs.${id}.label`)}
          </button>
        ))}
      </div>
      {tab === 'vision' && <VisionPage />}
      {tab === 'mates' && <MatesPage />}
      {tab === 'blunders' && <AntiBlunderPage />}
    </div>
  );
}
