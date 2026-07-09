import { describe, expect, it } from 'vitest';
import type { MoveDetail } from '../../lib/analytics/types';
import { bestMoveArrow, displayClassification, formatEval } from './MoveDetailPanel';

const row = (over: Partial<MoveDetail> = {}): MoveDetail => ({
  ply: 3,
  side: 'white',
  san: 'Nf3',
  uci: 'g1f3',
  fenBefore: 'fen-before',
  fenAfter: 'fen-after',
  evalBefore: { cp: 20 },
  evalAfter: { cp: 35 },
  winBefore: 52,
  winAfter: 54,
  moveAccuracy: 98,
  coachGrade: 'best',
  coachExplanation: null,
  evalText: null,
  bestMoveSan: 'Nf3',
  bestMoveUci: 'g1f3',
  bestReplySan: null,
  bestReplyUci: null,
  pv: ['Nf3', 'Nc6', 'Bb5'],
  secondEvalBefore: null,
  isMate: false,
  isCheck: false,
  isBook: false,
  nodeId: 'n3',
  classification: 'best',
  glyph: '✓',
  explanation: 'Best move.',
  ...over,
});

describe('formatEval', () => {
  it('renders — for a missing eval', () => {
    expect(formatEval(null)).toBe('—');
  });

  it('renders centipawns as signed pawns with 2 decimals', () => {
    expect(formatEval({ cp: 35 })).toBe('+0.35');
    expect(formatEval({ cp: -120 })).toBe('−1.20'); // formatScore uses U+2212
    expect(formatEval({ cp: 0 })).toBe('0.00');
  });

  it('renders mate as #N with the White-POV sign', () => {
    expect(formatEval({ mate: 3 })).toBe('#3');
    expect(formatEval({ mate: -2 })).toBe('#-2');
    expect(formatEval({ mate: 0 })).toBe('#');
  });
});

describe('bestMoveArrow', () => {
  it('splits a UCI move into from/to squares', () => {
    expect(bestMoveArrow('e2e4')).toEqual({ from: 'e2', to: 'e4' });
    expect(bestMoveArrow('e7e8q')).toEqual({ from: 'e7', to: 'e8' }); // promotion suffix dropped
  });

  it('returns null for missing or malformed input', () => {
    expect(bestMoveArrow(null)).toBeNull();
    expect(bestMoveArrow(undefined)).toBeNull();
    expect(bestMoveArrow('')).toBeNull();
    expect(bestMoveArrow('e2')).toBeNull();
  });
});

describe('displayClassification', () => {
  it('passes non-mate grades through unchanged', () => {
    expect(displayClassification(row({ classification: 'blunder' }))).toBe('blunder');
    expect(displayClassification(row({ classification: 'book' }))).toBe('book');
  });

  it('never shows a delivered mate as a bad move', () => {
    for (const cls of ['blunder', 'mistake', 'inaccuracy', 'miss', 'good', 'book', 'best'] as const) {
      expect(displayClassification(row({ san: 'Qh7#', isMate: true, classification: cls }))).toBe('best');
    }
  });

  it('keeps brilliant/great on a delivered mate', () => {
    expect(displayClassification(row({ san: 'Qh7#', isMate: true, classification: 'brilliant' }))).toBe('brilliant');
    expect(displayClassification(row({ san: 'Qh7#', isMate: true, classification: 'great' }))).toBe('great');
  });
});
