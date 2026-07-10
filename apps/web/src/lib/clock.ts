/**
 * Injectable clock. All day-rollover / streak / XP-day logic reads time from
 * here instead of calling `Date.now()` / `new Date()` directly, so tests can
 * pin "today" deterministically with `setClock`.
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

/** Today as a UTC `YYYY-MM-DD` day key — the canonical day format for streaks & day logs. */
export function todayStr(): string {
  return new Date(now()).toISOString().slice(0, 10);
}

/** Whole days between two `YYYY-MM-DD` keys (positive when `b` is later). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
