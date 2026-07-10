import { describe, expect, it } from 'vitest';
import { dueLabel, isDue, newCard, review } from './srs';

// Deterministic clock: `now` is injected into every call — no Date.now() here.
const T0 = Date.UTC(2026, 6, 1, 12);
const DAY = 86_400_000;

describe('srs scheduler (SM-2 style, injected clock)', () => {
  it('a new card is due immediately and labelled "new"', () => {
    const c = newCard(T0);
    expect(isDue(c, T0)).toBe(true);
    expect(dueLabel(c, T0)).toBe('new');
    expect(c.reps).toBe(0);
    expect(c.ease).toBe(2.5);
  });

  it('intervals grow on consecutive successes: 1d → 3d → interval×ease', () => {
    let c = newCard(T0);
    c = review(c, 'good', T0);
    expect(c.intervalDays).toBe(1);
    expect(c.due).toBe(T0 + DAY);
    expect(isDue(c, T0 + DAY - 1)).toBe(false);
    expect(isDue(c, T0 + DAY)).toBe(true);

    c = review(c, 'good', T0 + DAY);
    expect(c.intervalDays).toBe(3);

    c = review(c, 'good', T0 + 4 * DAY);
    // third success: round(3 × ease 2.5) = 8, scheduled from the review time
    expect(c.intervalDays).toBe(8);
    expect(c.due).toBe(T0 + 4 * DAY + 8 * DAY);
    expect(c.reps).toBe(3);
    expect(c.lapses).toBe(0);
  });

  it('failure resets the run: interval back to 0, quick re-show, lapse counted, ease drops', () => {
    let c = newCard(T0);
    c = review(c, 'good', T0);
    c = review(c, 'good', T0 + DAY);
    const easeBefore = c.ease;

    c = review(c, 'again', T0 + 2 * DAY);
    expect(c.reps).toBe(0);
    expect(c.intervalDays).toBe(0);
    expect(c.lapses).toBe(1);
    expect(c.ease).toBeCloseTo(easeBefore - 0.2);
    // re-shown within the session, not tomorrow
    expect(c.due).toBe(T0 + 2 * DAY + 60_000);

    // and the next success starts the ladder again at 1 day
    c = review(c, 'good', T0 + 2 * DAY);
    expect(c.intervalDays).toBe(1);
  });

  it('easy grows faster than good; hard slower — and ease shifts accordingly', () => {
    let easy = newCard(T0);
    let good = newCard(T0);
    let hard = newCard(T0);
    for (const [i, t] of [T0, T0 + 2 * DAY, T0 + 8 * DAY].entries()) {
      easy = review(easy, 'easy', t);
      good = review(good, 'good', t);
      hard = review(hard, 'hard', t);
      if (i === 0) {
        expect(easy.intervalDays).toBe(2);
        expect(good.intervalDays).toBe(1);
        expect(hard.intervalDays).toBe(1);
      }
    }
    expect(easy.intervalDays).toBeGreaterThan(good.intervalDays);
    expect(good.intervalDays).toBeGreaterThan(hard.intervalDays);
    expect(easy.ease).toBeGreaterThan(2.5);
    expect(hard.ease).toBeLessThan(2.5);
  });

  it('ease never drops below the 1.3 floor', () => {
    let c = newCard(T0);
    for (let i = 0; i < 20; i++) c = review(c, 'again', T0 + i * 60_000);
    expect(c.ease).toBeCloseTo(1.3);
    expect(c.lapses).toBe(20);
  });

  it('dueLabel reflects schedule state', () => {
    let c = newCard(T0);
    c = review(c, 'good', T0);
    expect(dueLabel(c, T0)).toBe('1d');
    expect(dueLabel(c, T0 + DAY)).toBe('due');
    c = review(c, 'good', T0 + DAY); // 3d
    expect(dueLabel(c, T0 + DAY + 2 * DAY)).toBe('1d');
    expect(dueLabel(c, T0 + DAY + 3 * DAY - 30 * 60_000)).toBe('1h');
  });
});
