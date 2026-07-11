import { describe, expect, it } from 'vitest';
import type { MoveDetail } from '../../lib/analytics/types';
import { buildGraphPoints, buildWinPaths, markerFill } from './EvalGraphPro';

function row(partial: Partial<MoveDetail> & { ply: number }): MoveDetail {
  return {
    side: partial.ply % 2 === 1 ? 'white' : 'black',
    san: 'e4',
    uci: 'e2e4',
    fenBefore: 'fen-before',
    fenAfter: 'fen-after',
    evalBefore: { cp: 0 },
    evalAfter: { cp: 0 },
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
    ...partial,
  };
}

describe('buildGraphPoints', () => {
  it('returns [] for an empty game', () => {
    expect(buildGraphPoints([])).toEqual([]);
  });

  it('yields 2 points for a 1-move game: winBefore then winAfter', () => {
    const pts = buildGraphPoints([row({ ply: 1, winBefore: 50, winAfter: 58 })]);
    expect(pts).toEqual([
      { ply: 0, win: 50 },
      { ply: 1, win: 58 },
    ]);
  });

  it('clamps out-of-range win values to [0, 100]', () => {
    const pts = buildGraphPoints([row({ ply: 1, winBefore: -5, winAfter: 130 })]);
    expect(pts[0]!.win).toBe(0);
    expect(pts[1]!.win).toBe(100);
  });

  it('pins a delivered mate to the mover’s winning edge', () => {
    const white = buildGraphPoints([row({ ply: 1, san: 'Qh7#', isMate: true, winAfter: 97 })]);
    expect(white[1]!.win).toBe(100);
    const black = buildGraphPoints([
      row({ ply: 1, winAfter: 40 }),
      row({ ply: 2, san: 'Qg2#', isMate: true, winAfter: 12 }),
    ]);
    expect(black[2]!.win).toBe(0);
  });
});

describe('buildWinPaths', () => {
  it('is empty for fewer than 2 points or a degenerate size', () => {
    expect(buildWinPaths([], 100, 50)).toEqual({ line: '', area: '' });
    expect(buildWinPaths([{ ply: 0, win: 50 }], 100, 50)).toEqual({ line: '', area: '' });
    expect(buildWinPaths([{ ply: 0, win: 50 }, { ply: 1, win: 50 }], 0, 50)).toEqual({ line: '', area: '' });
  });

  it('maps win% to y (100% at the top) and closes the area along the bottom', () => {
    const pts = [
      { ply: 0, win: 50 },
      { ply: 1, win: 100 },
      { ply: 2, win: 0 },
    ];
    const { line, area } = buildWinPaths(pts, 200, 100);
    expect(line).toBe('M0,50 L100,0 L200,100');
    expect(area).toBe('M0,50 L100,0 L200,100 L200,100 L0,100 Z');
  });

  it('rounds coordinates to 2 decimals', () => {
    const pts = [
      { ply: 0, win: 33.333 },
      { ply: 1, win: 66.667 },
      { ply: 2, win: 50 },
    ];
    const { line } = buildWinPaths(pts, 100, 96);
    expect(line).toBe('M0,64 L50,32 L100,48');
  });
});

describe('markerFill', () => {
  it('marks blunder/mistake/miss/brilliant/great but not quiet grades', () => {
    expect(markerFill(row({ ply: 1, classification: 'blunder' }))).toBeTruthy();
    expect(markerFill(row({ ply: 1, classification: 'mistake' }))).toBeTruthy();
    expect(markerFill(row({ ply: 1, classification: 'miss' }))).toBeTruthy();
    expect(markerFill(row({ ply: 1, classification: 'brilliant' }))).toBeTruthy();
    expect(markerFill(row({ ply: 1, classification: 'great' }))).toBeTruthy();
    expect(markerFill(row({ ply: 1, classification: 'best' }))).toBeNull();
    expect(markerFill(row({ ply: 1, classification: 'good' }))).toBeNull();
    expect(markerFill(row({ ply: 1, classification: 'book' }))).toBeNull();
    expect(markerFill(row({ ply: 1, classification: 'inaccuracy' }))).toBeNull();
  });

  it('never draws a bad-move dot on a delivered mate', () => {
    const mate = row({ ply: 1, san: 'Qh7#', isMate: true, classification: 'blunder' });
    expect(markerFill(mate)).toBeNull();
    const brilliantMate = row({ ply: 1, san: 'Qh7#', isMate: true, classification: 'brilliant' });
    expect(markerFill(brilliantMate)).toBeTruthy();
  });
});
