import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, isoWeekKey, isWeekKey } from './week.js';

const ms = (iso: string) => Date.parse(iso);

describe('isoWeekKey', () => {
  it('matches known ISO-8601 fixtures', () => {
    // Canonical tricky dates from the ISO week-date system.
    assert.equal(isoWeekKey(ms('2026-07-10T12:00:00Z')), '2026-W28'); // a plain mid-year Friday
    assert.equal(isoWeekKey(ms('2026-01-01T00:00:00Z')), '2026-W01'); // Thu → week 1 of 2026
    assert.equal(isoWeekKey(ms('2027-01-01T00:00:00Z')), '2026-W53'); // Fri → still 2026's last week
    assert.equal(isoWeekKey(ms('2026-12-28T00:00:00Z')), '2026-W53'); // Monday of week 53
    assert.equal(isoWeekKey(ms('2025-12-29T00:00:00Z')), '2026-W01'); // Monday belongs to next year's W01
    assert.equal(isoWeekKey(ms('2021-01-01T00:00:00Z')), '2020-W53'); // Fri of the famous 53-week 2020
  });

  it('rolls over at Monday 00:00 UTC, deterministically', () => {
    const sundayNight = ms('2026-07-12T23:59:59Z');
    const mondayMorning = ms('2026-07-13T00:00:00Z');
    assert.equal(isoWeekKey(sundayNight), '2026-W28');
    assert.equal(isoWeekKey(mondayMorning), '2026-W29');
    // Same instant → same key, always (pure function of its input).
    assert.equal(isoWeekKey(sundayNight), isoWeekKey(sundayNight));
  });

  it('produces keys that sort chronologically and validate', () => {
    const keys = [ms('2025-12-29T00:00:00Z'), ms('2026-03-01T00:00:00Z'), ms('2026-07-10T00:00:00Z')].map(isoWeekKey);
    assert.deepEqual([...keys].sort(), keys);
    for (const k of keys) assert.ok(isWeekKey(k), k);
    assert.ok(!isWeekKey('2026-13'));
    assert.ok(!isWeekKey(42));
  });

  it('exposes the numeric week too', () => {
    assert.deepEqual(isoWeek(ms('2026-07-10T12:00:00Z')), { year: 2026, week: 28 });
  });
});
