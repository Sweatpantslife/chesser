import { useState } from 'react';
import { LadderPanel } from './LadderPanel';
import { BotPanel } from './BotPanel';

type Tab = 'ladder' | 'custom';

/** Left-column play hub: climb the ladder, or configure a one-off custom game. */
export function PlayPanel() {
  const [tab, setTab] = useState<Tab>('ladder');

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${
        tab === id ? 'bg-emerald-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg bg-panel p-1">
        {tabBtn('ladder', '🪜 Ladder')}
        {tabBtn('custom', '⚙ Custom')}
      </div>
      {tab === 'ladder' ? <LadderPanel /> : <BotPanel />}
    </div>
  );
}
