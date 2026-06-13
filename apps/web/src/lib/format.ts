import type { Score } from '@chesser/shared';
export { formatScore } from '@chesser/shared';

/** Map a White-POV score to White's winning-chance percentage (0–100). */
export function whiteWinPercent(score: Score | null): number {
  if (!score) return 50;
  if (score.kind === 'mate') return score.value > 0 ? 100 : score.value < 0 ? 0 : 50;
  const cp = Math.max(-1500, Math.min(1500, score.value));
  // Logistic curve used by most chess UIs.
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
