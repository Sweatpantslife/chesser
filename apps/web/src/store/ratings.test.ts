import { beforeEach, describe, expect, it } from 'vitest';
import { PROVISIONAL_RD, useRatings } from './ratings';

describe('ratings store — provisional peaks', () => {
  beforeEach(() => {
    useRatings.getState().reset();
  });

  it('one lucky win at a provisional rating does not register a glicko peak', () => {
    // The day-one repro: a fresh 1200±700 puzzles rating beats a 2120 daily puzzle.
    expect(useRatings.getState().categories.puzzles.glickoPeak).toBe(1200);
    useRatings.getState().record('puzzles', 2120, 'win');
    const c = useRatings.getState().categories.puzzles;
    expect(c.glicko.rating).toBeGreaterThan(1600); // the live rating does spike…
    expect(c.glicko.rd).toBeGreaterThan(PROVISIONAL_RD); // …but it is still provisional…
    expect(c.glickoPeak).toBe(1200); // …so the peak (which fuels the rating badges) stays put
    expect(c.eloPeak).toBeLessThan(1300); // Elo's capped K never spiked in the first place
  });

  it('an established rating (rd at or below the provisional cutoff) tracks peaks again', () => {
    // Grind the deviation down with evenly-matched results, ending on a win.
    for (let i = 0; i < 40; i++) {
      const rating = useRatings.getState().categories.puzzles.glicko.rating;
      useRatings.getState().record('puzzles', Math.round(rating), i === 39 || i % 2 === 0 ? 'win' : 'loss');
    }
    const c = useRatings.getState().categories.puzzles;
    expect(c.glicko.rd).toBeLessThanOrEqual(PROVISIONAL_RD);
    expect(c.glickoPeak).toBeGreaterThanOrEqual(Math.floor(c.glicko.rating));
    expect(c.glickoPeak).toBeGreaterThan(1200);
  });
});
