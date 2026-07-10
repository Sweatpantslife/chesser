/**
 * Puzzle-sprint engine — the pure, deterministic core shared by the Puzzle
 * Rush and Puzzle Storm trainers (pages/RushMode.tsx, pages/StormMode.tsx).
 *
 * Everything here is a plain function of its inputs: no Date.now(), no
 * Math.random(), no store reads. The UI owns the run seed (generated once per
 * run at the entry point) and the clock (lib/clock `now()`), and feeds both
 * in — so a whole run is reproducible in tests from a seed + a scripted
 * sequence of solve/miss events.
 *
 * Puzzle *data* stays owned by lib/puzzleService (consumed read-only via
 * getLoadedPuzzles); this module only decides which of the loaded puzzles a
 * run serves next and how the score/lives/combo evolve.
 */
import type { Puzzle } from '../trainers/tactics';
import { puzzleRatingOf } from './puzzleRating';

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/** Small, fast, seedable PRNG (mulberry32). Same seed → same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Puzzle Rush — escalating difficulty, 3 strikes, streak counting
// ---------------------------------------------------------------------------

export type RushVariant = 'timed3' | 'survival';

/** Run length per variant; null = no clock (survival ends on strikes only). */
export const RUSH_DURATION_MS: Record<RushVariant, number | null> = {
  timed3: 180_000,
  survival: null,
};

export const RUSH_MAX_STRIKES = 3;

export type SprintEndReason = 'strikes' | 'time' | 'quit';

export interface RushState {
  solved: number;
  strikes: number;
  /** Current run of consecutive solves. */
  streak: number;
  bestStreak: number;
  over: boolean;
  endReason: SprintEndReason | null;
}

export function initialRush(): RushState {
  return { solved: 0, strikes: 0, streak: 0, bestStreak: 0, over: false, endReason: null };
}

export function rushSolve(s: RushState): RushState {
  if (s.over) return s;
  const streak = s.streak + 1;
  return { ...s, solved: s.solved + 1, streak, bestStreak: Math.max(s.bestStreak, streak) };
}

export function rushMiss(s: RushState): RushState {
  if (s.over) return s;
  const strikes = s.strikes + 1;
  const out = strikes >= RUSH_MAX_STRIKES;
  return { ...s, strikes, streak: 0, over: out, endReason: out ? 'strikes' : null };
}

/** External end (clock ran out / player gave up). Strike-outs use rushMiss. */
export function rushEnd(s: RushState, reason: 'time' | 'quit'): RushState {
  if (s.over) return s;
  return { ...s, over: true, endReason: reason };
}

/** Rush ramp: start easy and climb with every solve, whoever you are.
 *  600 is the easiest dataset band; the ramp tops out at 2600. */
export function rushTargetRating(solved: number): number {
  return Math.min(600 + solved * 45, 2600);
}

// ---------------------------------------------------------------------------
// Puzzle Storm — fixed window, combo multipliers, speed-adaptive difficulty
// ---------------------------------------------------------------------------

export const STORM_DURATION_MS = 180_000;

/** Points for a solve before the combo multiplier. */
export const STORM_BASE_POINTS = 10;
/** Solving faster than this earns the flat speed bonus on top. */
export const STORM_FAST_SOLVE_MS = 4_000;
export const STORM_FAST_BONUS = 5;

/** Combo multiplier tiers: ×1 → ×1.5 (5+) → ×2 (10+) → ×3 (15+). */
export function stormMultiplier(combo: number): number {
  if (combo >= 15) return 3;
  if (combo >= 10) return 2;
  if (combo >= 5) return 1.5;
  return 1;
}

/** Difficulty window the adaptive target is clamped to. */
export const STORM_MIN_TARGET = 600;
export const STORM_MAX_TARGET = 2800;

/** Adaptive steps: fast/normal solves push the target up, misses pull it down. */
export const STORM_STEP_FAST = 60; // solved in ≤ 5s
export const STORM_STEP_NORMAL = 30; // solved in ≤ 12s
export const STORM_STEP_SLOW = 10; // solved, but slowly
export const STORM_STEP_MISS = 120; // wrong move

export interface StormState {
  score: number;
  solved: number;
  missed: number;
  /** Current run of consecutive solves (drives the multiplier). */
  combo: number;
  bestCombo: number;
  /** Adaptive difficulty: the rating the next puzzle is picked around. */
  target: number;
  over: boolean;
  endReason: SprintEndReason | null;
}

const clampTarget = (t: number): number => Math.max(STORM_MIN_TARGET, Math.min(STORM_MAX_TARGET, t));

/** A run opens slightly below the player's puzzle rating so the first solves
 *  feel brisk, then speed takes over. */
export function initialStorm(playerRating: number): StormState {
  return {
    score: 0,
    solved: 0,
    missed: 0,
    combo: 0,
    bestCombo: 0,
    target: clampTarget(Math.round(playerRating) - 200),
    over: false,
    endReason: null,
  };
}

export interface StormSolveResult {
  state: StormState;
  /** Points this solve was worth (base × multiplier + speed bonus). */
  points: number;
  /** The multiplier that applied to this solve. */
  multiplier: number;
}

export function stormSolve(s: StormState, solveMs: number): StormSolveResult {
  if (s.over) return { state: s, points: 0, multiplier: stormMultiplier(s.combo) };
  const combo = s.combo + 1;
  const multiplier = stormMultiplier(combo);
  const points = Math.round(STORM_BASE_POINTS * multiplier) + (solveMs <= STORM_FAST_SOLVE_MS ? STORM_FAST_BONUS : 0);
  const step = solveMs <= 5_000 ? STORM_STEP_FAST : solveMs <= 12_000 ? STORM_STEP_NORMAL : STORM_STEP_SLOW;
  const state: StormState = {
    ...s,
    score: s.score + points,
    solved: s.solved + 1,
    combo,
    bestCombo: Math.max(s.bestCombo, combo),
    target: clampTarget(s.target + step),
  };
  return { state, points, multiplier };
}

export function stormMiss(s: StormState): StormState {
  if (s.over) return s;
  return { ...s, missed: s.missed + 1, combo: 0, target: clampTarget(s.target - STORM_STEP_MISS) };
}

export function stormEnd(s: StormState, reason: 'time' | 'quit'): StormState {
  if (s.over) return s;
  return { ...s, over: true, endReason: reason };
}

// ---------------------------------------------------------------------------
// Deterministic puzzle selection
// ---------------------------------------------------------------------------

/**
 * Pick the next sprint puzzle near `target` from the loaded pool: start with a
 * ±150 rating window and widen by 150 until candidates exist, skipping ids
 * already served this run. Once the run has exhausted every fresh puzzle the
 * used-id filter is dropped rather than ending the run. The `rand` source is
 * the run's seeded PRNG, so a run replays identically given the same pool.
 */
export function pickSprintPuzzle(
  pool: readonly Puzzle[],
  target: number,
  usedIds: ReadonlySet<string>,
  rand: () => number,
): Puzzle | null {
  if (pool.length === 0) return null;
  for (const skipUsed of [true, false]) {
    const candidates = skipUsed ? pool.filter((p) => !usedIds.has(p.id)) : pool;
    if (candidates.length === 0) continue;
    for (let window = 150; window <= 2400; window += 150) {
      const near = candidates.filter((p) => Math.abs(puzzleRatingOf(p) - target) <= window);
      if (near.length > 0) return near[Math.floor(rand() * near.length)]!;
    }
    return candidates[Math.floor(rand() * candidates.length)]!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small shared display helper
// ---------------------------------------------------------------------------

/** ms → "m:ss" (floored at 0:00). */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
