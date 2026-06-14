/**
 * A compact SM-2 style spaced-repetition scheduler.
 *
 * Each reviewable item (an opening line, a tactics puzzle, …) is a card with an
 * ease factor and an interval. Grading it reschedules its next due date.
 */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface SrsCard {
  ease: number; // SM-2 ease factor
  intervalDays: number;
  due: number; // epoch ms
  reps: number; // consecutive successful reviews
  lapses: number;
  last: number; // last reviewed epoch ms (0 = never)
}

const DAY = 86_400_000;
const MIN_EASE = 1.3;

export function newCard(now = Date.now()): SrsCard {
  return { ease: 2.5, intervalDays: 0, due: now, reps: 0, lapses: 0, last: 0 };
}

export function review(card: SrsCard, grade: Grade, now = Date.now()): SrsCard {
  let { ease, intervalDays, reps, lapses } = card;

  if (grade === 'again') {
    return {
      ease: Math.max(MIN_EASE, ease - 0.2),
      intervalDays: 0,
      reps: 0,
      lapses: lapses + 1,
      last: now,
      due: now + 60_000, // re-show within the session
    };
  }

  if (grade === 'hard') ease = Math.max(MIN_EASE, ease - 0.15);
  if (grade === 'easy') ease = ease + 0.15;

  reps += 1;
  if (reps === 1) intervalDays = grade === 'easy' ? 2 : 1;
  else if (reps === 2) intervalDays = grade === 'easy' ? 6 : 3;
  else {
    const mult = grade === 'hard' ? 1.2 : grade === 'easy' ? ease * 1.3 : ease;
    intervalDays = Math.max(1, Math.round(intervalDays * mult));
  }

  return { ease, intervalDays, reps, lapses, last: now, due: now + intervalDays * DAY };
}

export const isDue = (card: SrsCard, now = Date.now()): boolean => card.due <= now;

/** Human label for when a card is next due. */
export function dueLabel(card: SrsCard, now = Date.now()): string {
  if (card.last === 0) return 'new';
  const ms = card.due - now;
  if (ms <= 0) return 'due';
  const days = Math.round(ms / DAY);
  if (days >= 1) return `${days}d`;
  const hrs = Math.round(ms / 3_600_000);
  return hrs >= 1 ? `${hrs}h` : 'soon';
}
