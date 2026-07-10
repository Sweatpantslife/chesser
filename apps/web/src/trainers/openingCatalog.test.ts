import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { CATALOG_LINES, OPENING_CATALOG, catalogLine, catalogOpeningOf } from './openingCatalog';
import { OPENING_LINES } from './openings';

describe('opening catalog data', () => {
  it('has a sensible curated shape: 2-4 named lines per opening, both sides covered', () => {
    expect(OPENING_CATALOG.length).toBeGreaterThanOrEqual(8);
    for (const o of OPENING_CATALOG) {
      expect(o.lines.length).toBeGreaterThanOrEqual(2);
      expect(o.lines.length).toBeLessThanOrEqual(4);
      for (const l of o.lines) expect(l.side).toBe(o.side);
    }
    expect(OPENING_CATALOG.some((o) => o.side === 'white')).toBe(true);
    expect(OPENING_CATALOG.some((o) => o.side === 'black')).toBe(true);
  });

  it('has globally unique line ids that do not collide with the legacy starter set', () => {
    const ids = CATALOG_LINES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const legacy = new Set(OPENING_LINES.map((l) => l.id));
    for (const id of ids) expect(legacy.has(id)).toBe(false);
  });

  it('every line is a legal SAN sequence from the initial position', () => {
    for (const l of CATALOG_LINES) {
      const c = new Chess();
      for (const m of l.moves) {
        expect(() => c.move(m), `${l.id}: ${m} after ${c.fen()}`).not.toThrow();
      }
    }
  });

  it('every line ends on the trainee’s own move and is drill-sized', () => {
    for (const l of CATALOG_LINES) {
      // white moves at even plies, black at odd — last index parity must match side
      const lastPly = l.moves.length - 1;
      expect(lastPly % 2, l.id).toBe(l.side === 'white' ? 0 : 1);
      expect(l.moves.length).toBeGreaterThanOrEqual(10);
      expect(l.moves.length).toBeLessThanOrEqual(20);
      expect(l.idea.length).toBeGreaterThan(20);
      expect(l.eco).toMatch(/^[A-E]\d\d$/);
    }
  });

  it('lookups resolve lines and their parent opening', () => {
    const l = CATALOG_LINES[0]!;
    expect(catalogLine(l.id)).toBe(l);
    expect(catalogOpeningOf(l.id)?.lines).toContain(l);
    expect(catalogLine('nope')).toBeUndefined();
  });
});
