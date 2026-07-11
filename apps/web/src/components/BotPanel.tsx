import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Chess } from 'chess.js';
import type { BotStyleId } from '@chesser/shared';
import { STOCKFISH_ELO_MIN, STOCKFISH_ELO_MAX } from '@chesser/shared';
import { useGame, type Color, type TimeControl } from '../store/game';
import { OPENING_LINES, type OpeningLine } from '../trainers/openings';

const TIME_CONTROLS: (TimeControl | null)[] = [
  null,
  { label: '1+0', initialMs: 60_000, incrementMs: 0 },
  { label: '3+2', initialMs: 180_000, incrementMs: 2_000 },
  { label: '5+3', initialMs: 300_000, incrementMs: 3_000 },
  { label: '10+5', initialMs: 600_000, incrementMs: 5_000 },
];

const THINK_OPTIONS = [
  { id: 'fast', ms: 300 },
  { id: 'normal', ms: 700 },
  { id: 'slow', ms: 1500 },
] as const;

const ELO_PRESETS = [1320, 1600, 1900, 2200, 2500, 3190];
// The human-like sampler covers any rating; sub-1320 lives here (not the ladder-only path).
const HUMAN_ELO_MIN = 600;
const HUMAN_ELO_MAX = 2000;
const HUMAN_ELO_PRESETS = [600, 800, 1000, 1200, 1600, 2000];

type StartFrom = 'standard' | 'position' | 'opening';

// The generated opponent display name ("Maia 1500", "Human-like ~1200", …). It
// is translated once at game start and stored in game state, like roster names.
function botLabel(t: TFunction<'play'>, style: BotStyleId, elo: number, maia: number, viaMaia: boolean): string {
  if (style === 'human') {
    return viaMaia ? t('custom.opponent.maia', { rating: maia }) : t('custom.opponent.humanLike', { elo });
  }
  const s = style.charAt(0).toUpperCase() + style.slice(1);
  return t('custom.opponent.stockfish', {
    styleName: s,
    strength: elo >= STOCKFISH_ELO_MAX ? t('custom.eloMax') : elo,
  });
}

export function BotPanel() {
  const { t } = useTranslation('play');
  const { styles, availability, botConfig, newGame, timeControl, setTimeControl } = useGame();
  const liveFen = useGame((s) => s.fen);

  const [style, setStyle] = useState<BotStyleId>(botConfig.style);
  const [elo, setElo] = useState(botConfig.elo ?? 1600);
  const [maiaRating, setMaiaRating] = useState(botConfig.maiaRating ?? 1500);
  const [moveTimeMs, setMoveTimeMs] = useState(botConfig.moveTimeMs ?? 700);
  const [color, setColor] = useState<'white' | 'black' | 'random'>('white');

  const [startFrom, setStartFrom] = useState<StartFrom>('standard');
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);
  const [openingFilter, setOpeningFilter] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);

  // If the chosen style isn't available, fall back to the first one offered.
  useEffect(() => {
    if (styles.length > 0 && !styles.some((s) => s.id === style)) setStyle(styles[0]!.id);
  }, [styles, style]);

  const selStyle = styles.find((s) => s.id === style);
  const isHuman = style === 'human';
  const maiaNets = availability?.maiaNetworks ?? [];
  // Real Maia needs a live lc0 backend — `humanBackend` is the server's honest
  // signal; net entries alone just mean weights are on disk. Without it,
  // 'human' runs on the server's human-calibrated engine sampler: strength
  // comes from the rating slider instead of net buttons.
  const humanViaMaia = isHuman && availability?.humanBackend === 'maia' && maiaNets.length > 0;
  const humanViaEngine = isHuman && !humanViaMaia;

  // Keep the slider value inside the selected model's range when switching styles.
  useEffect(() => {
    if (humanViaMaia) return; // net grid shown: the slider isn't in play
    const lo = humanViaEngine ? HUMAN_ELO_MIN : STOCKFISH_ELO_MIN;
    const hi = humanViaEngine ? HUMAN_ELO_MAX : STOCKFISH_ELO_MAX;
    if (elo < lo || elo > hi) setElo(Math.min(Math.max(elo, lo), hi));
  }, [humanViaMaia, humanViaEngine, elo]);

  // Snap the selected net to one that's actually installed (a partial install
  // may not cover the default), so the label always names the net that plays.
  useEffect(() => {
    if (!humanViaMaia || maiaNets.some((n) => n.rating === maiaRating)) return;
    let nearest = maiaNets[0]!.rating;
    for (const n of maiaNets) {
      if (Math.abs(n.rating - maiaRating) < Math.abs(nearest - maiaRating)) nearest = n.rating;
    }
    setMaiaRating(nearest);
  }, [humanViaMaia, maiaNets, maiaRating]);

  const filteredOpenings = useMemo(() => {
    const q = openingFilter.trim().toLowerCase();
    return q ? OPENING_LINES.filter((o) => o.name.toLowerCase().includes(q) || o.eco.toLowerCase() === q) : OPENING_LINES;
  }, [openingFilter]);
  const selectedOpening = OPENING_LINES.find((o) => o.id === openingId) ?? null;

  const selectOpening = (o: OpeningLine) => {
    setOpeningId(o.id);
    setColor(o.side); // default to playing the side this opening is for
  };

  const start = () => {
    const playerColor: Color = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
    const humanElo = Math.min(Math.max(elo, HUMAN_ELO_MIN), HUMAN_ELO_MAX);
    const bot = humanViaEngine
      ? { style, elo: humanElo, moveTimeMs } // no maiaRating: the sampler covers the whole range
      : { style, elo, maiaRating, moveTimeMs };
    const opponent = {
      name: botLabel(t, style, humanViaEngine ? humanElo : elo, maiaRating, humanViaMaia),
      rating: isHuman ? (humanViaEngine ? humanElo : maiaRating) : elo,
    };

    if (startFrom === 'position') {
      const fen = fenInput.trim();
      try {
        new Chess(fen);
      } catch {
        setFenError(t('custom.fenError'));
        return;
      }
      newGame({ mode: 'play', playerColor, bot, opponent, startFen: fen });
    } else if (startFrom === 'opening' && selectedOpening) {
      newGame({ mode: 'play', playerColor, bot, opponent, setupSan: selectedOpening.moves });
    } else {
      newGame({ mode: 'play', playerColor, bot, opponent });
    }
  };

  const startDisabled = startFrom === 'opening' && !selectedOpening;

  if (styles.length === 0) {
    return (
      <div className="rounded-2xl bg-panel shadow-soft p-3 text-sm text-neutral-400">
        <Trans t={t} i18nKey="custom.waitingForServer" components={{ cmd: <code className="text-neutral-200" /> }} />
      </div>
    );
  }

  const tab = (active: boolean) =>
    `rounded px-2 py-1 text-xs ${active ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'}`;

  return (
    <div className="rounded-2xl bg-panel shadow-soft p-3">
      <h3 className="mb-2 text-sm font-semibold text-ink">{t('custom.title')}</h3>

      {/* style */}
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('custom.style')}</div>
      <div className="mb-2 flex flex-wrap gap-1">
        {styles.map((s) => (
          <button key={s.id} onClick={() => setStyle(s.id)} aria-pressed={style === s.id} className={tab(style === s.id)}>
            {s.name}
          </button>
        ))}
      </div>
      {selStyle && <p className="mb-3 text-xs leading-snug text-neutral-400">{selStyle.description}</p>}
      {isHuman && availability && (
        <p className="-mt-2 mb-3 text-xs leading-snug text-neutral-400">
          {humanViaMaia ? t('custom.humanViaMaia') : t('custom.humanViaEngine')}
        </p>
      )}

      {/* strength */}
      {humanViaMaia ? (
        <div className="mb-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('custom.rating')}</div>
          <div className="grid grid-cols-5 gap-1">
            {maiaNets.map((n) => (
              <button
                key={n.id}
                onClick={() => setMaiaRating(n.rating)}
                className={`rounded px-2 py-1 text-xs ${
                  maiaRating === n.rating ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
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
            <span className="uppercase tracking-wide text-neutral-400">{t('custom.strength')}</span>
            <span className="font-mono text-neutral-300">
              {humanViaEngine ? t('custom.eloApprox', { elo }) : elo >= 3190 ? t('custom.eloMax') : t('custom.eloValue', { elo })}
            </span>
          </div>
          <input
            type="range"
            min={humanViaEngine ? HUMAN_ELO_MIN : STOCKFISH_ELO_MIN}
            max={humanViaEngine ? HUMAN_ELO_MAX : STOCKFISH_ELO_MAX}
            step={10}
            value={elo}
            onChange={(e) => setElo(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
          <div className="mt-1 flex justify-between">
            {(humanViaEngine ? HUMAN_ELO_PRESETS : ELO_PRESETS).map((p) => (
              <button key={p} onClick={() => setElo(p)} className="text-xs text-neutral-400 hover:text-neutral-200">
                {!humanViaEngine && p === 3190 ? t('custom.eloMax') : p}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-xs text-neutral-400">{t('custom.think.label')}</span>
            {THINK_OPTIONS.map((o) => (
              <button
                key={o.ms}
                onClick={() => setMoveTimeMs(o.ms)}
                className={`rounded px-2 py-0.5 text-xs ${
                  moveTimeMs === o.ms ? 'bg-neutral-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {t(`custom.think.${o.id}`)}
              </button>
            ))}
          </div>
          {!humanViaEngine && <p className="mt-1 text-xs text-neutral-400">{t('custom.subLadderHint')}</p>}
        </div>
      )}

      {/* time control */}
      <div className="mb-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('timeControl.label')}</div>
        <div className="flex gap-1">
          {TIME_CONTROLS.map((tc) => {
            const selected = (timeControl?.label ?? 'unlimited') === (tc?.label ?? 'unlimited');
            return (
              <button key={tc?.label ?? 'unlimited'} onClick={() => setTimeControl(tc)} className={`flex-1 ${tab(selected)} py-1`}>
                {tc?.label ?? t('timeControl.unlimited')}
              </button>
            );
          })}
        </div>
      </div>

      {/* color */}
      <div className="mb-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('color.label')}</div>
        <div className="flex gap-1">
          {(['white', 'black', 'random'] as const).map((c) => (
            <button key={c} onClick={() => setColor(c)} className={`flex-1 capitalize ${tab(color === c)} py-1`}>
              {t(`color.${c}`)}
            </button>
          ))}
        </div>
      </div>

      {/* start from */}
      <div className="mb-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('custom.startFrom.label')}</div>
        <div className="flex gap-1">
          {([
            ['standard', t('custom.startFrom.standard')],
            ['position', t('custom.startFrom.position')],
            ['opening', t('custom.startFrom.opening')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setStartFrom(id);
                setFenError(null);
              }}
              className={`flex-1 ${tab(startFrom === id)} py-1`}
            >
              {label}
            </button>
          ))}
        </div>

        {startFrom === 'position' && (
          <div className="mt-2">
            <textarea
              value={fenInput}
              onChange={(e) => {
                setFenInput(e.target.value);
                setFenError(null);
              }}
              placeholder={t('custom.fenPlaceholder')}
              rows={2}
              className="w-full resize-none rounded bg-neutral-900 p-2 font-mono text-xs text-neutral-200 outline-none ring-1 ring-neutral-700 focus:ring-emerald-600"
            />
            <div className="mt-1 flex items-center justify-between">
              <button
                onClick={() => {
                  setFenInput(liveFen);
                  setFenError(null);
                }}
                className="text-xs text-emerald-400 hover:text-emerald-300"
              >
                {t('custom.useCurrentPosition')}
              </button>
              {fenError && <span className="text-xs text-rose-400">{fenError}</span>}
            </div>
          </div>
        )}

        {startFrom === 'opening' && (
          <div className="mt-2">
            <input
              value={openingFilter}
              onChange={(e) => setOpeningFilter(e.target.value)}
              placeholder={t('custom.openingFilterPlaceholder')}
              className="mb-1 w-full rounded bg-neutral-900 px-2 py-1 text-xs text-neutral-200 outline-none ring-1 ring-neutral-700 focus:ring-emerald-600"
            />
            <div className="scroll-thin max-h-40 space-y-0.5 overflow-y-auto">
              {filteredOpenings.map((o) => (
                <button
                  key={o.id}
                  onClick={() => selectOpening(o)}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs ${
                    openingId === o.id ? 'bg-brand-600 text-white' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
                  }`}
                >
                  <span className="truncate">{o.name}</span>
                  <span className="shrink-0 font-mono opacity-90">{o.eco}</span>
                </button>
              ))}
              {filteredOpenings.length === 0 && (
                <p className="px-2 py-1 text-xs text-neutral-400">{t('custom.noOpeningsMatch')}</p>
              )}
            </div>
            {selectedOpening && (
              <p className="mt-1 text-xs text-neutral-400">
                <Trans
                  t={t}
                  i18nKey="custom.openingStart"
                  count={selectedOpening.moves.length}
                  values={{ name: selectedOpening.name }}
                  components={{ b: <b className="text-neutral-200" /> }}
                />
              </p>
            )}
          </div>
        )}
      </div>

      <button
        onClick={start}
        disabled={startDisabled}
        className="w-full rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {t('custom.start')}
      </button>
    </div>
  );
}
