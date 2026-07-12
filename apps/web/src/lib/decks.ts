// Central registry that ties every spaced-repetition deck to its item ids and
// display metadata. This is what makes the SRS "unified": one place knows about
// all decks, so the Stats page and the review summary can show progress across
// openings, tactics, checkmates and anti-blunder drills together.
import { useMemo } from 'react';
import i18n from '../i18n';
import { useProgress, DECKS, type Deck } from '../store/progress';
import { useRepertoire, BUILTIN_REPERTOIRE } from '../store/repertoire';
import { PUZZLES } from '../trainers/tactics';
import { MATE_DRILL_IDS } from '../trainers/mates';
import { BLUNDER_IDS } from '../trainers/blunders';
import { ENDGAME_DRILL_IDS } from '../trainers/endgameDrills';
import type { PlanItem } from './studyPlan';

/** Where a deck's "Review now" jumps to (a top-level view, optionally a Train sub-tab). */
export type DeckTarget = { view: 'openings' | 'tactics' | 'train' | 'endgame-drills'; trainTab?: 'mates' | 'blunders' };

/**
 * Router path for a study-plan item's trainer — the "Continue" deep link.
 * Coach-served puzzle quotas train inside the plan page's coach panel (that's
 * what credits the item automatically); everything else jumps straight to the
 * trainer that hosts the content.
 */
export function planItemPath(item: PlanItem): string {
  switch (item.kind) {
    case 'puzzle':
      return item.viaCoach ? '/train/plan' : '/train/tactics';
    case 'lesson':
      return '/learn';
    case 'opening':
      return '/learn/openings';
    case 'master':
      return '/learn/masters';
  }
}

/** `label` resolves through the `progress` namespace at access time (the
 *  English literal is the defaultValue), so render sites reading
 *  `DECK_META[deck].label` follow the active language without code changes. */
const deckMeta = (key: Deck, english: string, rest: { accent: string; target: DeckTarget }) => ({
  get label() {
    return i18n.t(`progress:decks.${key}`, { defaultValue: english });
  },
  ...rest,
});

export const DECK_META: Record<Deck, { label: string; accent: string; target: DeckTarget }> = {
  openings: deckMeta('openings', 'Openings', { accent: 'text-sky-300', target: { view: 'openings' } }),
  tactics: deckMeta('tactics', 'Tactics', { accent: 'text-emerald-300', target: { view: 'tactics' } }),
  mates: deckMeta('mates', 'Checkmates', { accent: 'text-rose-300', target: { view: 'train', trainTab: 'mates' } }),
  blunders: deckMeta('blunders', 'Anti-blunder', { accent: 'text-amber-300', target: { view: 'train', trainTab: 'blunders' } }),
  endgames: deckMeta('endgames', 'Endgames', { accent: 'text-brand-300', target: { view: 'endgame-drills' } }),
};

export interface DeckReview {
  deck: Deck;
  total: number;
  seen: number;
  due: number;
}

/** All item ids per deck (openings include the builtin + every custom repertoire). */
export function useDeckIds(): Record<Deck, string[]> {
  const userReps = useRepertoire((s) => s.user);
  return useMemo(
    () => ({
      openings: [...BUILTIN_REPERTOIRE.lines.map((l) => l.id), ...userReps.flatMap((r) => r.lines.map((l) => l.id))],
      tactics: PUZZLES.map((p) => p.id),
      mates: MATE_DRILL_IDS,
      blunders: BLUNDER_IDS,
      endgames: ENDGAME_DRILL_IDS,
    }),
    [userReps],
  );
}

export interface ReviewSummary {
  decks: DeckReview[];
  totalDue: number;
  totalSeen: number;
  totalCards: number;
}

/** Per-deck and aggregate spaced-repetition status, recomputed reactively. */
export function useReviewSummary(): ReviewSummary {
  const cards = useProgress((s) => s.cards);
  const ids = useDeckIds();
  return useMemo(() => {
    const now = Date.now();
    const decks: DeckReview[] = DECKS.map((deck) => {
      let seen = 0;
      let due = 0;
      for (const id of ids[deck]) {
        const c = cards[`${deck}:${id}`];
        if (c?.last) {
          seen++;
          if (c.due <= now) due++;
        }
      }
      return { deck, total: ids[deck].length, seen, due };
    });
    return {
      decks,
      totalDue: decks.reduce((n, d) => n + d.due, 0),
      totalSeen: decks.reduce((n, d) => n + d.seen, 0),
      totalCards: decks.reduce((n, d) => n + d.total, 0),
    };
  }, [cards, ids]);
}
