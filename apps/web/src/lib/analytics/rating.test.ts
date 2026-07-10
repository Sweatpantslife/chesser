import { describe, expect, it } from 'vitest';
import { estimatePerformanceRating } from './rating';

describe('estimatePerformanceRating', () => {
  it('matches the documented formula exactly (deterministic)', () => {
    // 0.6·(3000 − 9·80) + 0.4·(45·85 − 1700) = 1368 + 850 = 2218
    expect(estimatePerformanceRating({ accuracy: 85, acpl: 80, moves: 40 })).toBe(2218);
    // 0.6·(3000 − 9·150) + 0.4·(45·60 − 1700) = 990 + 400 = 1390
    expect(estimatePerformanceRating({ accuracy: 60, acpl: 150, moves: 40 })).toBe(1390);
    // 0.6·(3000 − 9·100) + 0.4·(45·50 − 1700) = 1260 + 220 = 1480
    expect(estimatePerformanceRating({ accuracy: 50, acpl: 100, moves: 40 })).toBe(1480);
  });

  it('anchor: near-perfect play rates 2700+', () => {
    const rating = estimatePerformanceRating({ accuracy: 99, acpl: 5, moves: 40 });
    expect(rating).toBe(2875);
    expect(rating).toBeGreaterThanOrEqual(2700);
  });

  it('anchor: very poor play rates sub-1000', () => {
    const rating = estimatePerformanceRating({ accuracy: 45, acpl: 250, moves: 40 });
    expect(rating).toBe(580);
    expect(rating).toBeLessThan(1000);
  });

  it('is monotonic: lower ACPL never lowers the rating', () => {
    let prev = -Infinity;
    for (let acpl = 300; acpl >= 0; acpl -= 5) {
      const rating = estimatePerformanceRating({ accuracy: 85, acpl, moves: 40 });
      expect(rating).toBeGreaterThanOrEqual(prev);
      prev = rating;
    }
    // Strict within the unclamped range.
    expect(estimatePerformanceRating({ accuracy: 85, acpl: 50, moves: 40 })).toBeGreaterThan(
      estimatePerformanceRating({ accuracy: 85, acpl: 60, moves: 40 }),
    );
  });

  it('is monotonic: higher accuracy never lowers the rating', () => {
    let prev = -Infinity;
    for (let accuracy = 0; accuracy <= 100; accuracy += 5) {
      const rating = estimatePerformanceRating({ accuracy, acpl: 80, moves: 40 });
      expect(rating).toBeGreaterThanOrEqual(prev);
      prev = rating;
    }
    expect(estimatePerformanceRating({ accuracy: 90, acpl: 80, moves: 40 })).toBeGreaterThan(
      estimatePerformanceRating({ accuracy: 80, acpl: 80, moves: 40 }),
    );
  });

  it('clamps to [400, 3200]', () => {
    expect(estimatePerformanceRating({ accuracy: 0, acpl: 400, moves: 40 })).toBe(400);
    // Ceiling is unreachable with in-domain inputs (acc 100 / acpl 0 → 2920);
    // it guards against out-of-domain aggregates.
    expect(estimatePerformanceRating({ accuracy: 100, acpl: 0, moves: 40 })).toBe(2920);
    expect(estimatePerformanceRating({ accuracy: 100, acpl: -200, moves: 40 })).toBe(3200);
  });

  it('damps games under 12 moves 50/50 toward 1500', () => {
    // Strong short game pulled DOWN toward 1500…
    expect(estimatePerformanceRating({ accuracy: 99, acpl: 5, moves: 12 })).toBe(2875);
    expect(estimatePerformanceRating({ accuracy: 99, acpl: 5, moves: 11 })).toBe(2188);
    // …and a weak short game pulled UP toward 1500.
    expect(estimatePerformanceRating({ accuracy: 45, acpl: 250, moves: 6 })).toBe(1040);
    // Damping preserves monotonicity within short games too.
    expect(estimatePerformanceRating({ accuracy: 99, acpl: 5, moves: 11 })).toBeGreaterThan(
      estimatePerformanceRating({ accuracy: 60, acpl: 150, moves: 11 }),
    );
  });
});
