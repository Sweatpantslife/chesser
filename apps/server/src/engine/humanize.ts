import { Chess } from 'chess.js';
import { BOT_RATING_MIN, STOCKFISH_ELO_MIN } from '@chesser/shared';

/**
 * humanize — pure move-selection math for human-like bots.
 *
 * Given a list of engine candidate moves (MultiPV output collapsed to
 * comparable side-to-move centipawns), pick the move a human of a target
 * rating plausibly plays:
 *
 *  - softmax over candidate evals with a rating-calibrated temperature
 *    (lower rating ⇒ flatter distribution ⇒ more graded inaccuracies),
 *  - an explicit "lapse" tier whose probability AND magnitude decay with
 *    rating (an 800 occasionally hangs a piece; a 1900 makes small slips),
 *  - extra sampling width among near-equal moves in the opening, so games
 *    don't repeat move-for-move,
 *  - eval-gap safety rails, phased in across ~900-1100: at club level and up a
 *    candidate that throws away a won position (or walks into mate when
 *    anything safe exists) is dropped,
 *  - a heavy penalty on moves that repeat an earlier position while the bot
 *    is clearly winning, so it converts instead of shuffling.
 *
 * Everything here is deterministic given an injected RNG — no engine, no IO —
 * so the selection model is unit-testable without Stockfish installed.
 */

export interface HumanCandidate {
  uci: string;
  /** Comparable centipawns, side-to-move POV (mate collapsed to ±~100000). */
  cp: number;
  /** Times the position after this move already occurred in the game. */
  repeats?: number;
}

export interface HumanPickContext {
  rating: number;
  /** Plies played so far (0 = initial position). */
  ply: number;
  /** Uniform [0,1) source. Injectable so sampling is deterministic in tests. */
  rng?: () => number;
}

export interface HumanPick {
  index: number;
  uci: string;
  /** Centipawns given up versus the best candidate. */
  lossCp: number;
  /** True when the pick came from the deliberate-lapse (blunder) tier. */
  viaLapse: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Plies of extra opening variety (sampling widened among near-equal moves). */
export const OPENING_PLIES = 12;
/** Moves within this many cp of the best count as "near-equal" in the opening. */
const OPENING_EQUAL_CP = 45;
/** Minimum relative weight a near-equal opening move gets at ply 0 (best = 1). */
const OPENING_MIX = 0.7;
/** Side-to-move eval above which the bot counts as clearly winning. */
const WINNING_CP = 200;
/** Weight multiplier for repetition moves while clearly winning. */
const REPEAT_WEIGHT = 0.02;
/**
 * Eval magnitude beyond which "more winning" stops mattering when grading a
 * move choice. Mate scores collapse to ~±100000 comparable cp; without this
 * cap any non-mating alternative counted as a ~99000cp "blunder", making
 * every railed bot engine-perfect at forced mates. On this scale "mate vs a
 * +500 move" is a ~1000cp loss (rail-dropped at club level, reachable below
 * it) while "safe vs getting mated" stays a ≥1500cp loss the rails exclude.
 */
const GRADE_EVAL_CAP = 1500;

/**
 * Softmax temperature (cp) by rating. ~256 at 500 (very flat — beginners treat
 * quite-different moves as interchangeable) decaying to ~22 by 2000 (only
 * near-equal moves get a real chance).
 */
export function temperatureFor(rating: number): number {
  const r = clamp(rating, 400, 3200);
  return clamp(10 + 300 * Math.exp(-(r - 400) / 500), 10, 330);
}

/**
 * Per-move probability of a deliberate lapse (an error beyond softmax noise).
 * ~16% at 500, ~9% at 800, ~5% at 1100, ~1% at 1900, ~0.4% floor above 2300.
 */
export function blunderChanceFor(rating: number): number {
  const r = clamp(rating, 400, 3200);
  return clamp(0.16 * Math.exp(-(r - 500) / 500), 0.004, 0.2);
}

/**
 * How bad a lapse is allowed to be (cp lost vs best). ~1000 at 500 (hangs a
 * major piece), ~630 at 800, ~250 at 1400, ~115 at 1900 — a 1900's "blunder"
 * is a small inaccuracy, matching how error magnitude shrinks with rating.
 */
export function blunderLossCapFor(rating: number): number {
  const r = clamp(rating, 400, 3200);
  return clamp(1000 * Math.exp(-(r - 500) / 650), 60, 1000);
}

/**
 * How much of the safety rails applies: 0 below rating 900, 1 from 1100 up.
 * Dividing a cap by this phases the rails in smoothly across 900-1100 instead
 * of switching them on at exactly 1000 — no persona sits on a behavioral
 * cliff where "sometimes throws games" flips to "never errs badly".
 */
function railPhase(rating: number): number {
  return clamp((rating - 900) / 200, 0, 1);
}

/**
 * Absolute cap on eval given up in one move, whatever tier picked it. Below
 * 900 there is no cap (beginners really do throw games); it then phases in
 * across 900-1100 and shrinks with rating (~883 at 1100, ~750 at 1200, ~450
 * at 1500, ~230 at 1900), which via pure eval gaps also excludes walking into
 * mate or losing a completely won position — on the GRADE_EVAL_CAP scale both
 * grade as losses above the cap at club level.
 */
export function hardLossCapFor(rating: number): number {
  const r = clamp(rating, 400, 3200);
  const phase = railPhase(r);
  if (phase === 0) return Infinity;
  return clamp(2400 * Math.exp(-(r - 500) / 600), 150, 2400) / phase;
}

export interface SearchPlan {
  multiPv: number;
  go: string;
}

/**
 * Engine budget for gathering candidates. Sub-1320 ratings keep the old
 * beginner path's shallow fixed depth (eval noise at depth 1-6 is itself a
 * realistic error source); above it a movetime search at full strength gives
 * trustworthy evals for the sampler to grade moves against.
 */
export function searchPlanFor(rating: number, moveTimeMs?: number): SearchPlan {
  const r = clamp(rating, 400, 3200);
  // Below the rail phase-in the pool is widened so genuinely losing moves
  // exist in it — a beginner's worst reachable move shouldn't be merely the
  // 8th-best move of a full-strength search.
  const multiPv = r < 1000 ? 12 : r < 1100 ? 8 : r < 1700 ? 7 : 6;
  if (r < STOCKFISH_ELO_MIN) {
    const t = clamp((r - BOT_RATING_MIN) / (STOCKFISH_ELO_MIN - 1 - BOT_RATING_MIN), 0, 1);
    const depth = Math.round(1 + t * 5); // 1 … 6, mirrors the old beginner path
    return { multiPv, go: `go depth ${depth}` };
  }
  return { multiPv, go: `go movetime ${clamp(Math.round(moveTimeMs ?? 600), 50, 5000)}` };
}

/** Deterministic RNG (mulberry32) so tests can fix the sampling sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedIndex(weights: number[], rng: () => number): number {
  let total = 0;
  for (const w of weights) total += w;
  if (!(total > 0)) return 0;
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

/** Plies played so far, derived from a FEN's turn + fullmove counter. */
export function plyOfFen(fen: string): number {
  const parts = fen.split(' ');
  const fullmove = Number(parts[5] ?? '1');
  const black = parts[1] === 'b';
  return Math.max(0, (Number.isFinite(fullmove) ? fullmove - 1 : 0) * 2 + (black ? 1 : 0));
}

/**
 * Repetition fingerprint: placement + side to move + castling. En-passant
 * rights are deliberately ignored — this feeds a *penalty* (don't shuffle a
 * won game), not a rules claim, and dropping the EP field means a repeat is
 * never missed just because the earlier visit had a stale EP square.
 */
function repetitionKey(fen: string): string {
  return fen.split(' ').slice(0, 3).join(' ');
}

/** Tag each candidate with how often its resulting position already occurred. */
export function annotateRepeats(fen: string, candidates: HumanCandidate[], recentFens: string[]): HumanCandidate[] {
  if (recentFens.length === 0) return candidates;
  const counts = new Map<string, number>();
  for (const f of recentFens) {
    const k = repetitionKey(f);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return candidates.map((c) => {
    try {
      const g = new Chess(fen);
      g.move({ from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), promotion: c.uci.length > 4 ? c.uci[4] : undefined });
      return { ...c, repeats: counts.get(repetitionKey(g.fen())) ?? 0 };
    } catch {
      return { ...c, repeats: 0 };
    }
  });
}

/** Pick a move like a human of `ctx.rating` from engine candidates. */
export function pickHumanMove(candidates: HumanCandidate[], ctx: HumanPickContext): HumanPick {
  if (candidates.length === 0) throw new Error('pickHumanMove: no candidates');
  const rng = ctx.rng ?? Math.random;
  const rating = clamp(ctx.rating, 400, 3200);

  const bestCp = Math.max(...candidates.map((c) => c.cp));
  // Grade losses on a capped eval scale: choosing between two crushing moves
  // (or a mate and a clearly winning move) is a human choice, not a blunder.
  const grade = (cp: number) => clamp(cp, -GRADE_EVAL_CAP, GRADE_EVAL_CAP);
  const bestGraded = grade(bestCp);
  const loss = candidates.map((c) => bestGraded - grade(c.cp));
  const winning = bestCp >= WINNING_CP;
  const repeatPenalised = (i: number) => winning && (candidates[i]!.repeats ?? 0) > 0;

  // Eval-gap safety rail: drop anything a player of this strength never plays.
  // loss(best) is 0, so the pool can never be emptied by the cap.
  const hardCap = hardLossCapFor(rating);
  const pool = candidates.map((_, i) => i).filter((i) => loss[i]! <= hardCap);

  // Deliberate lapse: a graded error — mostly small, occasionally near the
  // rating's cap. Below the rail phase-in every inferior move is reachable
  // (loss capped for weighting so even huge throws keep a tiny tail
  // probability); the reach narrows to lapseCap as the rails come online.
  const lapseCap = blunderLossCapFor(rating);
  const phase = railPhase(rating);
  const lapseReach = phase === 0 ? Infinity : lapseCap / phase;
  if (rng() < blunderChanceFor(rating)) {
    const errors = pool.filter((i) => loss[i]! > 0 && !repeatPenalised(i) && loss[i]! <= lapseReach);
    if (errors.length > 0) {
      const scale = Math.max(1, lapseCap / 2);
      const w = errors.map((i) => Math.exp(-Math.min(loss[i]!, 2 * lapseCap) / scale));
      const pick = errors[weightedIndex(w, rng)]!;
      return { index: pick, uci: candidates[pick]!.uci, lossCp: loss[pick]!, viaLapse: true };
    }
  }

  // Softmax over the (safe) pool; best move has weight 1 by construction.
  const temperature = temperatureFor(rating);
  const weights = pool.map((i) => Math.exp(-loss[i]! / temperature));

  // Opening variety: lift near-equal moves toward the best so the first plies
  // don't play out identically every game. Fades to nothing by OPENING_PLIES.
  if (ctx.ply < OPENING_PLIES) {
    const lift = OPENING_MIX * (1 - ctx.ply / OPENING_PLIES);
    for (let j = 0; j < pool.length; j++) {
      if (loss[pool[j]!]! <= OPENING_EQUAL_CP) weights[j] = Math.max(weights[j]!, lift);
    }
  }

  // Clearly winning + candidate recreates a previous position ⇒ convert, don't shuffle.
  for (let j = 0; j < pool.length; j++) {
    if (repeatPenalised(pool[j]!)) weights[j] = weights[j]! * REPEAT_WEIGHT;
  }

  const pick = pool[weightedIndex(weights, rng)]!;
  return { index: pick, uci: candidates[pick]!.uci, lossCp: loss[pick]!, viaLapse: false };
}

/** Plies of Maia policy-sampling variety at the start of a game. */
export const MAIA_VARIETY_PLIES = 12;
const MAIA_VARIETY_WINDOW_CP = 60;
const MAIA_VARIETY_WEIGHTS = [1, 0.45, 0.2, 0.1];

/**
 * Mild opening variety for real-Maia moves: given lc0's MultiPV candidates in
 * rank order (rank 1 = the raw-policy move Maia would play), occasionally play
 * a near-top alternative during the first plies. Past the opening — or when
 * lc0 reported a single line — always returns 0 (today's behaviour).
 *
 * The weights apply to policy rank. At a true one-node search lc0 reports the
 * identical root score on every MultiPV line, so the cp window filters nothing
 * there; it is a defensive guard, anchored at the rank-1 policy move, for
 * builds whose lines carry real (possibly diverging) per-move evals.
 */
export function pickMaiaVariety(candidates: { cp: number }[], ply: number, rng: () => number = Math.random): number {
  if (ply >= MAIA_VARIETY_PLIES || candidates.length < 2) return 0;
  const top = candidates[0]!.cp;
  const weights = candidates.map((c, i) =>
    i < MAIA_VARIETY_WEIGHTS.length && top - c.cp <= MAIA_VARIETY_WINDOW_CP ? MAIA_VARIETY_WEIGHTS[i]! : 0,
  );
  return weightedIndex(weights, rng);
}
