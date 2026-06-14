/**
 * Gamification orchestrator. The trainer pages and the play page call into the
 * `record*` functions here on every meaningful event; this module then:
 *   1. updates the relevant rating (Elo + Glicko-2),
 *   2. awards XP / advances the daily goal & streak,
 *   3. re-checks the achievement catalogue and unlocks anything newly earned,
 *   4. emits UI events so toasts can celebrate level-ups, badges and goals.
 *
 * Keeping this glue in one place means the call sites stay one-liners and the
 * stores stay unaware of each other.
 */
import { useRatings, type GameOutcome, type RatingCategory } from '../store/ratings';
import { useGamify, levelFromXp, type AwardResult } from '../store/gamify';
import { useAchievements } from '../store/achievements';
import { useProgress } from '../store/progress';
import { useRepertoire } from '../store/repertoire';
import { useLadder } from '../store/ladder';
import { ROSTER_BY_ID } from '../data/botRoster';
import { ACHIEVEMENTS_BY_ID, evaluateAchievements, type AchievementCtx } from './achievements';

// — Event bus (toasts subscribe to this) —
export type GamifyEvent =
  | { kind: 'achievement'; id: string; name: string; icon: string; xp: number }
  | { kind: 'level'; level: number }
  | { kind: 'goal'; streak: number };

const listeners = new Set<(e: GamifyEvent) => void>();

export function onGamifyEvent(fn: (e: GamifyEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(e: GamifyEvent): void {
  for (const fn of listeners) fn(e);
}

/** Award XP and surface any level-up / daily-goal-met as toast events. */
function applyAward(amount: number, countsAsActivity = true): AwardResult {
  const res = useGamify.getState().award(amount, countsAsActivity);
  if (res.leveledUp) emit({ kind: 'level', level: res.level });
  if (res.goalJustMet) emit({ kind: 'goal', streak: res.streak });
  return res;
}

/** Snapshot every store into the flat shape the achievement catalogue reads. */
export function buildAchievementCtx(): AchievementCtx {
  const ratings = useRatings.getState().categories;
  const gamify = useGamify.getState();
  const progress = useProgress.getState();
  const ladder = useLadder.getState();

  const ratingSnap = (cat: RatingCategory) => {
    const c = ratings[cat];
    return {
      elo: Math.round(c.elo),
      glicko: Math.round(c.glicko.rating),
      peak: Math.round(Math.max(c.eloPeak, c.glickoPeak)),
      played: c.played,
      won: c.won,
    };
  };

  let reviews = 0;
  const activeDays = new Set<string>();
  for (const [day, v] of Object.entries(progress.history)) {
    reviews += v.reviews;
    if (v.reviews > 0) activeDays.add(day);
  }
  for (const [day, log] of Object.entries(gamify.days)) {
    if (log.activities > 0) activeDays.add(day);
  }
  // Counted at crossing time, so changing the goal doesn't retroactively shift it.
  const goalsMet = gamify.goalsMet;

  let topBotBeatenRating = 0;
  for (const id of Object.keys(ladder.defeated)) {
    const bot = ROSTER_BY_ID[id];
    if (bot && bot.rating > topBotBeatenRating) topBotBeatenRating = bot.rating;
  }

  return {
    level: levelFromXp(gamify.xp),
    streak: gamify.activeStreak(),
    bestStreak: gamify.bestStreak,
    goalMetToday: gamify.goalMetToday(),
    goalsMet,
    ratings: { bots: ratingSnap('bots'), blitz: ratingSnap('blitz'), puzzles: ratingSnap('puzzles') },
    puzzlesSolved: ratings.puzzles.won,
    gamesPlayed: ratings.bots.played + ratings.blitz.played,
    gamesWon: ratings.bots.won + ratings.blitz.won,
    botsBeaten: ladder.clearedCount(),
    topBotBeatenRating,
    rushBest: useRepertoire.getState().rushHighScore,
    reviews,
    activeDays: activeDays.size,
  };
}

/**
 * Re-evaluate the catalogue. `silent` unlocks already-satisfied badges without
 * toasts or XP (used once at startup so historical progress doesn't spam or
 * inflate); otherwise new unlocks celebrate and pay out their bonus XP.
 */
function runAchievements(opts: { silent?: boolean } = {}): void {
  // Loop so a badge whose XP triggers a level-up (which unlocks another badge)
  // resolves in one go. Bounded to avoid any pathological cycle.
  for (let pass = 0; pass < 4; pass++) {
    const newly = useAchievements.getState().unlock(evaluateAchievements(buildAchievementCtx()));
    if (newly.length === 0) return;
    if (opts.silent) continue;
    for (const id of newly) {
      const a = ACHIEVEMENTS_BY_ID[id];
      if (!a) continue;
      if (a.xp > 0) applyAward(a.xp, false);
      emit({ kind: 'achievement', id: a.id, name: a.name, icon: a.icon, xp: a.xp });
    }
  }
}

// — Public record functions (called from the pages) —

/** A rated tactics puzzle was attempted. Updates the puzzles rating + XP. */
export function recordPuzzle(puzzleRating: number, success: boolean): { eloDelta: number; elo: number; glickoDelta: number; glicko: number } {
  const res = useRatings.getState().record('puzzles', puzzleRating, success ? 'win' : 'loss');
  applyAward(success ? 8 : 3);
  runAchievements();
  return res;
}

/** A spaced-repetition card (openings / mates / anti-blunder) was graded. */
export function recordReview(correct: boolean): void {
  applyAward(correct ? 6 : 2);
  runAchievements();
}

/** A vs-bot game finished. `timed` routes it to the blitz vs bots rating. */
export function recordGameResult(opts: { opponentRating: number; outcome: GameOutcome; timed: boolean }): void {
  const category: RatingCategory = opts.timed ? 'blitz' : 'bots';
  const before = useRatings.getState().categories[category].elo;
  useRatings.getState().record(category, opts.opponentRating, opts.outcome);
  // Base XP by result, with an upset bonus for beating a stronger opponent.
  let xp = opts.outcome === 'win' ? 25 : opts.outcome === 'draw' ? 12 : 6;
  if (opts.outcome === 'win' && opts.opponentRating > before) xp += Math.min(25, Math.round((opts.opponentRating - before) / 25));
  applyAward(xp);
  runAchievements();
}

/** A puzzle-rush run ended with `score` solved. */
export function recordRush(score: number): void {
  applyAward(Math.min(80, 5 + score * 2));
  runAchievements();
}

let initialized = false;
/** Run once on app start: migrate the legacy puzzle rating and back-fill badges. */
export function initGamify(): void {
  if (initialized) return;
  initialized = true;
  useRatings.getState().migrateLegacy();
  runAchievements({ silent: true });
}
