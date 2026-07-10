import { afterEach, describe, expect, it } from 'vitest';
import { dayDiff, now, setClock, todayStr } from './clock';

// new Date(y, m, d, hh, mm) builds LOCAL wall-clock times, so these tests are
// deterministic in any timezone: they assert that todayStr flips exactly at
// local midnight, whatever UTC instant that happens to be.
const localMs = (y: number, m: number, d: number, hh = 12, mm = 0) => new Date(y, m, d, hh, mm).getTime();

describe('clock', () => {
  afterEach(() => setClock(null));

  it('now() follows the injected clock', () => {
    setClock(() => 12345);
    expect(now()).toBe(12345);
  });

  it('todayStr uses the LOCAL calendar date, zero-padded', () => {
    setClock(() => localMs(2026, 0, 5)); // Jan 5, noon local
    expect(todayStr()).toBe('2026-01-05');
    setClock(() => localMs(2026, 10, 30));
    expect(todayStr()).toBe('2026-11-30');
  });

  it('rolls over exactly at local midnight, not UTC midnight', () => {
    setClock(() => localMs(2026, 6, 1, 23, 59));
    expect(todayStr()).toBe('2026-07-01');
    setClock(() => localMs(2026, 6, 2, 0, 1));
    expect(todayStr()).toBe('2026-07-02');
  });

  it('dayDiff is pure calendar-label math (independent of how keys were minted)', () => {
    expect(dayDiff('2026-07-01', '2026-07-02')).toBe(1);
    expect(dayDiff('2026-07-01', '2026-07-01')).toBe(0);
    expect(dayDiff('2026-07-02', '2026-07-01')).toBe(-1);
    expect(dayDiff('2026-06-28', '2026-07-04')).toBe(6);
    expect(dayDiff('2025-12-31', '2026-01-01')).toBe(1);
  });
});
