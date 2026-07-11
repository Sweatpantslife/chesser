// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '../i18n'; // initialize i18next so t() serves the bundled English strings
import { useGame } from '../store/game';
import { MoveList } from './MoveList';

// A dozen quiet moves — enough for the list to (notionally) overflow.
const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5';

const rect = (top: number, bottom: number): DOMRect =>
  ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

describe('MoveList active-move scrolling', () => {
  beforeEach(() => {
    expect(useGame.getState().loadPgn(PGN)).toBe(true);
    act(() => useGame.getState().goToPly(0));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('never calls scrollIntoView (which would scroll the page, not just the list)', () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    render(<MoveList />);
    act(() => useGame.getState().goToPly(5));
    expect(spy).not.toHaveBeenCalled();
  });

  it("scrolls the list container itself when the active move is below the list's viewport", () => {
    render(<MoveList />);
    const list = screen.getByRole('region', { name: 'Moves' });
    // jsdom does no layout: fake a 100px-tall list with the active move 70px
    // below its bottom edge once we navigate.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === list) return rect(0, 100);
      if (this.getAttribute('data-current') === 'true') return rect(150, 170);
      return rect(0, 0);
    });
    expect(list.scrollTop).toBe(0);
    act(() => useGame.getState().goToPly(8));
    expect(list.scrollTop).toBe(70); // 170 - 100: minimal scroll, container only
  });

  it('scrolls the list up when the active move is above its viewport', () => {
    render(<MoveList />);
    const list = screen.getByRole('region', { name: 'Moves' });
    list.scrollTop = 80;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === list) return rect(50, 150);
      if (this.getAttribute('data-current') === 'true') return rect(20, 40);
      return rect(0, 0);
    });
    act(() => useGame.getState().goToPly(1));
    expect(list.scrollTop).toBe(50); // 80 + (20 - 50)
  });
});
