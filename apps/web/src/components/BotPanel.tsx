import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { BotStyleId } from '@chesser/shared';
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
  { label: 'Fast', ms: 300 },
  { label: 'Normal', ms: 700 },
  { label: 'Slow', ms: 1500 },
];

const ELO_PRESETS = [1320, 1600, 1900, 2200, 2500, 3190];
// The human-like sampler covers any rating; sub-1320 lives here (not the ladder-only path).
const HUMAN_ELO_MIN = 600;
const HUMAN_ELO_MAX = 2000;
const HUMAN_ELO_PRESETS = [600, 800, 1000, 1200, 1600, 2000];

type StartFrom = 'standard' | 'position' | 'opening';

function botLabel(style: BotStyleId, elo: number, maia: number, hasMaiaNets: boolean): string {
  if (style === 'human') return hasMaiaNets ? `Maia ${maia}` : `Human-like ~${elo}`;
  const s = style.charAt(0).toUpperCase() + style.slice(1);
  return `Stockfish ${s} (${elo >= 3190 ? 'max' : elo})`;
}

export function BotPanel() {
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

  const isHumanViaEngine = style === 'human' && (availability?.maiaNetworks ?? []).length === 0;
  // Keep the slider value inside the human-model range when switching styles.
  useEffect(() => {
    if (isHumanViaEngine && (elo < HUMAN_ELO_MIN || elo > HUMAN_ELO_MAX)) {
      setElo(Math.min(Math.max(elo, HUMAN_ELO_MIN), HUMAN_ELO_MAX));
    }
  }, [isHumanViaEngine, elo]);

  const selStyle = styles.find((s) => s.id === style);
  const isHuman = style === 'human';
  const maiaNets = availability?.maiaNetworks ?? [];
  // 'human' without Maia nets runs on the server's human-calibrated engine
  // sampler: strength comes from the rating slider instead of net buttons.
  const humanViaEngine = isHuman && maiaNets.length === 0;

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
      name: botLabel(style, humanViaEngine ? humanElo : elo, maiaRating, maiaNets.length > 0),
      rating: isHuman ? (humanViaEngine ? humanElo : maiaRating) : elo,
    };

    if (startFrom === 'position') {
      const fen = fenInput.trim();
      try {
        new Chess(fen);
      } catch {
        setFenError('That FEN is not a legal position.');
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
        Waiting for the engine server… (run <code className="text-neutral-200">pnpm dev:server</code>)
      </div>
    );
  }

  const tab = (active: boolean) =>
    `rounded px-2 py-1 text-xs ${active ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'}`;

  return (
    <div className="rounded-2xl bg-panel shadow-soft p-3">
      <h3 className="mb-2 text-sm font-semibold text-ink">Custom game</h3>

      {/* style */}
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Style</div>
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
          {maiaNets.length > 0
            ? 'Running the Maia neural net (trained on real games at each rating).'
            : 'Maia nets are not installed here — using the engine-based human model.'}
        </p>
      )}

      {/* strength */}
      {isHuman && maiaNets.length > 0 ? (
        <div className="mb-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Rating</div>
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
            <span className="uppercase tracking-wide text-neutral-400">Strength</span>
            <span className="font-mono text-neutral-300">
              {humanViaEngine ? `~${elo} Elo` : elo >= 3190 ? 'max' : `${elo} Elo`}
            </span>
          </div>
          <input
            type="range"
            min={humanViaEngine ? HUMAN_ELO_MIN : 1320}
            max={humanViaEngine ? HUMAN_ELO_MAX : 3190}
            step={10}
            value={elo}
            onChange={(e) => setElo(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
          <div className="mt-1 flex justify-between">
            {(humanViaEngine ? HUMAN_ELO_PRESETS : ELO_PRESETS).map((p) => (
              <button key={p} onClick={() => setElo(p)} className="text-xs text-neutral-400 hover:text-neutral-200">
                {!humanViaEngine && p === 3190 ? 'max' : p}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-xs text-neutral-400">Think</span>
            {THINK_OPTIONS.map((t) => (
              <button
                key={t.ms}
                onClick={() => setMoveTimeMs(t.ms)}
                className={`rounded px-2 py-0.5 text-xs ${
                  moveTimeMs === t.ms ? 'bg-neutral-500 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {!humanViaEngine && <p className="mt-1 text-xs text-neutral-400">For sub-1320 opponents, climb the Ladder tab.</p>}
        </div>
      )}

      {/* time control */}
      <div className="mb-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Time control</div>
        <div className="flex gap-1">
          {TIME_CONTROLS.map((tc) => {
            const selected = (timeControl?.label ?? 'unlimited') === (tc?.label ?? 'unlimited');
            return (
              <button key={tc?.label ?? 'unlimited'} onClick={() => setTimeControl(tc)} className={`flex-1 ${tab(selected)} py-1`}>
                {tc?.label ?? '∞'}
              </button>
            );
          })}
        </div>
      </div>

      {/* color */}
      <div className="mb-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">You play</div>
        <div className="flex gap-1">
          {(['white', 'black', 'random'] as const).map((c) => (
            <button key={c} onClick={() => setColor(c)} className={`flex-1 capitalize ${tab(color === c)} py-1`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* start from */}
      <div className="mb-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Start from</div>
        <div className="flex gap-1">
          {([
            ['standard', 'Standard'],
            ['position', 'Position'],
            ['opening', 'Opening'],
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
              placeholder="Paste a FEN…"
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
                Use current board position
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
              placeholder="Filter openings…"
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
                  <span className="shrink-0 font-mono opacity-60">{o.eco}</span>
                </button>
              ))}
              {filteredOpenings.length === 0 && <p className="px-2 py-1 text-xs text-neutral-400">No openings match.</p>}
            </div>
            {selectedOpening && (
              <p className="mt-1 text-xs text-neutral-400">
                Start after <b className="text-neutral-200">{selectedOpening.moves.length}</b> moves of the{' '}
                {selectedOpening.name}.
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
        Start game
      </button>
    </div>
  );
}
