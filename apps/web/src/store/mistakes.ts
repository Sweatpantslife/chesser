import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface MistakeCard {
  id: string;
  fen: string; // position BEFORE the move you played
  side: 'white' | 'black'; // the side to move (you, in the drill)
  playedSan: string; // the move you actually played
  expected: number; // target win% (your POV) to recover
  severity: 'mistake' | 'blunder';
  label?: string;
  createdAt: number;
}

export type NewMistake = Omit<MistakeCard, 'id' | 'createdAt'>;

const uid = () => `m_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

interface MistakeState {
  cards: MistakeCard[];
  addMany(cards: NewMistake[]): number;
  remove(id: string): void;
  clear(): void;
  exportMistakes(): MistakeCard[];
  importMerge(remote: unknown): void;
}

export const useMistakes = create<MistakeState>()(
  persist(
    (set, get) => ({
      cards: [],
      addMany(incoming) {
        const seen = new Set(get().cards.map((c) => c.fen));
        const added = incoming
          .filter((c) => !seen.has(c.fen))
          .map((c) => ({ ...c, id: uid(), createdAt: Date.now() }));
        set({ cards: [...added, ...get().cards].slice(0, 500) });
        return added.length;
      },
      remove(id) {
        set({ cards: get().cards.filter((c) => c.id !== id) });
      },
      clear() {
        set({ cards: [] });
      },
      exportMistakes() {
        return get().cards;
      },
      importMerge(remote) {
        if (!Array.isArray(remote)) return;
        const byFen = new Map(get().cards.map((c) => [c.fen, c] as const));
        for (const c of remote as MistakeCard[]) {
          if (c?.fen && typeof c.fen === 'string' && !byFen.has(c.fen)) byFen.set(c.fen, c);
        }
        set({ cards: [...byFen.values()] });
      },
    }),
    { name: 'chesser-mistakes' },
  ),
);
