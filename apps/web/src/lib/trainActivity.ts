/**
 * Per-trainer "last activity" for the Train hub's cards, derived from the
 * local stores that already record training work:
 *
 *  - spaced-repetition day tallies (store/progress `history[day].decks`) for
 *    tactics, endgame drills, checkmates and anti-blunder;
 *  - sprint personal-best timestamps (store/sprints) for tactics rush/storm;
 *  - coordinate runs (store/coordinate) for the coordinates trainer.
 *
 * Vision keeps no client-side log, so its card omits the line (`null` =
 * unknown, render nothing). All values are epoch ms; day-level sources
 * resolve to the local midnight of that day.
 */
import { useMemo } from 'react';
import { useProgress, type Deck } from '../store/progress';
import { useSprints } from '../store/sprints';
import { useCoordinate } from '../store/coordinate';

/** Card ids of the Train hub grid (also nav:sections.* i18n keys). */
export type TrainerCardId = 'tactics' | 'endgames' | 'vision' | 'checkmates' | 'antiBlunder' | 'coordinates';

/** SRS deck feeding each card's review badge / activity (null = no deck). */
export const DECK_FOR_CARD: Record<TrainerCardId, Deck | null> = {
  tactics: 'tactics',
  endgames: 'endgames',
  vision: null,
  checkmates: 'mates',
  antiBlunder: 'blunders',
  coordinates: null,
};

/**
 * Due review counts per deck, straight from the stored SRS cards — no id
 * catalogues needed: a card only exists once its item has been trained, which
 * is exactly the population `useReviewSummary` counts "due" from. This keeps
 * the eagerly-loaded Train hub from importing lib/decks, whose puzzle/drill
 * catalogues must stay out of the app-shell chunk (see the route-splitting
 * contract in App.tsx).
 */
export function useDueByDeck(): Partial<Record<Deck, number>> {
  const cards = useProgress((s) => s.cards);
  return useMemo(() => {
    const now = Date.now();
    const due: Partial<Record<Deck, number>> = {};
    for (const [key, card] of Object.entries(cards)) {
      if (!card.last || card.due > now) continue; // unseen or not due yet
      const sep = key.indexOf(':'); // card keys are `${deck}:${id}`
      if (sep <= 0) continue;
      const deck = key.slice(0, sep) as Deck;
      due[deck] = (due[deck] ?? 0) + 1;
    }
    return due;
  }, [cards]);
}

/** Local-midnight epoch ms for a YYYY-MM-DD day key (null when malformed). */
function dayStartTs(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** Latest-activity epoch ms per trainer card; null = nothing recorded. */
export function useTrainerLastActivity(): Record<TrainerCardId, number | null> {
  const history = useProgress((s) => s.history);
  const rushBest = useSprints((s) => s.puzzleRushBest);
  const stormBest = useSprints((s) => s.puzzleStormBest);
  const coordRuns = useCoordinate((s) => s.runs);

  return useMemo(() => {
    // Newest day (local midnight) with at least one review, per deck.
    const byDeck: Partial<Record<Deck, number>> = {};
    for (const [day, stat] of Object.entries(history)) {
      if (!stat.decks) continue; // pre-v2 days have no per-deck breakdown
      const ts = dayStartTs(day);
      if (ts === null) continue;
      for (const [deck, tally] of Object.entries(stat.decks)) {
        if (!tally || tally.reviews <= 0) continue;
        const d = deck as Deck;
        if (ts > (byDeck[d] ?? 0)) byDeck[d] = ts;
      }
    }

    const max = (...ts: (number | undefined)[]) => {
      const best = Math.max(0, ...ts.map((t) => t ?? 0));
      return best > 0 ? best : null;
    };

    return {
      tactics: max(byDeck.tactics, rushBest.timed3.at, rushBest.survival.at, stormBest.at),
      endgames: max(byDeck.endgames),
      vision: null, // the vision trainer keeps no local activity log
      checkmates: max(byDeck.mates),
      antiBlunder: max(byDeck.blunders),
      coordinates: max(...coordRuns.map((r) => r.ts)),
    };
  }, [history, rushBest, stormBest, coordRuns]);
}
