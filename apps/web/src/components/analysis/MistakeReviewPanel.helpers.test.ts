import { describe, expect, it } from 'vitest';
import type { Classification, MoveDetail } from '../../lib/analytics/types';
import {
  MISTAKE_CLASSES,
  isMistakeRow,
  mistakeCounts,
  mistakeRows,
  pvSnippet,
  severityRank,
  shortCause,
  winLost,
} from './MistakeReviewPanel';

const row = (over: Partial<MoveDetail> = {}): MoveDetail => ({
  ply: 5,
  side: 'white',
  san: 'Qxf7',
  uci: 'h5f7',
  fenBefore: 'fen-before',
  fenAfter: 'fen-after',
  evalBefore: { cp: 40 },
  evalAfter: { cp: -320 },
  winBefore: 60,
  winAfter: 20,
  moveAccuracy: 12,
  coachGrade: 'blunder',
  coachExplanation: null,
  evalText: null,
  bestMoveSan: 'Nf3',
  bestMoveUci: 'g1f3',
  bestReplySan: 'Kxf7',
  bestReplyUci: 'e8f7',
  pv: ['Nf3', 'Nf6', 'd4', 'e6', 'c4'],
  secondEvalBefore: null,
  isMate: false,
  isCheck: false,
  isBook: false,
  nodeId: null,
  classification: 'blunder',
  glyph: '??',
  explanation: 'This hangs the queen — Kxf7 just takes it.',
  ...over,
});

describe('severityRank', () => {
  it('orders blunder > miss > mistake > inaccuracy > everything else', () => {
    expect(severityRank('blunder')).toBeGreaterThan(severityRank('miss'));
    expect(severityRank('miss')).toBeGreaterThan(severityRank('mistake'));
    expect(severityRank('mistake')).toBeGreaterThan(severityRank('inaccuracy'));
    for (const cls of ['best', 'good', 'book', 'brilliant', 'great'] as const) {
      expect(severityRank(cls)).toBe(0);
    }
  });
});

describe('isMistakeRow', () => {
  it('accepts the four mistake classes', () => {
    for (const cls of MISTAKE_CLASSES) {
      expect(isMistakeRow(row({ classification: cls }))).toBe(true);
    }
  });

  it('rejects good-tier grades', () => {
    for (const cls of ['best', 'good', 'book', 'brilliant', 'great'] as const) {
      expect(isMistakeRow(row({ classification: cls }))).toBe(false);
    }
  });

  it('never lists a delivered mate, whatever a stale grade says', () => {
    expect(isMistakeRow(row({ san: 'Qh7#', isMate: true, classification: 'blunder' }))).toBe(false);
    expect(isMistakeRow(row({ san: 'Qh7#', isMate: true, classification: 'miss' }))).toBe(false);
  });
});

describe('winLost', () => {
  it('is the mover-POV win% drop for White', () => {
    expect(winLost(row({ side: 'white', winBefore: 80, winAfter: 45 }))).toBe(35);
  });

  it('inverts the White-POV series for Black', () => {
    // Black's chances: 100-40=60 before, 100-70=30 after → 30 lost.
    expect(winLost(row({ side: 'black', ply: 6, winBefore: 40, winAfter: 70 }))).toBe(30);
  });

  it('clamps improvements to 0 and rounds', () => {
    expect(winLost(row({ side: 'white', winBefore: 45, winAfter: 80 }))).toBe(0);
    expect(winLost(row({ side: 'white', winBefore: 50, winAfter: 37.6 }))).toBe(12);
    expect(winLost(row({ side: 'white', winBefore: 50, winAfter: 37.4 }))).toBe(13);
  });
});

const ALL: ReadonlySet<Classification> = new Set(MISTAKE_CLASSES);

const game = (): MoveDetail[] => [
  row({ ply: 1, side: 'white', san: 'e4', classification: 'good' }),
  row({ ply: 2, side: 'black', san: 'e5', classification: 'book' }),
  row({ ply: 3, side: 'white', san: 'Qh5', classification: 'inaccuracy' }),
  row({ ply: 4, side: 'black', san: 'g6', classification: 'mistake' }),
  row({ ply: 5, side: 'white', san: 'Qxf7', classification: 'blunder' }),
  row({ ply: 6, side: 'black', san: 'Kxf7', classification: 'miss' }),
  row({ ply: 7, side: 'white', san: 'Ke2', classification: 'blunder' }),
];

describe('mistakeRows', () => {
  it('filters non-mistakes and sorts by severity, then ply', () => {
    expect(mistakeRows(game(), ALL).map((m) => m.ply)).toEqual([5, 7, 6, 4, 3]);
  });

  it('sorts in game order when asked', () => {
    expect(mistakeRows(game(), ALL, 'both', 'ply').map((m) => m.ply)).toEqual([3, 4, 5, 6, 7]);
  });

  it('applies the class filter', () => {
    const only = new Set<Classification>(['blunder']);
    expect(mistakeRows(game(), only).map((m) => m.ply)).toEqual([5, 7]);
    expect(mistakeRows(game(), new Set())).toEqual([]);
  });

  it('applies the side filter', () => {
    expect(mistakeRows(game(), ALL, 'black').map((m) => m.ply)).toEqual([6, 4]);
    expect(mistakeRows(game(), ALL, 'white').map((m) => m.ply)).toEqual([5, 7, 3]);
  });

  it('drops delivered mates even with a bad grade', () => {
    const moves = [row({ ply: 9, san: 'Qh7#', isMate: true, classification: 'blunder' })];
    expect(mistakeRows(moves, ALL)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const moves = game();
    const before = moves.map((m) => m.ply);
    mistakeRows(moves, ALL);
    expect(moves.map((m) => m.ply)).toEqual(before);
  });
});

describe('mistakeCounts', () => {
  it('tallies each mistake class', () => {
    expect(mistakeCounts(game())).toEqual({ inaccuracy: 1, mistake: 1, blunder: 2, miss: 1 });
  });

  it('respects the side toggle', () => {
    expect(mistakeCounts(game(), 'white')).toEqual({ inaccuracy: 1, mistake: 0, blunder: 2, miss: 0 });
    expect(mistakeCounts(game(), 'black')).toEqual({ inaccuracy: 0, mistake: 1, blunder: 0, miss: 1 });
  });
});

describe('shortCause', () => {
  it('cuts at an em dash', () => {
    expect(shortCause('This leaves the knight hanging — Rxd5 just takes it.')).toBe('This leaves the knight hanging');
  });

  it('keeps only the first sentence', () => {
    expect(shortCause('This allows Qxf7+. The rook falls next.')).toBe('This allows Qxf7+');
  });

  it('cuts at a colon before a line dump', () => {
    expect(shortCause('Nf3 was the move: Nf3 e5 Bc4.')).toBe('Nf3 was the move');
  });

  it('strips the trailing period of a one-sentence cause', () => {
    expect(shortCause('Best move.')).toBe('Best move');
  });

  it('handles the empty string', () => {
    expect(shortCause('')).toBe('');
  });
});

describe('pvSnippet', () => {
  it('takes the first 4 SANs by default', () => {
    expect(pvSnippet(row())).toEqual(['Nf3', 'Nf6', 'd4', 'e6']);
  });

  it('honours a custom max and empty PVs', () => {
    expect(pvSnippet(row(), 2)).toEqual(['Nf3', 'Nf6']);
    expect(pvSnippet(row({ pv: [] }))).toEqual([]);
    expect(pvSnippet(row(), 0)).toEqual([]);
  });
});
