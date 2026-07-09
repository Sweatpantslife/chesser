// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MoveDetail } from '../../lib/analytics/types';
import { MoveDetailPanel } from './MoveDetailPanel';

afterEach(cleanup);

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

const noop = () => undefined;

const renderPanel = (move: MoveDetail | null, over: Partial<Parameters<typeof MoveDetailPanel>[0]> = {}) => {
  const onShowArrow = vi.fn();
  const onPlayVariation = vi.fn();
  const onPractice = vi.fn();
  const utils = render(
    <MoveDetailPanel move={move} onShowArrow={onShowArrow} onPlayVariation={onPlayVariation} onPractice={onPractice} {...over} />,
  );
  return { onShowArrow, onPlayVariation, onPractice, ...utils };
};

describe('MoveDetailPanel', () => {
  it('renders nothing (and clears the arrow) when move is null', () => {
    const { container, onShowArrow } = renderPanel(null);
    expect(container.firstChild).toBeNull();
    expect(onShowArrow).toHaveBeenCalledWith(null);
  });

  it('shows the played move, grade label, explanation and eval before → after', () => {
    renderPanel(row({ classification: 'inaccuracy', glyph: '?!', bestMoveSan: 'd4', bestMoveUci: 'd2d4', explanation: 'Inaccurate — d4 was better.' }));
    expect(screen.getByText('2. Nf3')).toBeTruthy();
    expect(screen.getByText(/Inaccuracy/)).toBeTruthy();
    expect(screen.getByText('Inaccurate — d4 was better.')).toBeTruthy();
    expect(screen.getByText('+0.20')).toBeTruthy();
    expect(screen.getByText('+0.35')).toBeTruthy();
  });

  it('prefers the pre-formatted evalText for the after value', () => {
    renderPanel(row({ evalText: '+0.41' }));
    expect(screen.getByText('+0.41')).toBeTruthy();
  });

  it('publishes the best-move arrow on mount, updates it on move change, clears on unmount', () => {
    const { onShowArrow, rerender, unmount, onPlayVariation, onPractice } = renderPanel(row());
    expect(onShowArrow).toHaveBeenLastCalledWith({ from: 'g1', to: 'f3' });

    rerender(
      <MoveDetailPanel
        move={row({ ply: 4, side: 'black', san: 'd5', uci: 'd7d5', bestMoveUci: 'g8f6', bestMoveSan: 'Nf6' })}
        onShowArrow={onShowArrow}
        onPlayVariation={onPlayVariation}
        onPractice={onPractice}
      />,
    );
    expect(onShowArrow).toHaveBeenLastCalledWith({ from: 'g8', to: 'f6' });

    unmount();
    expect(onShowArrow).toHaveBeenLastCalledWith(null);
  });

  it('toggles the arrow off and back on via the Show/Hide best move button', () => {
    const { onShowArrow } = renderPanel(row());
    fireEvent.click(screen.getByText('Hide best move'));
    expect(onShowArrow).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByText('Show best move'));
    expect(onShowArrow).toHaveBeenLastCalledWith({ from: 'g1', to: 'f3' });
  });

  it('highlights the engine best move when it differs and plays it on click', () => {
    const { onPlayVariation } = renderPanel(
      row({ classification: 'mistake', glyph: '?', bestMoveSan: 'd4', bestMoveUci: 'd2d4', pv: ['d4', 'd5', 'c4'] }),
    );
    fireEvent.click(screen.getByText(/Best was/));
    expect(onPlayVariation).toHaveBeenCalledWith(['d4'], 3);
  });

  it('hides the best-move correction when the played move was best', () => {
    renderPanel(row());
    expect(screen.queryByText(/Best was/)).toBeNull();
  });

  it('plays the PV prefix up to the clicked san', () => {
    const { onPlayVariation } = renderPanel(row());
    fireEvent.click(screen.getByRole('button', { name: 'Nc6' }));
    expect(onPlayVariation).toHaveBeenCalledWith(['Nf3', 'Nc6'], 3);
  });

  it('hides the engine line when the PV is missing', () => {
    renderPanel(row({ pv: [] }));
    expect(screen.queryByText('Engine line')).toBeNull();
  });

  it('calls onPractice with the move ply', () => {
    const { onPractice } = renderPanel(row({ ply: 7 }));
    fireEvent.click(screen.getByText('Practice this position'));
    expect(onPractice).toHaveBeenCalledWith(7);
  });

  it('navigates with prev/next when onSelectPly is wired', () => {
    const onSelectPly = vi.fn();
    renderPanel(row({ ply: 1 }), { onSelectPly, maxPly: 3 });
    fireEvent.click(screen.getByTitle('Previous move')); // first move → start position
    expect(onSelectPly).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByTitle('Next move'));
    expect(onSelectPly).toHaveBeenCalledWith(2);
  });

  it('disables next on the last move and hides nav without onSelectPly', () => {
    renderPanel(row({ ply: 3 }), { onSelectPly: noop, maxPly: 3 });
    expect((screen.getByTitle('Next move') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderPanel(row());
    expect(screen.queryByTitle('Next move')).toBeNull();
  });

  it('shows a delivered mate as best-tier with no correction, eval as #', () => {
    renderPanel(
      row({
        ply: 41,
        san: 'Qh7#',
        uci: 'd3h7',
        isMate: true,
        isCheck: true,
        classification: 'blunder', // stale grade — the panel must not trust it
        glyph: '??',
        evalAfter: null,
        evalText: null,
        bestMoveSan: 'Rf8',
        bestMoveUci: 'f1f8',
        explanation: 'Checkmate — the game ends here.',
      }),
    );
    expect(screen.getByText(/Best move/)).toBeTruthy();
    expect(screen.queryByText(/Blunder/)).toBeNull();
    expect(screen.queryByText(/Best was/)).toBeNull();
    expect(screen.getByText('#')).toBeTruthy();
    expect(screen.getByText('Checkmate — the game ends here.')).toBeTruthy();
  });
});
