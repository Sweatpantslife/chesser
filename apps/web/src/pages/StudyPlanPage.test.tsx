// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../i18n'; // initialize i18next so t() serves the bundled English strings
import { setClock } from '../lib/clock';
import type { GameDigest, WeaknessKind } from '../lib/weakness';
import { useCoach } from '../store/coach';
import { usePlan } from '../store/plan';
import { StudyPlanPage } from './StudyPlanPage';
import { PlanCard } from '../components/PlanCard';

const T0 = new Date(2026, 6, 8, 12, 0, 0).getTime(); // local Wed → ISO week 2026-W28

function digest(gameKey: string, kinds: WeaknessKind[], createdAt: number): GameDigest {
  return {
    gameKey,
    createdAt,
    playerColor: 'white',
    result: 'loss',
    accuracy: 70,
    acpl: 80,
    moves: 40,
    openingEco: 'C50',
    openingName: 'Italian Game',
    phases: {
      opening: { accuracy: 85, acpl: 30, moves: 10 },
      middlegame: { accuracy: 70, acpl: 90, moves: 20 },
      endgame: { accuracy: 65, acpl: 100, moves: 10 },
    },
    mistakes: kinds.map((kind, i) => ({
      ply: 10 + i,
      san: 'Qd2',
      moveLabel: `${5 + i}.`,
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      bestSan: 'Nf3',
      bestUci: 'g1f3',
      winDrop: 25,
      severity: 'blunder' as const,
      phase: 'middlegame' as const,
      kinds: [kind],
    })),
  };
}

describe('StudyPlanPage / PlanCard (jsdom)', () => {
  beforeEach(() => {
    setClock(() => T0);
    localStorage.clear();
    usePlan.getState().reset();
    useCoach.getState().clear();
    useCoach.setState({
      games: {
        g1: digest('g1', ['missedForks', 'missedForks'], T0 - 2 * 86_400_000),
        g2: digest('g2', ['missedForks'], T0 - 3 * 86_400_000),
      },
    });
  });
  afterEach(() => {
    cleanup();
    setClock(null);
  });

  it('renders the week header, grouped items with WHY lines, and jumps via go()', () => {
    const go = vi.fn();
    render(<StudyPlanPage go={go} />);

    expect(screen.getByText("This week's study plan")).toBeTruthy();
    expect(screen.getByText('2026-W28')).toBeTruthy();
    expect(screen.getByText('Daily puzzles')).toBeTruthy();
    expect(screen.getByText('Master games')).toBeTruthy();
    // WHY line ties the quota to the user's own games.
    expect(screen.getAllByText(/reviewed games/).length).toBeGreaterThan(0);

    // Profile-backed puzzle items jump into the Coach trainer.
    fireEvent.click(screen.getAllByRole('button', { name: /^Train/ })[0]!);
    expect(go).toHaveBeenCalledWith('coach');
  });

  it('logs daily quota via the +1 button and shows regenerate', () => {
    render(<StudyPlanPage go={() => {}} />);
    const plus = screen.getAllByRole('button', { name: /Log one solved puzzle/ })[0]!;
    fireEvent.click(plus);
    expect(usePlan.getState().progress['puzzle:missedForks']).toBe(1);
    expect(screen.getByText(/today 1\//)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
    expect(usePlan.getState().progress['puzzle:missedForks']).toBeUndefined();
  });

  it("PlanCard shows today's remaining items and opens the full page", () => {
    const onOpen = vi.fn();
    render(<PlanCard onOpen={onOpen} />);
    expect(screen.getByText("This week's plan")).toBeTruthy();
    expect(screen.getAllByText(/left today/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Open/ }));
    expect(onOpen).toHaveBeenCalled();
  });
});
