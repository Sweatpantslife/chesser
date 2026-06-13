import { useEffect, useState } from 'react';
import type { BotStyleId } from '@chesser/shared';
import { useGame, type Color } from '../store/game';

const THINK_OPTIONS = [
  { label: 'Fast', ms: 300 },
  { label: 'Normal', ms: 700 },
  { label: 'Slow', ms: 1500 },
];

const ELO_PRESETS = [1320, 1600, 1900, 2200, 2500, 3190];

export function BotPanel() {
  const { styles, availability, botConfig, newGame } = useGame();

  const [style, setStyle] = useState<BotStyleId>(botConfig.style);
  const [elo, setElo] = useState(botConfig.elo ?? 1600);
  const [maiaRating, setMaiaRating] = useState(botConfig.maiaRating ?? 1500);
  const [moveTimeMs, setMoveTimeMs] = useState(botConfig.moveTimeMs ?? 700);
  const [color, setColor] = useState<'white' | 'black' | 'random'>('white');

  // If the chosen style isn't available, fall back to the first one offered.
  useEffect(() => {
    if (styles.length > 0 && !styles.some((s) => s.id === style)) setStyle(styles[0]!.id);
  }, [styles, style]);

  const selStyle = styles.find((s) => s.id === style);
  const isHuman = style === 'human';
  const maiaNets = availability?.maiaNetworks ?? [];

  const start = () => {
    const playerColor: Color = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
    newGame({ mode: 'play', playerColor, bot: { style, elo, maiaRating, moveTimeMs } });
  };

  if (styles.length === 0) {
    return (
      <div className="rounded-lg bg-panel p-3 text-sm text-neutral-400">
        Waiting for the engine server… (run <code className="text-neutral-200">pnpm dev:server</code>)
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-panel p-3">
      <h3 className="mb-2 text-sm font-semibold text-ink">Play a bot</h3>

      {/* style */}
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Style</div>
      <div className="mb-2 flex flex-wrap gap-1">
        {styles.map((s) => (
          <button
            key={s.id}
            onClick={() => setStyle(s.id)}
            className={`rounded px-2 py-1 text-xs ${
              style === s.id ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
      {selStyle && <p className="mb-3 text-xs leading-snug text-neutral-400">{selStyle.description}</p>}

      {/* strength */}
      {isHuman ? (
        <div className="mb-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Rating</div>
          <div className="flex gap-1">
            {maiaNets.map((n) => (
              <button
                key={n.id}
                onClick={() => setMaiaRating(n.rating)}
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  maiaRating === n.rating
                    ? 'bg-emerald-600 text-white'
                    : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                }`}
              >
                {n.rating}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="uppercase tracking-wide text-neutral-500">Strength</span>
            <span className="font-mono text-neutral-300">{elo >= 3190 ? 'max' : `${elo} Elo`}</span>
          </div>
          <input
            type="range"
            min={1320}
            max={3190}
            step={10}
            value={elo}
            onChange={(e) => setElo(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
          <div className="mt-1 flex justify-between">
            {ELO_PRESETS.map((p) => (
              <button key={p} onClick={() => setElo(p)} className="text-[10px] text-neutral-500 hover:text-neutral-200">
                {p === 3190 ? 'max' : p}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-xs text-neutral-500">Think</span>
            {THINK_OPTIONS.map((t) => (
              <button
                key={t.ms}
                onClick={() => setMoveTimeMs(t.ms)}
                className={`rounded px-2 py-0.5 text-[11px] ${
                  moveTimeMs === t.ms ? 'bg-neutral-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* color */}
      <div className="mb-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">You play</div>
        <div className="flex gap-1">
          {(['white', 'black', 'random'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`flex-1 rounded px-2 py-1 text-xs capitalize ${
                color === c ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={start}
        className="w-full rounded bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
      >
        Start game
      </button>
    </div>
  );
}
