/**
 * Gamification core — the single public API for XP, levels, streaks and
 * achievements. The trainer pages and the play page call the `record*`
 * convenience functions on every meaningful event (the coach flow has its own
 * pair, recordCoachTraining / recordCoachSession, reached via the adapter in
 * lib/coachRewards.ts); other features integrate through the primitives:
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
 *   'quest-complete'       a daily quest finished: { id, name, icon, xp }
 *   'quests-all-done'      the whole daily slate finished: { bonusXp }
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
import { useQuests } from '../store/quests';
import { useCoach, type TrainingAttempt } from '../store/coach';
import type { WeaknessKind } from './weakness';
import { ROSTER_BY_ID } from '../data/botRoster';
import { ACHIEVEMENTS_BY_ID, evaluateAchievements, type AchievementCtx } from './achievements';
import { STREAK_MILESTONE_XP } from './streak';
import { ALL_QUESTS_BONUS_XP, type Activity } from './quests';
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
  gameUpsetEloPerXp: 25, // extra for beating a stronger bot: +1 XP per this many Elo above you…
  gameUpsetBonusMax: 25, // …capped here
  lessonFirstBase: 15, // + 5 per star (stars 0–3 → 15–30)
  lessonStarBonus: 5,
  lessonReplay: 5,
  rushBase: 5, // + 2 per puzzle solved, capped at 80 total
  rushPerSolve: 2,
  rushCap: 80,
  // Coach "Train this weakness" flow (extras ON TOP of the base puzzle XP,
  // which flows through recordPuzzle like any other rated attempt):
  coachSolveBonus: 4, // solving a weakness-targeted drill
  coachSessionBase: 5, // finishing a training session (≥ 1 rated attempt)…
  coachSessionPerSolve: 2, // …+2 per puzzle solved in the session…
  coachSessionCap: 25, // …capped here
  coachWeaknessCleared: 40, // a trained weakness reaches the "cleared" bar (see below)
} as const;

// A weakness counts as CLEARED once you've drilled it enough and now reliably
// spot the pattern: at least MIN_ATTEMPTS rated attempts, with a solve rate of
// CLEARED_RATE over the most recent MIN_ATTEMPTS. Derived live from the coach
// training log, so it's retroactive and needs no extra persisted state.
export const WEAKNESS_CLEARED_MIN_ATTEMPTS = 10;
export const WEAKNESS_CLEARED_RATE = 0.8;

/** Is one weakness's attempt list (oldest→newest) at the cleared bar? */
function weaknessCleared(attempts: readonly TrainingAttempt[]): boolean {
  if (attempts.length < WEAKNESS_CLEARED_MIN_ATTEMPTS) return false;
  const recent = attempts.slice(-WEAKNESS_CLEARED_MIN_ATTEMPTS);
  return recent.filter((t) => t.solved).length / recent.length >= WEAKNESS_CLEARED_RATE;
}

/** Distinct weakness kinds currently at the cleared bar. */
function clearedWeaknessCount(log: readonly TrainingAttempt[]): number {
  const byKind = new Map<WeaknessKind, TrainingAttempt[]>();
  for (const t of log) {
    const list = byKind.get(t.kind);
    if (list) list.push(t);
    else byKind.set(t.kind, [t]);
  }
  let n = 0;
  for (const list of byKind.values()) if (weaknessCleared(list)) n++;
  return n;
}

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
  | { kind: 'goal'; streak: number }
  | { kind: 'quest-complete'; id: string; name: string; icon: string; xp: number }
  | { kind: 'quests-all-done'; bonusXp: number };

const listeners = new Set<(e: GamifyEvent) => void>();

/**
 * Subscribe to the event bus (returns unsubscribe). Listeners are isolated: a
 * throwing listener is logged and skipped, never unwinding an award mid-flight.
 * Do NOT call awardXP from an 'xp-awarded' handler — that recurses; a depth
 * guard cuts the cycle and drops the event rather than blowing the stack.
 */
export function onGamifyEvent(fn: (e: GamifyEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Legitimate nesting (milestone/achievement bonus XP) is 1–2 deep; anything
// near this limit is a listener feeding awardXP back into the bus.
const MAX_EMIT_DEPTH = 25;
let emitDepth = 0;

function emit(e: GamifyEvent): void {
  if (emitDepth >= MAX_EMIT_DEPTH) {
    console.error(`[gamify] '${e.kind}' event dropped — onGamifyEvent listener cycle (don't call awardXP from an 'xp-awarded' handler)`);
    return;
  }
  emitDepth++;
  try {
    for (const fn of listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error('[gamify] onGamifyEvent listener threw', err);
      }
    }
  } finally {
    emitDepth--;
  }
}

/**
 * Award XP. The one entry point for every XP mutation: adds to the total,
 * advances the daily goal, extends the activity streak (paying milestone
 * bonuses), and emits/celebrates level-ups. Returns the store's AwardResult.
 *
 * `countsAsActivity: false` marks passive grants (achievement/milestone bonus
 * XP) that shouldn't tick the streak or the daily activity counter.
 *
 * Invalid amounts (NaN/Infinity/negative) are rejected as a no-op — a single
 * NaN would corrupt the persisted XP total and propagate through sync.
 * Note: bare awardXP does not advance daily quests (use the record* wrappers),
 * but level-gated badges are re-checked whenever a grant levels you up.
 */
export function awardXP(source: XpSource, amount: number, opts: { countsAsActivity?: boolean } = {}): AwardResult {
  if (!Number.isFinite(amount) || amount < 0) {
    console.error(`[gamify] awardXP ignored invalid amount ${amount} (source '${source}')`);
    const s = useGamify.getState();
    const level = levelFromXp(s.xp);
    return { xpGained: 0, totalXp: s.xp, prevLevel: level, level, leveledUp: false, goalJustMet: false, streak: s.streak };
  }
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
  // Level-gated badges ('dedication-level-*') must land with the level-up toast
  // even when the XP came from a bare awardXP (e.g. the coach) rather than a
  // record* wrapper. Safe to nest: unlock() dedups, so recursion converges.
  if (res.leveledUp) runAchievements();
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

/**
 * Feed one activity to the daily quests, paying reward XP for anything it
 * completed. Reward XP is passive (countsAsActivity: false) — the underlying
 * activity already ticked the streak/goal, and passive grants can't recurse
 * back into quest progress. Called from every record* wrapper *before* the
 * achievement re-check so quest badges see fresh counts.
 */
function advanceQuests(a: Activity): void {
  const res = useQuests.getState().applyActivity(a);
  for (const q of res.completed) {
    if (q.xp > 0) awardXP('quest', q.xp, { countsAsActivity: false });
    playSound('achievement');
    emit({ kind: 'quest-complete', id: q.id, name: q.name, icon: q.icon, xp: q.xp });
  }
  if (res.allDone) {
    awardXP('quest', ALL_QUESTS_BONUS_XP, { countsAsActivity: false });
    playSound('streak');
    emit({ kind: 'quests-all-done', bonusXp: ALL_QUESTS_BONUS_XP });
  }
}

/** Snapshot every store into the flat shape the achievement catalogue reads. */
export function buildAchievementCtx(): AchievementCtx {
  const ratings = useRatings.getState().categories;
  const gamify = useGamify.getState();
  const streakStore = useStreak.getState();
  const progress = useProgress.getState();
  const ladder = useLadder.getState();
  const quests = useQuests.getState();
  const coachLog = useCoach.getState().trainingLog;

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
    // ?? 0 guards rating state persisted before win streaks existed.
    bestWinStreak: Math.max(ratings.bots.bestWinStreak ?? 0, ratings.blitz.bestWinStreak ?? 0),
    botsBeaten: ladder.clearedCount(),
    topBotBeatenRating,
    rushBest: useRepertoire.getState().rushHighScore,
    reviews,
    activeDays: activeDays.size,
    lessonsCompleted: Object.keys(useLessons.getState().completed).length,
    questsCompleted: quests.totalCompleted,
    questDaysAllDone: quests.daysAllDone,
    weaknessTrainings: coachLog.length,
    weaknessesCleared: clearedWeaknessCount(coachLog),
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
  advanceQuests({ type: 'puzzle', success });
  runAchievements();
  return res;
}

/** A spaced-repetition card (openings / mates / anti-blunder) was graded. */
export function recordReview(correct: boolean): void {
  playSound(correct ? 'xpGain' : 'wrongMove');
  awardXP('review', correct ? XP_AWARDS.reviewCorrect : XP_AWARDS.reviewWrong);
  advanceQuests({ type: 'review', correct });
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
    xp += Math.min(XP_AWARDS.gameUpsetBonusMax, Math.round((opts.opponentRating - before) / XP_AWARDS.gameUpsetEloPerXp));
  awardXP('game', xp);
  advanceQuests({ type: 'game', outcome: opts.outcome });
  runAchievements();
  return { category, ratingBefore: Math.round(before), ratingAfter: Math.round(rec.elo), ratingDelta: rec.eloDelta };
}

/** A lesson was finished. First completions pay full XP; replays a token amount. */
export function recordLesson(opts: { firstTime: boolean; stars: number }): void {
  playSound('lessonComplete');
  awardXP('lesson', opts.firstTime ? XP_AWARDS.lessonFirstBase + opts.stars * XP_AWARDS.lessonStarBonus : XP_AWARDS.lessonReplay);
  advanceQuests({ type: 'lesson', firstTime: opts.firstTime });
  runAchievements();
}

/** A puzzle-rush run ended with `score` solved. */
export function recordRush(score: number): void {
  awardXP('rush', Math.min(XP_AWARDS.rushCap, XP_AWARDS.rushBase + score * XP_AWARDS.rushPerSolve));
  advanceQuests({ type: 'rush', score });
  runAchievements();
}

// — Coach integration (called via lib/coachRewards.ts, the coach's adapter) —

/**
 * A coach "Train this weakness" attempt was rated. Call AFTER the attempt is
 * in useCoach.trainingLog (the coach page records it first). The attempt's
 * base XP / puzzle rating / quest progress already flowed through the normal
 * recordPuzzle pipeline, so this pays only the coach-specific extras — all
 * passive (countsAsActivity: false), because the underlying puzzle already
 * ticked the streak and the day's activity count:
 *  - a solve bonus (XP_AWARDS.coachSolveBonus) on top of the puzzle XP;
 *  - the one-off clear bonus (XP_AWARDS.coachWeaknessCleared) when THIS
 *    attempt lifts the weakness over the cleared bar (re-clearing after a
 *    genuine regression pays again — you earned it back);
 * then re-checks the badge catalogue so coach achievements land immediately.
 */
export function recordCoachTraining(kind: WeaknessKind, solved: boolean): void {
  if (solved) awardXP('coach', XP_AWARDS.coachSolveBonus, { countsAsActivity: false });
  const attempts = useCoach.getState().trainingLog.filter((t) => t.kind === kind);
  if (weaknessCleared(attempts) && !weaknessCleared(attempts.slice(0, -1))) {
    awardXP('coach', XP_AWARDS.coachWeaknessCleared, { countsAsActivity: false });
    playSound('achievement');
  }
  runAchievements();
}

/** A coach training session ended ("Done training" with ≥ 1 rated attempt).
 *  Pays a small session bonus scaled by solves; passive, like all coach extras. */
export function recordCoachSession(opts: { solved: number; attempts: number }): void {
  if (opts.attempts <= 0) return;
  const xp = Math.min(XP_AWARDS.coachSessionCap, XP_AWARDS.coachSessionBase + opts.solved * XP_AWARDS.coachSessionPerSolve);
  awardXP('coach', xp, { countsAsActivity: false });
  runAchievements();
}

let initialized = false;
/** Run once on app start: migrate the legacy puzzle rating, refresh the daily
 *  quest slate, and back-fill badges. */
export function initGamify(): void {
  if (initialized) return;
  initialized = true;
  useRatings.getState().migrateLegacy();
  useQuests.getState().rollover();
  runAchievements({ silent: true });
}
