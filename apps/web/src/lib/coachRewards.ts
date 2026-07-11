/**
 * Thin adapter between the coach training flow and the gamification layer.
 *
 * The coach page emits {@link CoachRewardEvent}s at its two meaningful
 * moments; this adapter forwards them to the gamification public API's coach
 * wrappers (lib/gamify.ts), which own all amounts and side effects:
 *
 *  - 'weakness-trained'  → recordCoachTraining: solve bonus XP on top of the
 *    base puzzle XP, the one-off "weakness cleared" bonus when the attempt
 *    lifts a weakness over the cleared bar, and a badge-catalogue re-check
 *    (coach achievements: coach-train-* / coach-clear-*).
 *  - 'training-session'  → recordCoachSession: a small session-completion
 *    bonus scaled by solves.
 *
 * NOTE: base puzzle XP + rating + daily-quest progress still flow through the
 * EXISTING pipeline (lib/puzzleService.recordResult → lib/gamify.recordPuzzle)
 * — this adapter is only for the coach-specific extras on top, which is also
 * why those extras are passive (they never double-tick the streak or the
 * day's activity count).
 */
import type { WeaknessKind } from './weakness';
import { recordCoachSession, recordCoachTraining } from './gamify';

export type CoachRewardEvent =
  | { kind: 'weakness-trained'; weakness: WeaknessKind; solved: boolean }
  | { kind: 'training-session'; weakness: WeaknessKind; solved: number; attempts: number };

export function awardCoachReward(event: CoachRewardEvent): void {
  switch (event.kind) {
    case 'weakness-trained':
      recordCoachTraining(event.weakness, event.solved);
      break;
    case 'training-session':
      recordCoachSession({ solved: event.solved, attempts: event.attempts });
      break;
  }
}
