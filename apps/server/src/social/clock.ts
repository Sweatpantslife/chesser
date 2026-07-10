/**
 * Injectable server clock for the social/leaderboard layer.
 *
 * All time-dependent logic in this module tree (weekly board keys, submission
 * rate limits, streak recency on public profiles) reads time through `now()`
 * instead of calling `Date.now()` directly, so tests can pin time
 * deterministically with `setClock` — the same convention the web client uses
 * in apps/web/src/lib/clock.ts.
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
