// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnalysisReport, Classification, MoveDetail, PlayerSummary } from '../../lib/analytics/types';
import { ReviewSummary, theoryText } from './ReviewSummary';

const ZERO_COUNTS: Record<Classification, number> = {
  brilliant: 0,
  great: 0,
  best: 0,
  good: 0,
  book: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
  miss: 0,
};

function player(partial: Omit<Partial<PlayerSummary>, 'counts'> & { counts?: Partial<Record<Classification, number>> }): PlayerSummary {
  return {
    accuracy: 100,
    acpl: 0,
    moves: 6,
    ...partial,
    counts: { ...ZERO_COUNTS, ...partial.counts },
  };
}

function row(ply: number): MoveDetail {
  return {
    ply,
    side: ply % 2 === 1 ? 'white' : 'black',
    san: 'e4',
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
  };
}

function report(partial?: Partial<AnalysisReport>): AnalysisReport {
  return {
    version: 1,
    createdAt: 0,
    gameKey: 'carv1:test',
    meta: {
      gameNo: 1,
      startFen: 'start-fen',
      result: '1-0',
      playerColor: 'white',
      engine: { multipv: 2, movetimeMs: 300, depth: 22 },
    },
    white: player({ accuracy: 91.4, acpl: 18, counts: { best: 4, blunder: 1 } }),
    black: player({ accuracy: 78.2, acpl: 45, counts: { mistake: 2 } }),
    opening: { eco: 'B22', name: 'Sicilian Defense: Alapin Variation', leftTheoryAtPly: 10 },
    phases: [
      { phase: 'opening', startPly: 1, endPly: 10, white: { accuracy: 95.1, acpl: 5, moves: 5 }, black: { accuracy: 92.3, acpl: 12, moves: 5 } },
      { phase: 'middlegame', startPly: 11, endPly: 12, white: { accuracy: 84.6, acpl: 40, moves: 1 }, black: { accuracy: 70.1, acpl: 88, moves: 1 } },
      { phase: 'endgame', startPly: 13, endPly: 12, white: { accuracy: 100, acpl: 0, moves: 0 }, black: { accuracy: 100, acpl: 0, moves: 0 } },
    ],
    criticalMoments: [
      { ply: 11, san: 'Qxb7', side: 'white', kind: 'blunder', winSwing: 34, description: '6. Qxb7?? threw away a winning position' },
    ],
    estimatedPerformanceRating: { white: 1850, black: 1420 },
    moves: Array.from({ length: 12 }, (_, i) => row(i + 1)),
    ...partial,
  };
}

// Vitest runs without globals, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

describe('theoryText', () => {
  it('handles throughout / departure / never-in-book', () => {
    expect(theoryText(12, 12)).toBe('In theory throughout');
    expect(theoryText(10, 12)).toBe('Left theory at move 6'); // first non-book ply 11
    expect(theoryText(0, 12)).toBe('Left theory at move 1');
    expect(theoryText(0, 0)).toBe('');
  });
});

describe('ReviewSummary', () => {
  it('shows accuracy, ACPL and estimated rating for both players', () => {
    render(<ReviewSummary report={report()} reviewing={false} onSelectPly={() => {}} />);
    expect(screen.getByText('91.4')).toBeTruthy();
    expect(screen.getByText('78.2')).toBeTruthy();
    expect(screen.getByText('ACPL 18')).toBeTruthy();
    expect(screen.getByText('ACPL 45')).toBeTruthy();
    expect(screen.getByText('~1850 est. rating')).toBeTruthy();
    expect(screen.getByText('~1420 est. rating')).toBeTruthy();
  });

  it('renders the classification table and filters on count click', () => {
    const onFilterClass = vi.fn();
    const { container } = render(
      <ReviewSummary report={report()} reviewing={false} onSelectPly={() => {}} onFilterClass={onFilterClass} />,
    );
    expect(screen.getByText('Blunder')).toBeTruthy();
    expect(screen.getByText('!!')).toBeTruthy(); // brilliant glyph row
    const cell = container.querySelector('[data-count="white-blunder"]') as HTMLButtonElement;
    expect(cell.textContent).toBe('1');
    fireEvent.click(cell);
    expect(onFilterClass).toHaveBeenCalledWith('blunder');
    // Zero counts are disabled — nothing to filter.
    expect((container.querySelector('[data-count="black-blunder"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the opening with ECO and the theory-departure line', () => {
    render(<ReviewSummary report={report()} reviewing={false} onSelectPly={() => {}} />);
    expect(screen.getByText('B22')).toBeTruthy();
    expect(screen.getByText('Sicilian Defense: Alapin Variation')).toBeTruthy();
    expect(screen.getByText('Left theory at move 6')).toBeTruthy();
  });

  it('says "In theory throughout" when the game never left book', () => {
    const r = report({ opening: { eco: 'C50', name: 'Italian Game', leftTheoryAtPly: 12 } });
    render(<ReviewSummary report={r} reviewing={false} onSelectPly={() => {}} />);
    expect(screen.getByText('In theory throughout')).toBeTruthy();
  });

  it('renders phase accuracies, em-dashes empty phases and jumps on phase click', () => {
    const onSelectPly = vi.fn();
    const { container } = render(<ReviewSummary report={report()} reviewing={false} onSelectPly={onSelectPly} />);
    expect(screen.getByText('95.1%')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(2); // empty endgame, both sides
    expect(container.querySelector('[data-phase="endgame"]')).toBeNull(); // not clickable
    fireEvent.click(container.querySelector('[data-phase="middlegame"]') as HTMLButtonElement);
    expect(onSelectPly).toHaveBeenCalledWith(11);
  });

  it('jumps to a critical moment on click', () => {
    const onSelectPly = vi.fn();
    const { container } = render(<ReviewSummary report={report()} reviewing={false} onSelectPly={onSelectPly} />);
    expect(screen.getByText('6. Qxb7?? threw away a winning position')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-moment-ply="11"]') as HTMLButtonElement);
    expect(onSelectPly).toHaveBeenCalledWith(11);
  });

  it('shows a skeleton instead of content while reviewing', () => {
    const { container } = render(<ReviewSummary report={report()} reviewing onSelectPly={() => {}} />);
    expect(container.querySelector('[data-skeleton]')).toBeTruthy();
    expect(screen.queryByText('91.4')).toBeNull();
    expect(screen.getByText('Game report')).toBeTruthy(); // header stays
  });

  it('hides the export button unless onExportPgn is provided', () => {
    const onExportPgn = vi.fn();
    const { rerender } = render(<ReviewSummary report={report()} reviewing={false} onSelectPly={() => {}} />);
    expect(screen.queryByText('Export PGN')).toBeNull();
    rerender(<ReviewSummary report={report()} reviewing={false} onSelectPly={() => {}} onExportPgn={onExportPgn} />);
    fireEvent.click(screen.getByText('Export PGN'));
    expect(onExportPgn).toHaveBeenCalled();
  });

  it('tags the human player and handles a null playerColor', () => {
    const { rerender } = render(<ReviewSummary report={report()} reviewing={false} onSelectPly={() => {}} />);
    expect(screen.getAllByText('you')).toHaveLength(1);
    const r = report();
    rerender(<ReviewSummary report={{ ...r, meta: { ...r.meta, playerColor: null } }} reviewing={false} onSelectPly={() => {}} />);
    expect(screen.queryByText('you')).toBeNull();
  });
});
