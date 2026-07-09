import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Lesson completion progress. Follows the same persist + export/importMerge
 * contract as the other stores so lib/sync.ts can ship it to the account
 * snapshot unchanged.
 */
export interface LessonRecord {
  /** Epoch ms of first completion. */
  ts: number;
  /** Best star score (1–3; 3 = no wrong moves). */
  stars: number;
}

interface LessonsState {
  completed: Record<string, LessonRecord>;

  /** Record a completion; returns whether this was the first time. */
  complete(id: string, stars: number): { firstTime: boolean };
  isComplete(id: string): boolean;
  starsFor(id: string): number;
  countComplete(ids: string[]): number;
  exportState(): { completed: Record<string, LessonRecord> };
  importMerge(remote: unknown): void;
  reset(): void;
}

export const useLessons = create<LessonsState>()(
  persist(
    (set, get) => ({
      completed: {},

      complete(id, stars) {
        const prev = get().completed[id];
        set({
          completed: {
            ...get().completed,
            [id]: { ts: prev?.ts ?? Date.now(), stars: Math.max(prev?.stars ?? 0, stars) },
          },
        });
        return { firstTime: !prev };
      },

      isComplete(id) {
        return !!get().completed[id];
      },

      starsFor(id) {
        return get().completed[id]?.stars ?? 0;
      },

      countComplete(ids) {
        const c = get().completed;
        return ids.filter((id) => !!c[id]).length;
      },

      exportState() {
        return { completed: get().completed };
      },

      // Union of both devices: earliest completion time, best stars.
      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as Partial<LessonsState>;
        const completed = { ...get().completed };
        for (const [id, rec] of Object.entries(r.completed ?? {})) {
          if (!rec || typeof rec !== 'object') continue;
          const local = completed[id];
          completed[id] = local
            ? { ts: Math.min(local.ts, rec.ts ?? local.ts), stars: Math.max(local.stars, rec.stars ?? 0) }
            : { ts: rec.ts ?? Date.now(), stars: rec.stars ?? 1 };
        }
        set({ completed });
      },

      reset() {
        set({ completed: {} });
      },
    }),
    { name: 'chesser-lessons' },
  ),
);
