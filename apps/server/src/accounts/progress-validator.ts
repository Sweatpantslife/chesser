/**
 * Server-side anti-cheat validation for the synced progress blob
 * (PUT /api/progress).
 *
 * The client syncs a single JSON blob containing everything gamified —
 * ratings, XP/levels, streaks, achievements, daily quests, the bot ladder and
 * lessons (see apps/web/src/lib/sync.ts `gather()`). Before this guard the
 * server stored whatever the client sent, so a tampered client could claim any
 * rating, XP total, achievement or streak and have it replicated to every
 * device. This module enforces, per section:
 *
 *  1. Absolute bounds      — ratings within [100, 3600], XP under a hard cap,
 *                            per-day XP/activity caps, no future-dated days.
 *  2. Internal consistency — won+lost+drawn ≤ played, XP totals backed by the
 *                            claimed per-day logs, streaks backed by claimed
 *                            active days, achievements backed by the stats
 *                            that are supposed to have earned them.
 *  3. Delta plausibility   — vs the previously stored snapshot: rating moves
 *                            bounded per claimed game, and batch sizes bounded
 *                            per claimed activity day rather than per sync —
 *                            so a legitimate offline device syncing a large
 *                            backlog in one PUT is still accepted.
 *  4. Merge semantics      — what gets stored is the same monotonic merge the
 *                            clients compute themselves (max counters, the
 *                            more-played side owns live ratings), so a stale
 *                            device pushing old data neither regresses the
 *                            account nor gets spuriously rejected.
 *
 * Per-rule behavior is deliberate and consistent:
 *  - REJECT (whole PUT fails with 400): malformed section shapes and
 *    impossible claims — out-of-range ratings, rating jumps beyond what the
 *    claimed games allow, XP not backed by day logs, per-day caps exceeded,
 *    future-dated activity, streaks longer than the claimed active days,
 *    self-contradictory stats.
 *  - CLAMP (store an adjusted value; the adjustment is reported): normalizable
 *    noise — streak freezes above the bank cap, achievement claims whose
 *    backing stat falls short (the claim is dropped, the rest of the sync
 *    proceeds), junk map entries, peaks below the current value.
 *
 * Sections the server treats as opaque content rather than score claims (SRS
 * cards, repertoires, mistakes, coordinate drills, custom puzzles) pass
 * through untouched, except that SRS per-day review history — which feeds the
 * review achievements — gets the same day-key and per-day-cap checks.
 *
 * Known accepted limitations (two classes):
 *  1. With no server-side record of individual games, a fully self-consistent
 *     fabricated history (fake days each under the per-day caps, ratings
 *     walked up within the per-game bound from the starting seed) cannot be
 *     distinguished from a long-offline device's real backlog. The rules
 *     therefore bound the *rate* and *shape* of claims — absolute ceilings,
 *     per-day caps, per-game rating movement — rather than proving play.
 *  2. Achievement ids whose backing stat is not synced (puzzle-rush scores,
 *     coach drills, `ladder-master`, `learn-lesson-all`) cannot be verified
 *     and pass through unchecked (up to the badge-count cap). Closing this
 *     would require syncing those stats; until then such badges are forgeable.
 */

// ---------------------------------------------------------------------------
// Tunable limits (exported so tests and future tuning share one table)
// ---------------------------------------------------------------------------

export type RatingCat = 'bots' | 'blitz' | 'puzzles';
const CATS: RatingCat[] = ['bots', 'blitz', 'puzzles'];

export const LIMITS = {
  /** Client-side Elo floor (apps/web/src/lib/elo.ts ELO_MIN). */
  ratingFloor: 100,
  /** Above every bot and puzzle in the app; nothing legit can reach it. */
  ratingCeil: 3600,
  /** Glicko-2 deviation is 350 for a brand-new rating; allow slack. */
  rdCeil: 500,
  /** Max Elo K-factor client-side is 40, so one game moves ≤ 40 points. */
  eloDeltaPerGame: 40,
  /** Worst-case one-game swing of a provisional (RD 350) Glicko-2 rating. */
  glickoDeltaPerGame: 350,
  /** Plausible hardest-core single-day volume per rating category. */
  gamesPerDay: { bots: 300, blitz: 300, puzzles: 600 } as Record<RatingCat, number>,
  /**
   * Client per-category starting rating (apps/web/src/store/ratings.ts
   * START_ELO; Glicko seeds at the same number, and the legacy puzzle rating
   * used the same 1200 default). Anchors the absolute reachability bound:
   * every rating/peak must be reachable from this seed with the claimed games.
   */
  startRating: { bots: 1500, blitz: 1500, puzzles: 1200 } as Record<RatingCat, number>,
  playedCap: 2_000_000,
  historyDaysCap: 5_000, // ~13 years of daily snapshots
  /** Years of hard daily play; nothing legit gets near it. */
  xpCap: 5_000_000,
  /** ~600 solved puzzles incl. bonuses — a generous single-day XP ceiling. */
  xpPerDay: 5_000,
  activitiesPerDay: 1_500,
  /** Tolerance between the XP total and the sum of its per-day logs. */
  xpSlack: 500,
  /** Client streak-freeze bank cap (apps/web/src/lib/streak.ts MAX_FREEZES). */
  freezesCap: 2,
  /** Daily quest slate is 3 client-side; ×2 headroom for future growth. */
  questsPerDay: 6,
  reviewsPerDay: 2_000,
  /** The app did not exist before this; older day keys are junk. */
  earliestDay: '2020-01-01',
  /** Local-calendar day keys can run up to one day ahead of server UTC. */
  futureDaySlack: 1,
  ladderBotsCap: 200,
  lessonsCap: 2_000,
} as const;

/** Streak milestones the client can have paid out (lib/streak.ts). */
const STREAK_MILESTONES = [3, 7, 30, 100];

// ---------------------------------------------------------------------------
// Result plumbing
// ---------------------------------------------------------------------------

export interface ValidateOk {
  ok: true;
  /** The sanitized + merged blob to store. */
  data: unknown;
  /** Human-readable notes for every clamped/dropped value (empty = clean). */
  adjustments: string[];
}
export interface ValidateErr {
  ok: false;
  error: string;
}
export type ValidateResult = ValidateOk | ValidateErr;

/** Internal control flow: a rule violation that fails the whole PUT. */
class Rejection extends Error {}
function reject(msg: string): never {
  throw new Rejection(msg);
}

const MAX_ADJUSTMENT_NOTES = 30;

class Notes {
  readonly list: string[] = [];
  private overflow = 0;
  add(msg: string): void {
    if (this.list.length < MAX_ADJUSTMENT_NOTES) this.list.push(msg);
    else this.overflow++;
  }
  done(): string[] {
    if (this.overflow > 0) this.list.push(`…and ${this.overflow} more adjustment(s).`);
    return this.list;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDayKey = (v: unknown): v is string => typeof v === 'string' && DAY_RE.test(v) && Number.isFinite(Date.parse(v));
const dayKeyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A required non-negative finite number with an absolute ceiling. */
function countOf(v: unknown, cap: number, what: string): number {
  if (v === undefined || v === null) return 0;
  if (!isNum(v) || v < 0) reject(`${what} is malformed.`);
  if (v > cap) reject(`${what} of ${Math.round(v)} is implausibly large (max ${cap}).`);
  return v;
}

function ratingOf(v: unknown, what: string): number {
  if (!isNum(v)) reject(`${what} is malformed.`);
  if (v < LIMITS.ratingFloor || v > LIMITS.ratingCeil) {
    reject(`${what} of ${Math.round(v)} is outside the plausible range ${LIMITS.ratingFloor}–${LIMITS.ratingCeil}.`);
  }
  return v;
}

// Level curve — must mirror apps/web/src/store/gamify.ts.
const LEVEL_BASE = 60;
const LEVEL_STEP = 40;

/** Client floor for the configurable daily XP goal (store/gamify.ts setGoalXp). */
const MIN_GOAL_XP = 10;
function xpToReachLevel(level: number): number {
  const n = Math.max(0, level - 1);
  return n * LEVEL_BASE + (LEVEL_STEP * n * (n + 1)) / 2;
}
function levelFromXp(xp: number): number {
  let l = 1;
  while (xpToReachLevel(l + 1) <= xp) l++;
  return l;
}

/** Whole days between two YYYY-MM-DD keys (positive when b is later). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Ratings (per-category Elo + Glicko book)
// ---------------------------------------------------------------------------

interface Glicko {
  rating: number;
  rd: number;
  vol: number;
}
interface DaySnap {
  elo: number;
  glicko: number;
}
interface Category {
  elo: number;
  eloPeak: number;
  glicko: Glicko;
  glickoPeak: number;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  winStreak: number;
  bestWinStreak: number;
  history: Record<string, DaySnap>;
}

/** Defensive parse of a previously stored category; null = unusable, skip deltas. */
function parseStoredCategory(raw: unknown): Category | null {
  if (!isObj(raw)) return null;
  const g = raw.glicko;
  if (!isNum(raw.elo) || !isNum(raw.played) || !isObj(g) || !isNum(g.rating)) return null;
  // Out-of-range stored data (e.g. pre-deploy tampering) is discarded so the
  // account self-heals on the next honest sync instead of anchoring deltas.
  if (raw.elo < LIMITS.ratingFloor || raw.elo > LIMITS.ratingCeil) return null;
  if (g.rating < LIMITS.ratingFloor || g.rating > LIMITS.ratingCeil) return null;
  const history: Record<string, DaySnap> = {};
  if (isObj(raw.history)) {
    for (const [day, snap] of Object.entries(raw.history)) {
      if (isDayKey(day) && isObj(snap) && isNum(snap.elo) && isNum(snap.glicko)) {
        history[day] = { elo: snap.elo, glicko: snap.glicko };
      }
    }
  }
  const num = (v: unknown): number => (isNum(v) && v >= 0 ? v : 0);
  return {
    elo: raw.elo,
    eloPeak: isNum(raw.eloPeak) ? raw.eloPeak : raw.elo,
    glicko: { rating: g.rating, rd: isNum(g.rd) ? g.rd : 350, vol: isNum(g.vol) ? g.vol : 0.06 },
    glickoPeak: isNum(raw.glickoPeak) ? raw.glickoPeak : g.rating,
    played: num(raw.played),
    won: num(raw.won),
    lost: num(raw.lost),
    drawn: num(raw.drawn),
    winStreak: num(raw.winStreak),
    bestWinStreak: num(raw.bestWinStreak),
    history,
  };
}

function sanitizeCategory(cat: RatingCat, raw: unknown, maxDay: string, notes: Notes): Category {
  if (!isObj(raw)) reject(`Ratings: '${cat}' category is malformed.`);

  const elo = ratingOf(raw.elo, `Ratings: ${cat} rating`);
  let eloPeak = ratingOf(raw.eloPeak ?? elo, `Ratings: ${cat} peak rating`);
  if (eloPeak < elo) {
    notes.add(`ratings.${cat}: peak raised to match the current rating.`);
    eloPeak = elo;
  }

  const g = raw.glicko;
  if (!isObj(g)) reject(`Ratings: '${cat}' Glicko data is malformed.`);
  const gRating = ratingOf(g.rating, `Ratings: ${cat} Glicko rating`);
  if (!isNum(g.rd) || g.rd <= 0 || g.rd > LIMITS.rdCeil) reject(`Ratings: '${cat}' Glicko deviation is malformed.`);
  if (!isNum(g.vol) || g.vol <= 0 || g.vol > 1) reject(`Ratings: '${cat}' Glicko volatility is malformed.`);
  const glickoPeak = ratingOf(raw.glickoPeak ?? gRating, `Ratings: ${cat} Glicko peak`);

  const played = countOf(raw.played, LIMITS.playedCap, `Ratings: ${cat} games played`);
  const won = countOf(raw.won, LIMITS.playedCap, `Ratings: ${cat} games won`);
  const lost = countOf(raw.lost, LIMITS.playedCap, `Ratings: ${cat} games lost`);
  const drawn = countOf(raw.drawn, LIMITS.playedCap, `Ratings: ${cat} games drawn`);
  if (won + lost + drawn > played + 0.5) {
    reject(`Ratings: ${cat} results (${won} won + ${lost} lost + ${drawn} drawn) exceed the ${played} games played.`);
  }

  // Absolute reachability: every account starts a category at the fixed client
  // seed and moves at most eloDeltaPerGame (glickoDeltaPerGame) per game, so
  // live ratings AND peaks must be reachable from the seed with the claimed
  // game count. This is what stops a first sync — where there is no stored
  // snapshot to diff against — from teleporting a rating or peak to the
  // ceiling with zero (or too few) games.
  const eloReach = LIMITS.startRating[cat] + LIMITS.eloDeltaPerGame * played;
  if (elo > eloReach) {
    reject(`Ratings: ${cat} rating of ${Math.round(elo)} is unreachable from the starting rating with ${Math.round(played)} game(s).`);
  }
  if (eloPeak > eloReach) {
    reject(`Ratings: ${cat} peak rating of ${Math.round(eloPeak)} is unreachable from the starting rating with ${Math.round(played)} game(s).`);
  }
  const glickoReach = LIMITS.startRating[cat] + LIMITS.glickoDeltaPerGame * played;
  if (gRating > glickoReach) {
    reject(`Ratings: ${cat} Glicko rating of ${Math.round(gRating)} is unreachable from the starting rating with ${Math.round(played)} game(s).`);
  }
  if (glickoPeak > glickoReach) {
    reject(`Ratings: ${cat} Glicko peak of ${Math.round(glickoPeak)} is unreachable from the starting rating with ${Math.round(played)} game(s).`);
  }

  const winStreak = countOf(raw.winStreak, LIMITS.playedCap, `Ratings: ${cat} win streak`);
  let bestWinStreak = countOf(raw.bestWinStreak, LIMITS.playedCap, `Ratings: ${cat} best win streak`);
  if (bestWinStreak < winStreak) {
    notes.add(`ratings.${cat}: best win streak raised to match the current streak.`);
    bestWinStreak = winStreak;
  }
  if (bestWinStreak > won) reject(`Ratings: ${cat} win streak of ${Math.round(bestWinStreak)} exceeds the ${Math.round(won)} games won.`);

  const history: Record<string, DaySnap> = {};
  if (raw.history !== undefined) {
    if (!isObj(raw.history)) reject(`Ratings: '${cat}' history is malformed.`);
    const entries = Object.entries(raw.history);
    if (entries.length > LIMITS.historyDaysCap) reject(`Ratings: '${cat}' history spans an implausible number of days.`);
    for (const [day, snap] of entries) {
      if (!isDayKey(day) || day < LIMITS.earliestDay) {
        notes.add(`ratings.${cat}: dropped history entry with invalid day '${String(day).slice(0, 20)}'.`);
        continue;
      }
      if (day > maxDay) reject(`Ratings: '${cat}' history contains the future-dated day ${day}.`);
      if (!isObj(snap) || !isNum(snap.elo) || !isNum(snap.glicko) || snap.elo < 0 || snap.elo > LIMITS.ratingCeil || snap.glicko < 0 || snap.glicko > LIMITS.ratingCeil) {
        notes.add(`ratings.${cat}: dropped malformed history entry for ${day}.`);
        continue;
      }
      history[day] = { elo: snap.elo, glicko: snap.glicko };
    }
  }

  // Volume must be backed by claimed activity days: `history` keeps one
  // end-of-day snapshot per day actually played, so it is the batch-size
  // meter that lets a big offline backlog through while capping fabrication.
  const historyDays = Math.max(1, Object.keys(history).length);
  if (played > LIMITS.gamesPerDay[cat] * historyDays) {
    reject(
      `Ratings: ${cat} claims ${Math.round(played)} games over ${historyDays} recorded day(s) — more than the plausible ${LIMITS.gamesPerDay[cat]}/day.`,
    );
  }

  return { elo, eloPeak, glicko: { rating: gRating, rd: g.rd, vol: g.vol }, glickoPeak, played, won, lost, drawn, winStreak, bestWinStreak, history };
}

/**
 * Delta rules vs the stored snapshot — rejects impossible growth claims and
 * clamps peaks claimed without the games to back them (mutates `next`).
 */
function checkCategoryDeltas(cat: RatingCat, next: Category, prev: Category, notes: Notes): void {
  const gamesDelta = next.played - prev.played;
  if (gamesDelta <= 0) {
    // Stale/equal push: the merge keeps the stored side's live ratings and
    // counters — but peaks are max-merged, so an inflated peak claimed with
    // zero new games would stick permanently. A peak cannot rise without
    // playing, so clamp it to the stored bound (a clamp, not a reject, to
    // mirror the live-rating rule in mergeCategory: an honest-but-unusual
    // device pushing an unsynced parallel history must not brick its sync).
    const eloBound = Math.max(prev.eloPeak, prev.elo);
    if (next.eloPeak > eloBound) {
      notes.add(`ratings.${cat}: peak clamped to ${Math.round(eloBound)} — a higher peak is claimed without new games.`);
      next.eloPeak = eloBound;
    }
    const glickoBound = Math.max(prev.glickoPeak, prev.glicko.rating);
    if (next.glickoPeak > glickoBound) {
      notes.add(`ratings.${cat}: Glicko peak clamped to ${Math.round(glickoBound)} — a higher peak is claimed without new games.`);
      next.glickoPeak = glickoBound;
    }
    return;
  }

  // Batch size: new games must be backed by new-or-updated activity days.
  let changedDays = 0;
  for (const [day, snap] of Object.entries(next.history)) {
    const p = prev.history[day];
    if (!p || p.elo !== snap.elo || p.glicko !== snap.glicko) changedDays++;
  }
  const batchCap = LIMITS.gamesPerDay[cat] * Math.max(1, changedDays);
  if (gamesDelta > batchCap) {
    reject(
      `Ratings: ${cat} claims ${Math.round(gamesDelta)} new games across ${Math.max(1, changedDays)} claimed activity day(s) — more than the plausible ${LIMITS.gamesPerDay[cat]}/day.`,
    );
  }

  const eloCap = LIMITS.eloDeltaPerGame * gamesDelta;
  if (Math.abs(next.elo - prev.elo) > eloCap) {
    reject(
      `Ratings: ${cat} rating jump of ${Math.round(next.elo - prev.elo)} over ${Math.round(gamesDelta)} new game(s) is impossible (max ±${LIMITS.eloDeltaPerGame}/game).`,
    );
  }
  if (next.eloPeak > Math.max(prev.eloPeak, prev.elo + eloCap)) {
    reject(`Ratings: ${cat} peak rating of ${Math.round(next.eloPeak)} is unreachable from the stored rating with ${Math.round(gamesDelta)} new game(s).`);
  }
  const glickoCap = LIMITS.glickoDeltaPerGame * gamesDelta;
  if (Math.abs(next.glicko.rating - prev.glicko.rating) > glickoCap) {
    reject(`Ratings: ${cat} Glicko jump of ${Math.round(next.glicko.rating - prev.glicko.rating)} over ${Math.round(gamesDelta)} new game(s) is impossible.`);
  }
  if (next.glickoPeak > Math.max(prev.glickoPeak, prev.glicko.rating + glickoCap)) {
    reject(`Ratings: ${cat} Glicko peak of ${Math.round(next.glickoPeak)} is unreachable from the stored rating with ${Math.round(gamesDelta)} new game(s).`);
  }
}

/**
 * Store-side merge — mirrors the client's mergeCategory
 * (apps/web/src/store/ratings.ts): the side with more games owns the live
 * ratings, counters/peaks take the max, day snapshots union (incoming wins
 * conflicts — it is the fresher device).
 */
function mergeCategory(stored: Category | null, incoming: Category, cat: RatingCat, notes: Notes): Category {
  if (!stored) return incoming;
  const incomingWins = incoming.played > stored.played;
  if (!incomingWins && incoming.elo > stored.elo) {
    notes.add(`ratings.${cat}: kept the stored live rating — the incoming copy claims a higher rating without more games.`);
  }
  return {
    elo: incomingWins ? incoming.elo : stored.elo,
    eloPeak: Math.max(stored.eloPeak, incoming.eloPeak),
    glicko: incomingWins ? incoming.glicko : stored.glicko,
    glickoPeak: Math.max(stored.glickoPeak, incoming.glickoPeak),
    played: Math.max(stored.played, incoming.played),
    won: Math.max(stored.won, incoming.won),
    lost: Math.max(stored.lost, incoming.lost),
    drawn: Math.max(stored.drawn, incoming.drawn),
    winStreak: incomingWins ? incoming.winStreak : stored.winStreak,
    bestWinStreak: Math.max(stored.bestWinStreak, incoming.bestWinStreak),
    history: { ...stored.history, ...incoming.history },
  };
}

interface RatingsOut {
  categories: Partial<Record<RatingCat, Category>>;
  rest: Record<string, unknown>;
}

function validateRatings(raw: unknown, storedRaw: unknown, maxDay: string, notes: Notes): RatingsOut {
  if (!isObj(raw)) reject('Ratings section is malformed.');
  const { categories: rawCats, ...rest } = raw;
  const out: Partial<Record<RatingCat, Category>> = {};
  if (rawCats === undefined) return { categories: out, rest };
  if (!isObj(rawCats)) reject('Ratings categories are malformed.');
  const storedCats = isObj(storedRaw) && isObj(storedRaw.categories) ? storedRaw.categories : {};
  for (const cat of CATS) {
    if (rawCats[cat] === undefined) continue;
    const next = sanitizeCategory(cat, rawCats[cat], maxDay, notes);
    const prev = parseStoredCategory(storedCats[cat]);
    if (prev) checkCategoryDeltas(cat, next, prev, notes);
    out[cat] = mergeCategory(prev, next, cat, notes);
  }
  return { categories: out, rest };
}

// ---------------------------------------------------------------------------
// Gamify (XP total, per-day logs, daily-goal streak)
// ---------------------------------------------------------------------------

interface DayLog {
  xp: number;
  activities: number;
}
interface GamifyData {
  xp: number;
  days: Record<string, DayLog>;
  goalXp: number;
  streak: number;
  bestStreak: number;
  lastGoalDay: string;
  goalsMet: number;
}

function parseStoredGamify(raw: unknown): GamifyData | null {
  if (!isObj(raw) || !isNum(raw.xp) || raw.xp < 0 || raw.xp > LIMITS.xpCap) return null;
  const days: Record<string, DayLog> = {};
  if (isObj(raw.days)) {
    for (const [day, log] of Object.entries(raw.days)) {
      if (isDayKey(day) && isObj(log) && isNum(log.xp) && log.xp >= 0) {
        days[day] = { xp: log.xp, activities: isNum(log.activities) && log.activities >= 0 ? log.activities : 0 };
      }
    }
  }
  // Stored totals not backed by their own day logs (pre-validation tampering)
  // are discarded, so the account self-heals on the next honest sync.
  const dayXpSum = Object.values(days).reduce((s, d) => s + d.xp, 0);
  if (raw.xp > dayXpSum + LIMITS.xpSlack) return null;
  const num = (v: unknown): number => (isNum(v) && v >= 0 ? v : 0);
  return {
    xp: raw.xp,
    days,
    goalXp: isNum(raw.goalXp) && raw.goalXp >= MIN_GOAL_XP ? raw.goalXp : 40,
    streak: num(raw.streak),
    bestStreak: num(raw.bestStreak),
    lastGoalDay: isDayKey(raw.lastGoalDay) ? raw.lastGoalDay : '',
    goalsMet: num(raw.goalsMet),
  };
}

function validateGamify(raw: unknown, storedRaw: unknown, maxDay: string, notes: Notes): GamifyData {
  if (!isObj(raw)) reject('XP section is malformed.');

  const xp = countOf(raw.xp, LIMITS.xpCap, 'XP total');

  const days: Record<string, DayLog> = {};
  if (raw.days !== undefined) {
    if (!isObj(raw.days)) reject('XP day logs are malformed.');
    const entries = Object.entries(raw.days);
    if (entries.length > LIMITS.historyDaysCap) reject('XP day logs span an implausible number of days.');
    for (const [day, log] of entries) {
      if (!isDayKey(day) || day < LIMITS.earliestDay) {
        notes.add(`gamify: dropped day log with invalid day '${String(day).slice(0, 20)}'.`);
        continue;
      }
      if (day > maxDay) reject(`XP day log for ${day} is future-dated.`);
      if (!isObj(log)) reject(`XP day log for ${day} is malformed.`);
      const dayXp = countOf(log.xp, LIMITS.xpPerDay, `XP on ${day}`);
      const activities = countOf(log.activities, LIMITS.activitiesPerDay, `Activity count on ${day}`);
      days[day] = { xp: dayXp, activities };
    }
  }

  // The XP total must be backed by the claimed per-day activity: every client
  // grant lands in a day log, so the union of day logs bounds the total.
  const dayXpSum = Object.values(days).reduce((s, d) => s + d.xp, 0);
  if (xp > dayXpSum + LIMITS.xpSlack) {
    reject(`XP total of ${Math.round(xp)} is not backed by the claimed daily activity (day logs sum to ${Math.round(dayXpSum)}).`);
  }

  let goalXp = 40;
  if (raw.goalXp !== undefined) {
    if (!isNum(raw.goalXp)) reject('Daily goal is malformed.');
    goalXp = Math.max(MIN_GOAL_XP, Math.round(raw.goalXp));
    if (goalXp !== raw.goalXp) notes.add('gamify: daily goal normalized.');
  }

  const streak = countOf(raw.streak, 100_000, 'Daily-goal streak');
  let bestStreak = countOf(raw.bestStreak, 100_000, 'Best daily-goal streak');
  if (bestStreak < streak) {
    notes.add('gamify: best goal streak raised to match the current streak.');
    bestStreak = streak;
  }
  const goalsMet = countOf(raw.goalsMet, 100_000, 'Days the daily goal was met');
  // Only days that reached the lowest goal the client allows (MIN_GOAL_XP) can
  // have met it — zero/low-XP padding days don't back a daily-goal claim.
  const goalCapableDays = Object.values(days).filter((d) => d.xp >= MIN_GOAL_XP).length;
  if (goalsMet > goalCapableDays) {
    reject(`Daily goal claimed met on ${Math.round(goalsMet)} day(s) but only ${goalCapableDays} day(s) have enough XP to meet the minimum goal.`);
  }
  if (bestStreak > goalsMet) reject(`Daily-goal streak of ${Math.round(bestStreak)} exceeds the ${Math.round(goalsMet)} day(s) the goal was met.`);

  let lastGoalDay = '';
  if (raw.lastGoalDay !== undefined && raw.lastGoalDay !== '') {
    if (!isDayKey(raw.lastGoalDay)) reject('Last goal day is malformed.');
    if (raw.lastGoalDay > maxDay) reject(`Last goal day ${raw.lastGoalDay} is future-dated.`);
    lastGoalDay = raw.lastGoalDay;
  }

  return { xp, days, goalXp, streak, bestStreak, lastGoalDay, goalsMet };
}

/** Mirrors the client's gamify importMerge: monotonic max, day logs union. */
function mergeGamify(stored: GamifyData | null, incoming: GamifyData): GamifyData {
  if (!stored) return incoming;
  const days: Record<string, DayLog> = { ...stored.days };
  for (const [day, log] of Object.entries(incoming.days)) {
    const prev = days[day];
    days[day] = { xp: Math.max(prev?.xp ?? 0, log.xp), activities: Math.max(prev?.activities ?? 0, log.activities) };
  }
  return {
    xp: Math.max(stored.xp, incoming.xp),
    days,
    goalXp: incoming.goalXp,
    streak: Math.max(stored.streak, incoming.streak),
    bestStreak: Math.max(stored.bestStreak, incoming.bestStreak),
    lastGoalDay: incoming.lastGoalDay > stored.lastGoalDay ? incoming.lastGoalDay : stored.lastGoalDay,
    goalsMet: Math.max(stored.goalsMet, incoming.goalsMet),
  };
}

// ---------------------------------------------------------------------------
// Activity streak
// ---------------------------------------------------------------------------

interface StreakData {
  count: number;
  best: number;
  lastDay: string;
  freezes: number;
  milestonesAwarded: number[];
}

function parseStoredStreak(raw: unknown): StreakData | null {
  if (!isObj(raw) || !isNum(raw.count) || raw.count < 0) return null;
  const num = (v: unknown): number => (isNum(v) && v >= 0 ? v : 0);
  return {
    count: raw.count,
    best: num(raw.best),
    lastDay: isDayKey(raw.lastDay) ? raw.lastDay : '',
    freezes: Math.min(LIMITS.freezesCap, num(raw.freezes)),
    milestonesAwarded: Array.isArray(raw.milestonesAwarded) ? raw.milestonesAwarded.filter((m): m is number => STREAK_MILESTONES.includes(m as number)) : [],
  };
}

function validateStreak(raw: unknown, incomingGamify: GamifyData | null, maxDay: string, notes: Notes): StreakData {
  if (!isObj(raw)) reject('Streak section is malformed.');

  const count = countOf(raw.count, 100_000, 'Streak');
  let best = countOf(raw.best, 100_000, 'Best streak');
  if (best < count) {
    notes.add('streak: best raised to match the current run.');
    best = count;
  }

  let freezes = countOf(raw.freezes, 1_000, 'Streak freezes');
  if (freezes > LIMITS.freezesCap) {
    notes.add(`streak: freezes clamped to the bank cap of ${LIMITS.freezesCap}.`);
    freezes = LIMITS.freezesCap;
  }

  let lastDay = '';
  if (raw.lastDay !== undefined && raw.lastDay !== '') {
    if (!isDayKey(raw.lastDay)) reject('Streak last-active day is malformed.');
    if (raw.lastDay > maxDay) reject(`Streak last-active day ${raw.lastDay} is future-dated.`);
    lastDay = raw.lastDay;
  }
  if (count > 0 && !lastDay) reject('Streak claims a run but no last-active day.');

  let milestonesAwarded: number[] = [];
  if (raw.milestonesAwarded !== undefined) {
    if (!Array.isArray(raw.milestonesAwarded)) reject('Streak milestones are malformed.');
    for (const m of raw.milestonesAwarded) {
      if (!STREAK_MILESTONES.includes(m as number)) {
        notes.add(`streak: dropped unknown milestone '${String(m).slice(0, 20)}'.`);
      } else if ((m as number) > Math.max(best, count)) {
        notes.add(`streak: dropped the ${m}-day milestone — no run that long is claimed.`);
      } else {
        milestonesAwarded.push(m as number);
      }
    }
    milestonesAwarded = [...new Set(milestonesAwarded)].sort((a, b) => a - b);
  }

  // A streak counts consecutive *active* days, and every active day writes a
  // day log — so no run (current or best) can exceed the claimed active days
  // (which are themselves bounded to real, non-future calendar days).
  if (incomingGamify) {
    const activeDays = Object.values(incomingGamify.days).filter((d) => d.activities >= 1).length;
    if (count > activeDays) {
      reject(`Streak of ${Math.round(count)} day(s) exceeds the ${activeDays} claimed active day(s).`);
    }
    if (best > activeDays) {
      reject(`Best streak of ${Math.round(best)} day(s) exceeds the ${activeDays} claimed active day(s).`);
    }
  }

  return { count, best, lastDay, freezes, milestonesAwarded };
}

/**
 * Run-aware streak merge — a straight port of the client's mergeStreaks
 * (apps/web/src/lib/streak.ts); keep the two in sync.
 */
function mergeStreaks(a: StreakData, b: StreakData): StreakData {
  const runless = (s: StreakData): boolean => !s.lastDay || s.count <= 0;
  const [older, newer] = a.lastDay <= b.lastDay ? [a, b] : [b, a];
  const freezes = Math.min(LIMITS.freezesCap, Math.max(a.freezes, b.freezes));
  const milestonesAwarded = [...new Set([...a.milestonesAwarded, ...b.milestonesAwarded])].sort((x, y) => x - y);

  let count: number;
  let lastDay: string;
  let spentFreeze = false;
  if (runless(newer)) {
    count = older.count;
    lastDay = older.lastDay;
  } else if (runless(older)) {
    count = newer.count;
    lastDay = newer.lastDay;
  } else {
    lastDay = newer.lastDay;
    const gap = dayDiff(older.lastDay, newer.lastDay);
    if (gap === 0) {
      count = Math.max(a.count, b.count);
    } else if (newer.count > older.count) {
      count = newer.count;
    } else if (newer.count >= gap) {
      count = older.count + gap;
    } else if (newer.count === gap - 1 && freezes > 0) {
      count = older.count + newer.count;
      spentFreeze = true;
    } else {
      count = newer.count;
    }
  }
  return {
    count,
    best: Math.max(a.best, b.best, count),
    lastDay,
    freezes: spentFreeze ? freezes - 1 : freezes,
    milestonesAwarded,
  };
}

// ---------------------------------------------------------------------------
// Daily quests
// ---------------------------------------------------------------------------

interface QuestsData {
  day: string;
  progress: Record<string, number>;
  done: Record<string, number>;
  bonusPaid: boolean;
  totalCompleted: number;
  daysAllDone: number;
}

function parseStoredQuests(raw: unknown): QuestsData | null {
  if (!isObj(raw)) return null;
  const num = (v: unknown): number => (isNum(v) && v >= 0 ? v : 0);
  const numMap = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (isObj(v)) for (const [k, n] of Object.entries(v)) if (isNum(n)) out[k] = n;
    return out;
  };
  return {
    day: isDayKey(raw.day) ? raw.day : '',
    progress: numMap(raw.progress),
    done: numMap(raw.done),
    bonusPaid: raw.bonusPaid === true,
    totalCompleted: num(raw.totalCompleted),
    daysAllDone: num(raw.daysAllDone),
  };
}

function validateQuests(raw: unknown, incomingGamify: GamifyData | null, maxDay: string, notes: Notes): QuestsData {
  if (!isObj(raw)) reject('Quests section is malformed.');

  let day = '';
  if (raw.day !== undefined && raw.day !== '') {
    if (!isDayKey(raw.day)) reject('Quest day is malformed.');
    if (raw.day > maxDay) reject(`Quest day ${raw.day} is future-dated.`);
    day = raw.day;
  }

  const progress: Record<string, number> = {};
  if (raw.progress !== undefined) {
    if (!isObj(raw.progress)) reject('Quest progress is malformed.');
    const entries = Object.entries(raw.progress);
    if (entries.length > 20) reject('Quest progress claims an implausible daily slate.');
    for (const [id, v] of entries) {
      if (typeof id !== 'string' || id.length > 80 || !isNum(v) || v < 0 || v > 100_000) {
        notes.add('quests: dropped a malformed progress entry.');
        continue;
      }
      progress[id] = v;
    }
  }
  const done: Record<string, number> = {};
  if (raw.done !== undefined) {
    if (!isObj(raw.done)) reject('Quest completions are malformed.');
    const entries = Object.entries(raw.done);
    if (entries.length > 20) reject('Quest completions claim an implausible daily slate.');
    for (const [id, ts] of entries) {
      if (id.length > 80 || !isNum(ts)) {
        notes.add('quests: dropped a malformed completion entry.');
        continue;
      }
      done[id] = ts;
    }
  }

  const totalCompleted = countOf(raw.totalCompleted, 1_000_000, 'Lifetime quests completed');
  const daysAllDone = countOf(raw.daysAllDone, 1_000_000, 'All-quests-done days');
  if (incomingGamify) {
    // Quests only advance via recorded activities, and every activity writes
    // `activities ≥ 1` into its day log — so only genuinely active days back
    // quest claims (zero-activity padding days don't count).
    const activeDays = Math.max(1, Object.values(incomingGamify.days).filter((d) => d.activities >= 1).length);
    if (totalCompleted > LIMITS.questsPerDay * activeDays) {
      reject(`Lifetime quest count of ${Math.round(totalCompleted)} exceeds the plausible ${LIMITS.questsPerDay}/day over ${activeDays} active day(s).`);
    }
    if (daysAllDone > activeDays) reject(`All-quests-done days (${Math.round(daysAllDone)}) exceed the ${activeDays} claimed active day(s).`);
  }
  if (daysAllDone > totalCompleted) reject('All-quests-done days exceed the lifetime quests completed.');

  return { day, progress, done, bonusPaid: raw.bonusPaid === true, totalCompleted, daysAllDone };
}

/** Mirrors the client's quests importMerge: newer day wins, lifetime counters max. */
function mergeQuests(stored: QuestsData | null, incoming: QuestsData): QuestsData {
  if (!stored) return incoming;
  const out: QuestsData = {
    ...incoming,
    totalCompleted: Math.max(stored.totalCompleted, incoming.totalCompleted),
    daysAllDone: Math.max(stored.daysAllDone, incoming.daysAllDone),
  };
  if (stored.day > incoming.day) {
    out.day = stored.day;
    out.progress = stored.progress;
    out.done = stored.done;
    out.bonusPaid = stored.bonusPaid;
  } else if (stored.day === incoming.day && stored.day !== '') {
    const progress: Record<string, number> = { ...stored.progress };
    for (const [id, v] of Object.entries(incoming.progress)) progress[id] = Math.max(progress[id] ?? 0, v);
    const done: Record<string, number> = { ...stored.done };
    for (const [id, ts] of Object.entries(incoming.done)) done[id] = id in done ? Math.min(done[id]!, ts) : ts;
    out.progress = progress;
    out.done = done;
    out.bonusPaid = stored.bonusPaid || incoming.bonusPaid;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Achievements — claims verified against the stats that should back them
// ---------------------------------------------------------------------------

/**
 * The verifiable subset of the client badge catalogue
 * (apps/web/src/lib/achievements.ts) — ids whose backing stat the server can
 * recompute from the synced blob. Unknown ids pass through untouched (the
 * client ignores ids it does not know), but a *known* id whose backing stat
 * falls short of the target is a fabricated claim and gets dropped.
 * Keep targets in sync with the client catalogue.
 */
interface ClaimCtx {
  level?: number;
  streakMax?: number;
  goalsMet?: number;
  puzzlesSolved?: number;
  gamesPlayed?: number;
  gamesWon?: number;
  bestWinStreak?: number;
  peaks?: Partial<Record<RatingCat, number>>;
  botsBeaten?: number;
  lessonsCompleted?: number;
  questsCompleted?: number;
  questDaysAllDone?: number;
  reviews?: number;
  activeDays?: number;
}

type CtxValue = (c: ClaimCtx) => number | undefined;

function verifiableAchievements(): Map<string, { target: number; stat: string; value: CtxValue }> {
  const map = new Map<string, { target: number; stat: string; value: CtxValue }>();
  const add = (ids: [string, number][], stat: string, value: CtxValue): void => {
    for (const [id, target] of ids) map.set(id, { target, stat, value });
  };
  add(
    [
      ['tactics-solve-10', 10],
      ['tactics-solve-50', 50],
      ['tactics-solve-200', 200],
      ['tactics-solve-500', 500],
      ['tactics-solve-1000', 1000],
    ],
    'puzzles solved',
    (c) => c.puzzlesSolved,
  );
  add(
    [
      ['play-win-1', 1],
      ['play-win-10', 10],
      ['play-win-50', 50],
      ['play-win-150', 150],
    ],
    'games won',
    (c) => c.gamesWon,
  );
  add(
    [
      ['play-play-10', 10],
      ['play-play-100', 100],
    ],
    'games played',
    (c) => c.gamesPlayed,
  );
  add(
    [
      ['play-winstreak-3', 3],
      ['play-winstreak-5', 5],
      ['play-winstreak-10', 10],
    ],
    'best win streak',
    (c) => c.bestWinStreak,
  );
  add(
    [
      ['ladder-climb-3', 3],
      ['ladder-climb-8', 8],
      ['ladder-climb-15', 15],
    ],
    'ladder bots beaten',
    (c) => c.botsBeaten,
  );
  add(
    [
      ['streak-streak-3', 3],
      ['streak-streak-7', 7],
      ['streak-streak-30', 30],
      ['streak-streak-100', 100],
    ],
    'day streak',
    (c) => c.streakMax,
  );
  add(
    [
      ['streak-first-goal', 1],
      ['streak-goal-7', 7],
      ['streak-goal-30', 30],
    ],
    'daily goals met',
    (c) => c.goalsMet,
  );
  add(
    [
      ['dedication-level-5', 5],
      ['dedication-level-10', 10],
      ['dedication-level-25', 25],
    ],
    'level',
    (c) => c.level,
  );
  add(
    [
      ['dedication-days-7', 7],
      ['dedication-days-30', 30],
      ['dedication-days-100', 100],
    ],
    'active days',
    (c) => c.activeDays,
  );
  add(
    [
      ['quests-first', 1],
      ['quests-25', 25],
    ],
    'quests completed',
    (c) => c.questsCompleted,
  );
  add(
    [
      ['quests-clean-1', 1],
      ['quests-clean-7', 7],
    ],
    'all-quests days',
    (c) => c.questDaysAllDone,
  );
  add(
    [
      ['learn-lesson-1', 1],
      ['learn-lesson-10', 10],
    ],
    'lessons completed',
    (c) => c.lessonsCompleted,
  );
  add(
    [
      ['learn-reviews-50', 50],
      ['learn-reviews-250', 250],
    ],
    'reviews',
    (c) => c.reviews,
  );
  add([['rating-puzzles-1600', 1600]], 'puzzle rating peak', (c) => c.peaks?.puzzles);
  add([['rating-puzzles-2000', 2000]], 'puzzle rating peak', (c) => c.peaks?.puzzles);
  add([['rating-bots-1800', 1800]], 'bots rating peak', (c) => c.peaks?.bots);
  add([['rating-bots-2000', 2000]], 'bots rating peak', (c) => c.peaks?.bots);
  add([['rating-blitz-1600', 1600]], 'blitz rating peak', (c) => c.peaks?.blitz);
  return map;
}

const VERIFIABLE = verifiableAchievements();

function validateAchievements(raw: unknown, ctx: ClaimCtx, nowMs: number, notes: Notes): { unlocked: Record<string, number> } {
  if (!isObj(raw)) reject('Achievements section is malformed.');
  const unlocked: Record<string, number> = {};
  if (raw.unlocked === undefined) return { unlocked };
  if (!isObj(raw.unlocked)) reject('Achievements section is malformed.');
  if (Object.keys(raw.unlocked).length > 1_000) reject('Achievements claim an implausible number of badges.');
  for (const [id, ts] of Object.entries(raw.unlocked)) {
    if (id.length > 80 || !isNum(ts)) {
      notes.add('achievements: dropped a malformed entry.');
      continue;
    }
    const rule = VERIFIABLE.get(id);
    if (rule) {
      const value = rule.value(ctx);
      if (value !== undefined && value < rule.target) {
        notes.add(`achievements: dropped '${id}' — claimed with ${rule.stat} at ${Math.round(value)}, needs ${rule.target}.`);
        continue;
      }
    }
    unlocked[id] = Math.min(ts, nowMs); // unlock timestamps cannot be in the future
  }
  return { unlocked };
}

/** Union with the stored set; the earliest unlock timestamp wins (client rule). */
function mergeAchievements(storedRaw: unknown, incoming: Record<string, number>): Record<string, number> {
  const merged: Record<string, number> = { ...incoming };
  if (isObj(storedRaw) && isObj(storedRaw.unlocked)) {
    for (const [id, ts] of Object.entries(storedRaw.unlocked)) {
      if (!isNum(ts)) continue;
      merged[id] = id in merged ? Math.min(merged[id]!, ts) : ts;
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Ladder + lessons (bounded maps, unioned with the stored copy)
// ---------------------------------------------------------------------------

function validateLadder(raw: unknown, storedRaw: unknown, notes: Notes): { defeated: Record<string, number> } {
  if (!isObj(raw)) reject('Ladder section is malformed.');
  const defeated: Record<string, number> = {};
  if (raw.defeated !== undefined) {
    if (!isObj(raw.defeated)) reject('Ladder section is malformed.');
    if (Object.keys(raw.defeated).length > LIMITS.ladderBotsCap) reject('Ladder claims an implausible number of beaten bots.');
    for (const [id, ts] of Object.entries(raw.defeated)) {
      if (id.length > 64 || !isNum(ts)) {
        notes.add('ladder: dropped a malformed entry.');
        continue;
      }
      defeated[id] = ts;
    }
  }
  if (isObj(storedRaw) && isObj(storedRaw.defeated)) {
    for (const [id, ts] of Object.entries(storedRaw.defeated)) {
      if (!isNum(ts)) continue;
      defeated[id] = id in defeated ? Math.min(defeated[id]!, ts) : ts; // first-beaten wins
    }
  }
  return { defeated };
}

function validateLessons(raw: unknown, storedRaw: unknown, notes: Notes): { completed: Record<string, unknown> } {
  if (!isObj(raw)) reject('Lessons section is malformed.');
  const completed: Record<string, unknown> = {};
  if (raw.completed !== undefined) {
    if (!isObj(raw.completed)) reject('Lessons section is malformed.');
    if (Object.keys(raw.completed).length > LIMITS.lessonsCap) reject('Lessons claim an implausible number of completions.');
    for (const [id, rec] of Object.entries(raw.completed)) {
      if (id.length > 120 || !isObj(rec)) {
        notes.add('lessons: dropped a malformed entry.');
        continue;
      }
      completed[id] = rec;
    }
  }
  if (isObj(storedRaw) && isObj(storedRaw.completed)) {
    for (const [id, rec] of Object.entries(storedRaw.completed)) {
      if (!(id in completed) && isObj(rec)) completed[id] = rec; // union: never lose a completion
    }
  }
  return { completed };
}

// ---------------------------------------------------------------------------
// Legacy single puzzle rating (back-compat mirror of ratings.puzzles)
// ---------------------------------------------------------------------------

interface LegacyPuzzle {
  rating: number;
  peak: number;
  played: number;
  solved: number;
  history: Record<string, number>;
}

function parseStoredLegacy(raw: unknown): LegacyPuzzle | null {
  if (!isObj(raw) || !isNum(raw.rating) || raw.rating < LIMITS.ratingFloor || raw.rating > LIMITS.ratingCeil) return null;
  const num = (v: unknown): number => (isNum(v) && v >= 0 ? v : 0);
  const history: Record<string, number> = {};
  if (isObj(raw.history)) {
    for (const [day, r] of Object.entries(raw.history)) if (isDayKey(day) && isNum(r)) history[day] = r;
  }
  return { rating: raw.rating, peak: isNum(raw.peak) ? raw.peak : raw.rating, played: num(raw.played), solved: num(raw.solved), history };
}

function validateLegacyPuzzle(raw: unknown, storedRaw: unknown, maxDay: string, notes: Notes): LegacyPuzzle {
  if (!isObj(raw)) reject('Legacy puzzle rating is malformed.');
  const rating = ratingOf(raw.rating, 'Puzzle rating');
  let peak = ratingOf(raw.peak ?? rating, 'Puzzle peak rating');
  if (peak < rating) {
    notes.add('puzzleRating: peak raised to match the current rating.');
    peak = rating;
  }
  const played = countOf(raw.played, LIMITS.playedCap, 'Puzzles played');
  const solved = countOf(raw.solved, LIMITS.playedCap, 'Puzzles solved');
  if (solved > played) reject(`Puzzles solved (${Math.round(solved)}) exceed puzzles played (${Math.round(played)}).`);

  // Same seed-reachability bound as the modern categories: the legacy puzzle
  // rating started at the puzzles seed and moved ≤ eloDeltaPerGame per puzzle.
  const reach = LIMITS.startRating.puzzles + LIMITS.eloDeltaPerGame * played;
  if (rating > reach) reject(`Puzzle rating of ${Math.round(rating)} is unreachable from the starting rating with ${Math.round(played)} puzzle(s).`);
  if (peak > reach) reject(`Puzzle peak rating of ${Math.round(peak)} is unreachable from the starting rating with ${Math.round(played)} puzzle(s).`);

  const history: Record<string, number> = {};
  if (raw.history !== undefined) {
    if (!isObj(raw.history)) reject('Legacy puzzle history is malformed.');
    if (Object.keys(raw.history).length > LIMITS.historyDaysCap) reject('Legacy puzzle history spans an implausible number of days.');
    for (const [day, r] of Object.entries(raw.history)) {
      if (!isDayKey(day) || day < LIMITS.earliestDay) {
        notes.add(`puzzleRating: dropped history entry with invalid day '${String(day).slice(0, 20)}'.`);
        continue;
      }
      if (day > maxDay) reject(`Legacy puzzle history contains the future-dated day ${day}.`);
      if (!isNum(r) || r < 0 || r > LIMITS.ratingCeil) {
        notes.add(`puzzleRating: dropped malformed history entry for ${day}.`);
        continue;
      }
      history[day] = r;
    }
  }
  if (played > LIMITS.gamesPerDay.puzzles * Math.max(1, Object.keys(history).length)) {
    reject('Legacy puzzle rating claims more puzzles than plausible for its recorded days.');
  }

  const prev = parseStoredLegacy(storedRaw);
  if (prev) {
    const delta = played - prev.played;
    if (delta > 0 && Math.abs(rating - prev.rating) > LIMITS.eloDeltaPerGame * delta) {
      reject(`Puzzle rating jump of ${Math.round(rating - prev.rating)} over ${Math.round(delta)} new puzzle(s) is impossible.`);
    }
    // Peaks follow the same per-puzzle bound as the modern categories: with new
    // puzzles the peak must be reachable from the stored rating (reject); with
    // none it cannot rise at all (clamp — the merge below max-merges peaks).
    if (delta > 0) {
      if (peak > Math.max(prev.peak, prev.rating + LIMITS.eloDeltaPerGame * delta)) {
        reject(`Puzzle peak rating of ${Math.round(peak)} is unreachable from the stored rating with ${Math.round(delta)} new puzzle(s).`);
      }
    } else {
      const bound = Math.max(prev.peak, prev.rating);
      if (peak > bound) {
        notes.add(`puzzleRating: peak clamped to ${Math.round(bound)} — a higher peak is claimed without new puzzles.`);
        peak = bound;
      }
    }
    // Merge like the modern categories: more-played side owns the live rating.
    const incomingWins = played > prev.played;
    return {
      rating: incomingWins ? rating : prev.rating,
      peak: Math.max(peak, prev.peak),
      played: Math.max(played, prev.played),
      solved: Math.max(solved, prev.solved),
      history: { ...prev.history, ...history },
    };
  }
  return { rating, peak, played, solved, history };
}

// ---------------------------------------------------------------------------
// SRS progress (opaque content, but its review history feeds achievements)
// ---------------------------------------------------------------------------

/** Light-touch checks on progress.history; everything else passes through. */
function validateSrsHistory(progress: unknown, maxDay: string, notes: Notes): { reviews: number; activeDays: Set<string> } {
  const activeDays = new Set<string>();
  let reviews = 0;
  if (!isObj(progress) || progress.history === undefined) return { reviews, activeDays };
  if (!isObj(progress.history)) reject('Review history is malformed.');
  const history = progress.history as Record<string, unknown>;
  for (const [day, stat] of Object.entries(history)) {
    if (!isDayKey(day) || day < LIMITS.earliestDay) {
      notes.add(`progress: dropped review-history entry with invalid day '${String(day).slice(0, 20)}'.`);
      delete history[day];
      continue;
    }
    if (day > maxDay) reject(`Review history for ${day} is future-dated.`);
    if (!isObj(stat) || !isNum(stat.reviews) || stat.reviews < 0) reject(`Review history for ${day} is malformed.`);
    if (stat.reviews > LIMITS.reviewsPerDay) reject(`Review count on ${day} is implausibly large (max ${LIMITS.reviewsPerDay}/day).`);
    if (isNum(stat.correct) && stat.correct > stat.reviews) reject(`Review history for ${day} reports more correct answers than reviews.`);
    reviews += stat.reviews;
    if (stat.reviews > 0) activeDays.add(day);
  }
  return { reviews, activeDays };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Marker keys that identify a modern sectioned payload — must mirror the
 * client's detection in apps/web/src/lib/sync.ts `apply()`. A blob with none
 * of these is a legacy bare SRS-progress blob (whose top-level `streak` etc.
 * are SRS fields, not the gamification sections) and passes through untouched.
 */
const SECTION_MARKERS = ['progress', 'repertoires', 'mistakes', 'coordinate', 'customPuzzles', 'ratings', 'puzzleRating', 'ladder', 'lessons'];

export function validateProgress(incoming: unknown, stored: unknown, nowMs: number = Date.now()): ValidateResult {
  if (incoming === null || incoming === undefined) return { ok: true, data: null, adjustments: [] };
  if (!isObj(incoming)) return { ok: false, error: 'Progress payload must be an object.' };
  if (!SECTION_MARKERS.some((k) => k in incoming)) return { ok: true, data: incoming, adjustments: [] };

  const notes = new Notes();
  const maxDay = dayKeyOf(nowMs + LIMITS.futureDaySlack * 86_400_000);
  const prev = isObj(stored) ? stored : {};
  const out: Record<string, unknown> = { ...incoming };

  try {
    // SRS review history (light checks; the section itself passes through).
    const srs = validateSrsHistory(out.progress, maxDay, notes);

    // Gamify first — streak/quest plausibility reads the claimed day logs.
    let incomingGamify: GamifyData | null = null;
    if (out.gamify !== undefined) {
      incomingGamify = validateGamify(out.gamify, prev.gamify, maxDay, notes);
      out.gamify = mergeGamify(parseStoredGamify(prev.gamify), incomingGamify);
    }

    let ratings: RatingsOut | null = null;
    if (out.ratings !== undefined) {
      ratings = validateRatings(out.ratings, prev.ratings, maxDay, notes);
      out.ratings = { ...ratings.rest, categories: ratings.categories };
    }

    let streak: StreakData | null = null;
    if (out.streak !== undefined) {
      streak = validateStreak(out.streak, incomingGamify, maxDay, notes);
      const prevStreak = parseStoredStreak(prev.streak);
      out.streak = prevStreak ? mergeStreaks(prevStreak, streak) : streak;
    }

    let quests: QuestsData | null = null;
    if (out.quests !== undefined) {
      quests = validateQuests(out.quests, incomingGamify, maxDay, notes);
      out.quests = mergeQuests(parseStoredQuests(prev.quests), quests);
    }

    if (out.ladder !== undefined) out.ladder = validateLadder(out.ladder, prev.ladder, notes);
    if (out.lessons !== undefined) out.lessons = validateLessons(out.lessons, prev.lessons, notes);
    if (out.puzzleRating !== undefined) out.puzzleRating = validateLegacyPuzzle(out.puzzleRating, prev.puzzleRating, maxDay, notes);

    if (out.achievements !== undefined) {
      // Achievement claims are checked against the *final* (merged) stats, so a
      // stale device pushing old counters never loses badges it truly earned.
      const finalGamify = out.gamify as GamifyData | undefined;
      const finalStreak = out.streak as StreakData | undefined;
      const finalQuests = out.quests as QuestsData | undefined;
      const cats = ratings?.categories;
      const peak = (c?: Category): number | undefined => (c ? Math.max(c.eloPeak, c.glickoPeak) : undefined);
      const activeDays = new Set(srs.activeDays);
      for (const [day, log] of Object.entries(finalGamify?.days ?? {})) if (log.activities > 0) activeDays.add(day);
      const ctx: ClaimCtx = {
        level: finalGamify ? levelFromXp(finalGamify.xp) : undefined,
        streakMax:
          finalStreak || finalGamify
            ? Math.max(finalStreak?.count ?? 0, finalStreak?.best ?? 0, finalGamify?.streak ?? 0, finalGamify?.bestStreak ?? 0)
            : undefined,
        goalsMet: finalGamify?.goalsMet,
        puzzlesSolved: cats?.puzzles?.won,
        gamesPlayed: cats?.bots && cats.blitz ? cats.bots.played + cats.blitz.played : undefined,
        gamesWon: cats?.bots && cats.blitz ? cats.bots.won + cats.blitz.won : undefined,
        bestWinStreak: cats?.bots && cats.blitz ? Math.max(cats.bots.bestWinStreak, cats.blitz.bestWinStreak) : undefined,
        peaks: cats ? { bots: peak(cats.bots), blitz: peak(cats.blitz), puzzles: peak(cats.puzzles) } : undefined,
        botsBeaten: out.ladder !== undefined ? Object.keys((out.ladder as { defeated: Record<string, number> }).defeated).length : undefined,
        lessonsCompleted: out.lessons !== undefined ? Object.keys((out.lessons as { completed: Record<string, unknown> }).completed).length : undefined,
        questsCompleted: finalQuests?.totalCompleted,
        questDaysAllDone: finalQuests?.daysAllDone,
        reviews: isObj(out.progress) ? srs.reviews : undefined,
        activeDays: isObj(out.progress) || finalGamify ? activeDays.size : undefined,
      };
      const claims = validateAchievements(out.achievements, ctx, nowMs, notes);
      out.achievements = { unlocked: mergeAchievements(prev.achievements, claims.unlocked) };
    }
  } catch (e) {
    if (e instanceof Rejection) return { ok: false, error: e.message };
    throw e;
  }

  return { ok: true, data: out, adjustments: notes.done() };
}
