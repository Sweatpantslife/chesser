import { useState } from 'react';
import { useGame, type Color, type TimeControl } from '../store/game';
import { useLadder } from '../store/ladder';
import { BOT_ROSTER, resolveBotConfig, type RosterBot } from '../data/botRoster';
import { BotAvatar } from './BotAvatar';

const TIME_CONTROLS: (TimeControl | null)[] = [
  null,
  { label: '3+2', initialMs: 180_000, incrementMs: 2_000 },
  { label: '5+3', initialMs: 300_000, incrementMs: 3_000 },
  { label: '10+5', initialMs: 600_000, incrementMs: 5_000 },
];

export function LadderPanel() {
  const availability = useGame((s) => s.availability);
  const newGame = useGame((s) => s.newGame);
  const timeControl = useGame((s) => s.timeControl);
  const setTimeControl = useGame((s) => s.setTimeControl);
  const opponent = useGame((s) => s.opponent);
  const isGameOver = useGame((s) => s.isGameOver);

  const defeated = useLadder((s) => s.defeated);
  const reset = useLadder((s) => s.reset);

  const [color, setColor] = useState<'white' | 'black' | 'random'>('white');
  const [confirmReset, setConfirmReset] = useState(false);

  const cleared = Object.keys(defeated).length;
  const isDefeated = (id: string) => id in defeated;
  const nextIndex = BOT_ROSTER.findIndex((b, i) => {
    const prev = BOT_ROSTER[i - 1];
    const unlocked = i === 0 || (prev ? isDefeated(prev.id) : true);
    return unlocked && !isDefeated(b.id);
  });

  const start = (bot: RosterBot) => {
    const playerColor: Color = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
    newGame({
      mode: 'play',
      playerColor,
      bot: resolveBotConfig(bot, availability),
      opponent: { id: bot.id, name: bot.name, rating: bot.rating, accent: bot.accent, motif: bot.motif },
    });
  };

  return (
    <div className="rounded-lg bg-panel p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink">The ladder</h3>
        <span className="text-xs text-neutral-400">
          {cleared}/{BOT_ROSTER.length} cleared
        </span>
      </div>
      <p className="mb-3 text-xs leading-snug text-neutral-400">
        Beat each bot to unlock the next. Cleared rungs stay open — replay them any time, with either colour.
      </p>

      {/* play-as colour */}
      <div className="mb-2">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">You play</div>
        <div className="flex gap-1">
          {(['white', 'black', 'random'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`flex-1 rounded px-2 py-1 text-xs capitalize ${
                color === c ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* time control */}
      <div className="mb-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Time control</div>
        <div className="flex gap-1">
          {TIME_CONTROLS.map((tc) => {
            const selected = (timeControl?.label ?? 'unlimited') === (tc?.label ?? 'unlimited');
            return (
              <button
                key={tc?.label ?? 'unlimited'}
                onClick={() => setTimeControl(tc)}
                className={`flex-1 rounded px-1.5 py-1 text-xs ${
                  selected ? 'bg-emerald-700 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                }`}
              >
                {tc?.label ?? '∞'}
              </button>
            );
          })}
        </div>
      </div>

      {/* roster */}
      <div className="scroll-thin max-h-[58vh] space-y-1.5 overflow-y-auto pr-0.5">
        {BOT_ROSTER.map((bot, i) => {
          const prev = BOT_ROSTER[i - 1];
          const unlocked = i === 0 || (prev ? isDefeated(prev.id) : true);
          const botCleared = isDefeated(bot.id);
          const isNext = i === nextIndex;
          const isActive = opponent?.id === bot.id && !isGameOver;
          const maiaStandin = bot.bot.style === 'human' && !availability?.lc0;

          return (
            <div
              key={bot.id}
              className={`rounded-lg border p-2 ${
                isActive
                  ? 'border-emerald-500 bg-neutral-800'
                  : isNext
                    ? 'border-emerald-700/60 bg-neutral-800/60'
                    : 'border-neutral-800 bg-neutral-800/30'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <BotAvatar name={bot.name} accent={bot.accent} motif={bot.motif} size={42} locked={!unlocked} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{bot.name}</span>
                    <span className="shrink-0 font-mono text-xs text-neutral-400">{bot.rating}</span>
                  </div>
                  <div className="text-xs text-neutral-400">
                    {bot.title}
                    {botCleared && <span className="ml-1 text-emerald-400">· ✓ cleared</span>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-neutral-400">{bot.bio}</p>
                  {maiaStandin && unlocked && (
                    <p className="mt-0.5 text-xs text-neutral-400">Maia offline — Stockfish stand-in at this rating.</p>
                  )}
                </div>
              </div>
              <div className="mt-1.5 flex items-center justify-end">
                {!unlocked ? (
                  <span className="text-xs text-neutral-400">🔒 Beat {prev?.name ?? 'the previous bot'} to unlock</span>
                ) : (
                  <button
                    onClick={() => start(bot)}
                    className={`rounded px-3 py-1 text-xs font-semibold ${
                      isNext && !botCleared
                        ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                        : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                    }`}
                  >
                    {isActive ? 'Restart' : botCleared ? 'Replay' : 'Play ▶'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* reset */}
      <div className="mt-3 text-right">
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)} className="text-xs text-neutral-400 hover:text-neutral-300">
            Reset ladder progress
          </button>
        ) : (
          <span className="text-xs text-neutral-400">
            Reset all progress?{' '}
            <button
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
              className="text-rose-400 hover:text-rose-300"
            >
              Yes
            </button>{' '}
            ·{' '}
            <button onClick={() => setConfirmReset(false)} className="text-neutral-300 hover:text-neutral-100">
              No
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
