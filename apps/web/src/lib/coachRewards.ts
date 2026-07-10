/**
 * Thin adapter between the coach training flow and the gamification layer.
 *
 * The retention/gamification workstream OWNS the XP / achievements / streak
 * store and will expose dedicated hooks for coach-specific awards (e.g. bonus
 * XP for training a diagnosed weakness). Until those hooks land, this adapter
 * deliberately does nothing beyond a dev-only log, so the coach feature has
 * exactly one seam to wire up later and no competing writes to that store.
 *
 * NOTE: base puzzle XP + rating still flow through the EXISTING pipeline
 * (lib/puzzleService.recordResult → lib/gamify.recordPuzzle) — this adapter
 * is only for the coach-specific extras on top.
 */
import type { WeaknessKind } from './weakness';

export type CoachRewardEvent =
  | { kind: 'weakness-trained'; weakness: WeaknessKind; solved: boolean }
  | { kind: 'training-session'; weakness: WeaknessKind; solved: number; attempts: number };

export function awardCoachReward(event: CoachRewardEvent): void {
  // Seam for feat/retention-gamification: replace this body with the real
  // award hook once the gamification branch exposes it.
  if (import.meta.env?.DEV) console.debug('[coachRewards]', event);
}
