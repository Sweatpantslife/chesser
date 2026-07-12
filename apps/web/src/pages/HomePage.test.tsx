// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../i18n'; // initialize i18next so t() serves the bundled English strings
import { setClock } from '../lib/clock';
import { questsForDay } from '../lib/quests';
import { useQuests } from '../store/quests';
import { useGame } from '../store/game';
import { HomePage } from './HomePage';
import { DailyQuests } from '../components/DailyQuests';

const T0 = Date.UTC(2026, 6, 1, 12); // 2026-07-01 noon UTC

const renderHome = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );

describe('Home page surfaces (jsdom)', () => {
  beforeEach(() => {
    setClock(() => T0);
    useQuests.getState().reset();
  });
  afterEach(() => {
    cleanup();
    setClock(null);
    useGame.setState({ mode: 'analysis', history: [], opponent: null });
  });

  it("DailyQuests renders today's deterministic slate with progress", () => {
    useQuests.getState().rollover();
    const slate = questsForDay('2026-07-01');
    useQuests.getState().applyActivity({ type: 'review', correct: true });
    render(<DailyQuests />);
    for (const q of slate) expect(screen.getByText(q.name)).toBeTruthy();
    expect(screen.getByText(`0 / ${slate.length} done`)).toBeTruthy();
  });

  it('shows the summary strip (→ Profile Progress), quests, daily puzzle and collapsed recap', () => {
    renderHome();
    // 1. Summary strip: streak + level, one link to the Progress dashboard.
    const strip = screen.getByTestId('home-summary');
    expect(strip.getAttribute('href')).toBe('/profile/progress');
    expect(screen.getByText(/-day streak/)).toBeTruthy();
    expect(screen.getByText(/Level \d/)).toBeTruthy();
    // 4. Daily quests card.
    expect(screen.getByText('Daily quests')).toBeTruthy();
    // 6. Daily puzzle card is a real link into Train.
    const daily = screen.getByTestId('home-daily');
    expect(daily.getAttribute('href')).toBe('/train/tactics?daily=1');
    expect(screen.getByText('Daily puzzle')).toBeTruthy();
    // 8. Week recap: a disclosure, collapsed by default (content unmounted).
    const recap = screen.getByRole('button', { name: /Your week in chess/ });
    expect(recap.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('weekly-report')).toBeNull();
  });

  it('no longer renders the removed nav-duplicating cards', () => {
    renderHome();
    expect(screen.queryByText('Puzzle sprints')).toBeNull();
    expect(screen.queryByText(/Next lesson:/)).toBeNull();
    expect(screen.queryByText('Play a game')).toBeNull();
    expect(screen.queryByText(/opening line/)).toBeNull();
  });

  it('resume-last-game card only exists while a vs-bot game is live', () => {
    renderHome();
    expect(screen.queryByTestId('home-resume')).toBeNull();
    cleanup();

    useGame.setState({
      mode: 'play',
      isGameOver: false,
      history: [{} as never],
      opponent: { name: 'Melvin' },
    });
    renderHome();
    const resume = screen.getByTestId('home-resume');
    expect(resume.getAttribute('href')).toBe('/play');
    expect(screen.getByText(/against Melvin/)).toBeTruthy();
  });
});
