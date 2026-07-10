import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { buildBook, classifyMove, posKey, type BookLineInput } from './lineBook';
import { CATALOG_LINES } from '../trainers/openingCatalog';

const fenAfter = (sans: string[]): string => {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return c.fen();
};

const line = (id: string): BookLineInput => {
  const l = CATALOG_LINES.find((x) => x.id === id);
  if (!l) throw new Error(`missing catalog line ${id}`);
  return l;
};

describe('buildBook', () => {
  it('records only the trainee side’s moves, keyed by position', () => {
    const book = buildBook([line('si-najdorf')], 'black');
    // Black to move after 1.e4 — first recall point.
    const entries = book.get(posKey(fenAfter(['e4'])));
    expect(entries).toEqual([{ lineId: 'si-najdorf', ply: 1, san: 'c5' }]);
    // White-to-move positions are never book keys for a black repertoire.
    expect(book.get(posKey(fenAfter([])))).toBeUndefined();
  });

  it('skips lines of the other side and malformed lines', () => {
    const bad: BookLineInput = { id: 'bad', side: 'black', moves: ['e4', 'Ke2'] };
    const book = buildBook([line('rl-closed'), bad, line('si-najdorf')], 'black');
    const all = [...book.values()].flat();
    expect(all.every((e) => e.lineId === 'si-najdorf')).toBe(true);
  });

  it('a line that breaks mid-parse leaves no partial entries in the book', () => {
    // The first three moves are legal, so a naive builder would commit the
    // trainee's ...c5 before Kd4 throws — none of it may reach the book.
    const broken: BookLineInput = { id: 'broken', side: 'black', moves: ['e4', 'c5', 'Nf3', 'Kd4'] };
    const book = buildBook([broken, line('si-najdorf')], 'black');
    const all = [...book.values()].flat();
    expect(all.some((e) => e.lineId === 'broken')).toBe(false);
    // …and the valid sibling still populates fully (7 black moves in 14 plies).
    expect(all.filter((e) => e.lineId === 'si-najdorf')).toHaveLength(7);
  });
});

describe('classifyMove', () => {
  it('accepts the drilled line’s expected move', () => {
    const book = buildBook([line('si-najdorf')], 'black');
    const v = classifyMove(book, line('si-najdorf'), 1, fenAfter(['e4']), 'c7', 'c5');
    expect(v).toEqual({ kind: 'expected', san: 'c5' });
  });

  it('accepts a sibling line’s move at a fork (multiple valid continuations)', () => {
    // Closed Ruy and Exchange Ruy share 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 and fork at white’s 4th.
    const lines = [line('rl-closed'), line('rl-exchange')];
    const book = buildBook(lines, 'white');
    const fen = fenAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    // Drilling the Closed line, Bxc6 (the Exchange move) is also correct.
    const v = classifyMove(book, line('rl-closed'), 6, fen, 'b5', 'c6');
    expect(v).toEqual({ kind: 'alternate', san: 'Bxc6', lineId: 'rl-exchange', ply: 6 });
    // …and the drilled line’s own Ba4 stays "expected".
    expect(classifyMove(book, line('rl-closed'), 6, fen, 'b5', 'a4')).toEqual({ kind: 'expected', san: 'Ba4' });
  });

  it('recognises transpositions reached through a different move order', () => {
    // Same position after 3 white moves, reached via two move orders, then diverging.
    const a: BookLineInput = { id: 'a', side: 'white', moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3'] };
    const b: BookLineInput = { id: 'b', side: 'white', moves: ['d4', 'd5', 'Bf4', 'Nf6', 'Nf3', 'e6', 'c3'] };
    const book = buildBook([a, b], 'white');
    // Drill B via its own order; at the shared position play A's continuation.
    const fen = fenAfter(['d4', 'd5', 'Bf4', 'Nf6', 'Nf3', 'e6']);
    const v = classifyMove(book, b, 6, fen, 'e2', 'e3');
    expect(v).toEqual({ kind: 'alternate', san: 'e3', lineId: 'a', ply: 6 });
  });

  it('rejects legal off-book moves with the SAN it parsed', () => {
    const book = buildBook([line('si-najdorf')], 'black');
    const v = classifyMove(book, line('si-najdorf'), 1, fenAfter(['e4']), 'e7', 'e5');
    expect(v).toEqual({ kind: 'wrong', san: 'e5' });
  });

  it('rejects illegal moves with san: null', () => {
    const book = buildBook([line('si-najdorf')], 'black');
    const v = classifyMove(book, line('si-najdorf'), 1, fenAfter(['e4']), 'e8', 'e5');
    expect(v).toEqual({ kind: 'wrong', san: null });
  });

  it('canonicalizes authored SAN so suffix variants never mismatch', () => {
    // fr-winawer ply 9 is authored as "Bxc3+" — playing b4xc3 must be "expected".
    const book = buildBook([line('fr-winawer')], 'black');
    const fen = fenAfter(['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3']);
    const v = classifyMove(book, line('fr-winawer'), 9, fen, 'b4', 'c3');
    expect(v).toEqual({ kind: 'expected', san: 'Bxc3+' });
  });

  it('the full catalog produces at least one real fork per side', () => {
    const whiteBook = buildBook(CATALOG_LINES, 'white');
    const blackBook = buildBook(CATALOG_LINES, 'black');
    const forks = (book: ReturnType<typeof buildBook>) =>
      [...book.values()].filter((es) => new Set(es.map((e) => e.san)).size > 1).length;
    expect(forks(whiteBook)).toBeGreaterThan(0);
    expect(forks(blackBook)).toBeGreaterThan(0);
  });
});
