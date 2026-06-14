/**
 * Plain Elo with a decaying K-factor — the meter players are used to seeing.
 * It runs in parallel with Glicko-2 (lib/glicko.ts); Elo is the headline number,
 * Glicko is the confidence-aware one that drives difficulty decisions.
 */

export const ELO_MIN = 100;

/** Volatile while provisional, steady once a track record exists. */
export function eloK(played: number): number {
  if (played < 30) return 40;
  if (played < 100) return 24;
  return 16;
}

/** Probability the player scores against an opponent of `oppRating`. */
export function eloExpected(rating: number, oppRating: number): number {
  return 1 / (1 + 10 ** ((oppRating - rating) / 400));
}

/** New rating after a result. `score`: 1 win · 0.5 draw · 0 loss. */
export function updateElo(rating: number, oppRating: number, score: number, played: number): { rating: number; delta: number } {
  const delta = Math.round(eloK(played) * (score - eloExpected(rating, oppRating)));
  return { rating: Math.max(ELO_MIN, rating + delta), delta };
}
