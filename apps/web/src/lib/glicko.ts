/**
 * Glicko-2 rating system (Mark Glickman's 2013 formulation).
 *
 * Unlike plain Elo, Glicko-2 tracks two extra numbers alongside the rating: a
 * **deviation** (RD — how unsure we are of the rating) and a **volatility**
 * (how erratic recent results have been). A fresh or long-idle player has a
 * high RD, so their rating moves fast; an established one barely budges.
 *
 * We treat every result as its own one-game "rating period", which is what
 * Lichess does too — it keeps the rating responsive without batching.
 *
 * All functions are pure; the unified ratings store wires them to game/puzzle
 * outcomes (see store/ratings.ts).
 */

export interface Glicko2 {
  rating: number; // human-scale (≈ Elo), 1500 = average
  rd: number; // rating deviation (uncertainty), 350 = brand new
  vol: number; // volatility
}

/** A fresh, maximally-uncertain rating. */
export const DEFAULT_GLICKO: Glicko2 = { rating: 1500, rd: 350, vol: 0.06 };

/** Bounds we keep the visible numbers within. */
export const RD_MIN = 30;
export const RD_MAX = 350;
export const RATING_MIN = 100;

const SCALE = 173.7178; // Glicko-2 internal/visible conversion constant
const TAU = 0.5; // system constant: smaller = less volatile rating changes
const EPSILON = 1e-6;

/** A single opponent result within a rating period; `score` ∈ [0,1]. */
export interface GlickoGame {
  rating: number;
  rd: number;
  score: number; // 1 win · 0.5 draw · 0 loss · (any value for graded puzzles)
}

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number): number => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Advance a player's Glicko-2 rating over one rating period made of `games`.
 * With an empty `games` array only the deviation grows (idle decay).
 */
export function updateGlicko(player: Glicko2, games: GlickoGame[]): Glicko2 {
  const phi = player.rd / SCALE;

  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + player.vol * player.vol);
    return { rating: player.rating, rd: clamp(phiStar * SCALE, RD_MIN, RD_MAX), vol: player.vol };
  }

  const mu = (player.rating - 1500) / SCALE;

  // Estimated variance (v) and the rating-change direction (deltaSum / v gives Δ).
  let vInv = 0;
  let deltaSum = 0;
  for (const o of games) {
    const muJ = (o.rating - 1500) / SCALE;
    const phiJ = o.rd / SCALE;
    const gj = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    deltaSum += gj * (o.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Solve for the new volatility with the Illinois (regula-falsi) iteration.
  const a = Math.log(player.vol * player.vol);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const d2 = delta * delta;
    const num = ex * (d2 - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  let iter = 0;
  while (Math.abs(B - A) > EPSILON && iter < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
    iter++;
  }
  const newVol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    rating: clamp(newMu * SCALE + 1500, RATING_MIN, 4000),
    rd: clamp(newPhi * SCALE, RD_MIN, RD_MAX),
    vol: newVol,
  };
}

/** Update against a single opponent (score: 1 win · 0.5 draw · 0 loss). */
export function updateGlickoOne(player: Glicko2, oppRating: number, oppRd: number, score: number): Glicko2 {
  return updateGlicko(player, [{ rating: oppRating, rd: oppRd, score }]);
}

/** A ±band for display, e.g. "1532 ± 60", at ~95% confidence. */
export function ratingInterval(rd: number): number {
  return Math.round(2 * rd);
}
