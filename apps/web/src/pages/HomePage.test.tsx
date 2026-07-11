// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { setClock } from '../lib/clock';
import { questsForDay } from '../lib/quests';
import { useQuests } from '../store/quests';
import { HomePage } from './HomePage';
import { DailyQuests } from '../components/DailyQuests';

const T0 = Date.UTC(2026, 6, 1, 12); // 2026-07-01 noon UTC

describe('Today page surfaces (jsdom)', () => {
  beforeEach(() => {
    setClock(() => T0);
    useQuests.getState().reset();
  });
  afterEach(() => {
    cleanup();
    setClock(null);
  });

  it("DailyQuests renders today's deterministic slate with progress", () => {
    useQuests.getState().rollover();
    const slate = questsForDay('2026-07-01');
    useQuests.getState().applyActivity({ type: 'review', correct: true });
    render(<DailyQuests />);
    for (const q of slate) expect(screen.getByText(q.name)).toBeTruthy();
    expect(screen.getByText(`0 / ${slate.length} done`)).toBeTruthy();
  });

  it('HomePage shows streak, quests, daily puzzle, sprints and next-lesson entries', () => {
    render(<HomePage go={() => {}} onDailyPuzzle={() => {}} onSprint={() => {}} />);
    expect(screen.getByText('Daily quests')).toBeTruthy();
    expect(screen.getByText('Daily puzzle')).toBeTruthy();
    expect(screen.getByText('Puzzle sprints')).toBeTruthy();
    expect(screen.getByText('Rush')).toBeTruthy();
    expect(screen.getByText('Storm')).toBeTruthy();
    expect(screen.getByText(/Next lesson:/)).toBeTruthy();
    expect(screen.getByText('Play a game')).toBeTruthy();
  });
});
