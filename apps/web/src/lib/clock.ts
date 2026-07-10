/**
 * Injectable clock. All day-rollover / streak / XP-day logic reads time from
 * here instead of calling `Date.now()` / `new Date()` directly, so tests can
 * pin "today" deterministically with `setClock`.
 *
 * Day convention: `todayStr()` keys days on the user's LOCAL calendar, so
 * streaks/quests/goals roll over at local midnight (a 5 pm session and a 9 pm
 * session are the same "day" wherever you live). Everything the gamification
 * layer owns (streak store, quest slate, XP day logs, daily puzzle seed) flows
 * through this one function, so it all flips together. Pre-existing stores
 * that persisted UTC day keys before this layer existed (SRS progress
 * history, ratings day logs, coordinate day bests) are untouched — the two
 * conventions only meet in display-time unions (e.g. the active-days badge
 * count), where a one-day skew near midnight is cosmetic, never corrupting.
 * Consumers must tolerate a non-monotonic day key (it can step back one day
 * when the app updates or the user travels west): streak touches treat an
 * older "today" as already-counted, quests re-roll, day logs just open a new
 * bucket.
 */

export type Clock = () => number; // epoch ms

const realClock: Clock = () => Date.now();
let clock: Clock = realClock;

/** Override the clock (tests). Pass `null` to restore the real clock. */
export function setClock(c: Clock | null): void {
  clock = c ?? realClock;
}

/** Current epoch ms according to the (possibly injected) clock. */
export function now(): number {
  return clock();
}

/** Today as a LOCAL-calendar `YYYY-MM-DD` day key — the canonical day format
 *  for streaks & day logs. Rolls over at local midnight, not UTC. */
export function todayStr(): string {
  const d = new Date(now());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Whole days between two `YYYY-MM-DD` keys (positive when `b` is later). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
