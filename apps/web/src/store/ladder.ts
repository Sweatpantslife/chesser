import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Ladder progress: which roster bots you've beaten and when. A bot is "cleared"
 * once you win a game against it; the next rung unlocks. Cleared rungs stay
 * cleared and replayable. Syncs with your account via lib/sync.ts.
 */
interface LadderState {
  /** botId -> epoch ms of the *first* win against it. */
  defeated: Record<string, number>;

  isDefeated(id: string): boolean;
  markDefeated(id: string): void;
  clearedCount(): number;
  exportState(): { defeated: Record<string, number> };
  importMerge(remote: unknown): void;
  reset(): void;
}

export const useLadder = create<LadderState>()(
  persist(
    (set, get) => ({
      defeated: {},

      isDefeated(id) {
        return id in get().defeated;
      },

      markDefeated(id) {
        if (id in get().defeated) return; // keep the first-beaten timestamp
        set({ defeated: { ...get().defeated, [id]: Date.now() } });
      },

      clearedCount() {
        return Object.keys(get().defeated).length;
      },

      exportState() {
        return { defeated: get().defeated };
      },

      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as Partial<LadderState>;
        const merged = { ...get().defeated };
        for (const [id, ts] of Object.entries(r.defeated ?? {})) {
          if (typeof ts !== 'number') continue;
          merged[id] = id in merged ? Math.min(merged[id]!, ts) : ts; // earliest win wins
        }
        set({ defeated: merged });
      },

      reset() {
        set({ defeated: {} });
      },
    }),
    { name: 'chesser-ladder' },
  ),
);
