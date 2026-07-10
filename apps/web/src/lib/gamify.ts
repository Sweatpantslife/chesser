/**
 * Gamification core — the single public API for XP, levels, streaks and
 * achievements. The trainer pages and the play page call the `record*`
 * convenience functions on every meaningful event; other features (coach,
 * quests, …) integrate through the primitives:
 *
 *   awardXP(source, amount, opts?)   — ALL XP mutations flow through this
 *   unlockAchievement(id)            — direct unlock of a catalogue badge
 *   onGamifyEvent(fn)                — subscribe to the event bus (returns unsubscribe)
 *
 * Events emitted (see `GamifyEvent`):
 *   'xp-awarded'           every XP grant: { source, amount, totalXp, level }
 *   'level-up'             level threshold crossed: { level }
 *   'achievement-unlocked' badge earned: { id, name, icon, xp }
 *   'streak-milestone'     3/7/30/100-day streak bonus paid: { days, rewardXp, streak }
 *   'streak-freeze-used'   a banked freeze bridged a missed day: { streak, freezesLeft }
 *   'goal'                 daily XP goal met: { streak } (activity-day streak)
 *
 * On each awardXP this module: 1) adds XP / advances the daily goal,
 * 2) marks today active on the streak (freezes, milestones), 3) celebrates
 * level-ups / milestones with the existing sounds + confetti (components
 * Celebration/GamifyToasts subscribe to the bus), and the `record*` wrappers
 * additionally 4) re-check the achievement catalogue.
 *
 * Keeping this glue in one place means the call sites stay one-liners and the
 * stores stay unaware of each other.
 */
import { useRatings, type GameOutcome, type RatingCategory } from '../store/ratings';
import { useGamify, levelFromXp, type AwardResult } from '../store/gamify';
import { useAchievements } from '../store/achievements';
import { useStreak } from '../store/streak';
import { useProgress } from '../store/progress';
import { useRepertoire } from '../store/repertoire';
import { useLadder } from '../store/ladder';
import { useLessons } from '../store/lessons';
import { ROSTER_BY_ID } from '../data/botRoster';
import { ACHIEVEMENTS_BY_ID, evaluateAchievements, type AchievementCtx } from './achievements';
import { STREAK_MILESTONE_XP } from './streak';
import { playSound } from './sound';

// — Per-activity XP amounts (the one table to tune) —
export const XP_AWARDS = {
  puzzleSolved: 8,
  puzzleFailed: 3, // effort still counts
  reviewCorrect: 6,
  reviewWrong: 2,
  gameWin: 25,
  gameDraw: 12,
  gameLoss: 6,
  gameUpsetBonusMax: 25, // extra for beating a stronger bot: +1 XP per 25 Elo above you, capped
  lessonFirstBase: 15, // + 5 per star (stars 0–3 → 15–30)
  lessonStarBonus: 5,
  lessonReplay: 5,
  rushBase: 5, // + 2 per puzzle solved, capped at 80 total
  rushPerSolve: 2,
  rushCap: 80,
} as const;

/** Where a grant came from — extend freely; used for analytics/toasts, not logic. */
export type XpSource =
  | 'puzzle'
  | 'review'
  | 'game'
  | 'lesson'
  | 'rush'
  | 'achievement'
  | 'streak-milestone'
  | 'coach'
  | 'quest'
  | 'other';

// — Event bus (Celebration, GamifyToasts and feature code subscribe to this) —
export type GamifyEvent =
  | { kind: 'xp-awarded'; source: XpSource; amount: number; totalXp: number; level: number }
  | { kind: 'level-up'; level: number }
  | { kind: 'achievement-unlocked'; id: string; name: string; icon: string; xp: number }
  | { kind: 'streak-milestone'; days: number; rewardXp: number; streak: number }
  | { kind: 'streak-freeze-used'; streak: number; freezesLeft: number }
  | { kind: 'goal'; streak: number };

const listeners = new Set<(e: GamifyEvent) => void>();

export function onGamifyEvent(fn: (e: GamifyEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(e: GamifyEvent): void {
  for (const fn of listeners) fn(e);
}

/**
 * Award XP. The one entry point for every XP mutation: adds to the total,
 * advances the daily goal, extends the activity streak (paying milestone
 * bonuses), and emits/celebrates level-ups. Returns the store's AwardResult.
 *
 * `countsAsActivity: false` marks passive grants (achievement/milestone bonus
 * XP) that shouldn't tick the streak or the daily activity counter.
 */
export function awardXP(source: XpSource, amount: number, opts: { countsAsActivity?: boolean } = {}): AwardResult {
  const countsAsActivity = opts.countsAsActivity ?? true;
  const res = useGamify.getState().award(amount, countsAsActivity);
  emit({ kind: 'xp-awarded', source, amount, totalXp: res.totalXp, level: res.level });
  if (res.leveledUp) {
    playSound('levelUp');
    emit({ kind: 'level-up', level: res.level });
  }
  if (countsAsActivity) {
    const t = useStreak.getState().touch();
    if (t.usedFreeze) emit({ kind: 'streak-freeze-used', streak: t.data.count, freezesLeft: t.data.freezes });
    for (const days of t.newMilestones) {
      const rewardXp = STREAK_MILESTONE_XP[days] ?? 0;
      // Bonus XP is passive (countsAsActivity=false) so this can't recurse into touch().
      if (rewardXp > 0) awardXP('streak-milestone', rewardXp, { countsAsActivity: false });
      playSound('streak');
      emit({ kind: 'streak-milestone', days, rewardXp, streak: t.data.count });
    }
  }
  if (res.goalJustMet) {
    playSound('streak');
    emit({ kind: 'goal', streak: useStreak.getState().current() });
  }
  return res;
}

/**
 * Unlock a catalogue achievement by id (no-op if unknown or already earned).
 * Pays the badge's bonus XP and celebrates. Returns true when newly unlocked.
 * Feature code that mints its own badges should add them to the catalogue in
 * lib/achievements.ts, then call this.
 */
export function unlockAchievement(id: string): boolean {
  const a = ACHIEVEMENTS_BY_ID[id];
  if (!a) return false;
  const newly = useAchievements.getState().unlock([id]);
  if (newly.length === 0) return false;
  celebrateUnlock(id);
  return true;
}

function celebrateUnlock(id: string): void {
  const a = ACHIEVEMENTS_BY_ID[id];
  if (!a) return;
  if (a.xp > 0) awardXP('achievement', a.xp, { countsAsActivity: false });
  playSound('achievement');
  emit({ kind: 'achievement-unlocked', id: a.id, name: a.name, icon: a.icon, xp: a.xp });
}

/** Snapshot every store into the flat shape the achievement catalogue reads. */
export function buildAchievementCtx(): AchievementCtx {
  const ratings = useRatings.getState().categories;
  const gamify = useGamify.getState();
  const streakStore = useStreak.getState();
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
    // Streak badges read the activity streak; legacy goal-streak bests still count
    // so nobody's earned progress regresses.
    streak: streakStore.current(),
    bestStreak: Math.max(streakStore.best, gamify.bestStreak),
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
    lessonsCompleted: Object.keys(useLessons.getState().completed).length,
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
    for (const id of newly) celebrateUnlock(id);
  }
}

// — Public record functions (called from the pages) —

/** A rated tactics puzzle was attempted. Updates the puzzles rating + XP. */
export function recordPuzzle(puzzleRating: number, success: boolean): { eloDelta: number; elo: number; glickoDelta: number; glicko: number } {
  const res = useRatings.getState().record('puzzles', puzzleRating, success ? 'win' : 'loss');
  playSound(success ? 'puzzleSolved' : 'wrongMove');
  awardXP('puzzle', success ? XP_AWARDS.puzzleSolved : XP_AWARDS.puzzleFailed);
  runAchievements();
  return res;
}

/** A spaced-repetition card (openings / mates / anti-blunder) was graded. */
export function recordReview(correct: boolean): void {
  playSound(correct ? 'xpGain' : 'wrongMove');
  awardXP('review', correct ? XP_AWARDS.reviewCorrect : XP_AWARDS.reviewWrong);
  runAchievements();
}

/**
 * A vs-bot game finished. `timed` routes it to the blitz vs bots rating.
 * Returns the rating movement so the results modal can surface it.
 */
export function recordGameResult(opts: { opponentRating: number; outcome: GameOutcome; timed: boolean }): {
  category: RatingCategory;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
} {
  const category: RatingCategory = opts.timed ? 'blitz' : 'bots';
  const before = useRatings.getState().categories[category].elo;
  const rec = useRatings.getState().record(category, opts.opponentRating, opts.outcome);
  playSound(opts.outcome === 'win' ? 'gameWin' : opts.outcome === 'draw' ? 'gameDraw' : 'gameLoss');
  // Base XP by result, with an upset bonus for beating a stronger opponent.
  let xp = opts.outcome === 'win' ? XP_AWARDS.gameWin : opts.outcome === 'draw' ? XP_AWARDS.gameDraw : XP_AWARDS.gameLoss;
  if (opts.outcome === 'win' && opts.opponentRating > before)
    xp += Math.min(XP_AWARDS.gameUpsetBonusMax, Math.round((opts.opponentRating - before) / 25));
  awardXP('game', xp);
  runAchievements();
  return { category, ratingBefore: Math.round(before), ratingAfter: Math.round(rec.elo), ratingDelta: rec.eloDelta };
}

/** A lesson was finished. First completions pay full XP; replays a token amount. */
export function recordLesson(opts: { firstTime: boolean; stars: number }): void {
  playSound('lessonComplete');
  awardXP('lesson', opts.firstTime ? XP_AWARDS.lessonFirstBase + opts.stars * XP_AWARDS.lessonStarBonus : XP_AWARDS.lessonReplay);
  runAchievements();
}

/** A puzzle-rush run ended with `score` solved. */
export function recordRush(score: number): void {
  awardXP('rush', Math.min(XP_AWARDS.rushCap, XP_AWARDS.rushBase + score * XP_AWARDS.rushPerSolve));
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
