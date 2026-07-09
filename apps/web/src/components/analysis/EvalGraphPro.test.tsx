// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MoveDetail, PhaseStats } from '../../lib/analytics/types';
import { EvalGraphPro } from './EvalGraphPro';

function row(partial: Partial<MoveDetail> & { ply: number; san: string }): MoveDetail {
  return {
    side: partial.ply % 2 === 1 ? 'white' : 'black',
    uci: 'e2e4',
    fenBefore: 'fen-before',
    fenAfter: 'fen-after',
    evalBefore: { cp: 0 },
    evalAfter: { cp: 20 },
    winBefore: 50,
    winAfter: 52,
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
    glyph: '',
    explanation: '',
    ...partial,
  };
}

const game = (): MoveDetail[] => [
  row({ ply: 1, san: 'e4', classification: 'book', winAfter: 52 }),
  row({ ply: 2, san: 'e5', classification: 'best', winBefore: 52, winAfter: 50 }),
  row({ ply: 3, san: 'Qh5', classification: 'blunder', glyph: '??', winBefore: 50, winAfter: 30, evalText: '−1.80' }),
  row({ ply: 4, san: 'Nc6', classification: 'great', glyph: '!', winBefore: 30, winAfter: 28 }),
];

const noPhases: PhaseStats[] = [];

function mockRect(el: HTMLElement, width: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 96,
    width,
    height: 96,
    toJSON: () => ({}),
  } as DOMRect);
}

// Vitest runs without globals, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

describe('EvalGraphPro', () => {
  it('renders null with no moves', () => {
    const { container } = render(<EvalGraphPro moves={[]} phases={noPhases} viewPly={0} onSelectPly={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a 1-move game (2 points)', () => {
    const { container } = render(
      <EvalGraphPro moves={[row({ ply: 1, san: 'e4' })]} phases={noPhases} viewPly={1} onSelectPly={() => {}} />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('draws marker dots for loud grades only', () => {
    const { container } = render(<EvalGraphPro moves={game()} phases={noPhases} viewPly={0} onSelectPly={() => {}} />);
    expect(container.querySelectorAll('[data-classification="blunder"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-classification="great"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-classification="best"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-classification="book"]')).toHaveLength(0);
  });

  it('never marks a delivered mate as a blunder', () => {
    const moves = [row({ ply: 1, san: 'e4' }), row({ ply: 2, san: 'Qg2#', isMate: true, classification: 'blunder', glyph: '??' })];
    const { container } = render(<EvalGraphPro moves={moves} phases={noPhases} viewPly={0} onSelectPly={() => {}} />);
    expect(container.querySelectorAll('[data-classification="blunder"]')).toHaveLength(0);
  });

  it('is purely presentational without onSelectPly (no slider semantics, no click affordance)', () => {
    const { container } = render(<EvalGraphPro moves={game()} phases={noPhases} viewPly={4} sparkline />);
    expect(screen.queryByRole('slider')).toBeNull();
    const img = screen.getByRole('img');
    expect(img.getAttribute('title')).toBeNull();
    expect(img.getAttribute('tabindex')).toBeNull();
    expect(img.className).not.toContain('cursor-pointer');
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('jumps plies with arrow keys, clamped to the game', () => {
    const onSelectPly = vi.fn();
    render(<EvalGraphPro moves={game()} phases={noPhases} viewPly={1} onSelectPly={onSelectPly} />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onSelectPly).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onSelectPly).toHaveBeenLastCalledWith(0);
  });

  it('maps a click to the nearest ply', () => {
    const onSelectPly = vi.fn();
    render(<EvalGraphPro moves={game()} phases={noPhases} viewPly={0} onSelectPly={onSelectPly} />);
    const slider = screen.getByRole('slider');
    mockRect(slider, 400);
    fireEvent.click(slider, { clientX: 400 }); // right edge → last ply
    expect(onSelectPly).toHaveBeenLastCalledWith(4);
    fireEvent.click(slider, { clientX: 100 }); // quarter in → ply 1 of 4
    expect(onSelectPly).toHaveBeenLastCalledWith(1);
  });

  it('shows a move tooltip on hover and hides it on leave', () => {
    render(<EvalGraphPro moves={game()} phases={noPhases} viewPly={0} onSelectPly={() => {}} />);
    const slider = screen.getByRole('slider');
    mockRect(slider, 400);
    fireEvent.mouseMove(slider, { clientX: 300 }); // ply 3 = 2. Qh5??
    expect(screen.getByText('Qh5', { exact: false })).toBeTruthy();
    expect(screen.getByText('−1.80')).toBeTruthy();
    fireEvent.mouseLeave(slider);
    expect(screen.queryByText('Qh5', { exact: false })).toBeNull();
  });

  it('labels phase bands when they are wide enough', () => {
    const phases: PhaseStats[] = [
      { phase: 'opening', startPly: 1, endPly: 2, white: { accuracy: 100, acpl: 0, moves: 1 }, black: { accuracy: 100, acpl: 0, moves: 1 } },
      { phase: 'middlegame', startPly: 3, endPly: 4, white: { accuracy: 90, acpl: 40, moves: 1 }, black: { accuracy: 95, acpl: 10, moves: 1 } },
      { phase: 'endgame', startPly: 5, endPly: 4, white: { accuracy: 100, acpl: 0, moves: 0 }, black: { accuracy: 100, acpl: 0, moves: 0 } },
    ];
    render(<EvalGraphPro moves={game()} phases={phases} viewPly={0} onSelectPly={() => {}} />);
    // Fallback width 320 in jsdom → each 2-ply band is 160px wide, above the label cutoff.
    expect(screen.getByText('Opening')).toBeTruthy();
    expect(screen.getByText('Middlegame')).toBeTruthy();
    expect(screen.queryByText('Endgame')).toBeNull(); // empty phase is skipped
  });

  it('renders critical-moment ticks and suppresses extras in sparkline mode', () => {
    const crits = [{ ply: 3, san: 'Qh5', side: 'white' as const, kind: 'blunder' as const, winSwing: 20, description: '' }];
    const { container, rerender } = render(
      <EvalGraphPro moves={game()} phases={noPhases} viewPly={0} onSelectPly={() => {}} criticalMoments={crits} />,
    );
    expect(container.querySelectorAll('[data-critical-ply]')).toHaveLength(1);
    rerender(
      <EvalGraphPro moves={game()} phases={noPhases} viewPly={0} onSelectPly={() => {}} criticalMoments={crits} sparkline />,
    );
    expect(container.querySelectorAll('[data-critical-ply]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-classification]')).toHaveLength(0);
  });
});
