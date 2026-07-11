import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Difficulty } from '../trainers/tactics';

/** A tactic mined from one of your own games (engine-verified, client-side). */
export interface GeneratedPuzzle {
  id: string;
  fen: string;
  /** UCI moves; solution[0] is the key move, the rest is the main line. */
  solution: string[];
  theme: string;
  difficulty: Difficulty;
  turn: 'white' | 'black';
  rating: number;
  /** Where it came from, e.g. "Magnus vs You". */
  source?: string;
  createdAt: number;
}

export type NewGeneratedPuzzle = Omit<GeneratedPuzzle, 'id' | 'createdAt'>;

const uid = () => `g_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
const MAX = 300;

interface CustomPuzzleState {
  puzzles: GeneratedPuzzle[];
  addMany(incoming: NewGeneratedPuzzle[]): number;
  remove(id: string): void;
  clear(): void;
  exportPuzzles(): GeneratedPuzzle[];
  importMerge(remote: unknown): void;
}

export const useCustomPuzzles = create<CustomPuzzleState>()(
  persist(
    (set, get) => ({
      puzzles: [],
      addMany(incoming) {
        const seen = new Set(get().puzzles.map((p) => p.fen));
        const added = incoming
          .filter((p) => p.fen && !seen.has(p.fen))
          .map((p) => ({ ...p, id: uid(), createdAt: Date.now() }));
        if (added.length) set({ puzzles: [...added, ...get().puzzles].slice(0, MAX) });
        return added.length;
      },
      remove(id) {
        set({ puzzles: get().puzzles.filter((p) => p.id !== id) });
      },
      clear() {
        set({ puzzles: [] });
      },
      exportPuzzles() {
        return get().puzzles;
      },
      importMerge(remote) {
        if (!Array.isArray(remote)) return;
        const byFen = new Map(get().puzzles.map((p) => [p.fen, p] as const));
        for (const p of remote as GeneratedPuzzle[]) {
          if (p?.fen && typeof p.fen === 'string' && !byFen.has(p.fen)) byFen.set(p.fen, p);
        }
        set({ puzzles: [...byFen.values()].slice(0, MAX) });
      },
    }),
    { name: 'chesser-custom-puzzles' },
  ),
);
