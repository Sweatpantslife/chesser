import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CoordMode = 'find' | 'name';
export type CoordSide = 'white' | 'black';

export interface CoordRun {
  ts: number; // epoch ms (also the de-dupe key when merging across devices)
  day: string; // YYYY-MM-DD
  score: number;
  mode: CoordMode;
  side: CoordSide;
}

const MAX_RUNS = 200;

interface CoordState {
  best: number;
  bestBySide: Record<CoordSide, number>;
  runs: CoordRun[];

  record(run: CoordRun): void;
  exportState(): { best: number; bestBySide: Record<CoordSide, number>; runs: CoordRun[] };
  importMerge(remote: unknown): void;
  reset(): void;
}

export const useCoordinate = create<CoordState>()(
  persist(
    (set, get) => ({
      best: 0,
      bestBySide: { white: 0, black: 0 },
      runs: [],

      record(run) {
        const s = get();
        set({
          best: Math.max(s.best, run.score),
          bestBySide: { ...s.bestBySide, [run.side]: Math.max(s.bestBySide[run.side], run.score) },
          runs: [run, ...s.runs].slice(0, MAX_RUNS),
        });
      },

      exportState() {
        const { best, bestBySide, runs } = get();
        return { best, bestBySide, runs };
      },

      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as Partial<CoordState>;
        const byTs = new Map<number, CoordRun>();
        for (const run of [...get().runs, ...(r.runs ?? [])]) byTs.set(run.ts, run);
        const runs = [...byTs.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_RUNS);
        set({
          best: Math.max(get().best, r.best ?? 0),
          bestBySide: {
            white: Math.max(get().bestBySide.white, r.bestBySide?.white ?? 0),
            black: Math.max(get().bestBySide.black, r.bestBySide?.black ?? 0),
          },
          runs,
        });
      },

      reset() {
        set({ best: 0, bestBySide: { white: 0, black: 0 }, runs: [] });
      },
    }),
    { name: 'chesser-coordinate' },
  ),
);
