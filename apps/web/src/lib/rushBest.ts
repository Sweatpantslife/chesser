import { useRepertoire } from '../store/repertoire';

/**
 * READ-ONLY adapter for the player's Puzzle Rush best score.
 *
 * Sources, best-of:
 *  1. The sprints store (apps/web/src/store/sprints.ts, landing via PR #30):
 *     persisted as `chesser-sprints` with
 *     `puzzleRushBest: { timed3: { score, … }, survival: { score, … } }`.
 *     Probed through localStorage rather than imported so this module doesn't
 *     hard-depend on a file owned by a parallel workstream; once #30 is in the
 *     base, the import can replace the probe.
 *  2. The legacy high score on the repertoire store (`rushHighScore`, written
 *     by RushMode today).
 *
 * This module never writes any of those stores — the leaderboard layer only
 * consumes the score, and the server re-validates whatever is submitted.
 */

const SPRINTS_KEY = 'chesser-sprints';
const RUSH_MODES = ['timed3', 'survival'] as const;

function probeSprints(): number {
  let best = 0;
  try {
    const raw = localStorage.getItem(SPRINTS_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    const s = parsed?.state ?? parsed;
    const rush = s?.puzzleRushBest;
    if (!rush || typeof rush !== 'object') return 0;
    for (const mode of RUSH_MODES) {
      const score = rush[mode]?.score;
      if (typeof score === 'number' && Number.isFinite(score) && score > best) best = Math.floor(score);
    }
  } catch {
    // Malformed/foreign blob — ignore; this is a best-effort probe.
  }
  return best;
}

/** The player's Puzzle Rush best across every known source (0 = never played). */
export function getPuzzleRushBest(): number {
  return Math.max(useRepertoire.getState().rushHighScore, probeSprints());
}

/** Re-render/react hook-free subscription: fires when the known store changes. */
export function subscribePuzzleRushBest(cb: () => void): () => void {
  return useRepertoire.subscribe(cb);
}
