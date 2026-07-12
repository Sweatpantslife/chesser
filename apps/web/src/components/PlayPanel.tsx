import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LadderPanel } from './LadderPanel';
import { BotPanel } from './BotPanel';

type Tab = 'ladder' | 'custom';

/** Left-column play hub: climb the ladder, or configure a one-off custom game. */
export function PlayPanel() {
  const { t } = useTranslation('play');
  const [tab, setTab] = useState<Tab>('ladder');

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`btn-press flex-1 rounded-full px-3 py-1.5 text-sm font-semibold ${
        tab === id ? 'bg-brand-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-full bg-panel p-1 shadow-soft">
        {tabBtn('ladder', t('tabs.ladder'))}
        {tabBtn('custom', t('tabs.custom'))}
      </div>
      {tab === 'ladder' ? <LadderPanel /> : <BotPanel />}
    </div>
  );
}
