// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MoveDetail } from '../../lib/analytics/types';
import { MistakeReviewPanel } from './MistakeReviewPanel';

const row = (over: Partial<MoveDetail> = {}): MoveDetail => ({
  ply: 1,
  side: 'white',
  san: 'e4',
  uci: 'e2e4',
  fenBefore: 'fen-before',
  fenAfter: 'fen-after',
  evalBefore: { cp: 20 },
  evalAfter: { cp: 25 },
  winBefore: 52,
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
  explanation: 'A solid move.',
  ...over,
});

/** 6-ply fixture: one of each mistake class plus two clean moves. */
const game = (): MoveDetail[] => [
  row({ ply: 1, san: 'e4', classification: 'good' }),
  row({ ply: 2, side: 'black', san: 'e5', classification: 'book' }),
  row({
    ply: 3,
    san: 'Qh5',
    classification: 'inaccuracy',
    winBefore: 55,
    winAfter: 45,
    explanation: 'Slightly loose — the queen gets kicked around.',
  }),
  row({
    ply: 4,
    side: 'black',
    san: 'g6',
    classification: 'mistake',
    winBefore: 45,
    winAfter: 65,
    explanation: 'This weakens the kingside.',
  }),
  row({
    ply: 5,
    san: 'Qxf7',
    classification: 'blunder',
    winBefore: 60,
    winAfter: 20,
    bestMoveSan: 'Nf3',
    bestMoveUci: 'g1f3',
    bestReplySan: 'Kxf7',
    bestReplyUci: 'e8f7',
    pv: ['Nf3', 'Nf6', 'd4', 'e6', 'c4'],
    explanation: 'This hangs the queen — Kxf7 just takes it.',
  }),
  row({
    ply: 6,
    side: 'black',
    san: 'Kxf7',
    classification: 'miss',
    winBefore: 80,
    winAfter: 55,
    explanation: 'You had mate in 2 starting with Qf2+.',
  }),
];

const noop = () => {};

// Vitest runs without globals, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

describe('MistakeReviewPanel', () => {
  it('shows the clean-game empty state when nothing went wrong', () => {
    const moves = [row({ ply: 1 }), row({ ply: 2, side: 'black', classification: 'best' })];
    const { container } = render(<MistakeReviewPanel moves={moves} viewPly={0} onSelectPly={noop} onPractice={noop} />);
    expect(screen.getByText('No mistakes — clean game!')).toBeTruthy();
    expect(container.querySelector('[data-chip]')).toBeNull();
  });

  it('treats a delivered mate with a stale bad grade as clean', () => {
    const moves = [row({ ply: 1, san: 'Qh7#', isMate: true, classification: 'blunder' })];
    render(<MistakeReviewPanel moves={moves} viewPly={0} onSelectPly={noop} onPractice={noop} />);
    expect(screen.getByText('No mistakes — clean game!')).toBeTruthy();
  });

  it('lists mistakes worst-first and toggles to game order', () => {
    const { container } = render(<MistakeReviewPanel moves={game()} viewPly={0} onSelectPly={noop} onPractice={noop} />);
    const plies = () => Array.from(container.querySelectorAll('[data-row-ply]')).map((el) => el.getAttribute('data-row-ply'));
    expect(plies()).toEqual(['5', '6', '4', '3']);
    fireEvent.click(container.querySelector('[data-sort]') as HTMLButtonElement);
    expect(plies()).toEqual(['3', '4', '5', '6']);
  });

  it('shows move label, glyph, win% lost, best line and the punishing reply', () => {
    render(<MistakeReviewPanel moves={game()} viewPly={0} onSelectPly={noop} onPractice={noop} />);
    expect(screen.getByText('3. Qxf7')).toBeTruthy(); // ply 5 = White's 3rd move
    expect(screen.getByText('−40%')).toBeTruthy();
    expect(screen.getByText('This hangs the queen')).toBeTruthy(); // first clause only
    expect(screen.getByText('Nf3 Nf6 d4 e6')).toBeTruthy(); // 4-SAN PV snippet
    expect(screen.getByText('Kxf7')).toBeTruthy(); // punishing reply
  });

  it('jumps and practices with the row ply', () => {
    const onSelectPly = vi.fn();
    const onPractice = vi.fn();
    const { container } = render(
      <MistakeReviewPanel moves={game()} viewPly={0} onSelectPly={onSelectPly} onPractice={onPractice} />,
    );
    fireEvent.click(container.querySelector('[data-jump="5"]') as HTMLButtonElement);
    expect(onSelectPly).toHaveBeenCalledWith(5);
    fireEvent.click(container.querySelector('[data-practice="6"]') as HTMLButtonElement);
    expect(onPractice).toHaveBeenCalledWith(6);
  });

  it('filters by class chips and reports an all-filtered state', () => {
    const { container } = render(<MistakeReviewPanel moves={game()} viewPly={0} onSelectPly={noop} onPractice={noop} />);
    fireEvent.click(container.querySelector('[data-chip="blunder"]') as HTMLButtonElement);
    expect(container.querySelector('[data-row-ply="5"]')).toBeNull();
    expect(container.querySelector('[data-row-ply="6"]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-chip="blunder"]') as HTMLButtonElement); // back on
    expect(container.querySelector('[data-row-ply="5"]')).toBeTruthy();
    for (const cls of ['inaccuracy', 'mistake', 'blunder', 'miss']) {
      fireEvent.click(container.querySelector(`[data-chip="${cls}"]`) as HTMLButtonElement);
    }
    expect(screen.getByText('No moves match the current filters.')).toBeTruthy();
  });

  it('supports a controlled class filter (ReviewSummary count-cell wiring)', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MistakeReviewPanel
        moves={game()}
        viewPly={0}
        onSelectPly={noop}
        onPractice={noop}
        activeClasses={new Set(['blunder'])}
        onActiveClassesChange={onChange}
      />,
    );
    // Only the controlled class is listed…
    expect(container.querySelector('[data-row-ply="5"]')).toBeTruthy(); // the blunder
    expect(container.querySelector('[data-row-ply="3"]')).toBeNull(); // the inaccuracy
    // …and chip toggles report to the owner instead of mutating local state.
    fireEvent.click(container.querySelector('[data-chip="inaccuracy"]') as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledWith(new Set(['blunder', 'inaccuracy']));
    rerender(
      <MistakeReviewPanel
        moves={game()}
        viewPly={0}
        onSelectPly={noop}
        onPractice={noop}
        activeClasses={new Set(['blunder', 'inaccuracy'])}
        onActiveClassesChange={onChange}
      />,
    );
    expect(container.querySelector('[data-row-ply="3"]')).toBeTruthy();
  });

  it('filters by player', () => {
    const { container } = render(<MistakeReviewPanel moves={game()} viewPly={0} onSelectPly={noop} onPractice={noop} />);
    fireEvent.click(container.querySelector('[data-side="white"]') as HTMLButtonElement);
    expect(container.querySelector('[data-row-ply="4"]')).toBeNull(); // Black's mistake hidden
    expect(container.querySelector('[data-row-ply="5"]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-side="black"]') as HTMLButtonElement);
    expect(container.querySelector('[data-row-ply="5"]')).toBeNull();
    expect(container.querySelector('[data-row-ply="6"]')).toBeTruthy();
  });

  it('disables chips whose class has no moves under the side filter', () => {
    const { container } = render(<MistakeReviewPanel moves={game()} viewPly={0} onSelectPly={noop} onPractice={noop} />);
    fireEvent.click(container.querySelector('[data-side="white"]') as HTMLButtonElement);
    expect((container.querySelector('[data-chip="mistake"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-chip="blunder"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('highlights the row matching viewPly', () => {
    const { container } = render(<MistakeReviewPanel moves={game()} viewPly={5} onSelectPly={noop} onPractice={noop} />);
    const current = container.querySelectorAll('[data-current]');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('data-row-ply')).toBe('5');
  });

  it('walks the list with arrow keys', () => {
    const { container } = render(<MistakeReviewPanel moves={game()} viewPly={0} onSelectPly={noop} onPractice={noop} />);
    const jumps = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-jump]'));
    jumps[0]?.focus();
    fireEvent.keyDown(jumps[0] as HTMLButtonElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(jumps[1]);
    fireEvent.keyDown(jumps[1] as HTMLButtonElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(jumps[0]);
    fireEvent.keyDown(jumps[0] as HTMLButtonElement, { key: 'ArrowUp' }); // clamps at the top
    expect(document.activeElement).toBe(jumps[0]);
  });
});
