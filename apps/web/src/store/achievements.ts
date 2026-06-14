import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Which badges the player has unlocked, and when. The catalogue and the logic
 * that decides what's earned live in lib/achievements.ts; this store is just
 * persistence + sync.
 */
interface AchievementsState {
  unlocked: Record<string, number>; // id → epoch ms first earned

  isUnlocked(id: string): boolean;
  /** Record newly-earned ids; returns the ones that were actually new. */
  unlock(ids: string[]): string[];

  exportState(): { unlocked: Record<string, number> };
  importMerge(remote: unknown): void;
  reset(): void;
}

export const useAchievements = create<AchievementsState>()(
  persist(
    (set, get) => ({
      unlocked: {},

      isUnlocked(id) {
        return id in get().unlocked;
      },

      unlock(ids) {
        const cur = get().unlocked;
        const fresh = ids.filter((id) => !(id in cur));
        if (fresh.length === 0) return [];
        const now = Date.now();
        const next = { ...cur };
        for (const id of fresh) next[id] = now;
        set({ unlocked: next });
        return fresh;
      },

      exportState() {
        return { unlocked: get().unlocked };
      },

      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as Partial<AchievementsState>;
        const merged = { ...get().unlocked };
        for (const [id, ts] of Object.entries(r.unlocked ?? {})) {
          if (typeof ts !== 'number') continue;
          merged[id] = id in merged ? Math.min(merged[id]!, ts) : ts; // earliest unlock wins
        }
        set({ unlocked: merged });
      },

      reset() {
        set({ unlocked: {} });
      },
    }),
    { name: 'chesser-achievements' },
  ),
);
