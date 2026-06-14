import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isDue, newCard, review, type Grade, type SrsCard } from '../lib/srs';

export type Deck = 'openings' | 'tactics';

interface Tally {
  reviews: number;
  correct: number;
}
interface DayStat extends Tally {
  /** Per-deck breakdown (added in v2; older days only have the aggregate). */
  decks?: Partial<Record<Deck, Tally>>;
}

interface ProgressState {
  cards: Record<string, SrsCard>; // key `${deck}:${id}`
  history: Record<string, DayStat>; // key = YYYY-MM-DD
  lastActiveDay: string;
  streak: number;
  bestStreak: number;

  card(deck: Deck, id: string): SrsCard;
  grade(deck: Deck, id: string, grade: Grade): void;
  dueIds(deck: Deck, ids: string[]): string[];
  seenIds(deck: Deck, ids: string[]): string[];
  stats(deck: Deck, ids: string[]): { total: number; seen: number; due: number };
  exportState(): {
    cards: Record<string, SrsCard>;
    history: Record<string, DayStat>;
    lastActiveDay: string;
    streak: number;
    bestStreak: number;
  };
  importMerge(remote: unknown): void;
  reset(): void;
}

const key = (deck: Deck, id: string) => `${deck}:${id}`;
const today = () => new Date().toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const mergeTally = (a: Tally | undefined, b: Tally | undefined): Tally => ({
  reviews: Math.max(a?.reviews ?? 0, b?.reviews ?? 0),
  correct: Math.max(a?.correct ?? 0, b?.correct ?? 0),
});

export const useProgress = create<ProgressState>()(
  persist(
    (set, get) => ({
      cards: {},
      history: {},
      lastActiveDay: '',
      streak: 0,
      bestStreak: 0,

      card(deck, id) {
        return get().cards[key(deck, id)] ?? newCard();
      },

      grade(deck, id, g) {
        const k = key(deck, id);
        const existing = get().cards[k] ?? newCard();
        const updated = review(existing, g);
        const ok = g === 'again' ? 0 : 1;

        const d = today();
        const hist = { ...get().history };
        const day = hist[d] ?? { reviews: 0, correct: 0 };
        const decks = { ...(day.decks ?? {}) };
        const dd = decks[deck] ?? { reviews: 0, correct: 0 };
        decks[deck] = { reviews: dd.reviews + 1, correct: dd.correct + ok };
        hist[d] = { reviews: day.reviews + 1, correct: day.correct + ok, decks };

        // streak: consecutive active days
        const last = get().lastActiveDay;
        let streak = get().streak;
        if (last !== d) streak = last && dayDiff(last, d) === 1 ? streak + 1 : 1;
        const bestStreak = Math.max(get().bestStreak ?? 0, streak);

        set({ cards: { ...get().cards, [k]: updated }, history: hist, lastActiveDay: d, streak, bestStreak });
      },

      dueIds(deck, ids) {
        const now = Date.now();
        const cards = get().cards;
        return ids.filter((id) => {
          const c = cards[key(deck, id)];
          return c ? isDue(c, now) : false; // only previously-seen cards count as "due"
        });
      },

      seenIds(deck, ids) {
        const cards = get().cards;
        return ids.filter((id) => !!cards[key(deck, id)]?.last);
      },

      stats(deck, ids) {
        const seen = get().seenIds(deck, ids).length;
        const due = get().dueIds(deck, ids).length;
        return { total: ids.length, seen, due };
      },

      exportState() {
        const { cards, history, lastActiveDay, streak, bestStreak } = get();
        return { cards, history, lastActiveDay, streak, bestStreak };
      },

      // Merge a remote snapshot into local state (last-write-wins per card).
      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as Partial<ProgressState>;
        const cards = { ...get().cards };
        for (const [k, rc] of Object.entries(r.cards ?? {})) {
          const local = cards[k];
          if (!local || (rc as SrsCard).last > local.last) cards[k] = rc as SrsCard;
        }
        const history = { ...get().history };
        for (const [day, rs] of Object.entries(r.history ?? {})) {
          const local = history[day];
          const rstat = rs as DayStat;
          if (!local) {
            history[day] = rstat;
            continue;
          }
          const decks: Partial<Record<Deck, Tally>> = {};
          for (const dk of ['openings', 'tactics'] as Deck[]) {
            const merged = mergeTally(local.decks?.[dk], rstat.decks?.[dk]);
            if (merged.reviews || merged.correct) decks[dk] = merged;
          }
          history[day] = {
            reviews: Math.max(local.reviews, rstat.reviews),
            correct: Math.max(local.correct, rstat.correct),
            ...(Object.keys(decks).length ? { decks } : {}),
          };
        }
        const lastActiveDay = (r.lastActiveDay ?? '') > get().lastActiveDay ? r.lastActiveDay! : get().lastActiveDay;
        const streak = Math.max(get().streak, r.streak ?? 0);
        const bestStreak = Math.max(get().bestStreak ?? 0, r.bestStreak ?? 0, streak);
        set({ cards, history, lastActiveDay, streak, bestStreak });
      },

      reset() {
        set({ cards: {}, history: {}, lastActiveDay: '', streak: 0, bestStreak: 0 });
      },
    }),
    {
      name: 'chesser-progress',
      version: 2,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<ProgressState>;
        if (p.bestStreak == null) p.bestStreak = p.streak ?? 0;
        return p as ProgressState;
      },
    },
  ),
);
