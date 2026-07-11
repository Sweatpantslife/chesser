import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGame, type Color, type TimeControl } from '../store/game';
import { useLadder } from '../store/ladder';
import { BOT_ROSTER, humanBackendFor, resolveBotConfig, type RosterBot } from '../data/botRoster';
import { BotAvatar } from './BotAvatar';

const TIME_CONTROLS: (TimeControl | null)[] = [
  null,
  { label: '3+2', initialMs: 180_000, incrementMs: 2_000 },
  { label: '5+3', initialMs: 300_000, incrementMs: 3_000 },
  { label: '10+5', initialMs: 600_000, incrementMs: 5_000 },
];

export function LadderPanel() {
  const { t } = useTranslation(['play', 'bots']);
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
  // A rung is open when it's the first, its predecessor fell, or it was already
  // beaten — so beaten rungs stay replayable even if a new rung is ever
  // inserted before them in a roster update.
  const isUnlocked = (i: number) => {
    const prev = BOT_ROSTER[i - 1];
    return i === 0 || (prev ? isDefeated(prev.id) : true) || isDefeated(BOT_ROSTER[i]!.id);
  };
  const nextIndex = BOT_ROSTER.findIndex((b, i) => isUnlocked(i) && !isDefeated(b.id));

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
    <div className="rounded-2xl bg-panel p-3 shadow-soft">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">{t('ladder.title')}</h3>
        <span className="text-xs text-neutral-400">
          {t('ladder.cleared', { cleared, total: BOT_ROSTER.length })}
        </span>
      </div>
      <p className="mb-3 text-xs leading-snug text-neutral-400">{t('ladder.intro')}</p>

      {/* play-as colour */}
      <div className="mb-2">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('color.label')}</div>
        <div className="flex gap-1">
          {(['white', 'black', 'random'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-pressed={color === c}
              className={`btn-press flex-1 rounded-full px-2 py-1 text-xs font-semibold capitalize ${
                color === c ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
              }`}
            >
              {t(`color.${c}`)}
            </button>
          ))}
        </div>
      </div>

      {/* time control */}
      <div className="mb-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('timeControl.label')}</div>
        <div className="flex gap-1">
          {TIME_CONTROLS.map((tc) => {
            const selected = (timeControl?.label ?? 'unlimited') === (tc?.label ?? 'unlimited');
            return (
              <button
                key={tc?.label ?? 'unlimited'}
                onClick={() => setTimeControl(tc)}
                className={`btn-press flex-1 rounded-full px-1.5 py-1 text-xs font-semibold ${
                  selected ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                }`}
              >
                {tc?.label ?? t('timeControl.unlimited')}
              </button>
            );
          })}
        </div>
      </div>

      {/* roster */}
      <div className="scroll-thin max-h-[58vh] space-y-1.5 overflow-y-auto pr-0.5">
        {BOT_ROSTER.map((bot, i) => {
          const prev = BOT_ROSTER[i - 1];
          const unlocked = isUnlocked(i);
          const botCleared = isDefeated(bot.id);
          const isNext = i === nextIndex;
          const isActive = opponent?.id === bot.id && !isGameOver;
          const isHuman = bot.bot.style === 'human';
          const backend = humanBackendFor(bot, availability);

          return (
            <div
              key={bot.id}
              className={`card-lift rounded-xl border p-2 ${
                isActive
                  ? 'border-brand-400 bg-neutral-800'
                  : isNext
                    ? 'border-brand-500/60 bg-neutral-800/60'
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
                    {t(`bots:roster.${bot.id}.title`, { defaultValue: bot.title })}
                    {isHuman && availability && (
                      // Honest backend label: what actually answers this persona's moves.
                      <span className="ml-1">
                        ·{' '}
                        {backend === 'maia'
                          ? t('ladder.backend.maiaNet')
                          : backend === 'stockfish'
                            ? t('ladder.backend.engineHuman')
                            : t('ladder.backend.standIn')}
                      </span>
                    )}
                    {botCleared && <span className="ml-1 text-emerald-400">{t('ladder.clearedBadge')}</span>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-neutral-400">
                    {t(`bots:roster.${bot.id}.bio`, { defaultValue: bot.bio })}
                  </p>
                </div>
              </div>
              <div className="mt-1.5 flex items-center justify-end">
                {!unlocked ? (
                  <span className="text-xs text-neutral-400">
                    {t('ladder.lockedHint', { name: prev?.name ?? t('ladder.previousBot') })}
                  </span>
                ) : (
                  <button
                    onClick={() => start(bot)}
                    className={`btn-press rounded-full px-3 py-1 text-xs font-bold ${
                      isNext && !botCleared
                        ? 'bg-brand-600 text-white shadow-glow hover:bg-brand-700'
                        : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                    }`}
                  >
                    {isActive ? t('ladder.restart') : botCleared ? t('ladder.replay') : t('ladder.play')}
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
            {t('ladder.reset.prompt')}
          </button>
        ) : (
          <span className="text-xs text-neutral-400">
            {t('ladder.reset.confirm')}{' '}
            <button
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
              className="text-rose-400 hover:text-rose-300"
            >
              {t('ladder.reset.yes')}
            </button>{' '}
            ·{' '}
            <button onClick={() => setConfirmReset(false)} className="text-neutral-300 hover:text-neutral-100">
              {t('ladder.reset.no')}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
