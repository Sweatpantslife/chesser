import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { OPENING_LINES } from '../trainers/openings';

export interface RepLine {
  id: string;
  name: string;
  side: 'white' | 'black';
  moves: string[]; // SAN from the initial position
  eco?: string;
  idea?: string;
}

export interface Repertoire {
  id: string;
  name: string;
  builtin?: boolean;
  lines: RepLine[];
  updatedAt: number;
}

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

/** The curated starter repertoire, surfaced like any other (read-only). */
export const BUILTIN_REPERTOIRE: Repertoire = {
  id: 'builtin',
  name: 'Starter repertoire',
  builtin: true,
  updatedAt: 0,
  lines: OPENING_LINES.map((l) => ({ id: l.id, name: l.name, side: l.side, moves: l.moves, eco: l.eco, idea: l.idea })),
};

interface RepState {
  user: Repertoire[];
  rushHighScore: number;

  createRepertoire(name: string): string;
  renameRepertoire(id: string, name: string): void;
  deleteRepertoire(id: string): void;
  addLine(repId: string, line: Omit<RepLine, 'id'>): void;
  deleteLine(repId: string, lineId: string): void;
  setRushHighScore(n: number): void;

  exportRepertoires(): Repertoire[];
  importMerge(remote: unknown): void;
}

export const useRepertoire = create<RepState>()(
  persist(
    (set, get) => ({
      user: [],
      rushHighScore: 0,

      createRepertoire(name) {
        const id = uid('rep');
        set({ user: [...get().user, { id, name: name.trim() || 'My repertoire', lines: [], updatedAt: Date.now() }] });
        return id;
      },
      renameRepertoire(id, name) {
        set({ user: get().user.map((r) => (r.id === id ? { ...r, name: name.trim() || r.name, updatedAt: Date.now() } : r)) });
      },
      deleteRepertoire(id) {
        set({ user: get().user.filter((r) => r.id !== id) });
      },
      addLine(repId, line) {
        const l: RepLine = { ...line, id: uid('rl') };
        set({ user: get().user.map((r) => (r.id === repId ? { ...r, lines: [...r.lines, l], updatedAt: Date.now() } : r)) });
      },
      deleteLine(repId, lineId) {
        set({
          user: get().user.map((r) =>
            r.id === repId ? { ...r, lines: r.lines.filter((x) => x.id !== lineId), updatedAt: Date.now() } : r,
          ),
        });
      },
      setRushHighScore(n) {
        if (n > get().rushHighScore) set({ rushHighScore: n });
      },

      exportRepertoires() {
        return get().user;
      },
      // Merge synced repertoires (newer updatedAt wins per repertoire id).
      importMerge(remote) {
        if (!Array.isArray(remote)) return;
        const byId = new Map(get().user.map((r) => [r.id, r] as const));
        for (const rr of remote as Repertoire[]) {
          if (!rr || typeof rr.id !== 'string') continue;
          const local = byId.get(rr.id);
          if (!local || (rr.updatedAt ?? 0) > (local.updatedAt ?? 0)) byId.set(rr.id, rr);
        }
        set({ user: [...byId.values()] });
      },
    }),
    { name: 'chesser-repertoire', partialize: (s) => ({ user: s.user, rushHighScore: s.rushHighScore }) },
  ),
);
