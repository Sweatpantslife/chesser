import { describe, expect, it } from 'vitest';
import { whiteWinPercent } from './format';

describe('whiteWinPercent', () => {
  it('maps a level position to 50%', () => {
    expect(whiteWinPercent({ kind: 'cp', value: 0 })).toBe(50);
    expect(whiteWinPercent(null)).toBe(50);
  });

  it('maps mates to the extremes (White POV)', () => {
    expect(whiteWinPercent({ kind: 'mate', value: 3 })).toBe(100);
    expect(whiteWinPercent({ kind: 'mate', value: -3 })).toBe(0);
  });

  it('is monotonic in centipawns', () => {
    const w1 = whiteWinPercent({ kind: 'cp', value: 100 });
    const w3 = whiteWinPercent({ kind: 'cp', value: 300 });
    expect(w1).toBeGreaterThan(50);
    expect(w3).toBeGreaterThan(w1);
  });
});
