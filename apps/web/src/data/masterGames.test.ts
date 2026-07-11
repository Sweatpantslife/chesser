/**
 * Machine-validation of the annotated master-games library (same spirit as
 * learn/content.test.ts): every game must replay legally through chess.js
 * from the start position, results must match the final position, all
 * annotation/key-moment plies must be in range, and metadata must be present.
 * Add a game and these tests vet it for free.
 */
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  DIFFICULTY_LABELS,
  GAME_THEMES,
  MASTER_GAMES,
  MASTER_GAMES_BY_ID,
  masterGamePgn,
  plyLabel,
} from './masterGames';

describe('master games catalogue', () => {
  it('has a curated spread of games', () => {
    expect(MASTER_GAMES.length).toBeGreaterThanOrEqual(8);
    expect(MASTER_GAMES.length).toBeLessThanOrEqual(12);
    // The two mandatory classics.
    expect(MASTER_GAMES_BY_ID['opera-1858']).toBeDefined();
    expect(MASTER_GAMES_BY_ID['immortal-1851']).toBeDefined();
  });

  it('has unique ids', () => {
    const ids = MASTER_GAMES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(MASTER_GAMES_BY_ID).length).toBe(ids.length);
  });

  it('plyLabel formats white and black plies', () => {
    expect(plyLabel(1)).toBe('1.');
    expect(plyLabel(2)).toBe('1…');
    expect(plyLabel(33)).toBe('17.');
  });
});

describe('every game is valid', () => {
  for (const g of MASTER_GAMES) {
    describe(g.id, () => {
      it('has required metadata', () => {
        expect(g.white.length).toBeGreaterThan(0);
        expect(g.black.length).toBeGreaterThan(0);
        expect(g.event.length).toBeGreaterThan(0);
        expect(g.year).toBeGreaterThanOrEqual(1800);
        expect(g.year).toBeLessThanOrEqual(new Date().getFullYear());
        expect(g.eco).toMatch(/^[A-E]\d\d$/);
        expect(g.opening.length).toBeGreaterThan(0);
        expect(g.blurb.length).toBeGreaterThan(20);
        expect(g.themes.length).toBeGreaterThan(0);
        for (const t of g.themes) expect(GAME_THEMES).toContain(t);
        expect(Object.keys(DIFFICULTY_LABELS)).toContain(g.difficulty);
      });

      it('replays legally from the start position', () => {
        const chess = new Chess();
        for (let i = 0; i < g.sans.length; i++) {
          expect(
            () => chess.move(g.sans[i]!),
            `${g.id}: illegal/ambiguous move "${g.sans[i]}" at ply ${i + 1} (fen ${chess.fen()})`,
          ).not.toThrow();
        }
        // Result consistent with the final position: a game whose last SAN is
        // mate must really be checkmate, with the right side delivering it;
        // any other ending must NOT leave a position that is already decided.
        const lastSan = g.sans[g.sans.length - 1]!;
        if (lastSan.endsWith('#')) {
          expect(chess.isCheckmate(), `${g.id} ends in checkmate`).toBe(true);
          const winner = g.sans.length % 2 === 1 ? '1-0' : '0-1';
          expect(g.result, `${g.id} result matches mating side`).toBe(winner);
        } else {
          expect(chess.isGameOver(), `${g.id} ends by resignation, not on the board`).toBe(false);
          expect(g.result === '1-0' || g.result === '0-1' || g.result === '1/2-1/2').toBe(true);
        }
      });

      it('round-trips through PGN', () => {
        const probe = new Chess();
        expect(() => probe.loadPgn(masterGamePgn(g)), `${g.id} PGN parses`).not.toThrow();
        expect(probe.history().length, `${g.id} PGN preserves every move`).toBe(g.sans.length);
      });

      it('annotation and key-moment plies are in range', () => {
        for (const key of Object.keys(g.annotations)) {
          const ply = Number(key);
          expect(Number.isInteger(ply), `${g.id} annotation ply ${key} is an integer`).toBe(true);
          expect(ply, `${g.id} annotation ply ${key} >= 1`).toBeGreaterThanOrEqual(1);
          expect(ply, `${g.id} annotation ply ${key} <= ${g.sans.length}`).toBeLessThanOrEqual(g.sans.length);
          expect(g.annotations[ply]!.text.length).toBeGreaterThan(10);
        }
        expect(g.keyMoments.length).toBeGreaterThanOrEqual(2);
        expect(g.keyMoments.length).toBeLessThanOrEqual(4);
        expect(new Set(g.keyMoments).size).toBe(g.keyMoments.length);
        for (const ply of g.keyMoments) {
          expect(ply, `${g.id} key moment ${ply} in range`).toBeGreaterThanOrEqual(1);
          expect(ply, `${g.id} key moment ${ply} in range`).toBeLessThanOrEqual(g.sans.length);
          // Every key moment should carry commentary explaining it.
          expect(g.annotations[ply], `${g.id} key moment ${ply} is annotated`).toBeDefined();
        }
      });
    });
  }
});
