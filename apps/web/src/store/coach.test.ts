import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisReport, MoveDetail, PhaseStats, PlayerSummary } from '../lib/analytics/types';

// ---------------------------------------------------------------------------
// Fixtures — the smallest report that survives deserializeReport + digestReport
// ---------------------------------------------------------------------------

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const move = (): MoveDetail => ({
  ply: 1,
  side: 'white',
  san: 'e4',
  uci: 'e2e4',
  fenBefore: START,
  fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  evalBefore: { cp: 20 },
  evalAfter: { cp: 20 },
  winBefore: 50,
  winAfter: 50,
  moveAccuracy: 100,
  coachGrade: null,
  coachExplanation: null,
  evalText: null,
  bestMoveSan: null,
  bestMoveUci: null,
  bestReplySan: null,
  bestReplyUci: null,
  pv: [],
  secondEvalBefore: null,
  isMate: false,
  isCheck: false,
  isBook: false,
  nodeId: null,
  classification: 'good',
  glyph: '⋯',
  explanation: '',
});

const summary = (): PlayerSummary => ({
  accuracy: 85,
  acpl: 40,
  moves: 20,
  counts: { brilliant: 0, great: 0, best: 8, good: 8, book: 2, inaccuracy: 1, mistake: 1, blunder: 0, miss: 0 },
});

const phases = (): PhaseStats[] => [
  { phase: 'opening', startPly: 1, endPly: 8, white: { accuracy: 92, acpl: 30, moves: 4 }, black: { accuracy: 90, acpl: 30, moves: 4 } },
];

const report = (gameKey: string): AnalysisReport => ({
  version: 1,
  createdAt: 1_000_000,
  gameKey,
  meta: {
    gameNo: 1,
    startFen: START,
    result: '1-0',
    playerColor: 'white',
    engine: { multipv: 2, movetimeMs: 0, depth: 18 },
  },
  white: summary(),
  black: summary(),
  opening: { eco: 'B20', name: 'Sicilian Defense', leftTheoryAtPly: 6 },
  phases: phases(),
  criticalMoments: [],
  estimatedPerformanceRating: { white: 1500, black: 1400 },
  moves: [move()],
});

// ---------------------------------------------------------------------------
// A Storage stub whose key order reshuffles when a NEW key is inserted — the
// WHATWG spec only guarantees key(i) order "as long as the keys do not
// change", and hash-backed browser storage really does reorder on insert.
// ---------------------------------------------------------------------------

function reorderOnInsertStorage(): Storage {
  const map = new Map<string, string>();
  let order: string[] = [];
  return {
    get length() {
      return order.length;
    },
    key(i: number) {
      return order[i] ?? null;
    },
    getItem(k: string) {
      return map.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (!map.has(k)) {
        // Rehash: existing keys reorder, the new key lands at the end.
        order = [...order].reverse();
        order.push(k);
      }
      map.set(k, v);
    },
    removeItem(k: string) {
      map.delete(k);
      order = order.filter((x) => x !== k);
    },
    clear() {
      map.clear();
      order = [];
    },
  } as Storage;
}

describe('bootstrapFromReportCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('ingests every cached report even when persisting the store reorders keys mid-scan', async () => {
    const storage = reorderOnInsertStorage();
    storage.setItem('chesser-report:carv1:aaaa0001', JSON.stringify(report('carv1:aaaa0001')));
    storage.setItem('chesser-report:carv1:bbbb0002', JSON.stringify(report('carv1:bbbb0002')));
    // The scan reads globalThis.localStorage; zustand persist's default
    // storage getter reads window.localStorage — stub both to the same fake.
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });

    // Fresh module: resets the once-per-session bootstrap flag and lets the
    // persist middleware bind to the stubbed storage.
    vi.resetModules();
    const { bootstrapFromReportCache, useCoach } = await import('./coach');
    bootstrapFromReportCache();

    // The first ingest writes the persisted 'chesser-coach' key, reordering
    // the storage — the second report must still be found and digested.
    expect(Object.keys(useCoach.getState().games).sort()).toEqual(['carv1:aaaa0001', 'carv1:bbbb0002']);
    expect(storage.getItem('chesser-coach')).toBeTruthy();
  });
});
