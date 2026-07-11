import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Board-vision sprint modes. */
export type CoordMode = 'find' | 'name' | 'color' | 'knight';
export type CoordSide = 'white' | 'black';

export const COORD_MODES: CoordMode[] = ['find', 'name', 'color', 'knight'];

export interface CoordRun {
  ts: number; // epoch ms (also the de-dupe key when merging across devices)
  day: string; // YYYY-MM-DD
  score: number;
  mode: CoordMode;
  side: CoordSide;
}

const MAX_RUNS = 200;
const emptyByMode = (): Record<CoordMode, number> => ({ find: 0, name: 0, color: 0, knight: 0 });

interface CoordState {
  best: number;
  bestBySide: Record<CoordSide, number>;
  bestByMode: Record<CoordMode, number>;
  runs: CoordRun[];

  record(run: CoordRun): void;
  exportState(): {
    best: number;
    bestBySide: Record<CoordSide, number>;
    bestByMode: Record<CoordMode, number>;
    runs: CoordRun[];
  };
  importMerge(remote: unknown): void;
  reset(): void;
}

const maxByMode = (a: Partial<Record<CoordMode, number>> = {}, b: Partial<Record<CoordMode, number>> = {}) => {
  const out = emptyByMode();
  for (const m of COORD_MODES) out[m] = Math.max(a[m] ?? 0, b[m] ?? 0);
  return out;
};

export const useCoordinate = create<CoordState>()(
  persist(
    (set, get) => ({
      best: 0,
      bestBySide: { white: 0, black: 0 },
      bestByMode: emptyByMode(),
      runs: [],

      record(run) {
        const s = get();
        const byMode = { ...emptyByMode(), ...s.bestByMode };
        byMode[run.mode] = Math.max(byMode[run.mode] ?? 0, run.score);
        set({
          best: Math.max(s.best, run.score),
          bestBySide: { ...s.bestBySide, [run.side]: Math.max(s.bestBySide[run.side], run.score) },
          bestByMode: byMode,
          runs: [run, ...s.runs].slice(0, MAX_RUNS),
        });
      },

      exportState() {
        const { best, bestBySide, bestByMode, runs } = get();
        return { best, bestBySide, bestByMode, runs };
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
          bestByMode: maxByMode(get().bestByMode, r.bestByMode),
          runs,
        });
      },

      reset() {
        set({ best: 0, bestBySide: { white: 0, black: 0 }, bestByMode: emptyByMode(), runs: [] });
      },
    }),
    {
      name: 'chesser-coordinate',
      // Older persisted state predates bestByMode; backfill it on rehydrate.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CoordState>;
        return { ...current, ...p, bestByMode: { ...emptyByMode(), ...(p.bestByMode ?? {}) } };
      },
    },
  ),
);
