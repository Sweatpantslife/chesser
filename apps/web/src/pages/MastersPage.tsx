import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { STARTING_FEN } from '@chesser/shared';
import { Board } from '../board/Board';
import {
  DIFFICULTY_LABELS,
  GAME_THEMES,
  MASTER_GAMES,
  masterGamePgn,
  plyLabel,
  THEME_LABELS,
  type GameDifficulty,
  type GameTheme,
  type MasterGame,
} from '../data/masterGames';
import { awardXP } from '../lib/gamify';
import { playMoveSound, playSound } from '../lib/sound';
import { useGame } from '../store/game';
import type { Color } from '../store/game';

/**
 * Annotated master games: a curated library of famous instructive games
 * (data/masterGames.ts). The library view filters by theme / opening /
 * difficulty; the viewer replays a game move-by-move on the shared Board with
 * per-move commentary, key-moment jumps, and a hand-off to the analysis board.
 */
export function MastersPage({ goPlay }: { goPlay: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const game = selectedId ? MASTER_GAMES.find((g) => g.id === selectedId) ?? null : null;

  return game ? (
    <GameViewer
      game={game}
      goPlay={goPlay}
      onBack={() => {
        playSound('uiClick');
        setSelectedId(null);
      }}
    />
  ) : (
    <Library
      onOpen={(id) => {
        playSound('uiClick');
        setSelectedId(id);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

const CHIP_ON = 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow';
const CHIP_OFF = 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-ink';
const chip = (on: boolean) =>
  `btn-press min-h-11 shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold sm:min-h-0 ${on ? CHIP_ON : CHIP_OFF}`;

const DIFF_BADGE: Record<GameDifficulty, string> = {
  beginner: 'bg-emerald-900/60 text-emerald-300',
  intermediate: 'bg-amber-950 text-amber-300',
  advanced: 'bg-rose-900/60 text-rose-300',
};

function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [theme, setTheme] = useState<GameTheme | 'all'>('all');
  const [difficulty, setDifficulty] = useState<GameDifficulty | 'all'>('all');
  const [opening, setOpening] = useState<string>('all');

  const openings = useMemo(() => [...new Set(MASTER_GAMES.map((g) => `${g.eco} ${g.opening}`))].sort(), []);

  const filtered = MASTER_GAMES.filter(
    (g) =>
      (theme === 'all' || g.themes.includes(theme)) &&
      (difficulty === 'all' || g.difficulty === difficulty) &&
      (opening === 'all' || `${g.eco} ${g.opening}` === opening),
  );

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-4">
      <header>
        <h2 className="font-display text-2xl font-bold text-ink">Master games</h2>
        <p className="text-sm text-neutral-400">
          Famous games, annotated move by move — replay them, jump to the key moments, and take any position to the
          analysis board.
        </p>
      </header>

      <div className="space-y-2 rounded-blob bg-panel p-3 shadow-soft">
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto" role="group" aria-label="Filter by theme">
          <button className={chip(theme === 'all')} aria-pressed={theme === 'all'} onClick={() => setTheme('all')}>
            All themes
          </button>
          {GAME_THEMES.map((t) => (
            <button key={t} className={chip(theme === t)} aria-pressed={theme === t} onClick={() => setTheme(t)}>
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="scrollbar-none flex gap-1.5 overflow-x-auto" role="group" aria-label="Filter by difficulty">
            <button
              className={chip(difficulty === 'all')}
              aria-pressed={difficulty === 'all'}
              onClick={() => setDifficulty('all')}
            >
              Any level
            </button>
            {(Object.keys(DIFFICULTY_LABELS) as GameDifficulty[]).map((d) => (
              <button key={d} className={chip(difficulty === d)} aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
                {DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm text-neutral-300">
            Opening
            <select
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              className="min-h-11 rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-ink sm:min-h-0"
            >
              <option value="all">All openings</option>
              {openings.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-blob bg-panel p-6 text-center text-sm text-neutral-400">
          No games match these filters — try clearing one.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((g) => (
            <li key={g.id}>
              <button
                onClick={() => onOpen(g.id)}
                className="btn-press flex h-full w-full flex-col gap-2 rounded-blob bg-panel p-4 text-left shadow-soft hover:bg-panelmute"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-display text-base font-bold leading-tight text-ink">
                    {g.white} – {g.black}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${DIFF_BADGE[g.difficulty]}`}>
                    {DIFFICULTY_LABELS[g.difficulty]}
                  </span>
                </div>
                <span className="text-xs text-neutral-400">
                  {g.event} {g.year} · {g.result} · {g.eco} {g.opening}
                </span>
                <span className="text-sm leading-snug text-neutral-300">{g.blurb}</span>
                <span className="mt-auto flex flex-wrap gap-1 pt-1">
                  {g.themes.map((t) => (
                    <span key={t} className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-neutral-300">
                      {THEME_LABELS[t]}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

const EMPTY_DESTS = new Map<string, string[]>();
const NOOP = () => {};

/** Once-per-game view-through reward, tracked in localStorage. */
const VIEWED_KEY = 'chesser-masters-viewed';
function markViewedAndReward(id: string): void {
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    const seen: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (seen.includes(id)) return;
    localStorage.setItem(VIEWED_KEY, JSON.stringify([...seen, id]));
  } catch {
    return; // storage unavailable — skip the reward rather than repeat it
  }
  awardXP('lesson', 10);
}

interface ReplayStep {
  san: string;
  from: string;
  to: string;
  fen: string;
  check: boolean;
}

function GameViewer({ game, goPlay, onBack }: { game: MasterGame; goPlay: () => void; onBack: () => void }) {
  // ply 0 = start position; ply n = after sans[n-1] (matches data convention).
  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<Color>('white');

  const steps = useMemo<ReplayStep[]>(() => {
    const c = new Chess();
    return game.sans.map((san) => {
      const mv = c.move(san);
      return { san: mv.san, from: mv.from, to: mv.to, fen: c.fen(), check: c.inCheck() };
    });
  }, [game]);

  const last = steps.length;
  const step = ply > 0 ? steps[ply - 1]! : null;
  const fen = step ? step.fen : STARTING_FEN;
  const turnColor: Color = fen.split(' ')[1] === 'b' ? 'black' : 'white';

  // Kept current every render so event handlers never read stale state.
  const stateRef = useRef({ ply, last });
  stateRef.current = { ply, last };

  const goTo = (p: number, sound = false) => {
    const next = Math.max(0, Math.min(last, p));
    if (sound && next === stateRef.current.ply + 1) playMoveSound(steps[next - 1]!.san);
    setPly(next);
  };

  // Reward a completed view-through (once per game, ever).
  useEffect(() => {
    if (ply === last && last > 0) markViewedAndReward(game.id);
  }, [ply, last, game.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const { ply: p, last: len } = stateRef.current;
      if (e.key === 'ArrowLeft') goTo(p - 1);
      else if (e.key === 'ArrowRight') goTo(p + 1, true);
      else if (e.key === 'Home') goTo(0);
      else if (e.key === 'End') goTo(len);
      else if (e.key === 'f' || e.key === 'F') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hand the game to the analysis board on the Play tab, landing on this ply.
  const analyzeFromHere = () => {
    playSound('uiClick');
    if (useGame.getState().loadPgn(masterGamePgn(game))) {
      useGame.getState().goToPly(ply);
      goPlay();
    }
  };

  const note = ply > 0 ? game.annotations[ply] : undefined;
  const btn =
    'btn-press min-h-11 min-w-11 rounded-full bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 sm:min-h-0 sm:min-w-0';

  return (
    <div className="mx-auto grid w-full max-w-[1100px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} onClick={onBack}>
            ← Library
          </button>
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-bold leading-tight text-ink">
              {game.white} – {game.black}
            </h2>
            <p className="text-xs text-neutral-400">
              {game.event} {game.year} · {game.result} · {game.eco} {game.opening}
            </p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[560px]">
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={turnColor}
            movableColor={undefined}
            dests={EMPTY_DESTS}
            lastMove={step ? [step.from, step.to] : undefined}
            inCheck={!!step?.check}
            onMove={NOOP}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button className={btn} onClick={() => goTo(0)} disabled={ply === 0} title="First (Home)" aria-label="First move">
            ⏮
          </button>
          <button
            className={btn}
            onClick={() => goTo(ply - 1)}
            disabled={ply === 0}
            title="Previous (←)"
            aria-label="Previous move"
          >
            ◀
          </button>
          <button
            className={btn}
            onClick={() => goTo(ply + 1, true)}
            disabled={ply === last}
            title="Next (→)"
            aria-label="Next move"
          >
            ▶
          </button>
          <button className={btn} onClick={() => goTo(last)} disabled={ply === last} title="Last (End)" aria-label="Last move">
            ⏭
          </button>
          <div className="mx-1 h-5 w-px bg-neutral-700" aria-hidden="true" />
          <button
            className={btn}
            onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
            title="Flip board (f)"
          >
            ⇅ Flip
          </button>
          <button className={btn} onClick={analyzeFromHere} title="Open this position on the analysis board">
            Analyze from here
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <section className="rounded-blob bg-panel p-3 shadow-soft" aria-label="Commentary">
          <h3 className="mb-1 text-sm font-semibold text-ink">
            {ply === 0 ? 'About this game' : `${plyLabel(ply)} ${steps[ply - 1]!.san}${note?.glyph ?? ''}`}
          </h3>
          <p className="text-sm leading-relaxed text-neutral-300" aria-live="polite">
            {ply === 0
              ? game.blurb
              : note?.text ?? 'Step through with the arrow keys — commentary appears on the annotated moves.'}
          </p>
        </section>

        <section className="rounded-blob bg-panel p-3 shadow-soft" aria-label="Key moments">
          <h3 className="mb-1.5 text-sm font-semibold text-ink">Key moments</h3>
          <div className="flex flex-wrap gap-1.5">
            {game.keyMoments.map((k) => (
              <button
                key={k}
                onClick={() => {
                  playSound('uiClick');
                  goTo(k);
                }}
                aria-current={ply === k ? 'step' : undefined}
                className={`btn-press min-h-11 rounded-full px-2.5 py-1 font-mono text-xs font-semibold sm:min-h-0 ${
                  ply === k ? CHIP_ON : 'bg-gold-500/15 text-gold-400 hover:bg-gold-500/25'
                }`}
              >
                ★ {plyLabel(k)} {steps[k - 1]!.san}
                {game.annotations[k]?.glyph ?? ''}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-blob bg-panel p-3 shadow-soft" aria-label="Moves">
          <h3 className="mb-1.5 text-sm font-semibold text-ink">Moves</h3>
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm" aria-label="Game moves">
            <li>
              <button
                onClick={() => goTo(0)}
                aria-current={ply === 0 ? 'step' : undefined}
                className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                  ply === 0 ? 'bg-brand-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'
                }`}
              >
                Start
              </button>
            </li>
            {steps.map((m, i) => {
              const p = i + 1;
              const a = game.annotations[p];
              const isKey = game.keyMoments.includes(p);
              return (
                <li key={`${i}-${m.san}`} className="flex items-center gap-1">
                  {i % 2 === 0 && (
                    <span className="text-xs text-neutral-400" aria-hidden="true">
                      {i / 2 + 1}.
                    </span>
                  )}
                  <button
                    onClick={() => goTo(p)}
                    aria-current={ply === p ? 'step' : undefined}
                    title={a?.text}
                    className={`rounded px-1.5 py-0.5 font-mono ${
                      ply === p
                        ? 'bg-brand-600 text-white'
                        : isKey
                          ? 'font-bold text-gold-400 hover:bg-neutral-800'
                          : a
                            ? 'text-brand-300 hover:bg-neutral-800'
                            : 'text-neutral-200 hover:bg-neutral-800'
                    }`}
                  >
                    {m.san}
                    {a?.glyph ?? ''}
                    {isKey && (
                      <span aria-hidden="true" className="ml-0.5">
                        ★
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            <li className="ml-1 font-mono text-xs text-neutral-400">{game.result}</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
