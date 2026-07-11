import { describe, expect, it } from 'vitest';
import {
  buildStudyPlan,
  isoWeekIdOf,
  LESSONS_FOR_WEAKNESS,
  planProgress,
  ratingBandOf,
  remainingToday,
  type PlanCatalog,
  type PlanOpeningLine,
  type RecentActivity,
  type StudyPlan,
} from './studyPlan';
import { WEAKNESS_KINDS, WEAKNESS_META, type WeaknessEntry, type WeaknessKind, type WeaknessProfile } from './weakness';
import { ALL_LESSONS, LESSONS_BY_ID } from '../learn';
import { MASTER_GAMES, MASTER_GAMES_BY_ID, type GameDifficulty } from '../data/masterGames';

// ---------------------------------------------------------------------------
// Fixtures — FIXED injected clock, hand-built profiles
// ---------------------------------------------------------------------------

/** Local Wednesday 2026-07-08 noon → ISO week 2026-W28 in every timezone. */
const NOW = new Date(2026, 6, 8, 12, 0, 0);

const NO_ACTIVITY: RecentActivity = { completedLessonIds: [], viewedMasterGameIds: [] };

const LINES: PlanOpeningLine[] = [
  { id: 'italian', name: 'Italian Game — Giuoco Pianissimo', side: 'white', eco: 'C50' },
  { id: 'caro-kann', name: 'Caro-Kann Defence', side: 'black', eco: 'B12' },
  { id: 'london', name: 'London System', side: 'white', eco: 'D02' },
];

const CATALOG: PlanCatalog = { lessons: ALL_LESSONS, openingLines: LINES, masterGames: MASTER_GAMES };

function entry(kind: WeaknessKind, score: number, count: number, games: number): WeaknessEntry {
  return { kind, meta: WEAKNESS_META[kind], count, games, score, examples: [], trend: null };
}

function profileWith(opts: Partial<Pick<WeaknessProfile, 'weaknesses' | 'worstPhase' | 'openings' | 'games'>>): WeaknessProfile {
  return {
    games: opts.games ?? 12,
    accuracy: 78,
    weaknesses: opts.weaknesses ?? [],
    phases: [
      { phase: 'opening', accuracy: 85, acpl: 30, moves: 120 },
      { phase: 'middlegame', accuracy: 80, acpl: 45, moves: 200 },
      { phase: 'endgame', accuracy: 75, acpl: 60, moves: 90 },
    ],
    worstPhase: opts.worstPhase ?? null,
    colors: {
      white: { games: 6, wins: 3, losses: 2, draws: 1, accuracy: 80 },
      black: { games: 6, wins: 2, losses: 3, draws: 1, accuracy: 76 },
    },
    openings: opts.openings ?? [],
  };
}

/** Fixture 1 — tactics-weak beginner (misses forks, hangs pieces). */
const TACTICS_WEAK = profileWith({
  weaknesses: [entry('missedForks', 2.1, 9, 6), entry('hangingPieces', 1.4, 6, 5)],
  worstPhase: 'middlegame',
  openings: [{ name: 'Italian Game', eco: 'C50', games: 4, wins: 1, losses: 3, accuracy: 62 }],
});

/** Fixture 2 — endgame-weak intermediate. */
const ENDGAME_WEAK = profileWith({
  weaknesses: [entry('endgameMistakes', 1.8, 7, 5), entry('missedTactics', 0.9, 4, 3)],
  worstPhase: 'endgame',
});

/** Fixture 3 — balanced advanced player (nothing recurring). */
const BALANCED = profileWith({ weaknesses: [], worstPhase: null });

const bandIndex = (d: GameDifficulty) => ['beginner', 'intermediate', 'advanced'].indexOf(d);

function masterPicksOf(plan: StudyPlan) {
  return plan.items.filter((i) => i.kind === 'master');
}

describe('buildStudyPlan — deterministic weekly generation', () => {
  it('tactics-weak beginner: fork quota first, matched lessons, weak opening, beginner-band masters', () => {
    const plan = buildStudyPlan(TACTICS_WEAK, 1150, NO_ACTIVITY, CATALOG, NOW);

    expect(plan.weekId).toBe('2026-W28');
    expect(plan.band).toBe('beginner');
    expect(plan.personalized).toBe(true);
    expect(plan.focus).toEqual(['missedForks', 'hangingPieces']);

    // Full prioritized order is pinned — severity first, variety within rank.
    expect(plan.items.map((i) => i.id)).toEqual([
      'puzzle:missedForks',
      'lesson:skill-forks',
      'puzzle:hangingPieces',
      'lesson:rules-capturing',
      'opening:italian',
      'opening:caro-kann',
      'master:steinitz-bardeleben-1895',
      'master:evergreen-1852',
    ]);

    const forks = plan.items[0]!;
    expect(forks.kind).toBe('puzzle');
    if (forks.kind === 'puzzle') {
      expect(forks.perDay).toBe(4); // severity-scaled: clamp(2 + round(2.1))
      expect(forks.target).toBe(28);
      expect(forks.themes).toEqual(WEAKNESS_META.missedForks.puzzleThemes);
      expect(forks.viaCoach).toBe(true);
    }
    // WHY is tied to the weakness evidence.
    expect(forks.why).toContain('9×');
    expect(forks.why).toContain('12 reviewed games');

    // The shaky opening (62% accuracy in the profile) is drilled, and says why.
    const italian = plan.items.find((i) => i.id === 'opening:italian')!;
    expect(italian.why).toContain('62%');
  });

  it('endgame-weak intermediate: endgame quota + lesson, endgame master game surfaces', () => {
    const plan = buildStudyPlan(ENDGAME_WEAK, 1500, NO_ACTIVITY, CATALOG, NOW);

    expect(plan.band).toBe('intermediate');
    expect(plan.focus).toEqual(['endgameMistakes', 'missedTactics']);
    expect(plan.items.map((i) => i.id)).toEqual([
      'puzzle:endgameMistakes',
      'lesson:skill-endgame-pawns',
      'puzzle:missedTactics',
      'lesson:skill-pins',
      'opening:italian',
      'opening:caro-kann',
      'master:capablanca-tartakower-1924', // THE endgame classic, one band up
      'master:evergreen-1852',
    ]);
    const endgame = plan.items[0]!;
    if (endgame.kind === 'puzzle') expect(endgame.perDay).toBe(4);
  });

  it('balanced advanced: sensible fallback focus, advanced masters', () => {
    const plan = buildStudyPlan(BALANCED, 1900, NO_ACTIVITY, CATALOG, NOW);

    expect(plan.band).toBe('advanced');
    expect(plan.personalized).toBe(false);
    expect(plan.focus).toEqual(['missedTactics', 'hangingPieces']);
    expect(plan.items.map((i) => i.id)).toEqual([
      'puzzle:missedTactics',
      'lesson:skill-pins',
      'puzzle:hangingPieces',
      'lesson:rules-capturing',
      'opening:italian',
      'opening:caro-kann',
      'master:byrne-fischer-1956',
      'master:kasparov-topalov-1999',
    ]);
    for (const m of masterPicksOf(plan)) {
      if (m.kind === 'master') expect(MASTER_GAMES_BY_ID[m.gameId]!.difficulty).toBe('advanced');
    }
  });

  it('same inputs ⇒ byte-identical plans (no randomness, stable ordering)', () => {
    for (const [profile, rating] of [
      [TACTICS_WEAK, 1150],
      [ENDGAME_WEAK, 1500],
      [BALANCED, 1900],
    ] as const) {
      const a = buildStudyPlan(profile, rating, NO_ACTIVITY, CATALOG, NOW);
      const b = buildStudyPlan(profile, rating, NO_ACTIVITY, CATALOG, new Date(NOW.getTime()));
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('adapts: an improved profile shifts the emphasis', () => {
    const before = buildStudyPlan(TACTICS_WEAK, 1150, NO_ACTIVITY, CATALOG, NOW);
    // Fork training paid off — forks fell below a rising endgame leak.
    const improved = profileWith({
      weaknesses: [entry('endgameMistakes', 1.6, 6, 4), entry('missedForks', 0.4, 2, 2)],
      openings: TACTICS_WEAK.openings,
    });
    const after = buildStudyPlan(improved, 1350, NO_ACTIVITY, CATALOG, NOW);

    expect(before.focus[0]).toBe('missedForks');
    expect(after.focus[0]).toBe('endgameMistakes');
    expect(after.items[0]!.id).toBe('puzzle:endgameMistakes');
    expect(after.band).toBe('intermediate'); // rating moved a band up too
    expect(after.items.map((i) => i.id)).not.toEqual(before.items.map((i) => i.id));
  });

  it('skips lessons already completed and games already viewed', () => {
    const plan = buildStudyPlan(
      TACTICS_WEAK,
      1150,
      { completedLessonIds: ['skill-forks'], viewedMasterGameIds: [] },
      CATALOG,
      NOW,
    );
    // Next lesson in the missedForks list replaces the completed one.
    expect(plan.items.some((i) => i.id === 'lesson:tactics-adv-discovered')).toBe(true);
    expect(plan.items.some((i) => i.id === 'lesson:skill-forks')).toBe(false);

    // A viewed master game loses its freshness point and drops behind a peer.
    const balanced = buildStudyPlan(
      BALANCED,
      1900,
      { completedLessonIds: [], viewedMasterGameIds: ['byrne-fischer-1956'] },
      CATALOG,
      NOW,
    );
    expect(masterPicksOf(balanced)[0]!.id).toBe('master:kasparov-topalov-1999');
  });

  it('master picks always exist in the library, 1–2 per plan, difficulty within one band of the rating', () => {
    const ratings: Record<GameDifficulty, number> = { beginner: 1000, intermediate: 1500, advanced: 2000 };
    for (const kind of WEAKNESS_KINDS) {
      for (const [band, rating] of Object.entries(ratings) as [GameDifficulty, number][]) {
        const plan = buildStudyPlan(
          profileWith({ weaknesses: [entry(kind, 2, 6, 4)] }),
          rating,
          NO_ACTIVITY,
          CATALOG,
          NOW,
        );
        const picks = masterPicksOf(plan);
        expect(picks.length).toBeGreaterThanOrEqual(1);
        expect(picks.length).toBeLessThanOrEqual(2);
        for (const p of picks) {
          if (p.kind !== 'master') continue;
          const g = MASTER_GAMES_BY_ID[p.gameId];
          expect(g, `${p.gameId} must exist in the library`).toBeTruthy();
          expect(Math.abs(bandIndex(g!.difficulty) - bandIndex(band))).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('every lesson in the weakness→lesson map exists in the catalogue', () => {
    for (const ids of Object.values(LESSONS_FOR_WEAKNESS)) {
      for (const id of ids) expect(LESSONS_BY_ID[id], `unknown lesson id ${id}`).toBeTruthy();
    }
  });
});

describe('isoWeekIdOf / ratingBandOf', () => {
  it('computes ISO-8601 week ids on the local calendar', () => {
    expect(isoWeekIdOf(NOW)).toBe('2026-W28');
    expect(isoWeekIdOf(new Date(2026, 0, 1))).toBe('2026-W01'); // Thu Jan 1 2026
    expect(isoWeekIdOf(new Date(2026, 6, 12))).toBe('2026-W28'); // Sunday, same week
    expect(isoWeekIdOf(new Date(2026, 6, 13))).toBe('2026-W29'); // Monday rolls over
    expect(isoWeekIdOf(new Date(2027, 0, 1))).toBe('2026-W53'); // ISO year ≠ calendar year
  });

  it('maps ratings to the tactics difficulty bands', () => {
    expect(ratingBandOf(1000)).toBe('beginner');
    expect(ratingBandOf(1299)).toBe('beginner');
    expect(ratingBandOf(1300)).toBe('intermediate');
    expect(ratingBandOf(1799)).toBe('intermediate');
    expect(ratingBandOf(1800)).toBe('advanced');
  });
});

describe('progress arithmetic', () => {
  const plan = buildStudyPlan(TACTICS_WEAK, 1150, NO_ACTIVITY, CATALOG, NOW);

  it('planProgress caps per-item progress at the target and counts finished items', () => {
    const empty = planProgress(plan, {});
    expect(empty.done).toBe(0);
    expect(empty.pct).toBe(0);
    expect(empty.itemsTotal).toBe(plan.items.length);

    const some = planProgress(plan, { 'lesson:skill-forks': 5, 'puzzle:missedForks': 3 });
    expect(some.done).toBe(1 + 3); // lesson capped at its target of 1
    expect(some.itemsDone).toBe(1);

    const all = planProgress(plan, Object.fromEntries(plan.items.map((i) => [i.id, i.target])));
    expect(all.pct).toBe(100);
    expect(all.itemsDone).toBe(plan.items.length);
  });

  it("remainingToday reports today's unmet quotas and open one-shots", () => {
    const day = '2026-07-08';
    const fresh = remainingToday(plan, {}, {}, day);
    expect(fresh.map((r) => r.item.id)).toEqual(plan.items.map((i) => i.id));
    expect(fresh[0]!.remaining).toBe(4); // full fork quota

    const partway = remainingToday(
      plan,
      { 'puzzle:missedForks': 2, 'lesson:skill-forks': 1 },
      { 'puzzle:missedForks': { [day]: 2 } },
      day,
    );
    expect(partway.find((r) => r.item.id === 'puzzle:missedForks')!.remaining).toBe(2);
    expect(partway.some((r) => r.item.id === 'lesson:skill-forks')).toBe(false);

    // Quota met today → the item disappears until tomorrow.
    const met = remainingToday(plan, { 'puzzle:missedForks': 4 }, { 'puzzle:missedForks': { [day]: 4 } }, day);
    expect(met.some((r) => r.item.id === 'puzzle:missedForks')).toBe(false);
  });
});
