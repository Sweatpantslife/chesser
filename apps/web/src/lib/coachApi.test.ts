import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachMoveFacts } from '@chesser/shared';
import { _resetCoachApiForTests, buildWeaknessFacts, explainWithCoach, skillLevelFromRating } from './coachApi';
import type { WeaknessEntry, WeaknessProfile } from './weakness';
import { WEAKNESS_META } from './weakness';

function moveFacts(san = 'Qxb7'): CoachMoveFacts {
  return {
    kind: 'move',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    side: 'white',
    moveLabel: '14.',
    san,
    classification: 'blunder',
    evalBefore: '+1.20',
    evalAfter: '-2.35',
    winBefore: 62.1,
    winAfter: 21.4,
    bestMoveSan: 'Nf3',
    pv: ['Nf3'],
    bestReplySan: 'Rb8',
    phase: 'middlegame',
    isCheck: false,
    isMate: false,
    ruleBasedText: 'Blunder.',
    weaknessThemes: [],
  };
}

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe('explainWithCoach', () => {
  beforeEach(() => _resetCoachApiForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('posts the facts and memoizes: identical payloads fetch once', async () => {
    const fetchMock = vi.fn(async () => ok({ configured: true, explanation: 'Nice.', model: 'm', cached: false }));
    vi.stubGlobal('fetch', fetchMock);

    const a = await explainWithCoach(moveFacts(), 'beginner');
    const b = await explainWithCoach(moveFacts(), 'beginner');
    expect(a).toBe('Nice.');
    expect(b).toBe('Nice.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('/api/coach/explain');
    expect(JSON.parse(String(init.body))).toEqual({ facts: moveFacts(), level: 'beginner' });

    // Different facts → a second fetch.
    await explainWithCoach(moveFacts('a3'), 'beginner');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves null and stops asking once the server reports no key', async () => {
    const fetchMock = vi.fn(async () => ok({ configured: false, reason: 'no-key' }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await explainWithCoach(moveFacts())).toBeNull();
    expect(await explainWithCoach(moveFacts('a3'))).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // latched after the first answer
  });

  it('resolves null on network errors and HTTP failures — never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await explainWithCoach(moveFacts())).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as Response));
    expect(await explainWithCoach(moveFacts())).toBeNull();
  });

  it('does not memoize transient failures (a retry re-fetches)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as Response)
      .mockResolvedValueOnce(ok({ configured: true, explanation: 'Second try.', model: 'm', cached: false }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await explainWithCoach(moveFacts())).toBeNull();
    expect(await explainWithCoach(moveFacts())).toBe('Second try.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('skillLevelFromRating', () => {
  it('buckets ratings into coach voice levels', () => {
    expect(skillLevelFromRating(900)).toBe('beginner');
    expect(skillLevelFromRating(1500)).toBe('intermediate');
    expect(skillLevelFromRating(2100)).toBe('advanced');
  });
});

describe('buildWeaknessFacts', () => {
  it('compacts a profile entry into engine-truth facts', () => {
    const entry: WeaknessEntry = {
      kind: 'hangingPieces',
      meta: WEAKNESS_META.hangingPieces,
      count: 5,
      games: 3,
      score: 1.2,
      trend: -0.5,
      examples: [
        {
          ply: 27,
          san: 'Qxb7',
          moveLabel: '14.',
          fenBefore: 'k7/8/8/8/8/8/8/K7 w - - 0 1',
          bestSan: 'Nf3',
          bestUci: 'g1f3',
          winDrop: 38.2,
          severity: 'blunder',
          phase: 'middlegame',
          kinds: ['hangingPieces'],
          gameKey: 'g1',
          gameCreatedAt: 1,
          playerColor: 'white',
          openingName: 'Sicilian Defense',
          result: 'loss',
        },
      ],
    };
    const profile = { games: 12, accuracy: 84.2, worstPhase: 'middlegame' } as WeaknessProfile;

    const facts = buildWeaknessFacts(entry, profile);
    expect(facts.kind).toBe('weakness');
    expect(facts.label).toBe('Hanging pieces');
    expect(facts.trend).toBe('improving');
    expect(facts.totalGames).toBe(12);
    expect(facts.examples[0]).toContain('Qxb7');
    expect(facts.worstPhase).toBe('middlegame');
  });
});
