import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateProgress, LIMITS } from './progress-validator.js';

/**
 * Bounds/consistency checks for the `sprints` section (Puzzle Rush / Storm
 * personal bests, synced by apps/web/src/store/sprints.ts). Kept in its own
 * file so it composes cleanly with the main progress-validator suite.
 */

const NOW = Date.now();
const best = (score: number, bestStreak = Math.min(score, 5), at = NOW - 60_000) => ({ score, bestStreak, at });

const sprints = (over: Record<string, unknown> = {}) => ({
  sprints: {
    puzzleRushBest: { timed3: best(12), survival: best(20) },
    puzzleStormBest: best(25),
    ...over,
  },
});

function expectOk(payload: unknown, stored: unknown = null) {
  const res = validateProgress(payload, stored, NOW);
  assert.ok(res.ok, res.ok ? '' : res.error);
  return res;
}
function expectReject(payload: unknown, re: RegExp, stored: unknown = null) {
  const res = validateProgress(payload, stored, NOW);
  assert.ok(!res.ok, 'expected rejection');
  assert.match(res.error, re);
}

describe('sprints section validation', () => {
  it('accepts plausible personal bests and stores them', () => {
    const res = expectOk(sprints());
    const data = res.ok ? (res.data as { sprints: { puzzleRushBest: { survival: { score: number } } } }) : null;
    assert.equal(data?.sprints.puzzleRushBest.survival.score, 20);
  });

  it('rejects scores beyond the plausibility caps', () => {
    expectReject(sprints({ puzzleRushBest: { timed3: best(LIMITS.rushScoreCap + 1, 3) } }), /implausibly large/i);
    expectReject(sprints({ puzzleStormBest: best(LIMITS.stormScoreCap + 50, 3) }), /implausibly large/i);
  });

  it('rejects self-contradictory and malformed entries', () => {
    expectReject(sprints({ puzzleRushBest: { survival: { score: 10, bestStreak: 15, at: NOW } } }), /streak.*exceeds/i);
    expectReject(sprints({ puzzleRushBest: { timed3: 'yes' } }), /malformed/i);
    expectReject(sprints({ puzzleStormBest: { score: -4, bestStreak: 0, at: NOW } }), /malformed/i);
  });

  it('rejects future-dated and pre-app bests', () => {
    expectReject(sprints({ puzzleStormBest: best(10, 3, NOW + 3 * 86_400_000) }), /future-dated/i);
    expectReject(sprints({ puzzleStormBest: best(10, 3, Date.parse('2010-01-01')) }), /predates/i);
  });

  it('merges higher-score-wins against the stored copy (no regressions)', () => {
    const stored = expectOk(sprints());
    const regress = validateProgress(sprints({ puzzleRushBest: { survival: best(7) } }), stored.ok ? stored.data : null, NOW);
    assert.ok(regress.ok);
    const data = regress.ok ? (regress.data as { sprints: { puzzleRushBest: { survival: { score: number }; timed3: { score: number } } } }) : null;
    assert.equal(data?.sprints.puzzleRushBest.survival.score, 20); // kept the stored best
    assert.equal(data?.sprints.puzzleRushBest.timed3.score, 12); // omitted slot preserved
    assert.ok(regress.ok && regress.adjustments.some((a) => a.includes('survival')));
  });

  it('a sprints-only payload still takes the validated sectioned path', () => {
    const res = validateProgress({ sprints: { puzzleRushBest: { timed3: best(999, 3) } } }, null, NOW);
    assert.ok(!res.ok, 'sprints-only payload must not bypass validation');
  });
});
